const STORAGE_KEY = "oxide-studio-sql-completion-usage-v1";
const MAX_SCOPES = 64;
const MAX_ENTRIES_PER_SCOPE = 256;

type CompletionUsageEntry = {
  count: number;
  lastUsedAt: number;
};

type CompletionUsageState = Record<
  string,
  Record<string, CompletionUsageEntry>
>;

let cachedUsage: CompletionUsageState | null = null;

export function recordCompletionUsage(
  scope: string,
  label: string,
  now = Date.now(),
) {
  const normalizedScope = scope.trim();
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedScope || !normalizedLabel) return;

  const state = readCompletionUsage();
  const entries = state[normalizedScope] || {};
  const previous = entries[normalizedLabel];
  entries[normalizedLabel] = {
    count: Math.min(1_000, (previous?.count || 0) + 1),
    lastUsedAt: now,
  };
  state[normalizedScope] = trimEntries(entries);
  trimScopes(state);
  persistCompletionUsage(state);
}

export function completionUsageScore(
  scope: string,
  label: string,
  now = Date.now(),
) {
  const entry = readCompletionUsage()[scope]?.[label.trim().toLowerCase()];
  if (!entry) return 0;
  const ageDays = Math.max(0, (now - entry.lastUsedAt) / 86_400_000);
  const recency = Math.max(0, 30 - Math.floor(ageDays));
  return Math.min(999, entry.count * 10 + recency);
}

export function usageRankedCompletionSortText(base: string, score: number) {
  const separator = base.indexOf(":");
  const group = separator >= 0 ? base.slice(0, separator) : "0";
  const remainder = separator >= 0 ? base.slice(separator + 1) : base;
  const inverseScore = String(999 - Math.min(999, score)).padStart(3, "0");
  return `${group}:${inverseScore}:${remainder}`;
}

export function completionUsageScope(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim() || "-").join(":");
}

export function resetCompletionUsageCacheForTests() {
  cachedUsage = null;
}

function readCompletionUsage(): CompletionUsageState {
  if (cachedUsage) return cachedUsage;
  if (typeof window === "undefined") {
    cachedUsage = {};
    return cachedUsage;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cachedUsage = sanitizeState(parsed);
  } catch {
    cachedUsage = {};
  }
  return cachedUsage;
}

function persistCompletionUsage(state: CompletionUsageState) {
  cachedUsage = state;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Usage ranking is optional; completion must remain available when storage
    // is disabled or full.
  }
}

function sanitizeState(value: unknown): CompletionUsageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state: CompletionUsageState = {};
  for (const [scope, rawEntries] of Object.entries(value)) {
    if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
      continue;
    }
    const entries: Record<string, CompletionUsageEntry> = {};
    for (const [label, rawEntry] of Object.entries(rawEntries)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        continue;
      }
      const candidate = rawEntry as Partial<CompletionUsageEntry>;
      if (
        typeof candidate.count === "number" &&
        Number.isFinite(candidate.count) &&
        typeof candidate.lastUsedAt === "number" &&
        Number.isFinite(candidate.lastUsedAt)
      ) {
        entries[label] = {
          count: Math.max(1, Math.min(1_000, Math.floor(candidate.count))),
          lastUsedAt: candidate.lastUsedAt,
        };
      }
    }
    state[scope] = trimEntries(entries);
  }
  trimScopes(state);
  return state;
}

function trimEntries(entries: Record<string, CompletionUsageEntry>) {
  return Object.fromEntries(
    Object.entries(entries)
      .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt)
      .slice(0, MAX_ENTRIES_PER_SCOPE),
  );
}

function trimScopes(state: CompletionUsageState) {
  const retained = Object.entries(state)
    .sort((left, right) => newestEntry(right[1]) - newestEntry(left[1]))
    .slice(0, MAX_SCOPES);
  for (const scope of Object.keys(state)) delete state[scope];
  Object.assign(state, Object.fromEntries(retained));
}

function newestEntry(entries: Record<string, CompletionUsageEntry>) {
  return Math.max(0, ...Object.values(entries).map((entry) => entry.lastUsedAt));
}
