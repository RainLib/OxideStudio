/**
 * A small bounded scheduler for metadata requests initiated by the Explorer
 * filter. Database servers often serialize catalog work per connection, so
 * dispatching every collapsed node at once makes search slower, not faster.
 */
export const SIDEBAR_SEARCH_TASK_CONCURRENCY = 4;

export interface CollapsedDatabaseSearchCache {
  schemas: Record<string, string[]>;
  tables: Record<string, Record<string, unknown>>;
  objects: Record<string, Record<string, unknown>>;
}

/** Return only catalog nodes that have not already been loaded in this scope. */
export function collapsedDatabaseSchemaTargets(
  databases: readonly string[],
  currentDatabase: string,
  cache: CollapsedDatabaseSearchCache,
) {
  return databases.filter(
    (database) =>
      database !== currentDatabase &&
      !Object.prototype.hasOwnProperty.call(cache.schemas, database),
  );
}

/**
 * A relation plus its non-table objects form one Explorer search unit. Reload
 * it when either half is absent, otherwise a cached table list could hide a
 * matching routine, sequence, or trigger.
 */
export function collapsedSchemaMetadataTargets(
  databaseSchemas: ReadonlyMap<string, readonly string[]>,
  cache: CollapsedDatabaseSearchCache,
) {
  return [...databaseSchemas.entries()].flatMap(([database, schemas]) =>
    schemas
      .filter(
        (schema) =>
          !Object.prototype.hasOwnProperty.call(cache.tables[database] || {}, schema) ||
          !Object.prototype.hasOwnProperty.call(cache.objects[database] || {}, schema),
      )
      .map((schema) => ({ database, schema })),
  );
}

export async function runSidebarSearchTasks<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency = SIDEBAR_SEARCH_TASK_CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const index = nextIndex++;
        const task = tasks[index];
        if (!task) continue;
        try {
          results[index] = { status: "fulfilled", value: await task() };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
