export interface DataGridColumnLookupItem {
  index: number;
  name: string;
  detail?: string | null;
}

/**
 * Keeps the grid's column locator deterministic: visual column order remains
 * authoritative, while names, types, comments and ordinal numbers are all
 * discoverable from one compact query.
 */
export function filterDataGridColumnLookupItems(
  items: readonly DataGridColumnLookupItem[],
  query: string,
): DataGridColumnLookupItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...items];

  return items.filter((item) =>
    [item.name, item.detail, String(item.index + 1)]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
}
