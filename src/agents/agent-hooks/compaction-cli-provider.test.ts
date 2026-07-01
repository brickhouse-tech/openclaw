/** Covers the built-in claude-cli compaction provider: opt-in registration and
 * end-to-end summarize() plumbing (prompt via stdin, text from stdout). */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { getCompactionProvider } from "../../plugins/compaction-provider.js";
import {
  CLAUDE_CLI_COMPACTION_PROVIDER_ID,
  createClaudeCliCompactionProvider,
  ensureClaudeCliCompactionProvider,
} from "./compaction-cli-provider.js";

const REGISTRY_KEY = Symbol.for("openclaw.compactionProviderRegistryState");

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

afterEach(() => {
  const g = globalThis as Record<symbol, unknown>;
  delete g[REGISTRY_KEY];
});

/** Minimal config with a fake cliBackend command. `cat` ignores the CLI args and
 * echoes stdin, so summarize()'s output is exactly the prompt we sent — enough to
 * exercise the spawn/stdin/stdout path without a real `claude` binary. */
function cfgWith(overrides: {
  command?: string;
  provider?: string;
  model?: string;
}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        compaction: {
          ...(overrides.provider ? { provider: overrides.provider } : {}),
          ...(overrides.model ? { model: overrides.model } : {}),
        },
        ...(overrides.command
          ? { cliBackends: { "claude-cli": { command: overrides.command } } }
          : {}),
      },
    },
  } as unknown as OpenClawConfig;
}

describe("ensureClaudeCliCompactionProvider", () => {
  it("registers only when compaction.provider opts in", () => {
    ensureClaudeCliCompactionProvider(cfgWith({ command: echoCmd }));
    expect(getCompactionProvider(CLAUDE_CLI_COMPACTION_PROVIDER_ID)).toBeUndefined();

    ensureClaudeCliCompactionProvider(
      cfgWith({ command: echoCmd, provider: CLAUDE_CLI_COMPACTION_PROVIDER_ID }),
    );
    expect(getCompactionProvider(CLAUDE_CLI_COMPACTION_PROVIDER_ID)).toBeDefined();
  });
});

describe("createClaudeCliCompactionProvider.summarize", () => {
  it("feeds the transcript through the CLI and returns its stdout", async () => {
    const provider = createClaudeCliCompactionProvider(cfgWith({ command: echoCmd }));
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
    const provider = createClaudeCliCompactionProvider(cfgWith({}));
    const result = await provider.summarize({ messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("");
  });

  it("rejects on a non-zero CLI exit", async () => {
    const provider = createClaudeCliCompactionProvider(cfgWith({ command: "/usr/bin/false" }));
    await expect(
      provider.summarize({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/exited with code/);
  });
});
