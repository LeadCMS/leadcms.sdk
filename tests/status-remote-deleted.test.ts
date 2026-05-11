/**
 * Tests for remote-deleted status detection in segments and sequences.
 *
 * When an entity is pulled from the remote (creating a local file with the remote ID)
 * and then deleted on the remote, the next status check should classify the local
 * entity as "remote-deleted" (not "create"), indicating it will be removed on next pull.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

let segmentsDir = "/tmp/test-segments-remote-del";
let sequencesDir = "/tmp/test-sequences-remote-del";

jest.mock("../src/scripts/leadcms-helpers.js", () => ({
    get SEGMENTS_DIR() {
        return segmentsDir;
    },
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

import { buildSegmentStatus } from "../src/scripts/push-segments";
import { buildSequenceStatus } from "../src/scripts/push-sequences";

// ── Segment remote-deleted ─────────────────────────────────────────────

describe("buildSegmentStatus remote-deleted detection", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-seg-rd-"));
        segmentsDir = tmpDir;
        mockGetAllSegments.mockReset();
        mockGetAllEmailTemplates.mockResolvedValue([]);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("reports remote-deleted when local segment has an ID not present on remote", async () => {
        const segment = {
            id: 5,
            name: "Segment A",
            type: "Dynamic",
            definition: { includeRules: null, excludeRules: null },
        };
        await fs.writeFile(
            path.join(tmpDir, "segment-a.json"),
            JSON.stringify(segment),
            "utf8"
        );

        // Remote no longer has segment with id=5 (was deleted)
        mockGetAllSegments.mockResolvedValue([]);

        const result = await buildSegmentStatus({});

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe("remote-deleted");
        expect(result.operations[0].local?.name).toBe("Segment A");
    });

    it("reports create (not remote-deleted) when local segment has no ID", async () => {
        const segment = {
            name: "New Segment",
            type: "Dynamic",
            definition: { includeRules: null, excludeRules: null },
        };
        await fs.writeFile(
            path.join(tmpDir, "new-segment.json"),
            JSON.stringify(segment),
            "utf8"
        );

        mockGetAllSegments.mockResolvedValue([]);

        const result = await buildSegmentStatus({});

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe("create");
    });

    it("reports update (not remote-deleted) when local segment ID still exists on remote", async () => {
        const segment = {
            id: 7,
            name: "Existing Segment",
            type: "Dynamic",
            definition: { includeRules: null, excludeRules: null },
        };
        await fs.writeFile(
            path.join(tmpDir, "existing-segment.json"),
            JSON.stringify(segment),
            "utf8"
        );

        // Remote still has segment with id=7 but with different definition
        mockGetAllSegments.mockResolvedValue([
            {
                id: 7,
                name: "Existing Segment",
                type: "Dynamic",
                definition: {
                    includeRules: {
                        id: "g1",
                        connector: "And",
                        rules: [{ id: "r1", fieldId: "domain.free", operator: "IsFalse", value: "" }],
                        groups: [],
                    },
                    excludeRules: null,
                },
                contactCount: 10,
                createdById: 1,
                updatedById: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: null,
            },
        ]);

        const result = await buildSegmentStatus({});

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe("update");
    });
});

// ── Sequence remote-deleted ─────────────────────────────────────────────

describe("buildSequenceStatus remote-deleted detection", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-seq-rd-"));
        sequencesDir = tmpDir;
        mockGetAllSegments.mockReset();
        mockGetAllSequences.mockReset();
        mockGetAllEmailTemplates.mockReset();
        mockGetAllSegments.mockResolvedValue([]);
        mockGetAllEmailTemplates.mockResolvedValue([]);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("reports remote-deleted when local sequence has an ID not present on remote", async () => {
        const sequence = { id: 3, name: "Welcome Sequence", language: "en" };
        await fs.writeFile(
            path.join(tmpDir, "welcome-sequence.json"),
            JSON.stringify(sequence),
            "utf8"
        );

        // Remote no longer has sequence with id=3 (was deleted)
        mockGetAllSequences.mockResolvedValue([]);

        const result = await buildSequenceStatus({});

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe("remote-deleted");
        expect(result.operations[0].local?.name).toBe("Welcome Sequence");
    });

    it("reports create (not remote-deleted) when local sequence has no ID", async () => {
        const sequence = { name: "New Sequence", language: "en" };
        await fs.writeFile(
            path.join(tmpDir, "new-sequence.json"),
            JSON.stringify(sequence),
            "utf8"
        );

        mockGetAllSequences.mockResolvedValue([]);

        const result = await buildSequenceStatus({});

        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe("create");
    });

    it("does not report remote-deleted when local sequence ID still exists on remote", async () => {
        const sequence = { id: 8, name: "Active Sequence", language: "en" };
        await fs.writeFile(
            path.join(tmpDir, "active-sequence.json"),
            JSON.stringify(sequence),
            "utf8"
        );

        // Remote still has sequence with id=8
        mockGetAllSequences.mockResolvedValue([
            {
                id: 8,
                name: "Active Sequence",
                language: "en",
                description: null,
                stopOnReply: false,
                useContactTimeZone: false,
                timeZone: 0,
                enrollment: null,
                utmParameters: null,
                steps: [],
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: null,
            },
        ]);

        const result = await buildSequenceStatus({});

        const types = result.operations.map((o) => o.type);
        expect(types).not.toContain("remote-deleted");
        expect(types).not.toContain("create");
    });
});
