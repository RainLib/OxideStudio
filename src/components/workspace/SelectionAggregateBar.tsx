import type { SelectionAggregate } from "@/lib/selectionAggregate";

interface SelectionAggregateBarProps {
  aggregate: SelectionAggregate;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span
      className="inline-flex min-w-0 items-baseline gap-1 border-l border-[hsl(var(--wb-border-subtle))] pl-2 first:border-l-0 first:pl-0"
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]">
        {label}
      </span>
      <span className="max-w-32 truncate font-mono text-[10px] tabular-nums text-[hsl(var(--wb-text))]">
        {value}
      </span>
    </span>
  );
}

export function SelectionAggregateBar({
  aggregate,
}: SelectionAggregateBarProps) {
  if (aggregate.selectedCellCount <= 1) return null;

  return (
    <div
      className="absolute bottom-2 right-2 z-30 flex max-w-[min(760px,calc(100%-16px))] items-center gap-2 overflow-x-auto rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.96)] px-2.5 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm"
      aria-label="Selection aggregate"
    >
      <Metric
        label={aggregate.truncated ? "Cells ≥" : "Cells"}
        value={aggregate.selectedCellCount.toLocaleString()}
      />
      <Metric label="Distinct" value={aggregate.distinctCount.toLocaleString()} />
      {aggregate.nullCount > 0 && (
        <Metric label="NULL" value={aggregate.nullCount.toLocaleString()} />
      )}
      {aggregate.unavailableCount > 0 && (
        <Metric
          label="Default"
          value={aggregate.unavailableCount.toLocaleString()}
        />
      )}
      {aggregate.numericCount > 0 && (
        <>
          <Metric label="Sum" value={aggregate.sum || "0"} />
          <Metric label="Avg" value={aggregate.average || "0"} />
          <Metric label="Min" value={aggregate.minimum || "0"} />
          <Metric label="Max" value={aggregate.maximum || "0"} />
        </>
      )}
    </div>
  );
}
