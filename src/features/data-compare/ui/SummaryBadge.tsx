import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function SummaryBadge({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "warning" | "danger" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[3px] border px-1.5 text-[8px]",
        tone === "muted" && "border-[hsl(var(--wb-border-subtle))] wb-muted",
        tone === "warning" && "border-amber-400/20 text-amber-300",
        tone === "danger" && "border-rose-400/20 text-rose-300",
        tone === "success" && "border-emerald-400/20 text-emerald-300",
      )}
    >
      {value === 0 ? <Check size={8} /> : null}
      {label} {value.toLocaleString()}
    </span>
  );
}
