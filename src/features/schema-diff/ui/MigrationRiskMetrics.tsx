import { riskStyle } from "@/features/schema-diff/model/migrationPresentation";
import { cn } from "@/lib/utils";
import type { SchemaChangeRisk } from "@/services/tauri/types";
import { OctagonX } from "lucide-react";

export function RiskMetric({
  label,
  value,
  risk,
}: {
  label: string;
  value: number;
  risk: SchemaChangeRisk;
}) {
  const style = riskStyle[risk];
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 last:border-r-0">
      <div
        className={cn(
          "font-mono text-[15px] font-semibold leading-none",
          style.text,
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">
        {label}
      </div>
    </div>
  );
}

export function BlockedMetric({ value }: { value: number }) {
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 last:border-r-0">
      <div className="flex items-center gap-1 font-mono text-[15px] font-semibold leading-none text-red-300">
        <OctagonX size={11} /> {value}
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">
        Blocked
      </div>
    </div>
  );
}
