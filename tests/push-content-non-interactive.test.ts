/**
 * Non-interactive content push (issue #5): `assumeYes` must skip every prompt,
 * and without it a closed stdin must fail the push instead of exiting 0 with
 * nothing pushed.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import matter from "gray-matter";

describe("pushLeadCMSContent without a terminal", () => {
  let tmpDir: string;
  let stdin: PassThrough;
  let createInterface: jest.Mock;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  async function writeContent(slug: string, type: string): Promise<void> {
    await fs.writeFile(
      path.join(tmpDir, "en", `${slug}.mdx`),
      matter.stringify(`# ${slug}`, { title: slug, type }),
      "utf-8"
    );
  }

  async function loadModules() {
    const push = await import("../src/scripts/push-leadcms-content");
    const { leadCMSDataService } = await import("../src/lib/data-service");
    return { pushLeadCMSContent: push.pushLeadCMSContent, leadCMSDataService };
  }

  function printed(spy: jest.SpyInstance): string {
    return spy.mock.calls.map((call) => call.join(" ")).join("\n");
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-push-yes-"));
    await fs.mkdir(path.join(tmpDir, "en"));

    jest.resetModules();

    // A real readline interface on a stream the test controls stands in for
    // process.stdin; ending the stream is `< /dev/null`.
    stdin = new PassThrough();
    const realReadline = jest.requireActual("readline");
    createInterface = jest.fn(() =>
      realReadline.createInterface({ input: stdin, output: new PassThrough() })
    );
    jest.doMock("readline", () => ({
      __esModule: true,
      default: { createInterface },
      createInterface,
    }));

    const config = {
      url: "https://test.leadcms.com",
      apiKey: "test-api-key",
      defaultLanguage: "en",
      contentDir: tmpDir,
      mediaDir: path.join(tmpDir, "media"),
      commentsDir: path.join(tmpDir, "comments"),
      emailTemplatesDir: path.join(tmpDir, "email-templates"),
      settingsDir: path.join(tmpDir, "settings"),
    };
    jest.doMock("../src/lib/config", () => ({
      getConfig: () => config,
      loadLocalConfig: () => config,
      loadConfig: () => config,
      configure: () => undefined,
      isPreviewMode: () => false,
    }));

    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.dontMock("readline");
    jest.dontMock("../src/lib/config");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("pushes with assumeYes without asking anything", async () => {
    await writeContent("hello", "article");
    const { pushLeadCMSContent, leadCMSDataService } = await loadModules();
    const createContent = jest.spyOn(leadCMSDataService, "createContent");

    await pushLeadCMSContent({ assumeYes: true });

    expect(createInterface).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(createContent).toHaveBeenCalledTimes(1);
    expect(printed(consoleLog)).toContain("--yes given: pushing 1 change(s) without confirmation.");
  });

  it("creates missing content types from defaults with assumeYes", async () => {
    await writeContent("hello", "article");
    await writeContent("support", "support");
    const { pushLeadCMSContent, leadCMSDataService } = await loadModules();
    const createContentType = jest.spyOn(leadCMSDataService, "createContentType");
    const createContent = jest.spyOn(leadCMSDataService, "createContent");

    await pushLeadCMSContent({ assumeYes: true });

    expect(createInterface).not.toHaveBeenCalled();
    expect(createContentType).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "support", format: "MDX" })
    );
    expect(createContent).toHaveBeenCalledTimes(2);
  });

  it("fails the push when stdin closes at the confirmation", async () => {
    await writeContent("hello", "article");
    const { pushLeadCMSContent, leadCMSDataService } = await loadModules();
    const createContent = jest.spyOn(leadCMSDataService, "createContent");

    stdin.end();
    await pushLeadCMSContent({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(createContent).not.toHaveBeenCalled();
    expect(printed(consoleError)).toContain("Pass --yes (-y) to push without prompts.");
  });

  it("fails the push when stdin closes at the content type prompt", async () => {
    await writeContent("support", "support");
    const { pushLeadCMSContent, leadCMSDataService } = await loadModules();
    const createContentType = jest.spyOn(leadCMSDataService, "createContentType");

    stdin.end();
    await pushLeadCMSContent({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(createContentType).not.toHaveBeenCalled();
    expect(printed(consoleError)).toContain("Would you like me to create these content types");
  });

  it("still accepts a piped answer to the confirmation", async () => {
    await writeContent("hello", "article");
    const { pushLeadCMSContent, leadCMSDataService } = await loadModules();
    const createContent = jest.spyOn(leadCMSDataService, "createContent");

    stdin.end("y\n");
    await pushLeadCMSContent({});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(createContent).toHaveBeenCalledTimes(1);
  });
});
