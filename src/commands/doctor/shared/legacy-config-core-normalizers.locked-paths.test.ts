// Verifies that cfg.locked prevents legacy `claude-cli/*` model refs from being
// rewritten to `anthropic/*` by normalizeLegacyRuntimeModelRefs.
import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { normalizeLegacyRuntimeModelRefs } from "./legacy-config-core-normalizers.js";

// Named (non-index-signature) test-only view of the migrated agent shape, so
// property access below isn't subject to noUncheckedIndexedAccess turning
// every read into `T | undefined` the way a `Record<string, ...>` cast would.
type TestAgentModel = { primary?: string; fallbacks?: string[] };
type TestAgentDefaults = {
  model: TestAgentModel;
  models: Record<string, unknown>;
  compaction?: { model?: string };
};
type TestAgents = {
  defaults: TestAgentDefaults;
  list?: Array<{ id?: string; model: TestAgentModel }>;
  entries?: Record<string, { model: TestAgentModel } | undefined>;
};

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

    const model = (next.agents as TestAgents).defaults.model;
    expect(model.primary).toBe("anthropic/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-4-6"]);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("preserves model.primary when locked (fallbacks migrate independently)", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model.primary"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as TestAgents).defaults.model;
    expect(model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-4-6"]);
  });

  it("preserves model.fallbacks when locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model.fallbacks"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as TestAgents).defaults.model;
    expect(model.primary).toBe("anthropic/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"]);
  });

  it("preserves the whole model subtree when agents.defaults.model is locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.model"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const model = (next.agents as TestAgents).defaults.model;
    expect(model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(model.fallbacks).toEqual(["claude-cli/claude-opus-4-8", "claude-cli/claude-sonnet-4-6"]);
  });

  it("preserves the models allowlist when locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults.models"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const models = (next.agents as TestAgents).defaults.models;
    expect(Object.keys(models).toSorted()).toEqual(
      ["claude-cli/claude-opus-4-7", "claude-cli/claude-sonnet-4-6"].toSorted(),
    );
  });

  it("preserves both model and models when the parent is locked", () => {
    const cfg = buildCfg({ locked: ["agents.defaults"] });
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const defaults = (next.agents as TestAgents).defaults;
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

    const agents = next.agents as TestAgents;
    expect(agents.defaults.model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(agents.list?.[0]?.model.primary).toBe("anthropic/claude-sonnet-4-6");
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

    const agents = next.agents as TestAgents;
    expect(agents.defaults.model.primary).toBe("claude-cli/claude-opus-4-7");
    expect(agents.entries?.main?.model.primary).toBe("anthropic/claude-sonnet-4-6");
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

    const defaults = (next.agents as TestAgents).defaults;
    expect(defaults.model).toEqual({
      primary: "claude-cli/claude-opus-4-7",
      fallbacks: ["claude-cli/claude-sonnet-4-6"],
    });
    expect(defaults.compaction).toEqual({ model: "claude-cli/claude-haiku-4-5" });
    expect(changes).toEqual([]);
  });

  // Regression: the live config additionally sets a sibling `agents.defaults.compaction.provider`
  // (e.g. "claude-cli") next to `.model`. That shape matches rewriteModelRefs' "provider/model
  // pair" branch, which rewrites `provider`+`model` together via a bare `normalize(ref)` call that
  // did not carry the field's path — so the path-aware lock check never fired and this branch
  // rewrote a locked agents.defaults.compaction.model even though the sibling-free fixture above
  // (compaction: { model: ... }, no provider) proved the guard clean. Live config always pairs
  // compaction.provider with compaction.model, so this shape is not theoretical.
  it("preserves agents.defaults.compaction.model when locked, with a sibling compaction.provider", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults.model", "agents.defaults.compaction.model"],
      agents: {
        defaults: {
          model: { primary: "claude-cli/claude-opus-4-7" },
          compaction: {
            provider: "claude-cli",
            model: "claude-cli/claude-sonnet-5",
          },
        },
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    const defaults = (next.agents as TestAgents).defaults;
    expect(defaults.compaction).toEqual({
      provider: "claude-cli",
      model: "claude-cli/claude-sonnet-5",
    });
    expect(changes).toEqual([]);
  });

  it("still migrates compaction.provider/model together when not locked", () => {
    const cfg: OpenClawConfig = {
      locked: ["agents.defaults.model"],
      agents: {
        defaults: {
          model: { primary: "claude-cli/claude-opus-4-7" },
          compaction: {
            provider: "claude-cli",
            model: "claude-cli/claude-sonnet-5",
          },
        },
      } as unknown as OpenClawConfig["agents"],
    };
    const changes: string[] = [];
    const next = normalizeLegacyRuntimeModelRefs(cfg, changes);

    // Not a claim this ref-composition is ideal (the object-pair branch treats `model`
    // as a bare id, but compaction.model is itself a full "provider/model" ref) — this
    // pins the pre-existing unlocked-migration behavior so the fix above is scoped to
    // making the lock check reachable, not to reworking ref composition.
    const defaults = (next.agents as TestAgents).defaults;
    expect(defaults.compaction).toEqual({
      provider: "anthropic",
      model: "claude-cli/claude-sonnet-5",
    });
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

    const defaults = (next.agents as TestAgents).defaults;
    expect(defaults.model).toEqual({ primary: "claude-cli/claude-opus-4-7" });
    expect(defaults.compaction).toEqual({ model: "anthropic/claude-haiku-4-5" });
  });
});
