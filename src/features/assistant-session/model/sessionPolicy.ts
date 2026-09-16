export const AGENT_UNAVAILABLE_MESSAGE =
  "AI agent is unavailable. The database workspace remains fully usable; configure or restart the Agent Host and try again.";

export const AI_PROVIDER_REQUIRED_MESSAGE =
  "Configure an AI provider in Settings > AI Assistant before starting this request.";

export const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1_000;

export const MAX_TURN_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export const AGENT_STATUS_POLL_DELAY_MS = 300;

export const SNAPSHOT_PERSIST_DEBOUNCE_MS = 750;

export const SNAPSHOT_PERSIST_MAX_WAIT_MS = 5_000;

export const MAX_BUFFERED_HOST_EVENTS = 4_000;

export const MAX_LIVE_CONVERSATION_SCOPES = 8;
