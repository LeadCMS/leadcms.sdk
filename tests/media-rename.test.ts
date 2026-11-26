/**
 * Media files LeadCMS stores under a different name (issue #6): predict the
 * name before upload, report renames after it, and let the push skip or fail
 * on such files instead of renaming them locally.
 */

import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { predictServerMediaName } from "../src/lib/media-names";
import {
  displayMediaStatus,
  executeMediaPush,
  matchMediaFiles,
  pushMedia,
  reconcileLocalFile,
  type LocalMediaFile,
  type MediaDependencies,
  type MediaOperation,
} from "../src/scripts/push-media";
import type { MediaItem } from "../src/lib/data-service";
import { parseMediaRenameFlag } from "../src/cli/bin/media-rename-flag";

let mediaDir: string;

beforeEach(async () => {
  mediaDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "leadcms-media-rename-"));
});

afterEach(async () => {
  await fsPromises.rm(mediaDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

async function createLocalFile(relPath: string, content: string): Promise<LocalMediaFile> {
  const absolutePath = path.join(mediaDir, relPath);
  await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsPromises.writeFile(absolutePath, content);
  const scopeUid = path.posix.dirname(relPath) === "." ? "" : path.posix.dirname(relPath);
  const name = path.posix.basename(relPath);
  return {
    filePath: relPath,
    absolutePath,
    scopeUid,
    name,
    size: Buffer.byteLength(content),
    extension: path.extname(name),
    mimeType: "image/png",
  };
}

async function listFiles(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await fsPromises.readdir(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else out.push(childRel);
    }
  }
  await walk(mediaDir, "");
  return out.sort();
}

/** What LeadCMS answers to an upload: the file under its normalised name. */
function serverItem(local: LocalMediaFile, id = 1): MediaItem {
  const name = predictServerMediaName(local.name);
  return {
    id,
    location: `/api/media/${local.scopeUid}/${name}`,
    scopeUid: local.scopeUid,
    name,
    size: local.size,
    extension: path.extname(name),
    mimeType: local.mimeType,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
  };
}

function makeDeps(overrides: Partial<MediaDependencies> = {}) {
  return {
    fetchRemoteMedia: jest.fn().mockResolvedValue([]),
    fetchDeletedMedia: jest.fn().mockResolvedValue([]),
    uploadMedia: jest.fn(),
    updateMedia: jest.fn(),
    deleteMedia: jest.fn(),
    downloadMediaFile: jest.fn().mockResolvedValue(Buffer.from("downloaded")),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
    logSuccess: jest.fn(),
    promptConfirmation: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function messages(mock: jest.Mock): string {
  return mock.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("predictServerMediaName", () => {
  it.each([
    ["fire_extinguisher.svg", "fire-extinguisher.svg"],
    ["Request_details.png", "request-details.png"],
    ["chart@2x.png", "chart2x.png"],
    ["Team Photo  2024.JPG", "team-photo-2024.jpg"],
    ["café crème.png", "cafe-creme.png"],
    ["Привет мир.jpg", "privet-mir.jpg"],
    ["already-fine.webp", "already-fine.webp"],
  ])("%s → %s", (input, expected) => {
    expect(predictServerMediaName(input)).toBe(expected);
  });

  it("predicts a name the server keeps as is", () => {
    for (const name of ["fire_extinguisher.svg", "chart@2x.png", "日本 語.png", "A b_C.PNG"]) {
      const predicted = predictServerMediaName(name);
      expect(predictServerMediaName(predicted)).toBe(predicted);
    }
  });
});

describe("matchMediaFiles: server names", () => {
  it("marks new files LeadCMS will rename, and only those", async () => {
    const renamed = await createLocalFile("icons/fire_extinguisher.svg", "a");
    const clean = await createLocalFile("icons/plain.svg", "b");

    const ops = matchMediaFiles([renamed, clean], []);

    expect(ops.find((op) => op.local === renamed)?.serverName).toBe("fire-extinguisher.svg");
    expect(ops.find((op) => op.local === clean)?.serverName).toBeUndefined();
  });

  it("marks an update whose remote name differs from the local one", async () => {
    const local = await createLocalFile("blog/Hero.png", "bigger-content");
    const remote = { ...serverItem(local), name: "hero.png", size: 3 };

    const [op] = matchMediaFiles([local], [remote]);

    expect(op.type).toBe("update");
    expect(op.serverName).toBe("hero.png");
  });
});

describe("displayMediaStatus: rename notice", () => {
  it("shows old → new and warns about references outside the CMS", async () => {
    const local = await createLocalFile("icons/fire_extinguisher.svg", "a");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = makeDeps();

    displayMediaStatus(matchMediaFiles([local], []), true, true, deps);

    expect(messages(log as unknown as jest.Mock)).toContain(
      "+ icons/fire_extinguisher.svg → fire-extinguisher.svg"
    );
    const warnings = messages(deps.logWarn);
    expect(warnings).toContain("LeadCMS will store 1 file under the name marked →");
    expect(warnings).toContain("--on-media-rename skip|fail");
  });

  it("does not count held-back files as changes to apply with skip", async () => {
    const renamed = await createLocalFile("icons/fire_extinguisher.svg", "a");
    const clean = await createLocalFile("icons/plain.svg", "b");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = makeDeps();

    displayMediaStatus(matchMediaFiles([renamed, clean], []), false, true, deps, "skip");

    expect(messages(deps.logInfo)).toContain("Ready to apply 1 change(s).");
    expect(messages(deps.logWarn)).toContain("1 file will not be pushed");
  });
});

describe("executeMediaPush: reporting renames", () => {
  it("names the new file for each rename and lists them in the summary", async () => {
    const local = await createLocalFile("icons/fire_extinguisher.svg", "svg");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = makeDeps({ uploadMedia: jest.fn().mockResolvedValue(serverItem(local)) });
    const ops: MediaOperation[] = [{ type: "create", local, reason: "New file" }];

    const result = await executeMediaPush(ops, false, deps, mediaDir);

    expect(result.renamed).toEqual([
      { from: "icons/fire_extinguisher.svg", to: "icons/fire-extinguisher.svg" },
    ]);
    expect(messages(deps.logSuccess)).toContain(
      "↳ Renamed locally: icons/fire_extinguisher.svg → icons/fire-extinguisher.svg"
    );
    const summary = messages(deps.logWarn);
    expect(summary).toContain("1 media file renamed locally");
    expect(summary).toContain("icons/fire_extinguisher.svg → icons/fire-extinguisher.svg");
    expect(summary).toContain("leadcms pull-content");
    expect(await listFiles()).toEqual(["icons/fire-extinguisher.svg"]);
  });

  it("still records renames in quiet mode, without printing them", async () => {
    const local = await createLocalFile("screens/Request_details.png", "png");
    const deps = makeDeps({ uploadMedia: jest.fn().mockResolvedValue(serverItem(local)) });

    const result = await executeMediaPush(
      [{ type: "create", local, reason: "New file" }],
      false,
      deps,
      mediaDir,
      true
    );

    expect(result.renamed).toEqual([
      { from: "screens/Request_details.png", to: "screens/request-details.png" },
    ]);
    expect(deps.logSuccess).not.toHaveBeenCalled();
    expect(deps.logWarn).not.toHaveBeenCalled();
  });
});

describe("reconcileLocalFile: name collisions", () => {
  it("does not overwrite a different local file that already has the server's name", async () => {
    const underscored = await createLocalFile("img/a_b.png", "underscored");
    await createLocalFile("img/a-b.png", "dashed");

    await expect(
      reconcileLocalFile(underscored, serverItem(underscored), mediaDir, jest.fn())
    ).rejects.toThrow("not renamed to img/a-b.png: a different local file already has that name");

    expect(await fsPromises.readFile(path.join(mediaDir, "img/a_b.png"), "utf8")).toBe(
      "underscored"
    );
    expect(await fsPromises.readFile(path.join(mediaDir, "img/a-b.png"), "utf8")).toBe("dashed");
  });
});

describe("pushMedia: onRename", () => {
  /** One file LeadCMS would rename, one it keeps. */
  async function setup() {
    const renamed = await createLocalFile("icons/fire_extinguisher.svg", "svg");
    const clean = await createLocalFile("icons/plain.svg", "ok");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    return { renamed, clean };
  }

  it("renames locally by default", async () => {
    const renamed = await createLocalFile("icons/fire_extinguisher.svg", "svg");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = makeDeps({ uploadMedia: jest.fn().mockResolvedValue(serverItem(renamed)) });

    const result = await pushMedia({ force: true, mediaDir }, deps);

    expect(result.renamed).toHaveLength(1);
    expect(await listFiles()).toEqual(["icons/fire-extinguisher.svg"]);
  });

  it("skip: pushes the other files and leaves the renamed ones untouched", async () => {
    const { clean } = await setup();
    const deps = makeDeps({ uploadMedia: jest.fn().mockResolvedValue(serverItem(clean)) });

    const result = await pushMedia({ force: true, mediaDir, onRename: "skip" }, deps);

    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(result.executed.successful).toBe(1);
    expect(result.skippedRenames).toEqual([
      { from: "icons/fire_extinguisher.svg", to: "icons/fire-extinguisher.svg" },
    ]);
    expect(messages(deps.logWarn)).toContain("1 media file not pushed: LeadCMS would rename it.");
    expect(await listFiles()).toEqual(["icons/fire_extinguisher.svg", "icons/plain.svg"]);
  });

  it("skip: nothing to upload when every change would be renamed", async () => {
    await createLocalFile("icons/fire_extinguisher.svg", "svg");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = makeDeps();

    const result = await pushMedia({ mediaDir, onRename: "skip" }, deps);

    expect(deps.promptConfirmation).not.toHaveBeenCalled();
    expect(deps.uploadMedia).not.toHaveBeenCalled();
    expect(result.skippedRenames).toHaveLength(1);
  });

  it("fail: uploads nothing and names the files", async () => {
    await setup();
    const deps = makeDeps();

    await expect(pushMedia({ force: true, mediaDir, onRename: "fail", quiet: true }, deps)).rejects
      .toThrow(`Nothing was pushed: LeadCMS would rename 1 media file:
   icons/fire_extinguisher.svg → icons/fire-extinguisher.svg`);

    expect(deps.uploadMedia).not.toHaveBeenCalled();
    expect(await listFiles()).toEqual(["icons/fire_extinguisher.svg", "icons/plain.svg"]);
  });

  it("fail: also fails a dry run", async () => {
    await setup();
    const deps = makeDeps();

    await expect(pushMedia({ dryRun: true, mediaDir, onRename: "fail" }, deps)).rejects.toThrow(
      "(marked → above)"
    );
  });
});

describe("parseMediaRenameFlag", () => {
  it("defaults to rename", () => {
    expect(parseMediaRenameFlag(["--force"])).toBe("rename");
  });

  it("reads both the spaced and the = form", () => {
    expect(parseMediaRenameFlag(["--on-media-rename", "skip"])).toBe("skip");
    expect(parseMediaRenameFlag(["--on-media-rename=fail"])).toBe("fail");
  });

  it("exits on an unknown mode", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseMediaRenameFlag(["--on-media-rename", "maybe"])).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('(got "maybe")'));
  });
});
