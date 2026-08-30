export function resolveInitialTransferTableSelection(options: {
  availableTables: readonly string[];
  sourceTable: string;
  sourceSchemaMatches: boolean;
  initialScope: "table" | "schema" | "database";
  requestedTables?: readonly string[];
  currentSelection: ReadonlySet<string>;
}): Set<string> {
  const available = new Set(options.availableTables);
  const requested = (options.requestedTables || []).filter((table) =>
    available.has(table),
  );
  if (options.sourceSchemaMatches && requested.length > 0) {
    return new Set(requested);
  }
  if (options.initialScope !== "table") {
    return new Set(options.availableTables);
  }
  const retained = [...options.currentSelection].filter((table) =>
    available.has(table),
  );
  const fallback = available.has(options.sourceTable)
    ? options.sourceTable
    : options.availableTables[0];
  return new Set(retained.length > 0 ? retained : fallback ? [fallback] : []);
}
