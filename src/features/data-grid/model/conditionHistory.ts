const STORAGE_KEY = "oxide.data-grid-condition-history.v1";
const MAX_HISTORY_SCOPES = 160;
const MAX_HISTORY_PER_SCOPE = 12;
const MAX_CONDITION_LENGTH = 4_096;

export interface DataGridConditionHistoryScope {
  connectionId?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
}

/** Keep text-field undo/redo inside the condition editor, not the SQL editor. */
export function isDataGridConditionUndoRedoShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (event.altKey) return false;
  const key = event.key.toLocaleLowerCase();
  return (
    ((event.ctrlKey || event.metaKey) && key === "z") ||
    (Boolean(event.ctrlKey) && !event.metaKey && key === "y")
  );
}

interface StoredConditionHistory {
  version: 1;
  scopes: Record<string, string[]>;
}

function normalizeScopePart(value: string | null | undefined) {
  return (value || "").trim().toLocaleLowerCase();
}

function normalizeCondition(value: string | null | undefined) {
  return (value || "")
    .trim()
    .replace(/;+\s*$/u, "")
    .trim()
    .slice(0, MAX_CONDITION_LENGTH);
}

export function dataGridConditionHistoryScopeKey(
  scope: DataGridConditionHistoryScope,
): string | null {
  const connectionId = normalizeScopePart(scope.connectionId);
  const tableName = normalizeScopePart(scope.tableName);
  if (!connectionId || !tableName) return null;
  return [
    connectionId,
    normalizeScopePart(scope.databaseName),
    normalizeScopePart(scope.schemaName),
    tableName,
  ].join("\u0001");
}

export function loadDataGridConditionHistory(
  scope: DataGridConditionHistoryScope,
  query = "",
): string[] {
  const key = dataGridConditionHistoryScopeKey(scope);
  if (!key) return [];
  const normalizedQuery = normalizeCondition(query).toLocaleLowerCase();
  return (readHistory().scopes[key] || [])
    .filter(
      (condition) =>
        !normalizedQuery || condition.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, MAX_HISTORY_PER_SCOPE);
}

export function rememberDataGridConditionHistory(
  scope: DataGridConditionHistoryScope,
  value: string | null | undefined,
): string[] {
  const key = dataGridConditionHistoryScopeKey(scope);
  const condition = normalizeCondition(value);
  if (!key || !condition) return key ? loadDataGridConditionHistory(scope) : [];

  const history = readHistory();
  const previous = history.scopes[key] || [];
  history.scopes[key] = [
    condition,
    ...previous.filter(
      (entry) => entry.toLocaleLowerCase() !== condition.toLocaleLowerCase(),
    ),
  ].slice(0, MAX_HISTORY_PER_SCOPE);
  trimStoredScopes(history.scopes);
  writeHistory(history);
  return history.scopes[key];
}

function readHistory(): StoredConditionHistory {
  try {
    if (typeof localStorage === "undefined") return { version: 1, scopes: {} };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, scopes: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: 1, scopes: {} };
    }
    const candidate = parsed as Partial<StoredConditionHistory>;
    if (candidate.version !== 1 || !candidate.scopes || typeof candidate.scopes !== "object") {
      return { version: 1, scopes: {} };
    }
    return {
      version: 1,
      scopes: Object.fromEntries(
        Object.entries(candidate.scopes)
          .filter(([, values]) => Array.isArray(values))
          .map(([key, values]) => [
            key,
            values
              .filter((value): value is string => typeof value === "string")
              .map(normalizeCondition)
              .filter(Boolean)
              .slice(0, MAX_HISTORY_PER_SCOPE),
          ]),
      ),
    };
  } catch {
    return { version: 1, scopes: {} };
  }
}

function trimStoredScopes(scopes: Record<string, string[]>) {
  const keys = Object.keys(scopes);
  if (keys.length <= MAX_HISTORY_SCOPES) return;
  for (const staleKey of keys.slice(0, keys.length - MAX_HISTORY_SCOPES)) {
    delete scopes[staleKey];
  }
}

function writeHistory(history: StoredConditionHistory) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  } catch {
    // Local history is an optional convenience; a full browser store must not
    // prevent filtering, completion, or query execution.
  }
}
