/** Database-owned columns are inspectable but cannot be staged as mutations. */
export type TableColumnEditability =
  | "editable"
  | "generated"
  | "hidden"
  | "unclassified";

export interface TableColumnOwnership {
  is_generated?: boolean;
  is_hidden?: boolean;
}

export function tableColumnEditability(
  column: TableColumnOwnership | undefined,
): TableColumnEditability {
  if (column?.is_hidden === true) return "hidden";
  if (column?.is_generated === true) return "generated";
  if (!column || column.is_hidden === undefined || column.is_generated === undefined) {
    return "unclassified";
  }
  return "editable";
}

export function isTableColumnEditable(
  column: TableColumnOwnership | undefined,
) {
  return tableColumnEditability(column) === "editable";
}

export function tableColumnReadOnlyReason(
  editability: TableColumnEditability,
) {
  switch (editability) {
    case "generated":
      return "generated-column" as const;
    case "hidden":
      return "hidden-column" as const;
    case "unclassified":
      return "unclassified-column" as const;
    default:
      return "query-result" as const;
  }
}
