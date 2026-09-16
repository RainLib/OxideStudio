export function selectLspTablesForSchema<T extends { name: string }>(
  schemaTables: T[],
  preferredTableNames: Iterable<string> | undefined,
  maxTables = Number.POSITIVE_INFINITY,
) {
  const selected: T[] = [];
  const selectedNames = new Set<string>();
  const byExactName = new Map(schemaTables.map((table) => [table.name, table]));
  const byLowerName = new Map(
    schemaTables.map((table) => [table.name.toLowerCase(), table]),
  );
  const pushTable = (table: T | undefined) => {
    if (!table || selectedNames.has(table.name)) return;
    selected.push(table);
    selectedNames.add(table.name);
  };
  const selectionLimit = Number.isFinite(maxTables)
    ? Math.max(0, Math.floor(maxTables))
    : Number.POSITIVE_INFINITY;

  for (const preferredName of preferredTableNames || []) {
    if (selected.length >= selectionLimit) break;
    pushTable(
      byExactName.get(preferredName) ||
        byLowerName.get(preferredName.toLowerCase()),
    );
  }
  for (const table of schemaTables) {
    if (selected.length >= selectionLimit) break;
    pushTable(table);
  }
  return selected;
}
