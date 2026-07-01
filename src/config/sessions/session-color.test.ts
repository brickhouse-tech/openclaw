import { describe, expect, test } from "vitest";
import { parseSessionColor, sessionColorHex } from "./session-color.js";

describe("parseSessionColor", () => {
  test("accepts named palette entries case-insensitively", () => {
    expect(parseSessionColor("cyan")).toEqual({ ok: true, value: "cyan" });
    expect(parseSessionColor("PINK")).toEqual({ ok: true, value: "pink" });
  });

  test("normalizes short and long hex to #rrggbb", () => {
    expect(parseSessionColor("#0af")).toEqual({ ok: true, value: "#00aaff" });
    expect(parseSessionColor("#00AAFF")).toEqual({ ok: true, value: "#00aaff" });
  });

  test("normalizes rgb() to hex", () => {
    expect(parseSessionColor("rgb(0, 170, 255)")).toEqual({ ok: true, value: "#00aaff" });
  });

  test("treats empty and clear tokens as a clear (null)", () => {
    expect(parseSessionColor("")).toEqual({ ok: true, value: null });
    expect(parseSessionColor("default")).toEqual({ ok: true, value: null });
    expect(parseSessionColor("none")).toEqual({ ok: true, value: null });
  });

  test("rejects unknown names and malformed values", () => {
    expect(parseSessionColor("chartreuse").ok).toBe(false);
    expect(parseSessionColor("#12345").ok).toBe(false);
    expect(parseSessionColor("rgb(300,0,0)").ok).toBe(false);
  });
});

describe("sessionColorHex", () => {
  test("resolves palette names to hex", () => {
    expect(sessionColorHex("cyan")).toBe("#5BC8D6");
  });

  test("passes through canonical hex", () => {
    expect(sessionColorHex("#00aaff")).toBe("#00aaff");
  });

  test("returns undefined for unset or invalid tags", () => {
    expect(sessionColorHex(undefined)).toBeUndefined();
    expect(sessionColorHex(null)).toBeUndefined();
    expect(sessionColorHex("bogus")).toBeUndefined();
  });
});
