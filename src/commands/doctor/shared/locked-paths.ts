// Lock-checker helpers for doctor migrations.
//
// A LockChecker answers `isLocked(path)` for dotted JSON paths inside an
// OpenClawConfig. A lock on `a.b` also locks every descendant (`a.b.c`,
// `a.b[0]`, …). Used so operators can pin specific subtrees against
// legacy-config rewrites that would otherwise be applied by `openclaw doctor`.

import type { OpenClawConfig } from "../../../config/types.openclaw.js";

export type LockChecker = (path: string) => boolean;

const ALWAYS_FALSE: LockChecker = () => false;

/**
 * Build a LockChecker from a configured `locked` list. Returns a no-op checker
 * when the list is missing, empty, or contains no usable entries.
 */
export function createLockChecker(locked: readonly unknown[] | undefined): LockChecker {
  if (!Array.isArray(locked) || locked.length === 0) {
    return ALWAYS_FALSE;
  }
  const normalized: string[] = [];
  for (const entry of locked) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  if (normalized.length === 0) {
    return ALWAYS_FALSE;
  }
  return (path) => {
    if (typeof path !== "string" || path.length === 0) return false;
    for (const lock of normalized) {
      if (path === lock) return true;
      if (path.startsWith(`${lock}.`)) return true;
      if (path.startsWith(`${lock}[`)) return true;
    }
    return false;
  };
}

/** Convenience: build a LockChecker straight from a config object. */
export function createConfigLockChecker(cfg: OpenClawConfig | undefined): LockChecker {
  return createLockChecker(cfg?.locked);
}
