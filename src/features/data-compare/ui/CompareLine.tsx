import { type FlatCompareLine } from "@/features/data-compare/model/compareRows";
import { isSyncStatus } from "@/features/data-compare/model/syncSelection";
import { type DataCompareRowStatus } from "@/lib/dataCompare";
import { cn } from "@/lib/utils";
import { Equal } from "lucide-react";

export function CompareLine({
  row,
  showSyncSelection,
  selected,
  onToggleSync,
}: {
  row: FlatCompareLine;
  showSyncSelection: boolean;
  selected: boolean;
  onToggleSync: (rowId: string) => void;
}) {
  return (
    <tr className="hover:bg-[hsl(var(--wb-hover)/0.72)]">
      {showSyncSelection && (
        <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 text-center align-top">
          {row.firstForLogicalRow && isSyncStatus(row.status) ? (
            <input
              type="checkbox"
              aria-label={`Include ${row.status} row ${row.key} in synchronization`}
              checked={selected}
              onChange={() => onToggleSync(row.logicalRowId)}
            />
          ) : null}
        </td>
      )}
      <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top">
        <StatusLabel status={row.status} />
      </td>
      <td className="break-all border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono text-[8px]">
        {row.key}
      </td>
      <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono">
        {row.column}
      </td>
      <td
        className={cn(
          "break-all border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono",
          row.status === "changed" && "bg-rose-400/[0.055]",
        )}
      >
        {row.left}
      </td>
      <td
        className={cn(
          "break-all border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono",
          row.status === "changed" && "bg-emerald-400/[0.055]",
        )}
      >
        {row.right}
      </td>
    </tr>
  );
}

export function StatusLabel({ status }: { status: DataCompareRowStatus }) {
  const labels: Record<DataCompareRowStatus, string> = {
    changed: "Changed",
    leftOnly: "Left only",
    rightOnly: "Right only",
    duplicate: "Duplicate",
    equal: "Equal",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        status === "changed" && "text-amber-300",
        status === "leftOnly" && "text-rose-300",
        status === "rightOnly" && "text-emerald-300",
        status === "duplicate" && "text-orange-300",
        status === "equal" && "wb-muted",
      )}
    >
      {status === "equal" ? <Equal size={9} /> : <span aria-hidden>●</span>}
      {labels[status]}
    </span>
  );
}
