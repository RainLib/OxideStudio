export function looksReadOnlyJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  const mutatingMarkers = [
    '"delete"',
    '"delete_by_query"',
    '"doc"',
    '"index"',
    '"scripted_upsert"',
    '"update"',
    '"upsert"',
  ];
  return !mutatingMarkers.some((marker) => normalized.includes(marker));
}

export function looksDestructiveJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  return (
    normalized.includes('"delete"') || normalized.includes('"delete_by_query"')
  );
}
