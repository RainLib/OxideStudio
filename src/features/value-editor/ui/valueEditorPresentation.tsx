import {
  valueEditorState,
  type ValueEditorKind,
  type ValueEditorState,
} from "@/lib/valueEditor";
import {
  Binary,
  Braces,
  CalendarClock,
  CircleSlash2,
  Code2,
  FileText,
  Hash,
  Image,
  ListTree,
  LoaderCircle,
  ToggleLeft,
  Type,
} from "lucide-react";
import { type ReactNode } from "react";

export const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  lineHeight: 20,
  glyphMargin: false,
  folding: true,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  padding: { top: 12, bottom: 18 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
};

export function kindIcon(kind: ValueEditorKind) {
  const props = { size: 13, "aria-hidden": true };
  switch (kind) {
    case "json":
    case "map":
      return <Braces {...props} />;
    case "xml":
      return <Code2 {...props} />;
    case "image":
      return <Image {...props} />;
    case "geometry":
      return <ListTree {...props} />;
    case "array":
      return <ListTree {...props} />;
    case "binary":
      return <Binary {...props} />;
    case "date":
      return <CalendarClock {...props} />;
    case "number":
      return <Hash {...props} />;
    case "boolean":
      return <ToggleLeft {...props} />;
    default:
      return <FileText {...props} />;
  }
}

export function stateIcon(state: ValueEditorState): ReactNode {
  switch (state) {
    case "unloaded":
      return <LoaderCircle size={14} />;
    case "null":
      return <CircleSlash2 size={14} />;
    case "empty":
      return <Type size={14} />;
    default:
      return <FileText size={14} />;
  }
}

export function stateLabel(state: ValueEditorState) {
  switch (state) {
    case "unloaded":
      return "Not loaded";
    case "null":
      return "NULL";
    case "empty":
      return "Empty string";
    default:
      return "Value";
  }
}

export function initialValueDescription(value: unknown) {
  const state = valueEditorState(value);
  if (state === "unloaded") return "Not loaded / database default";
  if (state === "null") return "NULL";
  if (state === "empty") return "Empty string (0 characters)";
  if (typeof value === "string")
    return `${value.length.toLocaleString()} characters`;
  if (Array.isArray(value)) return `${value.length.toLocaleString()} items`;
  if (typeof value === "object") return "Structured value";
  return String(value);
}

export function StatePlaceholder({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-[360px]">
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-[hsl(var(--wb-accent))]">
          {icon}
        </span>
        <div className="mt-3 text-[12px] font-medium text-[hsl(var(--wb-text))]">
          {title}
        </div>
        <div className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </div>
      </div>
    </div>
  );
}
