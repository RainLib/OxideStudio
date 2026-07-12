export function resultColumnGridId(
  columns: Array<{ name: string }>,
  index: number
) {
  const name = columns[index]?.name || "Unknown";
  const isDuplicate = columns.some(
    (column, candidateIndex) =>
      candidateIndex !== index && column.name === name
  );
  return isDuplicate ? `__oxide_result_column_${index}:${name}` : name;
}

export function resultColumnIndexByGridId(
  columns: Array<{ name: string }>,
  gridId: string | number | undefined
) {
  if (gridId === undefined) return -1;
  const normalizedId = String(gridId);
  return columns.findIndex(
    (_column, index) => resultColumnGridId(columns, index) === normalizedId
  );
}
