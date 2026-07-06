import { describe, expect, it, vi } from "vitest";
import {
  cancelScheduledLspSync,
  scheduleDebouncedLspSync,
  type LspSyncControl,
  type LspSyncTimer,
} from "@/services/lsp/syncScheduler";

type TimerRecord = {
  callback: () => void;
  delayMs: number;
  id: LspSyncTimer;
};

function createTimerHarness() {
  const timers: TimerRecord[] = [];
  const clearTimeoutFn = vi.fn();
  const setTimeoutFn = (callback: () => void, delayMs: number) => {
    const id = `timer-${timers.length + 1}` as unknown as LspSyncTimer;
    timers.push({ callback, delayMs, id });
    return id;
  };

  return { timers, setTimeoutFn, clearTimeoutFn };
}

describe("LSP sync scheduler", () => {
  it("debounces sync work until the configured delay callback runs", () => {
    const timerRef = { current: null };
    const harness = createTimerHarness();
    const run = vi.fn();

    const scheduled = scheduleDebouncedLspSync({
      timerRef,
      delayMs: 500,
      generation: 3,
      run,
      setTimeoutFn: harness.setTimeoutFn,
      clearTimeoutFn: harness.clearTimeoutFn,
    });

    expect(run).not.toHaveBeenCalled();
    expect(harness.timers).toHaveLength(1);
    expect(harness.timers[0].delayMs).toBe(500);
    expect(timerRef.current).toBe(harness.timers[0].id);
    expect(scheduled.isCancelled()).toBe(false);

    harness.timers[0].callback();

    expect(timerRef.current).toBeNull();
    expect(run).toHaveBeenCalledWith({
      generation: 3,
      isCancelled: expect.any(Function),
    });
  });

  it("clears an existing timer before scheduling a replacement", () => {
    const oldTimer = "old-timer" as unknown as LspSyncTimer;
    const timerRef = { current: oldTimer };
    const harness = createTimerHarness();

    scheduleDebouncedLspSync({
      timerRef,
      delayMs: 250,
      generation: 4,
      run: vi.fn(),
      setTimeoutFn: harness.setTimeoutFn,
      clearTimeoutFn: harness.clearTimeoutFn,
    });

    expect(harness.clearTimeoutFn).toHaveBeenCalledWith(oldTimer);
    expect(timerRef.current).toBe(harness.timers[0].id);
  });

  it("marks scheduled work cancelled when cleanup runs before or after fire", () => {
    const timerRef = { current: null };
    const harness = createTimerHarness();
    let control: LspSyncControl | null = null;

    const scheduled = scheduleDebouncedLspSync({
      timerRef,
      delayMs: 500,
      generation: 5,
      run: (nextControl) => {
        control = nextControl;
      },
      setTimeoutFn: harness.setTimeoutFn,
      clearTimeoutFn: harness.clearTimeoutFn,
    });

    scheduled.cleanup();
    expect(scheduled.isCancelled()).toBe(true);
    expect(timerRef.current).toBeNull();
    expect(harness.clearTimeoutFn).toHaveBeenCalledWith(harness.timers[0].id);

    harness.timers[0].callback();
    expect(control?.isCancelled()).toBe(true);
  });

  it("reports whether a pending timer was cancelled", () => {
    const timer = "timer" as unknown as LspSyncTimer;
    const timerRef = { current: timer };
    const clearTimeoutFn = vi.fn();

    expect(cancelScheduledLspSync(timerRef, clearTimeoutFn)).toBe(true);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timer);
    expect(timerRef.current).toBeNull();
    expect(cancelScheduledLspSync(timerRef, clearTimeoutFn)).toBe(false);
  });
});
