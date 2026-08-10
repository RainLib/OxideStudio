export type MetadataTaskPriority = "background" | "interactive";

export interface MetadataTaskLimiterEvent {
  event: "done" | "queued" | "rejected" | "start";
  scope: string;
  kind: string;
  active: number;
  queued: number;
}

export class MetadataTaskQueueFullError extends Error {
  constructor(readonly scope: string, readonly maxQueued: number) {
    super(
      `Metadata queue for scope "${scope}" reached its ${maxQueued} task limit.`,
    );
    this.name = "MetadataTaskQueueFullError";
  }
}

interface QueuedTask<T> {
  kind: string;
  priority: MetadataTaskPriority;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface ScopeState {
  active: number;
  queue: QueuedTask<unknown>[];
}

const priorityRank = (priority: MetadataTaskPriority) =>
  priority === "interactive" ? 1 : 0;

/**
 * Bounds metadata work independently per connection/database scope. Queued
 * interactive work is admitted before background catalog hydration while FIFO
 * order is preserved within each priority. The queue itself is bounded so a
 * malformed or extremely large catalog cannot allocate unbounded promises.
 */
export class MetadataTaskLimiter {
  private readonly scopes = new Map<string, ScopeState>();
  private nextSequence = 0;

  constructor(
    private readonly maxActive = 2,
    private readonly maxQueued = 512,
    private readonly logger?: (event: MetadataTaskLimiterEvent) => void,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new RangeError("maxActive must be a positive integer.");
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError("maxQueued must be a non-negative integer.");
    }
  }

  run<T>(
    scope: string,
    kind: string,
    task: () => Promise<T>,
    priority: MetadataTaskPriority = "interactive",
  ): Promise<T> {
    const normalizedScope = scope || "global";
    const state = this.stateForScope(normalizedScope);
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = {
        kind,
        priority,
        sequence: this.nextSequence++,
        run: task,
        resolve,
        reject,
      };
      if (state.active < this.maxActive) {
        this.start(normalizedScope, state, queued);
        return;
      }
      if (state.queue.length >= this.maxQueued) {
        const error = new MetadataTaskQueueFullError(
          normalizedScope,
          this.maxQueued,
        );
        this.log("rejected", normalizedScope, state, kind);
        reject(error);
        return;
      }

      const insertionIndex = state.queue.findIndex(
        (candidate) =>
          priorityRank(candidate.priority) < priorityRank(priority) ||
          (candidate.priority === priority &&
            candidate.sequence > queued.sequence),
      );
      if (insertionIndex < 0) state.queue.push(queued as QueuedTask<unknown>);
      else state.queue.splice(insertionIndex, 0, queued as QueuedTask<unknown>);
      this.log("queued", normalizedScope, state, kind);
    });
  }

  private stateForScope(scope: string): ScopeState {
    const existing = this.scopes.get(scope);
    if (existing) return existing;
    const state: ScopeState = { active: 0, queue: [] };
    this.scopes.set(scope, state);
    return state;
  }

  private start<T>(
    scope: string,
    state: ScopeState,
    task: QueuedTask<T>,
  ): void {
    state.active += 1;
    this.log("start", scope, state, task.kind);
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        state.active -= 1;
        this.log("done", scope, state, task.kind);
        const next = state.queue.shift();
        if (next) this.start(scope, state, next);
        else if (state.active === 0) this.scopes.delete(scope);
      });
  }

  private log(
    event: MetadataTaskLimiterEvent["event"],
    scope: string,
    state: ScopeState,
    kind: string,
  ) {
    this.logger?.({
      event,
      scope,
      kind,
      active: state.active,
      queued: state.queue.length,
    });
  }
}
