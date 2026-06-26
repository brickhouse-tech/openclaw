// Verifies the top-level `locked` path list parses (doctor honors it; it must
// pass the strict root schema). Regression for `<root>: Invalid input` when a
// config set `locked` but the schema had never registered the key.
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("OpenClawSchema top-level locked paths", () => {
  it("accepts a list of dotted config paths", () => {
    const result = OpenClawSchema.safeParse({
      locked: ["agents.defaults.model", "agents.defaults.compaction.model"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted locked key", () => {
    expect(OpenClawSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-array locked value", () => {
    expect(() =>
      OpenClawSchema.parse({ locked: "agents.defaults.model" }),
    ).toThrow();
  });

  it("rejects non-string locked entries", () => {
    expect(() => OpenClawSchema.parse({ locked: [123] })).toThrow();
  });
});
