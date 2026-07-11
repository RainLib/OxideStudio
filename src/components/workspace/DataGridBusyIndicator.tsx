import { LoaderCircle } from "lucide-react";

interface DataGridBusyIndicatorProps {
  kind: "table" | "query";
}

export function DataGridBusyIndicator({ kind }: DataGridBusyIndicatorProps) {
  const label = kind === "table" ? "Fetching data..." : "Executing query...";

  return (
    <div
      className="absolute inset-0 z-40 flex cursor-progress items-center justify-center"
      data-testid="data-grid-busy-indicator"
    >
      <div
        className="wb-data-grid-busy-content flex flex-col items-center justify-center gap-2"
        role="status"
        aria-live="polite"
        aria-label={label}
      >
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin text-[hsl(var(--wb-text-muted)/0.72)]"
          size={24}
          strokeWidth={2}
        />
        <span className="text-[11px] leading-none text-[hsl(var(--wb-text-muted))]">
          {label}
        </span>
      </div>
    </div>
  );
}
