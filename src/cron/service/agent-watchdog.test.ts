import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCronAgentWatchdog } from "./agent-watchdog.js";

describe("createCronAgentWatchdog startup watchdog cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.OPENCLAW_CRON_STARTUP_WATCHDOG_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OPENCLAW_CRON_STARTUP_WATCHDOG_MS;
  });

  function startWaitingForExecution(triggerTimeout: (reason: string) => void) {
    const watchdog = createCronAgentWatchdog({
      deferUntilRunner: true,
      jobTimeoutMs: 300_000,
      triggerTimeout,
    });
    watchdog.start();
    watchdog.noteRunnerStarted({ jobId: "job-1", phase: "runtime_plugins" });
    return watchdog;
  }

  it("fires the pre-execution timeout at the default 60s cap", () => {
    const triggerTimeout = vi.fn();
    const watchdog = startWaitingForExecution(triggerTimeout);
    vi.advanceTimersByTime(59_999);
    expect(triggerTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(triggerTimeout).toHaveBeenCalledWith(
      expect.stringContaining("stalled before execution start"),
    );
    watchdog.dispose();
  });

  it("honors OPENCLAW_CRON_STARTUP_WATCHDOG_MS to raise the cap", () => {
    process.env.OPENCLAW_CRON_STARTUP_WATCHDOG_MS = "120000";
    const triggerTimeout = vi.fn();
    const watchdog = startWaitingForExecution(triggerTimeout);
    vi.advanceTimersByTime(119_999);
    expect(triggerTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(triggerTimeout).toHaveBeenCalledWith(
      expect.stringContaining("stalled before execution start"),
    );
    watchdog.dispose();
  });

  it("stays capped by half the job timeout even when the env cap is higher", () => {
    process.env.OPENCLAW_CRON_STARTUP_WATCHDOG_MS = "600000";
    const triggerTimeout = vi.fn();
    const watchdog = createCronAgentWatchdog({
      deferUntilRunner: true,
      jobTimeoutMs: 300_000,
      triggerTimeout,
    });
    watchdog.start();
    watchdog.noteRunnerStarted({ jobId: "job-1", phase: "runtime_plugins" });
    vi.advanceTimersByTime(149_999);
    expect(triggerTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(triggerTimeout).toHaveBeenCalled();
    watchdog.dispose();
  });

  it("ignores values lower than the default cap", () => {
    process.env.OPENCLAW_CRON_STARTUP_WATCHDOG_MS = "5000";
    const triggerTimeout = vi.fn();
    const watchdog = startWaitingForExecution(triggerTimeout);
    vi.advanceTimersByTime(59_999);
    expect(triggerTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(triggerTimeout).toHaveBeenCalled();
    watchdog.dispose();
  });
});
