// Unit tests for the locked-paths helper used by doctor legacy-config migrations.
import { describe, it, expect } from "vitest";
import { createConfigLockChecker, createLockChecker } from "./locked-paths.js";

describe("createLockChecker", () => {
  it("returns no-op for undefined", () => {
    const isLocked = createLockChecker(undefined);
    expect(isLocked("agents.defaults.model")).toBe(false);
  });

  it("returns no-op for empty array", () => {
    const isLocked = createLockChecker([]);
    expect(isLocked("agents.defaults.model")).toBe(false);
  });

  it("returns no-op for array of empty / non-string entries", () => {
    const isLocked = createLockChecker([
      " ",
      "",
      null as unknown as string,
      7 as unknown as string,
    ]);
    expect(isLocked("agents.defaults.model")).toBe(false);
  });

  it("matches exact paths", () => {
    const isLocked = createLockChecker(["agents.defaults.model"]);
    expect(isLocked("agents.defaults.model")).toBe(true);
    expect(isLocked("agents.defaults.models")).toBe(false);
    expect(isLocked("agents.defaults")).toBe(false);
  });

  it("matches descendants via dot suffix", () => {
    const isLocked = createLockChecker(["agents.defaults.model"]);
    expect(isLocked("agents.defaults.model.primary")).toBe(true);
    expect(isLocked("agents.defaults.model.fallbacks")).toBe(true);
  });

  it("matches descendants via bracket suffix", () => {
    const isLocked = createLockChecker(["agents.defaults.model.fallbacks"]);
    expect(isLocked("agents.defaults.model.fallbacks[0]")).toBe(true);
    expect(isLocked("agents.defaults.model.fallbacks[12]")).toBe(true);
  });

  it("does not match sibling prefixes that share a stem", () => {
    const isLocked = createLockChecker(["agents.defaults.model"]);
    expect(isLocked("agents.defaults.modelOverrides")).toBe(false);
    expect(isLocked("agents.defaults.models")).toBe(false);
  });

  it("trims whitespace inside lock entries", () => {
    const isLocked = createLockChecker(["  agents.defaults.model  "]);
    expect(isLocked("agents.defaults.model.primary")).toBe(true);
  });

  it("returns false for empty or non-string query", () => {
    const isLocked = createLockChecker(["agents.defaults.model"]);
    expect(isLocked("")).toBe(false);
    expect(isLocked(undefined as unknown as string)).toBe(false);
  });
});

describe("createConfigLockChecker", () => {
  it("returns a no-op when cfg is undefined", () => {
    const isLocked = createConfigLockChecker(undefined);
    expect(isLocked("agents.defaults.model")).toBe(false);
  });

  it("reads from cfg.locked", () => {
    const isLocked = createConfigLockChecker({ locked: ["agents.defaults"] });
    expect(isLocked("agents.defaults.model.primary")).toBe(true);
    expect(isLocked("agents.list.foo.model")).toBe(false);
  });
});
