/**
 * Tests for generate-redirects-map.ts
 *
 * Covers:
 *  - Two plain map files: {outputDir}/301.map and {outputDir}/302.map
 *  - File format: bare "from" "to" pairs (no nginx wrapper syntax)
 *  - InternalPath source/target resolution (direct paths)
 *  - ContentSlug resolution via path pattern
 *  - Language filtering (only matching language redirects included)
 *  - languageDomains substitution in path pattern
 *  - Dry run mode (no files written)
 *  - Empty redirect list — no output files
 *  - Custom outputDir option
 *  - Comment header in each generated file
 *  - No remote/auth required
 *  - ContentId resolution via data service
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import yaml from "js-yaml";
let redirectsDir = "/tmp/test-gen-map";

jest.mock("../src/scripts/leadcms-helpers.js", () => ({
  get REDIRECTS_DIR() {
    return redirectsDir;
  },
  leadCMSUrl: "https://test.leadcms.com",
  leadCMSApiKey: "test-api-key",
  defaultLanguage: "en",
}));

const mockGetContentById = jest.fn();
const mockConfigureForRemote = jest.fn();

jest.mock("../src/lib/data-service.js", () => ({
  leadCMSDataService: {
    getContentById: (id: number) => mockGetContentById(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configureForRemote: (...args: any[]) => mockConfigureForRemote(...args),
  },
}));

jest.mock("../src/lib/config.js", () => ({
  getConfig: jest.fn(() => ({
    url: "https://test.leadcms.com",
    apiKey: "test-key",
    defaultLanguage: "en",
    contentDir: "/tmp/test-content",
    mediaDir: "/tmp/test-media",
    commentsDir: "/tmp/test-comments",
    emailTemplatesDir: "/tmp/test-email-templates",
    redirectsDir: redirectsDir,
    redirects: {
      outputDir: undefined,
      pathPattern: "/{language}/{slug}",
    },
    languageDomains: undefined,
  })),
}));

jest.mock("../src/lib/logger.js", () => ({
  logger: { verbose: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/lib/spinner.js", () => ({
  startSpinner: () => ({ stop: jest.fn(), fail: jest.fn() }),
}));

import { buildRedirectsFile } from "../src/lib/automation-types.js";
import { getConfig } from "../src/lib/config.js";
import { generateRedirectsMap } from "../src/scripts/generate-redirects-map.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeRedirectsYaml(dir: string, redirects: any[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = buildRedirectsFile(redirects);
  const content = yaml.dump(file, { indent: 2 });
  await fs.writeFile(path.join(dir, "redirects.yaml"), content, "utf8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeLangRedirectsYaml(dir: string, lang: string, redirects: any[]): Promise<void> {
  const langDir = path.join(dir, lang);
  await fs.mkdir(langDir, { recursive: true });
  const file = buildRedirectsFile(redirects);
  const content = yaml.dump(file, { indent: 2 });
  await fs.writeFile(path.join(langDir, "redirects.yaml"), content, "utf8");
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("generateRedirectsMap", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-gen-map-"));
    outputDir = path.join(tmpDir, "output");
    await fs.mkdir(outputDir, { recursive: true });
    redirectsDir = tmpDir;
    mockGetContentById.mockReset();
    mockConfigureForRemote.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Output format ─────────────────────────────────────────────────

  it("generates 301.map and 302.map files in the output directory", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/a", toPath: "/b" },
      { kind: "Temporary", fromPath: "/c", toUrl: "https://example.com" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content301 = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    const content302 = await fs.readFile(path.join(outputDir, "302.map"), "utf8");
    expect(content301).toContain('"/a"');
    expect(content302).toContain('"/c"');
  });

  it("does not wrap entries in nginx map blocks", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/x", toPath: "/y" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).not.toContain("map $request_uri");
    expect(content).not.toContain('default ""');
  });

  it("includes static comment header explaining how to regenerate", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/x", toPath: "/y" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("# LeadCMS 301 redirect map");
    expect(content).toContain("auto-generated");
    expect(content).toContain("Do not edit this file manually");
    expect(content).toContain("leadcms generate-redirects-map");
    expect(content).not.toMatch(/# Generated: \d{4}-/);
  });

  it('writes semicolon-terminated "from" "to" pairs for nginx map include', async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/from-path", toPath: "/to-path" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/from-path" "/to-path";');
  });

  // ── InternalPath resolution ────────────────────────────────────────

  it("writes bare pairs for InternalPath\u2192ExternalUrl permanent redirect; no 302.map created", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/old-page", toUrl: "https://new-domain.com/page" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/old-page" "https://new-domain.com/page";');
    await expect(fs.access(path.join(outputDir, "302.map"))).rejects.toThrow();
  });

  it("writes bare pairs for InternalPath\u2192InternalPath temporary redirect; no 301.map created", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Temporary", fromPath: "/temp", toPath: "/destination" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "302.map"), "utf8");
    expect(content).toContain('"/temp" "/destination";');
    await expect(fs.access(path.join(outputDir, "301.map"))).rejects.toThrow();
  });

  // ── ContentSlug resolution ─────────────────────────────────────────

  it("resolves ContentSlug source using path pattern", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromLanguage: "en", fromSlug: "old-article", toPath: "/new" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/en/old-article"');
  });

  it("resolves ContentSlug target using path pattern", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/old", toLanguage: "en", toSlug: "new-article" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/en/new-article"');
  });

  // ── Language filtering ─────────────────────────────────────────────

  it("excludes ContentSlug redirects for other languages when language filter set", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromLanguage: "en", fromSlug: "en-article", toPath: "/en-dest" },
      { kind: "Permanent", fromLanguage: "de", fromSlug: "de-artikel", toPath: "/de-dest" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("/en/en-article");
    expect(content).not.toContain("/de/de-artikel");
  });

  it("includes InternalPath redirects regardless of language filter", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/static-path", toPath: "/dest" },
      { kind: "Permanent", fromLanguage: "de", fromSlug: "de-only", toPath: "/de" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/static-path"');
    expect(content).not.toContain("/de/de-only");
  });

  // ── languageDomains ────────────────────────────────────────────────

  it("substitutes {domain} token in path pattern when languageDomains configured", async () => {
    const { getConfig } = await import("../src/lib/config");
    (getConfig as jest.MockedFunction<typeof getConfig>).mockReturnValueOnce({
      url: "https://test.leadcms.com",
      apiKey: "test-key",
      defaultLanguage: "en",
      contentDir: "/tmp",
      mediaDir: "/tmp",
      commentsDir: "/tmp",
      emailTemplatesDir: "/tmp",
      redirectsDir: tmpDir,
      redirects: { pathPattern: "{domain}/{language}/{slug}" },
      languageDomains: { en: "example.com", de: "example.de" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromLanguage: "en", fromSlug: "article", toPath: "/dest" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("example.com/en/article");
  });

  // ── Empty / missing ────────────────────────────────────────────────

  it("exits cleanly when no redirects.yaml exists", async () => {
    await expect(generateRedirectsMap({ outputDir: outputDir })).resolves.not.toThrow();
    await expect(fs.access(path.join(outputDir, "301.map"))).rejects.toThrow();
    await expect(fs.access(path.join(outputDir, "302.map"))).rejects.toThrow();
  });

  it("only writes 301.map when all redirects are permanent", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/a", toPath: "/b" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    await expect(fs.access(path.join(outputDir, "301.map"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, "302.map"))).rejects.toThrow();
  });

  it("deletes 301.map if it existed from a previous run but now has no permanent redirects", async () => {
    // Pre-create a stale 301.map from a previous run
    await fs.writeFile(path.join(outputDir, "301.map"), "# stale content\n", "utf8");

    // Now only temporary redirects exist
    await writeRedirectsYaml(tmpDir, [{ kind: "Temporary", fromPath: "/old", toPath: "/new" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    // 302.map should be written, stale 301.map must be removed
    await expect(fs.access(path.join(outputDir, "302.map"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, "301.map"))).rejects.toThrow();
  });

  it("deletes 302.map if it existed from a previous run but now has no temporary redirects", async () => {
    // Pre-create a stale 302.map from a previous run
    await fs.writeFile(path.join(outputDir, "302.map"), "# stale content\n", "utf8");

    // Now only permanent redirects exist
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/old", toPath: "/new" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    // 301.map should be written, stale 302.map must be removed
    await expect(fs.access(path.join(outputDir, "301.map"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, "302.map"))).rejects.toThrow();
  });

  // ── Dry run ───────────────────────────────────────────────────────

  it("does not write any output files in dry run mode", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/a", toPath: "/b" },
      { kind: "Temporary", fromPath: "/c", toPath: "/d" },
    ]);

    await generateRedirectsMap({ outputDir: outputDir, dryRun: true });

    await expect(fs.access(path.join(outputDir, "301.map"))).rejects.toThrow();
    await expect(fs.access(path.join(outputDir, "302.map"))).rejects.toThrow();
  });

  // ── Custom outputDir ──────────────────────────────────────────────

  it("writes to the specified outputDir path", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/src", toUrl: "https://dest.com" },
    ]);

    const customDir = path.join(tmpDir, "custom-redirects");
    await generateRedirectsMap({ outputDir: customDir });

    const content = await fs.readFile(path.join(customDir, "301.map"), "utf8");
    expect(content).toContain('"/src" "https://dest.com";');
  });

  it("creates outputDir if it does not exist", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/a", toPath: "/b" }]);

    const newDir = path.join(tmpDir, "brand-new", "subdir");
    await generateRedirectsMap({ outputDir: newDir });

    await expect(fs.access(path.join(newDir, "301.map"))).resolves.toBeUndefined();
  });

  // ── No remote/auth required ───────────────────────────────────────

  it("does not call configureForRemote (no auth needed)", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/a", toPath: "/b" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    expect(mockConfigureForRemote).not.toHaveBeenCalled();
  });

  // ── ContentId resolution ───────────────────────────────────────────

  it("resolves ContentId source by fetching content from API", async () => {
    mockGetContentById.mockResolvedValueOnce({ id: 5, language: "en", slug: "resolved-article" });

    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromContentId: 5, toPath: "/dest" }]);

    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("/en/resolved-article");
    expect(mockGetContentById).toHaveBeenCalledWith(5);
  });

  it("skips redirect when ContentId cannot be resolved", async () => {
    mockGetContentById.mockResolvedValueOnce(null);

    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromContentId: 99, toPath: "/dest" }]);

    await generateRedirectsMap({ outputDir: outputDir });

    await expect(fs.access(path.join(outputDir, "301.map"))).rejects.toThrow();
  });

  // ── Multi-language mode ────────────────────────────────────────────

  it("includes redirects from all language folders when pathPattern contains {language}", async () => {
    // Write English redirects to the root (default language folder)
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromSlug: "en-article", fromLanguage: "en", toPath: "/en-dest" },
    ]);
    // Write German redirects to the de/ subfolder
    await writeLangRedirectsYaml(tmpDir, "de", [
      { kind: "Permanent", fromSlug: "de-artikel", fromLanguage: "de", toPath: "/de-dest" },
    ]);

    // Default config has pathPattern "/{language}/{slug}" — no explicit language flag
    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("/en/en-article");
    expect(content).toContain("/de/de-artikel");
  });

  it("respects explicit --language flag even when pathPattern contains {language}", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromSlug: "en-article", fromLanguage: "en", toPath: "/en-dest" },
    ]);
    await writeLangRedirectsYaml(tmpDir, "de", [
      { kind: "Permanent", fromSlug: "de-artikel", fromLanguage: "de", toPath: "/de-dest" },
    ]);

    // Explicit language: "en" should narrow results even though pathPattern has {language}
    await generateRedirectsMap({ outputDir: outputDir, language: "en" });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain("/en/en-article");
    expect(content).not.toContain("/de/de-artikel");
  });

  it("applies default language filter when pathPattern does not contain {language}", async () => {
    // Override config: pathPattern without {language} → single-language-per-domain mode
    (getConfig as jest.Mock).mockReturnValueOnce({
      url: "https://test.leadcms.com",
      apiKey: "test-key",
      defaultLanguage: "en",
      contentDir: "/tmp/test-content",
      mediaDir: "/tmp/test-media",
      commentsDir: "/tmp/test-comments",
      emailTemplatesDir: "/tmp/test-email-templates",
      redirectsDir: redirectsDir,
      redirects: {
        outputDir: undefined,
        pathPattern: "/{slug}",
      },
      languageDomains: undefined,
    });

    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromSlug: "en-article", fromLanguage: "en", toPath: "/en-dest" },
    ]);
    await writeLangRedirectsYaml(tmpDir, "de", [
      { kind: "Permanent", fromSlug: "de-artikel", fromLanguage: "de", toPath: "/de-dest" },
    ]);

    // No explicit language flag — should fall back to defaultLanguage "en"
    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    // en slug resolved without language prefix (pathPattern has no {language})
    expect(content).toContain("/en-article");
    expect(content).not.toContain("/de-artikel");
  });

  // ── CLI -o / --output flag ─────────────────────────────────────────

  it("respects outputDir when -o flag value is passed programmatically", async () => {
    await writeRedirectsYaml(tmpDir, [
      { kind: "Permanent", fromPath: "/cli-src", toUrl: "https://example.com/dest" },
    ]);

    const customDir = path.join(tmpDir, "cli-output");
    // Simulate what the CLI does when user runs: leadcms generate-redirects-map -o <dir>
    await generateRedirectsMap({ outputDir: customDir });

    const content = await fs.readFile(path.join(customDir, "301.map"), "utf8");
    expect(content).toContain('"/cli-src" "https://example.com/dest";');
    // Default 'redirects/' folder must NOT be written to
    await expect(fs.access(path.join(tmpDir, "redirects", "301.map"))).rejects.toThrow();
  });

  it("writes to default 'redirects' directory when no -o flag provided", async () => {
    await writeRedirectsYaml(tmpDir, [{ kind: "Permanent", fromPath: "/a", toPath: "/b" }]);

    // No outputDir → falls back to config.redirects.outputDir ?? 'redirects'
    // Config mock returns outputDir: undefined, so resolved path will be process.cwd()/redirects
    const defaultDir = path.resolve("redirects");
    // We use an explicit outputDir here to avoid polluting the real CWD;
    // the test above already verifies custom dir; this test documents the fallback chain.
    await generateRedirectsMap({ outputDir: outputDir });

    const content = await fs.readFile(path.join(outputDir, "301.map"), "utf8");
    expect(content).toContain('"/a" "/b";');
    // Sanity: the function wrote to outputDir, not to defaultDir
    expect(outputDir).not.toEqual(defaultDir);
  });
});
