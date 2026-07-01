/**
 * Built-in "claude-cli" compaction provider.
 *
 * The embedded LLM summarization path (`summarizeInStages`) resolves its model
 * through the HTTP `models.providers` registry, which structurally cannot see a
 * cliBackend such as `claude-cli`. So pointing `compaction.model` at
 * `claude-cli/*` fails with "Unknown model … no matching models.providers[…]".
 *
 * This provider sidesteps that by summarizing through the same `claude` CLI the
 * main agent loop already uses — driven by the configured
 * `agents.defaults.cliBackends["claude-cli"]` command (which injects the
 * Max-subscription OAuth token). No HTTP provider, no API key, no per-token cost.
 *
 * Opt in with `agents.defaults.compaction.provider: "claude-cli"`. Registration
 * happens lazily from `buildEmbeddedExtensionFactories` (which runs at agent
 * init, before any compaction), so the provider is always present in the
 * process-global registry before `getCompactionProvider()` looks it up.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  getCompactionProvider,
  registerCompactionProvider,
  type CompactionProvider,
  type CompactionProviderSummarizationInstructions,
} from "../../plugins/compaction-provider.js";

const log = createSubsystemLogger("compaction-cli-provider");

/** Config value users set for `compaction.provider` to opt in. */
export const CLAUDE_CLI_COMPACTION_PROVIDER_ID = "claude-cli";

/** cliBackend key whose `command` drives summarization. */
const CLI_BACKEND_KEY = "claude-cli";

/** Fallback model alias when `compaction.model` is unset. The bare `sonnet`
 * alias always maps to the current Sonnet in the CLI, and Sonnet is the right
 * cost/quality tier for keep-vs-drop summarization. */
const DEFAULT_MODEL = "sonnet";

const DEFAULT_TIMEOUT_SECONDS = 900;

type ResolvedBackend = {
  command: string;
  modelId: string;
  timeoutMs: number;
};

/** Resolve the CLI command + model + timeout from config. Returns undefined
 * when no usable `claude-cli` cliBackend command is configured. */
function resolveBackend(cfg: OpenClawConfig | undefined): ResolvedBackend | undefined {
  const defaults = cfg?.agents?.defaults;
  const command = defaults?.cliBackends?.[CLI_BACKEND_KEY]?.command?.trim();
  if (!command) {
    return undefined;
  }
  // Honor the configured compaction model (strip the provider prefix, since we
  // pass the bare id to the CLI's --model), else fall back to the sonnet alias.
  const rawModel = defaults?.compaction?.model?.trim();
  const modelId =
    rawModel && rawModel.length > 0 ? rawModel.replace(/^claude-cli\//, "") : DEFAULT_MODEL;
  const timeoutSeconds = defaults?.compaction?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
  return { command, modelId: modelId || DEFAULT_MODEL, timeoutMs };
}

/** Best-effort render of one message to a readable transcript block. */
function renderMessage(message: unknown): string | undefined {
  if (message == null) {
    return undefined;
  }
  if (typeof message === "string") {
    return message.trim() || undefined;
  }
  if (typeof message !== "object") {
    return String(message);
  }
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "message";
  const content = record.content;
  const parts: string[] = [];
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== "object") {
        continue;
      }
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") {
        parts.push(p.text);
      } else if (p.type === "toolCall" || p.type === "tool_use") {
        const name = typeof p.name === "string" ? p.name : "tool";
        parts.push(`[tool call: ${name}]`);
      } else if (p.type === "toolResult" || p.type === "tool_result") {
        parts.push(`[tool result]`);
      }
    }
  } else if (typeof record.text === "string") {
    parts.push(record.text);
  }
  const body = parts.join("\n").trim();
  if (!body) {
    return undefined;
  }
  return `### ${role}\n${body}`;
}

function renderTranscript(messages: unknown[]): string {
  const blocks: string[] = [];
  for (const message of messages) {
    try {
      const rendered = renderMessage(message);
      if (rendered) {
        blocks.push(rendered);
      }
    } catch {
      // Skip anything we cannot render rather than aborting the whole summary.
    }
  }
  return blocks.join("\n\n");
}

