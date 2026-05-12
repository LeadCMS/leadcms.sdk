import type { SettingComparisonEntry } from "../lib/settings-types.js";

export interface PushLikeOperation {
  type: string;
  local?: unknown;
  remote?: unknown;
}

export function isActionablePushOperation(
  op: PushLikeOperation,
  allowDelete: boolean
): boolean {
  if (!allowDelete && op.type === "delete") return false;
  if (op.type === "create" && op.remote && !op.local) return false;
  return true;
}

export function countActionablePushOperations(
  operations: PushLikeOperation[] | null | undefined,
  allowDelete: boolean
): number {
  return operations?.filter((op) => isActionablePushOperation(op, allowDelete)).length ?? 0;
}

export function subtractRemoteCreates(totalChanges: number, remoteCreates: number): number {
  return Math.max(0, totalChanges - remoteCreates);
}

export function isActionableSettingsComparison(
  comparison: SettingComparisonEntry,
  allowDelete: boolean
): boolean {
  return (
    comparison.status === "modified" ||
    comparison.status === "local-only" ||
    (allowDelete && comparison.status === "remote-only")
  );
}

export function countActionableSettingsComparisons(
  comparisons: SettingComparisonEntry[] | null | undefined,
  allowDelete: boolean
): number {
  return (
    comparisons?.filter((comparison) => isActionableSettingsComparison(comparison, allowDelete))
      .length ?? 0
  );
}
