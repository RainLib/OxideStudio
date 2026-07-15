export type StartupIntent = "new-query" | "project-files" | "command-palette";

type StartupIntentListener = (intent: StartupIntent) => void;

declare global {
  interface Window {
    __oxideStartupIntents?: string[];
  }
}

const pendingIntents: StartupIntent[] = [];
const listeners = new Set<StartupIntentListener>();

function isStartupIntent(value: string): value is StartupIntent {
  return (
    value === "new-query" ||
    value === "project-files" ||
    value === "command-palette"
  );
}

function enqueue(intent: StartupIntent) {
  if (!pendingIntents.includes(intent)) pendingIntents.push(intent);
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
    if (isStartupIntent(intent)) enqueue(intent);
  });

  const queued = pendingIntents.splice(0);
  queued.forEach(listener);

  return () => {
    listeners.delete(listener);
  };
}
