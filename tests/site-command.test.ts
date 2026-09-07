/**
 * `leadcms site …` and `--site` on `leadcms remote …`, run against the built
 * CLI in a temporary project. Requires `pnpm run build` first, like the
 * version command tests.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const CLI_PATH = path.resolve(__dirname, "../dist/cli/index.js");

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

describe("leadcms site", () => {
  let tmpRoot: string;

  const configPath = () => path.join(tmpRoot, "leadcms.config.json");
  const writeConfig = (value: unknown) =>
    fs.writeFileSync(configPath(), JSON.stringify(value, null, 2) + "\n");
  const readConfig = () => JSON.parse(fs.readFileSync(configPath(), "utf-8"));

  const run = (...args: string[]): RunResult => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("LEADCMS_") || key.startsWith("NEXT_PUBLIC_LEADCMS_")) delete env[key];
    }
    try {
      const stdout = execFileSync("node", [CLI_PATH, ...args], {
        cwd: tmpRoot,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { stdout, stderr: "", status: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? "",
        status: failed.status ?? 1,
      };
    }
  };

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'pnpm run build' first. Expected: ${CLI_PATH}`);
    }
  });

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-site-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const SINGLE_SITE = {
    defaultLanguage: "ru-RU",
    contentDir: ".leadcms/content",
    mediaDir: "public/media",
    remotes: {
      prod: { url: "https://cms.acme.example.com" },
      dev: { url: "https://cms.dev.acme.example.com" },
    },
    defaultRemote: "prod",
    redirects: { outputDir: "redirects", pathPattern: "/{slug}/" },
  };

  it("wraps a single-site config into a site and adds the new one", () => {
    writeConfig(SINGLE_SITE);
    // Existing state must be picked up unchanged: it stays under .leadcms/remotes
    fs.mkdirSync(path.join(tmpRoot, ".leadcms/remotes/prod"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, ".leadcms/remotes/prod/metadata.json"),
      JSON.stringify({
        version: 2,
        content: { syncToken: "tok-1", items: { en: { home: { id: 1 } } } },
      })
    );

    const result = run(
      "site",
      "add",
      "zenith",
      "--existing-name",
      "acme",
      "--yes",
      "--language",
      "en-GB",
      "--remote",
      "prod=https://cms.zenith.example.com/",
      "--remote",
      "dev=https://cms.dev.zenith.example.com"
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Added site "zenith"');

    const written = readConfig();
    expect(written.remotes).toBeUndefined();
    expect(written.defaultRemote).toBeUndefined();
    expect(written.contentDir).toBeUndefined();
    expect(written.mediaDir).toBeUndefined();
    // Shared defaults stay at the top level
    expect(written.defaultLanguage).toBe("ru-RU");
    expect(written.redirects).toEqual(SINGLE_SITE.redirects);
    expect(written.defaultSite).toBe("acme");
    expect(written.sites.acme).toEqual({
      root: ".leadcms",
      mediaDir: "public/media",
      remotes: SINGLE_SITE.remotes,
      defaultRemote: "prod",
    });
    expect(written.sites.zenith).toEqual({
      root: "sites/zenith/.leadcms",
      mediaDir: "sites/zenith/public/media",
      defaultLanguage: "en-GB",
      remotes: {
        prod: { url: "https://cms.zenith.example.com" },
        dev: { url: "https://cms.dev.zenith.example.com" },
      },
      defaultRemote: "prod",
    });

    const show = run("site", "show", "acme");
    expect(show.status).toBe(0);
    expect(show.stdout).toContain("Checkpoints:    content=tok-1");
  });

  it("turns a flat url into a remote named default so its checkpoint survives", () => {
    writeConfig({ url: "https://cms.example.com/", mediaDir: "static/media" });
    const result = run("site", "add", "second", "--existing-name", "first", "--yes");
    expect(result.status).toBe(0);
    const written = readConfig();
    expect(written.url).toBeUndefined();
    expect(written.sites.first).toEqual({
      root: ".leadcms",
      mediaDir: "static/media",
      remotes: { default: { url: "https://cms.example.com" } },
      defaultRemote: "default",
    });
    expect(written.defaultSite).toBe("first");
  });

  it("refuses the migration without a name for the existing site when not interactive", () => {
    writeConfig(SINGLE_SITE);
    const result = run("site", "add", "zenith", "--yes");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--existing-name");
    expect(readConfig()).toEqual(SINGLE_SITE);
  });

  it("does not write a config that fails validation", () => {
    writeConfig(SINGLE_SITE);
    // Same root as the existing site → same content and state directories
    const result = run(
      "site",
      "add",
      "zenith",
      "--existing-name",
      "acme",
      "--yes",
      "--root",
      ".leadcms",
      "--media-dir",
      "other/media"
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("resolve to the same contentDir");
    expect(readConfig()).toEqual(SINGLE_SITE);
  });

  describe("on a multi-site project", () => {
    const MULTI = {
      defaultLanguage: "en",
      sites: {
        acme: {
          root: ".leadcms",
          mediaDir: "public/media",
          remotes: { prod: { url: "https://cms.acme.example.com" } },
          defaultRemote: "prod",
        },
        zenith: {
          root: "sites/zenith/.leadcms",
          mediaDir: "sites/zenith/public/media",
          defaultLanguage: "en-GB",
          remotes: { prod: { url: "https://cms.zenith.example.com" } },
          defaultRemote: "prod",
        },
      },
      defaultSite: "acme",
    };

    beforeEach(() => writeConfig(MULTI));

    it("lists sites with the active and default markers", () => {
      const result = run("site", "list");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(
        /\* acme\s+\.leadcms\s+en\s+remotes: prod \(default\)\s+\[default\]/
      );
      expect(result.stdout).toMatch(
        / {2}zenith\s+sites\/zenith\/\.leadcms\s+en-GB\s+remotes: prod \(default\)/
      );

      const names = run("site", "list", "--names");
      expect(names.stdout.trim().split("\n")).toEqual(["acme", "zenith"]);
    });

    it("shows a site's directories and remotes", () => {
      const result = run("site", "show", "zenith");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Site:             zenith");
      expect(result.stdout).toContain("Language:         en-GB");
      expect(result.stdout).toContain(
        `Content:          ${path.join("sites/zenith/.leadcms", "content")}`
      );
      expect(result.stdout).toContain(
        `State:            ${path.join("sites/zenith/.leadcms", "remotes")}`
      );
      expect(result.stdout).toContain("prod (default)    https://cms.zenith.example.com");
      expect(result.stdout).toContain("LEADCMS_SITE_ZENITH_REMOTE_PROD_API_KEY=<key>");
      expect(result.stdout).toContain("none yet");
    });

    it("changes the default site", () => {
      expect(run("site", "set-default", "zenith").status).toBe(0);
      expect(readConfig().defaultSite).toBe("zenith");
      expect(run("site", "set-default", "nope").status).toBe(1);
    });

    it("removes a site's config entry only", () => {
      fs.mkdirSync(path.join(tmpRoot, "sites/zenith/.leadcms/content"), { recursive: true });
      const result = run("site", "remove", "zenith");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("left in place");
      expect(readConfig().sites.zenith).toBeUndefined();
      expect(readConfig().defaultSite).toBe("acme");
      expect(fs.existsSync(path.join(tmpRoot, "sites/zenith/.leadcms/content"))).toBe(true);
    });

    it("returns to single-site mode when the last site is removed", () => {
      run("site", "remove", "zenith");
      const result = run("site", "remove", "acme");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("single-site mode");
      const written = readConfig();
      expect(written.sites).toBeUndefined();
      expect(written.defaultSite).toBeUndefined();
    });

    it("rejects adding a site that exists or is reserved", () => {
      expect(run("site", "add", "zenith").stderr).toContain("already exists");
      expect(run("site", "add", "default").stderr).toContain("reserved");
      expect(run("site", "add", "Bad_Name").stderr).toContain("lowercase alphanumeric");
      expect(readConfig()).toEqual(MULTI);
    });

    it("writes remotes into the selected site's block", () => {
      const add = run(
        "remote",
        "add",
        "dev",
        "https://cms.dev.zenith.example.com",
        "--site",
        "zenith"
      );
      expect(add.status).toBe(0);
      expect(add.stdout).toContain("Site: zenith");
      expect(add.stdout).toContain('(site "zenith")');
      const written = readConfig();
      expect(written.sites.zenith.remotes.dev).toEqual({
        url: "https://cms.dev.zenith.example.com",
      });
      expect(written.sites.acme.remotes.dev).toBeUndefined();
      expect(written.remotes).toBeUndefined();

      expect(run("remote", "set-default", "dev", "-s", "zenith").status).toBe(0);
      expect(readConfig().sites.zenith.defaultRemote).toBe("dev");

      expect(run("remote", "remove", "dev", "--site", "zenith").status).toBe(0);
      expect(readConfig().sites.zenith.defaultRemote).toBe("prod");
      expect(readConfig().sites.zenith.remotes.dev).toBeUndefined();
    });

    it("lists the selected site's remotes under a site header", () => {
      const result = run("remote", "list", "-s", "zenith");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/🏷 {2}Site: zenith\s+\(sites\/zenith\/\.leadcms\)/);
      expect(result.stdout).toContain("https://cms.zenith.example.com");
      expect(result.stdout).not.toContain("acme.example.com");

      const byDefault = run("remote", "list");
      expect(byDefault.stdout).toMatch(/Site: acme \(default\)/);
      expect(byDefault.stdout).toContain("https://cms.acme.example.com");
    });

    it("rejects an unknown site on any command", () => {
      const result = run("remote", "list", "--site", "nope");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Available sites: acme, zenith");
    });
  });

  it("rejects --site on a single-site project", () => {
    writeConfig(SINGLE_SITE);
    const result = run("remote", "list", "--site", "zenith");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Add a "sites" block');

    // Without the flag nothing changes for single-site projects: no site header.
    const plain = run("remote", "list");
    expect(plain.status).toBe(0);
    expect(plain.stdout).not.toContain("Site:");
    expect(plain.stdout).toContain("prod (default)");
  });
});
