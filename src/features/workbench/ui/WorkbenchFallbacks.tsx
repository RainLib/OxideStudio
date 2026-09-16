import type { WorkbenchSide } from "@/lib/appSettings";

export function ToolWindowFallback({
  side,
  isOpen,
  width,
}: {
  side: WorkbenchSide;
  isOpen: boolean;
  width: number;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="wb-tool-window h-full shrink-0 rounded-[6px]"
      style={{ width }}
      data-tool-window-side={side}
      aria-hidden="true"
    >
      <div className="h-8 border-b border-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}

export function QueryResultsFallback() {
  return (
    <div
      className="h-full bg-[linear-gradient(to_right,hsl(var(--wb-border-subtle))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--wb-border-subtle))_1px,transparent_1px)] bg-[size:160px_28px] opacity-45"
      aria-label="Loading query results"
    />
  );
}

export function WorkbenchSurfaceFallback() {
  return (
    <div
      className="h-full min-h-0 bg-[hsl(var(--wb-editor))]"
      aria-hidden="true"
    />
  );
}
