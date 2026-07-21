export type StartupActionIntent =
  | "new-query"
  | "project-files"
  | "command-palette";

export type StartupIntent =
  | StartupActionIntent
  | {
      type: "open-data-source";
      connectionId: string;
    };

type StartupIntentListener = (intent: StartupIntent) => void;

declare global {
  interface Window {
    __oxideStartupIntents?: string[];
  }
}

const pendingIntents: StartupIntent[] = [];
const listeners = new Set<StartupIntentListener>();
const OPEN_DATA_SOURCE_PREFIX = "open-data-source:";

function isStartupActionIntent(value: string): value is StartupActionIntent {
  return (
    value === "new-query" ||
    value === "project-files" ||
    value === "command-palette"
  );
}

function parseInlineStartupIntent(value: string): StartupIntent | null {
  if (isStartupActionIntent(value)) return value;
  if (!value.startsWith(OPEN_DATA_SOURCE_PREFIX)) return null;
  const encodedConnectionId = value.slice(OPEN_DATA_SOURCE_PREFIX.length);
  if (!encodedConnectionId) return null;
  try {
    const connectionId = decodeURIComponent(encodedConnectionId).trim();
    return connectionId
      ? { type: "open-data-source", connectionId }
      : null;
  } catch {
    return null;
  }
}

function startupIntentKey(intent: StartupIntent) {
  return typeof intent === "string"
    ? intent
    : `${intent.type}:${intent.connectionId}`;
}

function enqueue(intent: StartupIntent) {
  const key = startupIntentKey(intent);
  if (!pendingIntents.some((pending) => startupIntentKey(pending) === key)) {
    pendingIntents.push(intent);
  }
}

export function peekStartupIntent(): StartupIntent | null {
  const queuedIntent = pendingIntents[0];
  if (queuedIntent) return queuedIntent;

  const inlineIntent = window.__oxideStartupIntents
    ?.map(parseInlineStartupIntent)
    .find((intent): intent is StartupIntent => intent !== null);
  return inlineIntent ?? null;
}

export function requestStartupIntent(intent: StartupIntent) {
  if (listeners.size === 0) {
    enqueue(intent);
    return;
  }
  listeners.forEach((listener) => listener(intent));
}

export function subscribeStartupIntents(listener: StartupIntentListener) {
  listeners.add(listener);

  const inlineIntents = window.__oxideStartupIntents?.splice(0) ?? [];
  inlineIntents.forEach((intent) => {
    const parsed = parseInlineStartupIntent(intent);
    if (parsed) enqueue(parsed);
  });

  const queued = pendingIntents.splice(0);
  queued.forEach(listener);

  return () => {
    listeners.delete(listener);
  };
}