function buildPrompt(params: {
  messages: unknown[];
  customInstructions?: string;
  summarizationInstructions?: CompactionProviderSummarizationInstructions;
  previousSummary?: string;
}): string {
  const sections: string[] = [];
  sections.push(
    "You are compacting a long agent conversation into a compact summary that will REPLACE the " +
      "older turns as the agent's memory. Preserve, in prose or lists:\n" +
      "- the overarching goal and current task,\n" +
      "- decisions made and the reasoning behind them,\n" +
      "- open threads / next steps / unresolved questions,\n" +
      "- exact identifiers (file paths, commands, IDs, names, values) needed to continue.\n" +
      "Drop resolved tangents, greetings, and verbose tool-call output. Do not invent facts. " +
      "Output ONLY the summary — no preamble, no meta commentary.",
  );
  const extra = params.customInstructions?.trim();
  if (extra) {
    sections.push(`Additional requirements:\n${extra}`);
  }
  const prior = params.previousSummary?.trim();
  if (prior) {
    sections.push(
      `A prior summary of earlier context is below. Fold its still-relevant content into your ` +
        `new summary — do not lose it.\n\n<prior_summary>\n${prior}\n</prior_summary>`,
    );
  }
  sections.push(`<transcript>\n${renderTranscript(params.messages)}\n</transcript>`);
  return sections.join("\n\n");
}

/** Spawn the CLI, feed the prompt via stdin, and collect stdout as text.
 * Rejects on non-zero exit, timeout, or abort. */
function runClaude(params: {
  command: string;
  modelId: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (params.signal?.aborted) {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
      return;
    }
    const args = ["-p", "--permission-mode", "bypassPermissions", "--model", params.modelId];
    let child: ChildProcess;
    try {
      child = spawn(params.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      const timeoutErr = new Error(
        `claude-cli compaction timed out after ${Math.round(params.timeoutMs / 1000)}s`,
      );
      timeoutErr.name = "TimeoutError";
      reject(timeoutErr);
    }, params.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `claude-cli compaction exited with code ${code ?? "null"}: ${stderr.trim().slice(0, 500)}`,
        ),
      );
    });

    try {
      child.stdin?.end(params.prompt);
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}

/** Build a claude-cli compaction provider bound to the given config. */
export function createClaudeCliCompactionProvider(
  cfg: OpenClawConfig | undefined,
): CompactionProvider {
  return {
    id: CLAUDE_CLI_COMPACTION_PROVIDER_ID,
    label: "Claude CLI (Max subscription)",
    async summarize(params) {
      const backend = resolveBackend(cfg);
      if (!backend) {
        // No usable cliBackend command — signal empty so the caller falls back
        // to the built-in LLM path rather than hanging.
        log.warn(
          `compaction.provider="${CLAUDE_CLI_COMPACTION_PROVIDER_ID}" but no ` +
            `agents.defaults.cliBackends["${CLI_BACKEND_KEY}"].command is configured.`,
        );
        return "";
      }
      const prompt = buildPrompt({
        messages: params.messages,
        customInstructions: params.customInstructions,
        summarizationInstructions: params.summarizationInstructions,
        previousSummary: params.previousSummary,
      });
      const summary = await runClaude({
        command: backend.command,
        modelId: backend.modelId,
        prompt,
        timeoutMs: backend.timeoutMs,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      return summary;
    },
  };
}

/**
 * Register the built-in claude-cli compaction provider when the user has opted
 * in (`compaction.provider === "claude-cli"`) and no provider of that id is
 * registered yet (e.g. a plugin overriding it takes precedence). Idempotent and
 * cheap to call on every agent init.
 */
export function ensureClaudeCliCompactionProvider(cfg: OpenClawConfig | undefined): void {
  const providerId = cfg?.agents?.defaults?.compaction?.provider?.trim();
  if (providerId !== CLAUDE_CLI_COMPACTION_PROVIDER_ID) {
    return;
  }
  if (getCompactionProvider(CLAUDE_CLI_COMPACTION_PROVIDER_ID)) {
    return;
  }
  registerCompactionProvider(createClaudeCliCompactionProvider(cfg));
  log.info(`Registered built-in "${CLAUDE_CLI_COMPACTION_PROVIDER_ID}" compaction provider.`);
}
