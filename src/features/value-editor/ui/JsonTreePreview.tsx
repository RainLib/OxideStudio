import {
  JSON_TREE_MAX_ROWS,
  flattenJsonTreeRows,
  isJsonTreeContainer,
  jsonTreeContainerSummary,
  type JsonTreeRow,
} from "@/features/value-editor/model/jsonTree";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export const JSON_TREE_ROW_HEIGHT = 24;

export const JSON_TREE_OVERSCAN_ROWS = 20;

export function JsonTreePreview({ value }: { value: unknown }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([""]),
  );
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 480 });
  const rows = useMemo(
    () => flattenJsonTreeRows(value, expandedPaths),
    [expandedPaths, value],
  );
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / JSON_TREE_ROW_HEIGHT) -
      JSON_TREE_OVERSCAN_ROWS,
  );
  const end = Math.min(
    rows.length,
    Math.ceil((viewport.scrollTop + viewport.height) / JSON_TREE_ROW_HEIGHT) +
      JSON_TREE_OVERSCAN_ROWS,
  );

  useEffect(() => {
    setExpandedPaths(new Set([""]));
    setViewport((current) => ({ ...current, scrollTop: 0 }));
    scrollRef.current?.scrollTo({ top: 0 });
  }, [value]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateHeight = () => {
      if (element.clientHeight > 0) {
        setViewport((current) => ({
          ...current,
          height: element.clientHeight,
        }));
      }
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto px-3 py-3 font-mono text-[11px] text-[hsl(var(--wb-text))]"
      data-json-tree-virtualized="true"
      onScroll={(event) =>
        setViewport({
          scrollTop: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight || viewport.height,
        })
      }
    >
      <div
        className="relative min-w-max"
        style={{ height: rows.length * JSON_TREE_ROW_HEIGHT }}
      >
        {rows.slice(start, end).map((row, index) => (
          <JsonTreeVirtualRow
            key={row.path}
            row={row}
            expanded={expandedPaths.has(row.path)}
            top={(start + index) * JSON_TREE_ROW_HEIGHT}
            onToggle={togglePath}
          />
        ))}
      </div>
    </div>
  );
}

export function JsonTreeVirtualRow({
  row,
  expanded,
  top,
  onToggle,
}: {
  row: JsonTreeRow;
  expanded: boolean;
  top: number;
  onToggle: (path: string) => void;
}) {
  if (row.truncated) {
    return (
      <div
        className="absolute left-0 flex h-6 items-center text-[hsl(var(--wb-text-muted))]"
        style={{ top }}
      >
        Tree preview reached its {JSON_TREE_MAX_ROWS.toLocaleString()} row
        safety limit. Use the text view to inspect the complete value.
      </div>
    );
  }
  const expandable = isJsonTreeContainer(row.value);
  const summary = expandable ? jsonTreeContainerSummary(row.value) : "";
  return (
    <div
      className="absolute left-0 flex h-6 min-w-full items-center gap-1 whitespace-nowrap rounded-[3px] hover:bg-[hsl(var(--wb-hover))]"
      data-json-path={row.path}
      style={{ top, paddingLeft: row.depth * 14 }}
    >
      {row.closing ? (
        <span className="text-[hsl(var(--wb-text-secondary))]">
          {Array.isArray(row.value) ? "]" : "}"}
        </span>
      ) : (
        <>
          {expandable ? (
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              aria-expanded={expanded}
              aria-label={row.path || "$"}
              onClick={() => onToggle(row.path)}
            >
              {expanded ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="inline-block w-5 shrink-0" aria-hidden="true" />
          )}
          {row.parentKind !== "root" && (
            <span className="text-[hsl(var(--wb-text-muted))]">
              {row.parentKind === "array" ? `[${row.label}]` : row.label}:
            </span>
          )}
          {row.parentKind === "root" && (
            <span className="text-[hsl(var(--wb-text-muted))]">
              {row.label}
            </span>
          )}
          {expandable ? (
            <>
              <span className="text-[hsl(var(--wb-text-secondary))]">
                {Array.isArray(row.value) ? "[" : "{"}
              </span>
              {!expanded && (
                <>
                  <span className="text-[hsl(var(--wb-text-muted))]">
                    {summary}
                  </span>
                  <span className="text-[hsl(var(--wb-text-secondary))]">
                    {Array.isArray(row.value) ? "]" : "}"}
                  </span>
                </>
              )}
            </>
          ) : (
            <span
              className={jsonPrimitiveClass(row.value)}
              title={jsonPrimitiveText(row.value)}
            >
              {jsonPrimitiveText(row.value)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function jsonPrimitiveText(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

export function jsonPrimitiveClass(value: unknown) {
  if (value === null) return "text-[hsl(var(--wb-text-muted))]";
  if (typeof value === "string") return "text-[hsl(var(--wb-accent))]";
  if (typeof value === "boolean") return "text-[hsl(var(--wb-success))]";
  return "text-[hsl(var(--wb-warning))]";
}
