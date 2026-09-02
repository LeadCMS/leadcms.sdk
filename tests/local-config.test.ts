import fs from "fs";
import os from "os";
import path from "path";

/**
 * Commands that only touch local files must work without a remote. Sites that
 * develop against committed content — with no LeadCMS instance reachable, or
 * before one exists — would otherwise be unable to run them at all.
 */
describe("loadLocalConfig", () => {
  let tmpRoot: string;
  let cwd: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-local-config-"));
    cwd = process.cwd();
    process.chdir(tmpRoot);

    jest.resetModules();
    jest.unmock("../src/lib/config");
    delete process.env.LEADCMS_URL;
    delete process.env.LEADCMS_CONTENT_DIR;

    config = await import("../src/lib/config.js");
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves directories with no url configured", () => {
    const local = config.loadLocalConfig();
    expect(local.contentDir).toBe(".leadcms/content");
    expect(local.contentRevisionFile).toBe(".leadcms/content-revision.js");
  });

  it("still rejects a missing url when the remote is actually needed", () => {
    expect(() => config.loadConfig()).toThrow(/Missing required configuration: url/);
  });

  it("honours contentRevisionFile from the config file", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "leadcms.config.json"),
      JSON.stringify({ contentRevisionFile: "src/generated/revision.js" })
    );
    expect(config.loadLocalConfig().contentRevisionFile).toBe("src/generated/revision.js");
  });
});
