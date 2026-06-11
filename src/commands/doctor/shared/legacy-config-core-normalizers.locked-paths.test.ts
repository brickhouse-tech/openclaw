// Verifies that cfg.locked prevents legacy `claude-cli/*` model refs from being
// rewritten to `anthropic/*` by normalizeLegacyRuntimeModelRefs.
import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { normalizeLegacyRuntimeModelRefs } from "./legacy-config-core-normalizers.js";

function buildCfg(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "claude-cli/claude-opus-4-7",
          fallbacks: ["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"],
        },
        models: {
          "claude-cli/claude-opus-4-7": {},
          "claude-cli/claude-sonnet-4-6": {},
        },
      },
    } as unknown as OpenClawConfig["agents"],
    ...overrides,
  };
}

describe("normalizeLegacyRuntimeModelRefs with locked paths", () => {
  it("rewrites claude-cli/* to anthropic/* when no lock is set (baseline)", () => {
    const cfg = buildCfg();
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .model;
    expect(model.primary).toBe("anthropic/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-4-6"]);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("preserves model.primary when locked (fallbacks also stay because they anchor to primary's runtime)", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model.primary"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .model;
    expect(model.primary).toBe("claude-cli/claude-opus-4-7");
    // NOTE: existing upstream logic only migrates fallbacks whose runtime
    // matches the primary-derived selected runtime. With primary locked, no
    // selected runtime is established, so fallbacks stay too. Lock both
    // `model.primary` and `model.fallbacks` (or just `model`) if you want
    // fallbacks to migrate independently — but at that point you're saying
    // "don't touch the model subtree" anyway.
    expect(model.fallbacks).toEqual(["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"]);
  });

  it("preserves model.fallbacks when locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model.fallbacks"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .model;
    expect(model.primary).toBe("anthropic/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"]);
  });

  it("preserves the whole model subtree when agents.defaults.model is locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .model;
    expect(model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"]);
  });

  it("preserves the models allowlist when locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.models"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const models = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .models;
    expect(Object.keys(models).sort()).toEqual(
      ["claude-cli/claude-opus-4-7", "claude-cli/claude-sonnet-4-6"].sort(),
    );
  });

  it("preserves both model and models when the parent is locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const defaults = (next.agents as Record<string, Record<string, unknown>>).defaults as Record<
      string,
      Record<string, unknown>
    >;
    expect((defaults.model as Record<string, unknown>).primary).toBe("claude-cli/claude-opus-4-7");
    expect(Object.keys(defaults.models as Record<string, unknown>).sort()).toEqual(
      ["claude-cli/claude-opus-4-7", "claude-cli/claude-sonnet-4-6"].sort(),
    );
  });

  it("does not affect agents.list entries when only agents.defaults is locked", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults"],
      agents: {
        defaults: {
          model: { primary: "claude-cli/claude-opus-4-7" },
        },
        list: [
          {
            id: "foo",
            model: { primary: "claude-cli/claude-sonnet-4-6" },
          },
        ],
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const agents = next.agents as Record<string, unknown>;
    const defaults = agents.defaults as Record<string, Record<string, unknown>>;
    expect(defaults.model.primary).toBe("claude-cli/claude-opus-4-7");
    const list = agents.list as Array<Record<string, Record<string, unknown>>>;
    expect(list[0]?.model.primary).toBe("anthropic/claude-sonnet-4-6");
  });
});
