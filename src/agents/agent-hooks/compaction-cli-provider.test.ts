/** Covers the built-in claude-cli compaction provider: opt-in registration and
 * end-to-end summarize() plumbing (prompt via stdin, text from stdout). */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { getCompactionProvider } from "../../plugins/compaction-provider.js";
import { createTestPluginRegistry } from "../../plugins/registry-runtime.test-helpers.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../../plugins/runtime.js";
import { testing as cliBackendsTesting } from "../cli-backends.test-support.js";
import {
  CLAUDE_CLI_COMPACTION_PROVIDER_ID,
  createClaudeCliCompactionProvider,
  ensureClaudeCliCompactionProvider,
} from "./compaction-cli-provider.js";

// A fake "claude" that ignores its CLI args and echoes stdin, so summarize()'s
// output equals the prompt we sent — exercises spawn/stdin/stdout end-to-end.
let tmpDir: string;
let echoCmd: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "compaction-cli-"));
  echoCmd = join(tmpDir, "fake-claude.sh");
  writeFileSync(echoCmd, "#!/bin/sh\nexec cat\n");
  chmodSync(echoCmd, 0o755);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  setActivePluginRegistry(createTestPluginRegistry().registry);
});

afterEach(() => {
  resetPluginRuntimeStateForTest();
  cliBackendsTesting.resetDepsForTest();
});

/** Minimal config with an opt-in compaction provider/model. The `claude-cli`
 * cliBackend command itself is stubbed via `cliBackendsTesting`, matching how
 * the native-compaction tests resolve a fake backend. */
function cfgWith(overrides: { provider?: string; model?: string }): OpenClawConfig {
  return {
    agents: {
      defaults: {
        compaction: {
          ...(overrides.provider ? { provider: overrides.provider } : {}),
          ...(overrides.model ? { model: overrides.model } : {}),
        },
      },
    },
  } as unknown as OpenClawConfig;
}

function registerFakeCliBackend(command: string | undefined) {
  cliBackendsTesting.setDepsForTest({
    resolveRuntimeCliBackends: () =>
      command
        ? ([{ id: "claude-cli", config: { command }, bundleMcp: false }] as never)
        : ([] as never),
    resolvePluginSetupCliBackend: () => undefined,
  });
}

describe("ensureClaudeCliCompactionProvider", () => {
  it("registers only when compaction.provider opts in", () => {
    registerFakeCliBackend(echoCmd);
    ensureClaudeCliCompactionProvider(cfgWith({}));
    expect(getCompactionProvider(CLAUDE_CLI_COMPACTION_PROVIDER_ID)).toBeUndefined();

    ensureClaudeCliCompactionProvider(cfgWith({ provider: CLAUDE_CLI_COMPACTION_PROVIDER_ID }));
    expect(getCompactionProvider(CLAUDE_CLI_COMPACTION_PROVIDER_ID)).toBeDefined();
  });
});

describe("createClaudeCliCompactionProvider.summarize", () => {
  it("feeds the transcript through the CLI and returns its stdout", async () => {
    registerFakeCliBackend(echoCmd);
    const provider = createClaudeCliCompactionProvider(cfgWith({}));
    const result = await provider.summarize({
      messages: [
        { role: "user", content: "build the widget" },
        { role: "assistant", content: [{ type: "text", text: "widget built" }] },
      ],
    });
    // /bin/cat echoes the prompt; assert the transcript made it through stdin.
    expect(result).toContain("build the widget");
    expect(result).toContain("widget built");
    expect(result).toContain("<transcript>");
  });

  it("returns empty (caller falls back) when no cliBackend command is configured", async () => {
    registerFakeCliBackend(undefined);
    const provider = createClaudeCliCompactionProvider(cfgWith({}));
    const result = await provider.summarize({ messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("");
  });

  it("rejects on a non-zero CLI exit", async () => {
    registerFakeCliBackend("/usr/bin/false");
    const provider = createClaudeCliCompactionProvider(cfgWith({}));
    await expect(
      provider.summarize({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/exited with code/);
  });
});
