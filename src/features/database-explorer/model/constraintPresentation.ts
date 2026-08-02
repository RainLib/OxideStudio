import type { ConstraintInfo } from "@/services/tauri/types";

export type ConstraintPresentation = {
  detail: string;
  title: string;
  isForeignKey: boolean;
};

function concise(value: string, limit = 68) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, Math.max(1, limit - 1))}…`
    : normalized;
}

/**
 * Keeps constraint detail readable in the compact Explorer row while retaining
 * the complete database-provided definition in the native tooltip.
 */
export function constraintPresentation(
  constraint: ConstraintInfo,
): ConstraintPresentation {
  const columns = constraint.columns.length
    ? `(${constraint.columns.join(", ")})`
    : "";
  const isForeignKey = /foreign\s+key|^fk$/iu.test(constraint.constraint_type);
  const referencedRelation = [
    constraint.referenced_schema,
    constraint.referenced_table,
  ]
    .filter(Boolean)
    .join(".");
  const referencedColumns = constraint.referenced_columns.length
    ? ` (${constraint.referenced_columns.join(", ")})`
    : "";

  if (isForeignKey && referencedRelation) {
    const detail = `→ ${referencedRelation}${referencedColumns}`;
    return {
      detail,
      title: `${constraint.name} · ${constraint.constraint_type}${columns ? ` ${columns}` : ""} references ${referencedRelation}${referencedColumns}`,
      isForeignKey,
    };
  }

  if (constraint.definition?.trim()) {
    const definition = concise(constraint.definition);
    return {
      detail: definition,
      title: `${constraint.name} · ${constraint.constraint_type}${columns ? ` ${columns}` : ""} · ${constraint.definition.trim()}`,
      isForeignKey,
    };
  }

  return {
    detail: columns || constraint.constraint_type,
    title: `${constraint.name} · ${constraint.constraint_type}${columns ? ` ${columns}` : ""}`,
    isForeignKey,
  };
}
