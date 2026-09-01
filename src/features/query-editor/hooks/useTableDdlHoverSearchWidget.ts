import { useEffect, useRef } from "react";
import type { TableInfo } from "@/services/tauri";
import {
  loadTableDdl,
  loadTableMetadata,
} from "@/services/tableMetadataCache";
import {
  boundedHoverDdl,
  findQueryEditorHoverTable,
  isSqlRelationIdentifierContext,
  sqlIdentifierAtColumn,
} from "@/lib/queryEditorTableHover";

const HOVER_DELAY_MS = 320;
const FALLBACK_COLUMN_LIMIT = 200;

export type TableDdlHoverSearchRuntime = {
  activeProjectId?: string | null;
  currentSchema?: string | null;
  databaseName?: string | null;
  documentUri: string;
  driver: Parameters<typeof loadTableMetadata>[0]["driver"];
  effectiveConnectionId?: string | null;
  metadataRevision?: number | null;
  schemaTables: TableInfo[];
  showTableDdlHoverPreview: boolean;
  supportsTableBrowsing: boolean;
  targetSchema?: string | null;
};

export type TableDdlHoverSearchMatch = {
  start: number;
  end: number;
};

export function findTableDdlHoverSearchMatches(
  text: string,
  query: string,
): TableDdlHoverSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const matches: TableDdlHoverSearchMatch[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    offset = start + needle.length;
  }
  return matches;
}

export function renderTableDdlHoverSearchMatches(
  container: HTMLElement,
  text: string,
  matches: readonly TableDdlHoverSearchMatch[],
) {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const match of matches) {
    if (match.start > offset) {
      fragment.append(document.createTextNode(text.slice(offset, match.start)));
    }
    const mark = document.createElement("mark");
    mark.dataset.tableDdlHoverMatch = "true";
    mark.className =
      "rounded-[2px] bg-amber-300/75 px-px text-inherit dark:bg-amber-500/45";
    mark.textContent = text.slice(match.start, match.end);
    fragment.append(mark);
    offset = match.end;
  }
  if (offset < text.length) fragment.append(document.createTextNode(text.slice(offset)));
  container.replaceChildren(fragment);
}

function metadataFallbackText(
  schema: string,
  table: TableInfo,
  columns: Awaited<ReturnType<typeof loadTableMetadata>>["columns"],
) {
  const lines = [`-- ${schema}.${table.name} (${table.type || "table"})`];
  for (const column of columns.slice(0, FALLBACK_COLUMN_LIMIT)) {
    const details = [
      column.is_primary_key ? "PRIMARY KEY" : "",
      column.is_nullable ? "" : "NOT NULL",
      column.is_auto_increment ? "AUTO INCREMENT" : "",
    ].filter(Boolean);
    lines.push(
      `${column.name} ${column.data_type || "unknown"}${details.length ? ` ${details.join(" ")}` : ""}`,
    );
  }
  if (columns.length > FALLBACK_COLUMN_LIMIT) {
    lines.push(`-- ${columns.length - FALLBACK_COLUMN_LIMIT} more columns`);
  }
  return lines.join("\n");
}

function runtimeOwnerKey(runtime: TableDdlHoverSearchRuntime) {
  return [
    runtime.documentUri,
    runtime.activeProjectId || "local",
    runtime.effectiveConnectionId || "",
    runtime.driver,
    runtime.databaseName || "",
    runtime.targetSchema || runtime.currentSchema || "",
    runtime.metadataRevision ?? "",
  ].join("\u0000");
}

