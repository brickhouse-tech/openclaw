// Shared session color tag parsing + palette resolution.
//
// A session's colorTag is either one of the named palette entries below or a
// custom color stored canonically as "#rrggbb". The gateway applier validates
// user input with parseSessionColor(); the TUI resolves the stored tag to a hex
// value with sessionColorHex() for rendering.

/** Named palette, mirroring the Claude CLI /color set. Values are dark-theme-friendly hexes. */
export const SESSION_COLOR_PALETTE = {
  red: "#F97066",
  blue: "#7DA6FF",
  green: "#7DD3A5",
  yellow: "#F6C453",
  purple: "#B692F6",
  orange: "#F2A65A",
  pink: "#F48FB1",
  cyan: "#5BC8D6",
} as const;

export type SessionColorName = keyof typeof SESSION_COLOR_PALETTE;

/** Ordered palette names for completions/help. */
export const SESSION_COLOR_NAMES = Object.keys(SESSION_COLOR_PALETTE) as SessionColorName[];

/** Values that clear the color instead of setting one. */
export const SESSION_COLOR_CLEAR_TOKENS = ["default", "none", "clear"] as const;

export type ParseSessionColorResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function normalizeHex(raw: string): string | null {
  const hex = raw.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(hex)) {
    return hex;
  }
  return null;
}

function parseRgb(raw: string): string | null {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(raw.trim());
  if (!match) {
    return null;
  }
  const channels = [match[1], match[2], match[3]].map((value) => Number.parseInt(value, 10));
  if (channels.some((value) => value < 0 || value > 255)) {
    return null;
  }
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Parse a user-supplied color into a canonical stored tag.
 * - Named palette entry -> the lowercase name.
 * - "#rgb" / "#rrggbb" / "rgb(r,g,b)" -> canonical "#rrggbb".
 * - A clear token (default/none/clear) -> null (caller should clear the tag).
 * Returns { ok: false } with a user-facing error for anything else.
 */
export function parseSessionColor(input: string): ParseSessionColorResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  const lower = trimmed.toLowerCase();
  if ((SESSION_COLOR_CLEAR_TOKENS as readonly string[]).includes(lower)) {
    return { ok: true, value: null };
  }
  if (Object.hasOwn(SESSION_COLOR_PALETTE, lower)) {
    return { ok: true, value: lower };
  }
  const hex = normalizeHex(trimmed);
  if (hex) {
    return { ok: true, value: hex };
  }
  const rgb = parseRgb(trimmed);
  if (rgb) {
    return { ok: true, value: rgb };
  }
  return {
    ok: false,
    error: `invalid color (use ${SESSION_COLOR_NAMES.join("|")}|default or a #hex / rgb(r,g,b) value)`,
  };
}

/** Resolve a stored colorTag to a hex string for rendering, or undefined if unset/invalid. */
export function sessionColorHex(colorTag: string | undefined | null): string | undefined {
  if (!colorTag) {
    return undefined;
  }
  const lower = colorTag.toLowerCase();
  if (Object.hasOwn(SESSION_COLOR_PALETTE, lower)) {
    return SESSION_COLOR_PALETTE[lower as SessionColorName];
  }
  if (/^#[0-9a-f]{6}$/.test(lower)) {
    return lower;
  }
  return undefined;
}
