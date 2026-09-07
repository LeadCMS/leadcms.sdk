/**
 * Multi-site support (docs/MULTI_SITE.md).
 *
 * One codebase, several content trees. Each named site owns its directories,
 * its default language, its remotes and the sync state of those remotes.
 * Without a `sites` block nothing observable changes.
 */

import fs from "fs";
import os from "os";
import path from "path";

const ACME_ZENITH = {
  defaultLanguage: "en",
  redirects: { outputDir: "redirects", pathPattern: "/{slug}/" },
  sites: {
    acme: {
      root: ".leadcms",
      mediaDir: "public/media",
      remotes: {
        prod: { url: "https://cms.acme.example.com" },
        dev: { url: "https://cms.dev.acme.example.com" },
      },
      defaultRemote: "prod",
    },
    zenith: {
      root: "sites/zenith/.leadcms",
      mediaDir: "sites/zenith/public/media",
      defaultLanguage: "en-GB",
      remotes: {
        prod: { url: "https://cms.zenith.example.com" },
      },
      defaultRemote: "prod",
    },
  },
  defaultSite: "acme",
};

const ENV_KEYS = [
  "LEADCMS_SITE",
  "LEADCMS_URL",
  "NEXT_PUBLIC_LEADCMS_URL",
  "LEADCMS_API_KEY",
  "LEADCMS_REMOTE",
  "LEADCMS_CONTENT_DIR",
  "LEADCMS_MEDIA_DIR",
  "LEADCMS_DEFAULT_LANGUAGE",
  "NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE",
  "LEADCMS_REMOTE_PROD_API_KEY",
  "LEADCMS_REMOTE_DEFAULT_API_KEY",
  "LEADCMS_SITE_ZENITH_REMOTE_PROD_API_KEY",
  "LEADCMS_SITE_ACME_REMOTE_PROD_API_KEY",
];

