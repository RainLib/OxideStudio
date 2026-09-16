import { type DataCompareSource } from "@/lib/dataCompare";

export function SourceIdentity({
  side,
  source,
}: {
  side: string;
  source: DataCompareSource;
}) {
  return (
    <div className="min-w-0 max-w-[34%] flex-1">
      <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.11em] wb-muted">
        {side} ·{" "}
        {source.sourceKind === "table"
          ? `page ${source.page || 1} · `
          : `result ${source.resultIndex + 1} · `}
        {source.rows.length.toLocaleString()} rows
        {source.truncated && <span className="text-amber-300">truncated</span>}
      </div>
      <div
        className="mt-0.5 truncate text-[10px] font-semibold"
        title={source.label}
      >
        {source.label}
      </div>
    </div>
  );
}
