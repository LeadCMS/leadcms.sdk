/**
 * Regression tests for sequences whose local language no longer matches the
 * remote's (e.g. a file moved out of the `en-US/` subdirectory and re-tagged
 * `en`, while the remote still says `en-US`).
 *
 * getRemoteMatch resolves such a pair through the metadata map, so status must
 * treat the remote as claimed. Keying the orphan scan on `language:name` alone
 * reported the same sequence twice — "updated locally" *and* "added remotely" —
 * and made `push --delete` delete the sequence it had just pushed to.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

let sequencesDir = "/tmp/test-sequences-lang-drift";

jest.mock("../src/scripts/leadcms-helpers.js", () => ({
  get SEQUENCES_DIR() {
    return sequencesDir;
  },
}));

const mockGetAllSegments = jest.fn();
const mockGetAllSequences = jest.fn();
const mockGetAllEmailTemplates = jest.fn();

jest.mock("../src/lib/data-service.js", () => ({
  leadCMSDataService: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllSegments: (...args: any[]) => mockGetAllSegments(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllSequences: (...args: any[]) => mockGetAllSequences(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllEmailTemplates: (...args: any[]) => mockGetAllEmailTemplates(...args),
    isApiKeyConfigured: () => true,
  },
}));

import { buildSequenceStatus } from "../src/scripts/push-sequences";
import {
  readMetadataMap,
  setSequenceRemoteId,
  setMetadataForSequence,
  writeMetadataMap,
  type RemoteContext,
} from "../src/lib/remote-context";

describe("buildSequenceStatus with drifted language", () => {
  let tmpDir: string;
  let remoteContext: RemoteContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-seq-drift-"));
    sequencesDir = path.join(tmpDir, "sequences");
    await fs.mkdir(sequencesDir, { recursive: true });

    remoteContext = {
      name: "prod",
      url: "https://cms.example.com",
      apiKey: "test-key",
      isDefault: true,
      stateDir: path.join(tmpDir, "remotes", "prod"),
    };

    mockGetAllSegments.mockResolvedValue([]);
    mockGetAllEmailTemplates.mockResolvedValue([]);
    mockGetAllSequences.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Local file says "en"; the remote still says "en-US" for the same id. */
  async function seedDriftedPair(): Promise<void> {
    await fs.writeFile(
      path.join(sequencesDir, "trial-reminder.json"),
      JSON.stringify({ name: "Trial Reminder", language: "en", steps: [] }),
      "utf8"
    );

    const map = await readMetadataMap(remoteContext);
    setSequenceRemoteId(map, "en", "Trial Reminder", 1);
    setMetadataForSequence(map, "en", "Trial Reminder", {
      id: 1,
      createdAt: "2026-09-02T16:15:13Z",
      updatedAt: "2026-09-02T19:56:02Z",
    });
    await writeMetadataMap(remoteContext, map);

    mockGetAllSequences.mockResolvedValue([
      {
        id: 1,
        name: "Trial Reminder",
        language: "en-US",
        status: "Active",
        createdAt: "2026-09-02T16:15:13Z",
        updatedAt: "2026-09-03T08:04:45Z",
        steps: [],
      },
    ]);
  }

  it("reports the metadata-matched sequence once, as an update", async () => {
    await seedDriftedPair();

    const result = await buildSequenceStatus({ remoteContext });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe("update");
    expect(result.operations[0].remote?.id).toBe(1);
  });

  it("does not report the matched remote as deleted locally", async () => {
    await seedDriftedPair();

    const result = await buildSequenceStatus({ remoteContext, showDelete: true });

    expect(result.operations.map((op) => op.type)).not.toContain("delete");
  });

  it("still reports a genuinely remote-only sequence as added remotely", async () => {
    await seedDriftedPair();
    mockGetAllSequences.mockResolvedValue([
      {
        id: 1,
        name: "Trial Reminder",
        language: "en-US",
        createdAt: "2026-09-02T16:15:13Z",
        updatedAt: "2026-09-03T08:04:45Z",
        steps: [],
      },
      { id: 2, name: "Onboarding", language: "en", createdAt: "2026-09-02T16:15:13Z", steps: [] },
    ]);

    const result = await buildSequenceStatus({ remoteContext });

    const remoteOnly = result.operations.filter((op) => op.type === "create" && !op.local);
    expect(remoteOnly).toHaveLength(1);
    expect(remoteOnly[0].remote?.name).toBe("Onboarding");
  });
});