describe("multi-site", () => {
  let tmpRoot: string;
  let cwd: string;
  const savedEnv = { ...process.env };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let config: any;
  let sites: any;
  let remotes: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const writeConfig = (value: unknown) =>
    fs.writeFileSync(path.join(tmpRoot, "leadcms.config.json"), JSON.stringify(value, null, 2));

  const reload = async () => {
    jest.resetModules();
    jest.unmock("../src/lib/config");
    config = await import("../src/lib/config.js");
    sites = await import("../src/lib/site-context.js");
    remotes = await import("../src/lib/remote-context.js");
  };

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-multi-site-"));
    cwd = process.cwd();
    process.chdir(tmpRoot);
    process.env = { ...savedEnv };
    for (const key of ENV_KEYS) delete process.env[key];
    await reload();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  // ── Single-site mode: nothing changes ─────────────────────────────────

  describe("single-site mode", () => {
    it("uses the implicit default site with today's paths", () => {
      writeConfig({ url: "https://cms.example.com" });
      const cfg = config.loadLocalConfig();
      expect(cfg.site).toBe("default");
      expect(cfg.sites).toBeUndefined();
      expect(cfg.contentDir).toBe(".leadcms/content");
      expect(cfg.settingsDir).toBe(".leadcms/settings");

      const site = sites.getActiveSite();
      expect(site.name).toBe("default");
      expect(site.isDefault).toBe(true);
      expect(site.root).toBe(path.resolve(".leadcms"));
      expect(site.stateBaseDir).toBe(path.resolve(".leadcms/remotes"));
      expect(site.contentDir).toBe(path.resolve(".leadcms/content"));
      expect(site.remotes).toEqual({});
    });

    it("keeps a top-level contentDir winning (no root expansion without sites)", () => {
      writeConfig({ url: "https://cms.example.com", contentDir: "content" });
      expect(config.loadLocalConfig().contentDir).toBe("content");
    });

    it("keeps the remote state directory byte for byte", async () => {
      writeConfig({ url: "https://cms.example.com" });
      const ctx = remotes.resolveRemote();
      expect(ctx.stateDir).toBe(path.resolve(".leadcms/remotes/default"));

      // The raw config file is cached per process; reload to pick up the rewrite.
      writeConfig({
        remotes: { production: { url: "https://prod.example.com" } },
        defaultRemote: "production",
      });
      await reload();
      expect(remotes.resolveRemote("production").stateDir).toBe(
        path.resolve(".leadcms/remotes/production")
      );
    });

    it("lists exactly the implicit site", () => {
      writeConfig({ url: "https://cms.example.com" });
      expect(sites.listSites().map((s: { name: string }) => s.name)).toEqual(["default"]);
    });

    it("rejects LEADCMS_SITE with the same wording remotes use", () => {
      writeConfig({ url: "https://cms.example.com" });
      process.env.LEADCMS_SITE = "zenith";
      expect(() => config.loadLocalConfig()).toThrow(
        /Site "zenith" is not configured\. Add a "sites" block/
      );
    });

    it("rejects resolveSite(name) but accepts the implicit name", () => {
      writeConfig({ url: "https://cms.example.com" });
      expect(() => sites.resolveSite("zenith")).toThrow(/Add a "sites" block/);
      expect(sites.resolveSite("default").name).toBe("default");
    });
  });

  // ── Resolution ────────────────────────────────────────────────────────

  describe("site selection", () => {
    beforeEach(() => writeConfig(ACME_ZENITH));

    it("uses defaultSite when nothing selects a site", () => {
      const cfg = config.loadLocalConfig();
      expect(cfg.site).toBe("acme");
      expect(cfg.contentDir).toBe(".leadcms/content");
      expect(cfg.defaultLanguage).toBe("en");
      expect(Object.keys(cfg.remotes)).toEqual(["prod", "dev"]);
    });

    it("LEADCMS_SITE selects a site", () => {
      process.env.LEADCMS_SITE = "zenith";
      const cfg = config.loadLocalConfig();
      expect(cfg.site).toBe("zenith");
      expect(cfg.contentDir).toBe(path.join("sites/zenith/.leadcms", "content"));
      expect(cfg.defaultLanguage).toBe("en-GB");
      expect(cfg.remotes).toEqual({ prod: { url: "https://cms.zenith.example.com" } });
    });

    it("configure({ site }) beats LEADCMS_SITE", () => {
      process.env.LEADCMS_SITE = "acme";
      config.configure({ site: "zenith" });
      expect(config.loadLocalConfig().site).toBe("zenith");
    });

    it("an explicit resolveSite(name) beats configure() and the environment", () => {
      process.env.LEADCMS_SITE = "zenith";
      config.configure({ site: "zenith" });
      expect(sites.resolveSite("acme").name).toBe("acme");
    });

    it("lists the available sites for an unknown name", () => {
      process.env.LEADCMS_SITE = "nope";
      expect(() => config.loadLocalConfig()).toThrow(
        /Site "nope" is not configured\. Available sites: acme, zenith/
      );
    });

    it("treats a single site without defaultSite as the implicit default", () => {
      writeConfig({ sites: { solo: { root: "cms" } } });
      const cfg = config.loadLocalConfig();
      expect(cfg.site).toBe("solo");
      expect(cfg.contentDir).toBe(path.join("cms", "content"));
      expect(sites.getActiveSite().isDefault).toBe(true);
    });

    it("requires defaultSite with two or more sites", () => {
      const { defaultSite: _dropped, ...withoutDefault } = ACME_ZENITH;
      writeConfig(withoutDefault);
      expect(() => config.loadLocalConfig()).toThrow(/"defaultSite" is not set/);
    });

    it("follows LEADCMS_SITE between calls in one process", () => {
      expect(config.loadLocalConfig().site).toBe("acme");
      process.env.LEADCMS_SITE = "zenith";
      expect(config.loadLocalConfig().site).toBe("zenith");
      delete process.env.LEADCMS_SITE;
      expect(config.loadLocalConfig().site).toBe("acme");
    });
  });

  // ── Effective config ──────────────────────────────────────────────────

  describe("effective configuration", () => {
    it("expands root into the seven entity directories and the state base", () => {
      writeConfig(ACME_ZENITH);
      const zenith = sites.resolveSite("zenith");
      const root = path.resolve("sites/zenith/.leadcms");
      expect(zenith).toMatchObject({
        name: "zenith",
        isDefault: false,
        root,
        defaultLanguage: "en-GB",
        contentDir: path.join(root, "content"),
        commentsDir: path.join(root, "comments"),
        emailTemplatesDir: path.join(root, "email-templates"),
        settingsDir: path.join(root, "settings"),
        segmentsDir: path.join(root, "segments"),
        sequencesDir: path.join(root, "sequences"),
        redirectsDir: path.join(root, "redirects"),
        mediaDir: path.resolve("sites/zenith/public/media"),
        stateBaseDir: path.join(root, "remotes"),
        defaultRemote: "prod",
      });

      const acme = sites.resolveSite("acme");
      expect(acme).toMatchObject({
        name: "acme",
        isDefault: true,
        root: path.resolve(".leadcms"),
        defaultLanguage: "en",
        contentDir: path.resolve(".leadcms/content"),
        redirectsDir: path.resolve(".leadcms/redirects"),
        mediaDir: path.resolve("public/media"),
        stateBaseDir: path.resolve(".leadcms/remotes"),
      });
      expect(Object.keys(acme.remotes)).toEqual(["prod", "dev"]);
    });

    it("lets an explicit per-site directory override the expansion", () => {
      writeConfig({
        sites: {
          acme: { root: ".leadcms", contentDir: "content", mediaDir: "public/media" },
          zenith: { root: "sites/zenith/.leadcms", mediaDir: "sites/zenith/public/media" },
        },
        defaultSite: "acme",
      });
      const cfg = config.loadLocalConfig();
      expect(cfg.contentDir).toBe("content");
      expect(cfg.settingsDir).toBe(path.join(".leadcms", "settings"));
    });

    it("inherits top-level keys that the site does not set", () => {
      writeConfig({
        ...ACME_ZENITH,
        enableDrafts: true,
        languageDomains: { en: "https://en.example.com" },
      });
      process.env.LEADCMS_SITE = "zenith";
      const cfg = config.loadLocalConfig();
      expect(cfg.enableDrafts).toBe(true);
      expect(cfg.redirects).toEqual({ outputDir: "redirects", pathPattern: "/{slug}/" });
      expect(cfg.languageDomains).toEqual({ en: "https://en.example.com" });
      expect(cfg.contentRevisionFile).toBe(".leadcms/content-revision.js");
    });

    it("inherits the top-level mediaDir when a site does not set one", () => {
      writeConfig({ mediaDir: "assets/media", sites: { solo: { root: "cms" } } });
      expect(config.loadLocalConfig().mediaDir).toBe("assets/media");
    });

    it("lets environment variables override the site", () => {
      writeConfig(ACME_ZENITH);
      process.env.LEADCMS_SITE = "zenith";
      process.env.LEADCMS_CONTENT_DIR = "/tmp/x";
      process.env.LEADCMS_DEFAULT_LANGUAGE = "fr";
      const cfg = config.loadLocalConfig();
      expect(cfg.contentDir).toBe("/tmp/x");
      expect(cfg.defaultLanguage).toBe("fr");
      expect(sites.getActiveSite().contentDir).toBe(path.resolve("/tmp/x"));
      // The listing describes the file, not the environment.
      const listed = sites.listSites().find((s: { name: string }) => s.name === "zenith");
      expect(listed.contentDir).toBe(path.resolve("sites/zenith/.leadcms/content"));
      expect(listed.defaultLanguage).toBe("en-GB");
    });

    it("warns once that a top-level directory key is shadowed by the expansion", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeConfig({ ...ACME_ZENITH, contentDir: "content" });
      config.loadLocalConfig();
      config.loadLocalConfig();
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.filter((m) => m.includes('Top-level "contentDir" is ignored'))).toHaveLength(
        1
      );
      expect(config.loadLocalConfig().contentDir).toBe(".leadcms/content");
    });

    it("exposes the site block and default on the effective config", () => {
      writeConfig(ACME_ZENITH);
      const cfg = config.loadLocalConfig();
      expect(cfg.defaultSite).toBe("acme");
      expect(Object.keys(cfg.sites)).toEqual(["acme", "zenith"]);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe("validation", () => {
    const expectError = (value: unknown, pattern: RegExp) => {
      writeConfig(value);
      expect(() => config.loadLocalConfig()).toThrow(pattern);
    };

    it("rejects top-level remotes next to sites", () => {
      expectError(
        { ...ACME_ZENITH, remotes: { prod: { url: "https://x.example.com" } } },
        /Top-level "remotes" is not allowed when "sites" is configured/
      );
    });

    it("rejects a top-level url next to sites", () => {
      expectError(
        { ...ACME_ZENITH, url: "https://x.example.com" },
        /Top-level "url" is not allowed/
      );
    });

    it("rejects a url inside a site", () => {
      expectError(
        { sites: { solo: { url: "https://x.example.com" } } },
        /Site "solo": "url" is not a site key; configure "remotes" instead/
      );
    });

    it("rejects an unknown site key", () => {
      expectError(
        { sites: { solo: { contentdir: "x" } } },
        /Site "solo": unknown key "contentdir"/
      );
    });

    it("rejects two sites with the same contentDir", () => {
      expectError(
        {
          sites: {
            a: { root: "x", mediaDir: "ma" },
            b: { root: "y", contentDir: "x/content", mediaDir: "mb" },
          },
          defaultSite: "a",
        },
        /Sites "a" and "b" resolve to the same contentDir/
      );
    });

    it("rejects two sites that both inherit the same mediaDir", () => {
      expectError(
        { sites: { a: { root: "x" }, b: { root: "y" } }, defaultSite: "a" },
        /Sites "a" and "b" resolve to the same mediaDir/
      );
    });

    it("rejects two sites with the same remote state directory", () => {
      expectError(
        {
          sites: {
            a: { root: "x", mediaDir: "ma" },
            b: { root: "x", contentDir: "other", mediaDir: "mb" },
          },
          defaultSite: "a",
        },
        /Sites "a" and "b" resolve to the same remote state directory/
      );
    });

    it("rejects the reserved name default", () => {
      expectError({ sites: { default: { root: "x" } } }, /"default" is reserved/);
    });

    it("rejects an invalid site name", () => {
      expectError({ sites: { Zenith: { root: "x" } } }, /Invalid site name "Zenith"/);
    });

    it("rejects a site with remotes but no defaultRemote", () => {
      expectError(
        { sites: { solo: { root: "x", remotes: { prod: { url: "https://x.example.com" } } } } },
        /Site "solo": "remotes" is configured but "defaultRemote" is not set/
      );
    });

    it("rejects a defaultSite that does not exist", () => {
      expectError(
        { sites: { solo: { root: "x" } }, defaultSite: "other" },
        /"defaultSite" references "other"/
      );
    });

    it("warns, once, when two sites point at the same instance", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeConfig({
        sites: {
          a: {
            root: "x",
            mediaDir: "ma",
            remotes: { prod: { url: "https://one.example.com/" } },
            defaultRemote: "prod",
          },
          b: {
            root: "y",
            mediaDir: "mb",
            remotes: { live: { url: "https://one.example.com" } },
            defaultRemote: "live",
          },
        },
        defaultSite: "a",
      });
      expect(() => config.loadLocalConfig()).not.toThrow();
      config.loadLocalConfig();
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(
        messages.filter((m) => m.includes('Sites "a" and "b" both have a remote at'))
      ).toHaveLength(1);
    });

    it("allows a site without remotes for local reads and names it when a remote is needed", () => {
      writeConfig({ sites: { solo: { root: "cms" } } });
      expect(config.loadLocalConfig().contentDir).toBe(path.join("cms", "content"));
      expect(() => config.loadConfig()).toThrow(
        /Site "solo" has no "remotes" configured and no LEADCMS_URL is set/
      );

      process.env.LEADCMS_URL = "https://env.example.com/";
      expect(() => config.loadConfig()).not.toThrow();
      const ctx = remotes.resolveRemote();
      expect(ctx.name).toBe("default");
      expect(ctx.url).toBe("https://env.example.com");
      expect(ctx.stateDir).toBe(path.resolve("cms/remotes/default"));
    });
  });

  // ── Remote state isolation and API keys ───────────────────────────────

  describe("remotes within a site", () => {
    beforeEach(() => writeConfig(ACME_ZENITH));

    it("keeps separate state for the same remote name in two sites", () => {
      const acmeProd = remotes.resolveRemote("prod");
      process.env.LEADCMS_SITE = "zenith";
      const zenithProd = remotes.resolveRemote("prod");

      expect(acmeProd.stateDir).toBe(path.resolve(".leadcms/remotes/prod"));
      expect(zenithProd.stateDir).toBe(path.resolve("sites/zenith/.leadcms/remotes/prod"));
      expect(acmeProd.url).toBe("https://cms.acme.example.com");
      expect(zenithProd.url).toBe("https://cms.zenith.example.com");
      expect(remotes.metadataMapPath(zenithProd)).toBe(
        path.resolve("sites/zenith/.leadcms/remotes/prod/metadata.json")
      );
    });

    it("resolves the site's own default remote and lists only its remotes", () => {
      process.env.LEADCMS_SITE = "zenith";
      expect(remotes.resolveRemote().name).toBe("prod");
      expect(remotes.listRemotes().map((r: { name: string }) => r.name)).toEqual(["prod"]);
      expect(() => remotes.resolveRemote("dev")).toThrow(
        /Remote "dev" is not configured for site "zenith"\. Available remotes: prod/
      );
    });

    it("prefers the site-qualified API key, then the remote key, then the generic key", () => {
      process.env.LEADCMS_API_KEY = "generic";
      expect(remotes.resolveRemote("prod").apiKey).toBe("generic");

      process.env.LEADCMS_REMOTE_PROD_API_KEY = "remote";
      expect(remotes.resolveRemote("prod").apiKey).toBe("remote");

      process.env.LEADCMS_SITE_ZENITH_REMOTE_PROD_API_KEY = "zenith-only";
      expect(remotes.resolveRemote("prod").apiKey).toBe("remote"); // acme: no site key
      process.env.LEADCMS_SITE = "zenith";
      expect(remotes.resolveRemote("prod").apiKey).toBe("zenith-only");
    });

    it("names the env vars most specific first", () => {
      expect(remotes.remoteApiKeyEnvNames("prod", "my-site")).toEqual([
        "LEADCMS_SITE_MY_SITE_REMOTE_PROD_API_KEY",
        "LEADCMS_REMOTE_PROD_API_KEY",
        "LEADCMS_API_KEY",
      ]);
      expect(remotes.remoteApiKeyEnvNames("prod")).toEqual([
        "LEADCMS_REMOTE_PROD_API_KEY",
        "LEADCMS_API_KEY",
      ]);
      expect(remotes.remoteApiKeyEnvNames("prod", "default")).toEqual([
        "LEADCMS_REMOTE_PROD_API_KEY",
        "LEADCMS_API_KEY",
      ]);
    });

    it("derives the state directory from a hand-made config", () => {
      const cfg = {
        ...config.loadLocalConfig(),
        site: "zenith",
      };
      expect(remotes.resolveRemote("prod", cfg).stateDir).toBe(
        path.resolve("sites/zenith/.leadcms/remotes/prod")
      );
      expect(sites.siteStateBaseDir({ site: undefined, sites: undefined })).toBe(
        path.resolve(".leadcms/remotes")
      );
    });
  });

  // ── Build-time reads ──────────────────────────────────────────────────

  describe("build-time reads", () => {
    const writeContent = (dir: string, slug: string) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${slug}.mdx`),
        `---\ntype: "page"\ntitle: "${slug}"\npublishedAt: "2024-01-01T00:00:00Z"\n---\n\n# ${slug}\n`
      );
    };

    it("follow LEADCMS_SITE within one process", async () => {
      writeConfig(ACME_ZENITH);
      writeContent(path.join(tmpRoot, ".leadcms/content"), "home");
      writeContent(path.join(tmpRoot, ".leadcms/content/da"), "home");
      writeContent(path.join(tmpRoot, "sites/zenith/.leadcms/content"), "about");
      writeContent(path.join(tmpRoot, "sites/zenith/.leadcms/content/fr"), "about");

      const cms = await import("../src/lib/cms.js");

      expect(cms.getAvailableLanguages()).toEqual(["da", "en"]);
      expect(cms.getAllContentSlugsForLocale("en")).toEqual(["home"]);
      expect(cms.getAllContentSlugsForLocale("da")).toEqual(["home"]);

      process.env.LEADCMS_SITE = "zenith";
      cms.clearContentCache();

      expect(cms.getAvailableLanguages()).toEqual(["en-GB", "fr"]);
      expect(cms.getAllContentSlugsForLocale("en-GB")).toEqual(["about"]);
      expect(cms.getAllContentSlugsForLocale("fr")).toEqual(["about"]);
      expect(cms.getAllContentSlugsForLocale("en")).toEqual([]);

      // The default language of the site decides which locale lives at the root.
      const zenithDir = path.join(tmpRoot, "sites/zenith/.leadcms/content");
      expect(cms.getContentDirForLocale(zenithDir, "en-GB")).toBe(zenithDir);
      expect(cms.getContentDirForLocale(zenithDir, "en")).toBe(path.join(zenithDir, "en"));
    });
  });

  // ── Helper bindings ───────────────────────────────────────────────────

  describe("leadcms-helpers bindings", () => {
    it("rebind to the selected site through configureForSite()", async () => {
      writeConfig({ ...ACME_ZENITH, languageDomains: { en: "https://a", da: "https://b" } });
      const helpers = await import("../src/scripts/leadcms-helpers.js");

      expect(helpers.CONTENT_DIR).toBe(path.resolve(".leadcms/content"));
      expect(helpers.defaultLanguage).toBe("en");
      expect(helpers.singleLanguage).toBeUndefined();

      helpers.configureForSite(sites.resolveSite("zenith"));

      expect(helpers.CONTENT_DIR).toBe(path.resolve("sites/zenith/.leadcms/content"));
      expect(helpers.MEDIA_DIR).toBe(path.resolve("sites/zenith/public/media"));
      expect(helpers.EMAIL_TEMPLATES_DIR).toBe(
        path.resolve("sites/zenith/.leadcms/email-templates")
      );
      expect(helpers.SETTINGS_DIR).toBe(path.resolve("sites/zenith/.leadcms/settings"));
      expect(helpers.SEGMENTS_DIR).toBe(path.resolve("sites/zenith/.leadcms/segments"));
      expect(helpers.SEQUENCES_DIR).toBe(path.resolve("sites/zenith/.leadcms/sequences"));
      expect(helpers.REDIRECTS_DIR).toBe(path.resolve("sites/zenith/.leadcms/redirects"));
      expect(helpers.defaultLanguage).toBe("en-GB");
      // zenith inherits the two-language domain map, so it is still multi-language
      expect(helpers.singleLanguage).toBeUndefined();
    });

    it("compute the bindings for the site selected before import", async () => {
      writeConfig(ACME_ZENITH);
      process.env.LEADCMS_SITE = "zenith";
      const helpers = await import("../src/scripts/leadcms-helpers.js");
      expect(helpers.CONTENT_DIR).toBe(path.resolve("sites/zenith/.leadcms/content"));
      expect(helpers.singleLanguage).toBe("en-GB");
    });
  });

  // ── CLI flag helpers ──────────────────────────────────────────────────

  describe("site flag parsing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let siteArgs: any;

    beforeEach(async () => {
      siteArgs = await import("../src/cli/bin/site-args.js");
    });

    it("reads --site and -s", () => {
      expect(siteArgs.parseSiteArg(["pull", "--site", "zenith"])).toBe("zenith");
      expect(siteArgs.parseSiteArg(["-s", "acme", "--force"])).toBe("acme");
      expect(siteArgs.parseSiteArg(["pull"])).toBeUndefined();
    });

    it("exits when the flag has no value", () => {
      const exit = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
      jest.spyOn(console, "error").mockImplementation(() => {});
      expect(() => siteArgs.parseSiteArg(["--site", "--force"])).toThrow("exit 1");
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("strips the flag and its value", () => {
      expect(siteArgs.stripSiteArgs(["add", "--site", "zenith", "prod", "https://x"])).toEqual([
        "add",
        "prod",
        "https://x",
      ]);
      expect(siteArgs.stripSiteArgs(["-s", "zenith"])).toEqual([]);
    });

    it("selectSite stays silent and exports nothing in single-site mode", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      writeConfig({ url: "https://cms.example.com" });
      const single = siteArgs.selectSite([]);
      expect(single.name).toBe("default");
      expect(process.env.LEADCMS_SITE).toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    });

    it("selectSite exports the site and prints a header in multi-site mode", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      writeConfig(ACME_ZENITH);
      const zenith = siteArgs.selectSite(["-s", "zenith"]);
      expect(zenith.name).toBe("zenith");
      expect(process.env.LEADCMS_SITE).toBe("zenith");
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(
        /Site: zenith\s+\(sites\/zenith\/\.leadcms\)/
      );
      expect(config.loadLocalConfig().site).toBe("zenith");
    });

    it("selectSite exits with the resolution error", () => {
      writeConfig(ACME_ZENITH);
      const exit = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
      const error = jest.spyOn(console, "error").mockImplementation(() => {});
      expect(() => siteArgs.selectSite(["--site", "nope"])).toThrow("exit 1");
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(error.mock.calls[0][0])).toMatch(/Available sites: acme, zenith/);
    });
  });
});
