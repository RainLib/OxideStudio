import type {
  ConstraintInfo,
  ForeignKeyReferenceInfo,
  TableFilter,
} from "@/services/tauri/types";

export type ForeignKeyNavigationDirection = "referenced" | "referencing";

export interface ForeignKeyNavigationPlan {
  direction: ForeignKeyNavigationDirection;
  constraintName: string;
  schema: string;
  table: string;
  filters: TableFilter[];
}

interface ForeignKeyNavigationInput {
  currentSchema: string;
  currentTable: string;
  selectedColumn: string;
  columns: string[];
  row: unknown[];
  constraints: ConstraintInfo[];
  referencingForeignKeys: ForeignKeyReferenceInfo[];
}

function isForeignKey(constraint: ConstraintInfo) {
  return constraint.constraint_type.trim().toUpperCase() === "FOREIGN KEY";
}

function filterValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mappedFilters(
  rowColumns: string[],
  row: unknown[],
  valueColumns: string[],
  filterColumns: string[],
): TableFilter[] | null {
  if (
    valueColumns.length === 0 ||
    valueColumns.length !== filterColumns.length
  ) {
    return null;
  }

  const columnIndexes = new Map<string, number>();
  rowColumns.forEach((column, index) => {
    if (!columnIndexes.has(column)) columnIndexes.set(column, index);
  });

  const filters: TableFilter[] = [];
  for (let index = 0; index < valueColumns.length; index += 1) {
    const valueColumn = valueColumns[index];
    const filterColumn = filterColumns[index];
    if (valueColumn === undefined || filterColumn === undefined) return null;
    const rowIndex = columnIndexes.get(valueColumn);
    if (rowIndex === undefined) return null;
    const value = filterValue(row[rowIndex]);
    // SQL foreign keys with any NULL component do not identify a related row.
    if (value === null) return null;
    filters.push({
      column: filterColumn,
      operator: "equals",
      value,
      logic: index === 0 ? undefined : "AND",
    });
  }

  return filters;
}

/**
 * Build deterministic, structured table-navigation plans for one result row.
 * Composite keys are atomic: a plan is emitted only when every mapped value
 * is present and non-NULL.
 */
export function buildForeignKeyNavigationPlans({
  currentSchema,
  currentTable,
  selectedColumn,
  columns,
  row,
  constraints,
  referencingForeignKeys,
}: ForeignKeyNavigationInput): ForeignKeyNavigationPlan[] {
  const plans: ForeignKeyNavigationPlan[] = [];

  for (const constraint of constraints) {
    if (
      !isForeignKey(constraint) ||
      !constraint.columns.includes(selectedColumn) ||
      !constraint.referenced_table
    ) {
      continue;
    }
    const filters = mappedFilters(
      columns,
      row,
      constraint.columns,
      constraint.referenced_columns,
    );
    if (!filters) continue;
    plans.push({
      direction: "referenced",
      constraintName: constraint.name,
      schema: constraint.referenced_schema || currentSchema,
      table: constraint.referenced_table,
      filters,
    });
  }

  for (const reference of referencingForeignKeys) {
    if (
      reference.referenced_schema !== currentSchema ||
      reference.referenced_table !== currentTable ||
      !reference.referenced_columns.includes(selectedColumn)
    ) {
      continue;
    }
    const filters = mappedFilters(
      columns,
      row,
      reference.referenced_columns,
      reference.columns,
    );
    if (!filters) continue;
    plans.push({
      direction: "referencing",
      constraintName: reference.name,
      schema: reference.schema,
      table: reference.table,
      filters,
    });
  }

  return plans.sort((left, right) => {
    if (left.direction !== right.direction) {
      return left.direction === "referenced" ? -1 : 1;
    }
    return `${left.schema}.${left.table}.${left.constraintName}`.localeCompare(
      `${right.schema}.${right.table}.${right.constraintName}`,
    );
  });
}

export function foreignKeyNavigationLabel(plan: ForeignKeyNavigationPlan) {
  const relation = `${plan.schema}.${plan.table}`;
  return plan.direction === "referenced"
    ? `Go to Referenced Row · ${relation} [${plan.constraintName}]`
    : `Show Referencing Rows · ${relation} [${plan.constraintName}]`;
}