function createWidgetDom() {
  const root = document.createElement("section");
  root.dataset.tableDdlHoverSearch = "true";
  root.className =
    "pointer-events-auto w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-[7px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] shadow-[0_14px_38px_rgba(0,0,0,0.42)]";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Search table structure");

  const header = document.createElement("div");
  header.className =
    "flex items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5 py-2";
  const title = document.createElement("div");
  title.className = "min-w-0 flex-1 truncate font-mono text-[11px] font-medium";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search table structure";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className =
    "h-6 w-48 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[10px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";
  header.append(title, input);

  const status = document.createElement("div");
  status.className =
    "hidden border-b border-[hsl(var(--wb-border-subtle))] px-2.5 py-1 text-[10px] text-[hsl(var(--wb-text-muted))]";

  const body = document.createElement("pre");
  body.className =
    "m-0 max-h-[min(360px,calc(100vh-96px))] overflow-auto whitespace-pre p-2.5 font-mono text-[11px] leading-[18px]";
  root.append(header, status, body);
  return { root, title, input, status, body };
}

export function registerTableDdlHoverSearchWidget(options: {
  editor: any;
  monaco: any;
  getRuntime: () => TableDdlHoverSearchRuntime;
}) {
  const { editor, monaco, getRuntime } = options;
  const dom = createWidgetDom();
  let position: { lineNumber: number; column: number } | null = null;
  let sourceText = "";
  let timer: number | null = null;
  let requestId = 0;
  let shownKey = "";
  let mounted = false;

  const widget = {
    getId: () => "oxide.tableDdlHoverSearch",
    getDomNode: () => dom.root,
    getPosition: () =>
      position
        ? {
            position,
            preference: [
              monaco.editor.ContentWidgetPositionPreference.BELOW,
              monaco.editor.ContentWidgetPositionPreference.ABOVE,
            ],
          }
        : null,
    allowEditorOverflow: true,
    suppressMouseDown: false,
  };

  const cancelTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const hide = () => {
    cancelTimer();
    requestId += 1;
    shownKey = "";
    position = null;
    if (mounted) {
      editor.removeContentWidget(widget);
      mounted = false;
    }
  };
  const renderSearch = () => {
    const matches = findTableDdlHoverSearchMatches(sourceText, dom.input.value);
    renderTableDdlHoverSearchMatches(dom.body, sourceText, matches);
    const hasQuery = Boolean(dom.input.value.trim());
    dom.status.classList.toggle("hidden", !hasQuery);
    dom.status.textContent = hasQuery
      ? matches.length
        ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
        : "No matches"
      : "";
    dom.body
      .querySelector<HTMLElement>("[data-table-ddl-hover-match]")
      ?.scrollIntoView?.({ block: "nearest" });
  };

  const showAt = async (
    nextPosition: { lineNumber: number; column: number },
    relation: TableInfo,
    ownerKey: string,
  ) => {
    const runtime = getRuntime();
    const schema = runtime.targetSchema || runtime.currentSchema;
    const connectionId = runtime.effectiveConnectionId;
    if (!schema || !connectionId || runtimeOwnerKey(runtime) !== ownerKey) return;
    const currentRequest = ++requestId;
    const identity = {
      projectId: runtime.activeProjectId || undefined,
      connectionId,
      driver: runtime.driver,
      databaseName: runtime.databaseName || undefined,
      schema,
      table: relation.name,
    };
    const [metadata, ddl] = await Promise.all([
      loadTableMetadata({
        ...identity,
        includeIndexes: true,
        includeConstraints: false,
      }).catch(() => null),
      loadTableDdl(identity, relation.type).catch(() => null),
    ]);
    if (
      currentRequest !== requestId ||
      runtimeOwnerKey(getRuntime()) !== ownerKey ||
      editor.getModel()?.uri?.toString() !== runtime.documentUri
    ) {
      return;
    }
    const fallback = metadata
      ? metadataFallbackText(schema, relation, metadata.columns)
      : `-- Structure unavailable for ${schema}.${relation.name}`;
    const bounded = boundedHoverDdl(ddl || fallback);
    sourceText = bounded.text || fallback;
    if (bounded.truncated) sourceText += "\n-- Preview truncated; open the DDL tab for the complete definition.";
    dom.title.textContent = `${schema}.${relation.name}`;
    dom.input.value = "";
    renderSearch();
    position = nextPosition;
    if (!mounted) {
      editor.addContentWidget(widget);
      mounted = true;
    } else {
      editor.layoutContentWidget(widget);
    }
  };

  const mouseMove = editor.onMouseMove((event: any) => {
    const nextPosition = event.target?.position;
    const model = editor.getModel();
    const runtime = getRuntime();
    if (
      !nextPosition ||
      !model ||
      !runtime.showTableDdlHoverPreview ||
      !runtime.supportsTableBrowsing ||
      model.uri?.toString() !== runtime.documentUri
    ) {
      hide();
      return;
    }
    const line = model.getLineContent(nextPosition.lineNumber);
    const identifier = sqlIdentifierAtColumn(line, nextPosition.column);
    const relation = isSqlRelationIdentifierContext(line, nextPosition.column)
      ? findQueryEditorHoverTable(runtime.schemaTables, identifier)
      : null;
    if (!relation) {
      hide();
      return;
    }
    const ownerKey = runtimeOwnerKey(runtime);
    const nextKey = `${ownerKey}\u0000${relation.name}`;
    if (shownKey === nextKey) {
      if (mounted) {
        position = nextPosition;
        editor.layoutContentWidget(widget);
      }
      return;
    }
    shownKey = nextKey;
    cancelTimer();
    const scheduledRequest = ++requestId;
    timer = window.setTimeout(() => {
      timer = null;
      if (scheduledRequest !== requestId) return;
      void showAt(nextPosition, relation, ownerKey);
    }, HOVER_DELAY_MS);
  });
  const mouseLeave = editor.onMouseLeave((event: any) => {
    const related = event?.event?.browserEvent?.relatedTarget;
    if (related instanceof Node && dom.root.contains(related)) return;
    hide();
  });
  const contentChange = editor.onDidChangeModelContent(hide);
  const modelChange = editor.onDidChangeModel(hide);
  const scrollChange = editor.onDidScrollChange(hide);
  const outsidePointer = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && dom.root.contains(target)) return;
    if (target instanceof Node && editor.getDomNode()?.contains(target)) return;
    hide();
  };
  const stopPropagation = (event: Event) => event.stopPropagation();
  const keyboard = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (dom.input.value) {
      dom.input.value = "";
      renderSearch();
    } else {
      hide();
      editor.focus();
    }
  };
  dom.input.addEventListener("input", renderSearch);
  dom.root.addEventListener("pointerdown", stopPropagation);
  dom.root.addEventListener("mousedown", stopPropagation);
  dom.root.addEventListener("keydown", keyboard);
  document.addEventListener("pointerdown", outsidePointer, true);

  return {
    dispose() {
      hide();
      mouseMove.dispose();
      mouseLeave.dispose();
      contentChange.dispose();
      modelChange.dispose();
      scrollChange.dispose();
      dom.input.removeEventListener("input", renderSearch);
      dom.root.removeEventListener("pointerdown", stopPropagation);
      dom.root.removeEventListener("mousedown", stopPropagation);
      dom.root.removeEventListener("keydown", keyboard);
      document.removeEventListener("pointerdown", outsidePointer, true);
    },
  };
}

export function useTableDdlHoverSearchWidget(options: {
  editor: any;
  monaco: any;
  runtime: TableDdlHoverSearchRuntime;
  enabled: boolean;
}) {
  const runtimeRef = useRef(options.runtime);
  runtimeRef.current = options.runtime;
  const ownerKey = runtimeOwnerKey(options.runtime);

  useEffect(() => {
    if (!options.enabled || !options.editor || !options.monaco) return;
    const controller = registerTableDdlHoverSearchWidget({
      editor: options.editor,
      monaco: options.monaco,
      getRuntime: () => runtimeRef.current,
    });
    return () => controller.dispose();
  }, [options.editor, options.enabled, options.monaco, ownerKey]);
}
