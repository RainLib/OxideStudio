/**
 * An explicitly opted-in SQL expression staged from the table value editor.
 * It is intentionally distinct from a string so ordinary grid edits always
 * remain parameterized. The Rust mutation boundary validates it again before
 * placing it in a SET clause.
 */
export interface TableCellExpression {
  readonly __oxideTableCellExpression: true;
  readonly expression: string;
}

export function tableCellExpression(expression: string): TableCellExpression {
  return { __oxideTableCellExpression: true, expression };
}

export function isTableCellExpression(
  value: unknown,
): value is TableCellExpression {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { __oxideTableCellExpression?: unknown })
        .__oxideTableCellExpression === true &&
      typeof (value as { expression?: unknown }).expression === "string",
  );
}

export function validateTableCellExpression(expression: string):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  const value = expression.trim();
  if (!value) return { ok: false, error: "SQL expression is required." };
  if (value.length > 4_096) {
    return { ok: false, error: "SQL expressions are limited to 4,096 characters." };
  }
  if (/;|--|\/\*|\*\//u.test(value)) {
    return {
      ok: false,
      error: "SQL expressions cannot contain statement separators or comments.",
    };
  }
  if (/^where\b/iu.test(value)) {
    return { ok: false, error: "Enter an expression, not a WHERE clause." };
  }
  return { ok: true, value };
}
