export type SqlCompletionOutcome =
  | "lsp"
  | "fallback"
  | "empty"
  | "discarded"
  | "error";

export type SqlCompletionTelemetryEvent = {
  scope: string;
  outcome: SqlCompletionOutcome;
  durationMs: number;
  suggestionCount: number;
  reason?: string;
};

export type SqlCompletionTelemetrySnapshot = {
  requests: number;
  lsp: number;
  fallback: number;
  empty: number;
  discarded: number;
  errors: number;
  averageDurationMs: number;
  p95DurationMs: number;
  lastDurationMs: number;
  reasons: Record<string, number>;
};

const MAX_SCOPES = 24;
const MAX_SAMPLES_PER_SCOPE = 256;
const samples = new Map<string, SqlCompletionTelemetryEvent[]>();

/**
 * In-memory and content-free completion telemetry for diagnostics. SQL text,
 * identifiers, labels and server payloads are intentionally never recorded.
 */
export function recordSqlCompletionTelemetry(
  event: SqlCompletionTelemetryEvent,
) {
  const durationMs = Number.isFinite(event.durationMs)
    ? Math.max(0, event.durationMs)
    : 0;
  const normalized = {
    ...event,
    durationMs,
    suggestionCount: Math.max(0, Math.trunc(event.suggestionCount || 0)),
  };
  const previous = samples.get(event.scope) || [];
  const next = [...previous, normalized].slice(-MAX_SAMPLES_PER_SCOPE);
  samples.delete(event.scope);
  samples.set(event.scope, next);
  while (samples.size > MAX_SCOPES) {
    const oldest = samples.keys().next().value as string | undefined;
    if (!oldest) break;
    samples.delete(oldest);
  }
}

export function sqlCompletionTelemetrySnapshot(
  scope: string,
): SqlCompletionTelemetrySnapshot {
  const events = samples.get(scope) || [];
  const durations = events
    .map((event) => event.durationMs)
    .sort((left, right) => left - right);
  const reasons: Record<string, number> = {};
  for (const event of events) {
    if (event.reason) reasons[event.reason] = (reasons[event.reason] || 0) + 1;
  }
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
  return {
    requests: events.length,
    lsp: count(events, "lsp"),
    fallback: count(events, "fallback"),
    empty: count(events, "empty"),
    discarded: count(events, "discarded"),
    errors: count(events, "error"),
    averageDurationMs:
      events.length > 0
        ? durations.reduce((total, duration) => total + duration, 0) / events.length
        : 0,
    p95DurationMs: durations[p95Index] || 0,
    lastDurationMs: events[events.length - 1]?.durationMs || 0,
    reasons,
  };
}

export function resetSqlCompletionTelemetryForTests() {
  samples.clear();
}

function count(
  events: SqlCompletionTelemetryEvent[],
  outcome: SqlCompletionOutcome,
) {
  return events.filter((event) => event.outcome === outcome).length;
}
