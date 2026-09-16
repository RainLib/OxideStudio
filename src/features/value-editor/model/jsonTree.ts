export const JSON_TREE_MAX_ROWS = 100_000;

export const JSON_TREE_SUMMARY_COUNT_LIMIT = 10_000;

export type JsonTreeParentKind = "root" | "array" | "object";

export interface JsonTreeRow {
  path: string;
  label: string;
  value: unknown;
  depth: number;
  parentKind: JsonTreeParentKind;
  closing?: boolean;
  truncated?: boolean;
}

export function isJsonTreeContainer(
  value: unknown,
): value is unknown[] | Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function escapeJsonPointerSegment(segment: string) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function appendJsonPointer(path: string, segment: string | number) {
  return `${path}/${escapeJsonPointerSegment(String(segment))}`;
}

/**
 * Iterative traversal avoids recursive call-stack growth. Only expanded
 * containers enumerate children; the hard row bound prevents a hostile JSON
 * cell from turning the tree preview into an unbounded renderer allocation.
 */
export function flattenJsonTreeRows(
  value: unknown,
  expandedPaths: ReadonlySet<string>,
  maxRows = JSON_TREE_MAX_ROWS,
): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  const pending: JsonTreeRow[] = [
    { path: "", label: "$", value, depth: 0, parentKind: "root" },
  ];
  const boundedMaxRows = Math.max(1, Math.floor(maxRows));
  let omittedRows = false;

  while (pending.length > 0 && rows.length < boundedMaxRows) {
    const row = pending.pop();
    if (!row) break;
    rows.push(row);
    if (
      row.closing ||
      row.truncated ||
      !isJsonTreeContainer(row.value) ||
      !expandedPaths.has(row.path)
    ) {
      continue;
    }
    pending.push({
      ...row,
      path: `${row.path}/$close\u0000`,
      label: "",
      closing: true,
    });
    // Account for rows already rendered and queued before enumerating a wide
    // container. This bounds both the returned list and the traversal stack;
    // virtualization alone would not protect memory from a million-key object.
    const availableChildren = boundedMaxRows - rows.length - pending.length;
    if (availableChildren <= 0) {
      omittedRows = true;
      continue;
    }
    if (Array.isArray(row.value)) {
      const visibleLength = Math.min(row.value.length, availableChildren);
      omittedRows ||= visibleLength < row.value.length;
      for (let index = visibleLength - 1; index >= 0; index -= 1) {
        pending.push({
          path: appendJsonPointer(row.path, index),
          label: String(index),
          value: row.value[index],
          depth: row.depth + 1,
          parentKind: "array",
        });
      }
    } else {
      const entries: Array<[string, unknown]> = [];
      for (const label in row.value) {
        if (!Object.prototype.hasOwnProperty.call(row.value, label)) continue;
        if (entries.length >= availableChildren) {
          omittedRows = true;
          break;
        }
        entries.push([label, row.value[label]]);
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [label, child] = entries[index]!;
        pending.push({
          path: appendJsonPointer(row.path, label),
          label,
          value: child,
          depth: row.depth + 1,
          parentKind: "object",
        });
      }
    }
  }
  if (pending.length > 0 || omittedRows) {
    rows.push({
      path: "/$truncated\u0000",
      label: "",
      value: pending.length,
      depth: 0,
      parentKind: "root",
      truncated: true,
    });
  }
  return rows;
}

export function jsonTreeContainerSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `[${value.length}${value.length === 1 ? " item" : " items"}]`;
  }
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  let count = 0;
  for (const label in object) {
    if (!Object.prototype.hasOwnProperty.call(object, label)) continue;
    count += 1;
    if (count > JSON_TREE_SUMMARY_COUNT_LIMIT) {
      return `{${JSON_TREE_SUMMARY_COUNT_LIMIT.toLocaleString()}+ properties}`;
    }
  }
  return `{${count}${count === 1 ? " property" : " properties"}}`;
}
