export type LspSyncTimer = number | NodeJS.Timeout;
export type LspSetTimeout = (
  callback: () => void,
  delayMs: number
) => LspSyncTimer;
export type LspClearTimeout = (timer: LspSyncTimer) => void;

export type LspSyncTimerRef = {
  current: LspSyncTimer | null;
};

export type LspSyncControl = {
  generation: number;
  isCancelled: () => boolean;
};

export type ScheduledLspSync = LspSyncControl & {
  cleanup: () => void;
};

export function cancelScheduledLspSync(
  timerRef: LspSyncTimerRef,
  clearTimeoutFn: LspClearTimeout = defaultClearTimeout
) {
  const timer = timerRef.current;
  if (!timer) return false;

  clearTimeoutFn(timer);
  timerRef.current = null;
  return true;
}

export function scheduleDebouncedLspSync(options: {
  timerRef: LspSyncTimerRef;
  delayMs: number;
  generation: number;
  run: (control: LspSyncControl) => void | Promise<void>;
  setTimeoutFn?: LspSetTimeout;
  clearTimeoutFn?: LspClearTimeout;
}): ScheduledLspSync {
  const {
    timerRef,
    delayMs,
    generation,
    run,
    setTimeoutFn = defaultSetTimeout,
    clearTimeoutFn = defaultClearTimeout,
  } = options;
  let cancelled = false;
  const control: LspSyncControl = {
    generation,
    isCancelled: () => cancelled,
  };

  cancelScheduledLspSync(timerRef, clearTimeoutFn);

  timerRef.current = setTimeoutFn(() => {
    timerRef.current = null;
    void run(control);
  }, delayMs);

  return {
    ...control,
    cleanup: () => {
      cancelled = true;
    cancelScheduledLspSync(timerRef, clearTimeoutFn);
  },
  };
}

const defaultSetTimeout: LspSetTimeout = (callback, delayMs) =>
  setTimeout(callback, delayMs);

const defaultClearTimeout: LspClearTimeout = (timer) => {
  clearTimeout(timer);
};
