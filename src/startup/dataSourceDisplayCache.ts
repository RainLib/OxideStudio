const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";
const CONNECTION_DISPLAY_CACHE_PREFIX = "oxide-studio-data-sources:";

export interface ConnectionDisplaySummary {
  id: string;
  projectId?: string;
  name: string;
  driver: string;
  icon?: string;
  color?: string;
}

export function readStartupProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

function connectionDisplayCacheKey(projectId: string) {
  return `${CONNECTION_DISPLAY_CACHE_PREFIX}${projectId}`;
}

export function connectionDisplaySummaries<T extends ConnectionDisplaySummary>(
  connections: readonly T[],
): ConnectionDisplaySummary[] {
  return connections.map(({ id, projectId, name, driver, icon, color }) => ({
    id,
    projectId,
    name,
    driver,
    icon,
    color,
  }));
}

export function readConnectionDisplayCache(
  projectId: string,
): ConnectionDisplaySummary[] | null {
  try {
    const raw = localStorage.getItem(connectionDisplayCacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return null;
    return parsed.items.filter((item): item is ConnectionDisplaySummary =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof (item as ConnectionDisplaySummary).id === "string" &&
        typeof (item as ConnectionDisplaySummary).name === "string" &&
        typeof (item as ConnectionDisplaySummary).driver === "string",
      ),
    );
  } catch {
    return null;
  }
}

export function readStartupConnectionDisplayCache() {
  return readConnectionDisplayCache(readStartupProjectId());
}

export function writeConnectionDisplayCache(
  projectId: string,
  connections: readonly ConnectionDisplaySummary[],
) {
  const items = connectionDisplaySummaries(connections);
  try {
    localStorage.setItem(
      connectionDisplayCacheKey(projectId),
      JSON.stringify({ version: 1, items }),
    );
  } catch {
    // The display cache is optional; the encrypted backend remains canonical.
  }
  return items;
}
