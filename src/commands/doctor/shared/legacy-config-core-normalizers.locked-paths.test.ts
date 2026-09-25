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

  it("preserves model.primary when locked (fallbacks migrate independently)", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model.primary"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as Record<string, Record<string, Record<string, unknown>>>).defaults
      .model;
    expect(model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-4-6"]);
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
    expect(Object.keys(models).toSorted()).toEqual(
      ["claude-cli/claude-opus-4-7", "claude-cli/claude-sonnet-4-6"].toSorted(),
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
    expect(defaults.model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(Object.keys(defaults.models).toSorted()).toEqual(
      ["claude-cli/claude-opus-4-7", "claude-cli/claude-sonnet-4-6"].toSorted(),
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

  it("does not affect agents.entries when only agents.defaults is locked", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults"],
      agents: {
        defaults: {
          model: { primary: "claude-cli/claude-opus-4-7" },
        },
        entries: {
          main: {
            model: { primary: "claude-cli/claude-sonnet-4-6" },
          },
        },
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const agents = next.agents as Record<string, unknown>;
    const defaults = agents.defaults as Record<string, Record<string, unknown>>;
    expect(defaults.model.primary).toBe("claude-cli/claude-opus-4-7");
    const entries = agents.entries as Record<string, Record<string, Record<string, unknown>>>;
    expect(entries.main?.model.primary).toBe("anthropic/claude-sonnet-4-6");
  });

  // Regression: agents.defaults.compaction.model is a bare string field that only
  // the config-wide `rewriteRemainingSlots` pass ever touches (it is outside the
  // agents.defaults.model / agents.defaults.models subtrees the container-level
  // normalizer already threads a LockChecker through). This is the live guardrail
  // shape: locked = ["agents.defaults.model", "agents.defaults.compaction.model"].
  it("preserves agents.defaults.compaction.model when locked", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults.model", "agents.defaults.compaction.model"],
      agents: {
        defaults: {
          model: {
            primary: "claude-cli/claude-opus-4-7",
            fallbacks: ["claude-cli/claude-sonnet-4-6"],
          },
          compaction: {
            model: "claude-cli/claude-haiku-4-5",
          },
        },
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const defaults = (next.agents as Record<string, Record<string, unknown>>).defaults as Record<
      string,
      Record<string, unknown>
    >;
    expect(defaults.model).toEqual({
      primary: "claude-cli/claude-opus-4-7",
      fallbacks: ["claude-cli/claude-sonnet-4-6"],
    });
    expect(defaults.compaction).toEqual({ model: "claude-cli/claude-haiku-4-5" });
    expect(changes).toEqual([]);
  });

  it("still migrates compaction.model when it is not locked", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults.model"],
      agents: {
        defaults: {
          model: { primary: "claude-cli/claude-opus-4-7" },
          compaction: { model: "claude-cli/claude-haiku-4-5" },
        },
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const defaults = (next.agents as Record<string, Record<string, unknown>>).defaults as Record<
      string,
      Record<string, unknown>
    >;
    expect(defaults.model).toEqual({ primary: "claude-cli/claude-opus-4-7" });
    expect(defaults.compaction).toEqual({ model: "anthropic/claude-haiku-4-5" });
  });
});
