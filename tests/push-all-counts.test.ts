import {
  countActionablePushOperations,
  countActionableSettingsComparisons,
  isActionablePushOperation,
  subtractRemoteCreates,
} from "../src/scripts/push-all-counts";

import type { SettingComparisonEntry } from "../src/lib/settings-types";

describe("push-all actionable change counts", () => {
  it("does not count remote-only additions as push work", () => {
    const operations = [
      { type: "create", remote: { id: 1, name: "remote email" } },
      { type: "create", remote: { id: 2, name: "remote segment" } },
      { type: "create", remote: { id: 3, name: "remote sequence" } },
      { type: "create", remote: { id: 4, name: "remote redirect" } },
    ];

    expect(countActionablePushOperations(operations, false)).toBe(0);
    expect(countActionablePushOperations(operations, true)).toBe(0);
    expect(operations.every((op) => !isActionablePushOperation(op, false))).toBe(true);
  });

  it("counts local creates, updates, and conflicts as push work", () => {
    const operations = [
      { type: "create", local: { name: "local" } },
      { type: "update", local: { name: "local" }, remote: { id: 1 } },
      { type: "conflict", local: { name: "local" }, remote: { id: 2 } },
    ];

    expect(countActionablePushOperations(operations, false)).toBe(3);
  });

  it("counts deletes only when delete mode is enabled", () => {
    const operations = [
      { type: "delete", remote: { id: 1, name: "remote" } },
      { type: "update", local: { name: "local" }, remote: { id: 2 } },
    ];

    expect(countActionablePushOperations(operations, false)).toBe(1);
    expect(countActionablePushOperations(operations, true)).toBe(2);
  });

  it("does not count remote-only settings as push work without delete mode", () => {
    const comparisons: SettingComparisonEntry[] = [
      {
        key: "AI.SiteProfile.Topic",
        language: null,
        localValue: null,
        remoteValue: "Test test test",
        status: "remote-only",
      },
    ];

    expect(countActionableSettingsComparisons(comparisons, false)).toBe(0);
    expect(countActionableSettingsComparisons(comparisons, true)).toBe(1);
  });

  it("counts local-only and modified settings as push work", () => {
    const comparisons: SettingComparisonEntry[] = [
      {
        key: "AI.SiteProfile.Topic",
        language: null,
        localValue: "Local",
        remoteValue: null,
        status: "local-only",
      },
      {
        key: "AI.SiteProfile.Audience",
        language: null,
        localValue: "Developers",
        remoteValue: "Editors",
        status: "modified",
      },
      {
        key: "Content.MinTitleLength",
        language: null,
        localValue: "9",
        remoteValue: "9",
        status: "in-sync",
      },
    ];

    expect(countActionableSettingsComparisons(comparisons, false)).toBe(2);
  });

  it("subtracts remote-created summary rows from push work", () => {
    expect(subtractRemoteCreates(5, 5)).toBe(0);
    expect(subtractRemoteCreates(7, 5)).toBe(2);
    expect(subtractRemoteCreates(0, 5)).toBe(0);
  });
});
