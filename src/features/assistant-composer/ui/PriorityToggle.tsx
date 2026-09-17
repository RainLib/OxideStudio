import { cn } from "@/lib/utils";
import { Zap } from "lucide-react";

export function PriorityToggle({
  enabled,
  disabled,
  label,
  description,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-assistant-fast-toggle="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100",
        enabled &&
          "bg-[hsl(var(--wb-brand)/0.16)] text-[hsl(var(--wb-brand))] shadow-[inset_0_0_0_1px_hsl(var(--wb-brand)/0.18)]",
      )}
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-pressed={enabled}
      title={description}
    >
      <Zap
        size={14}
        strokeWidth={1.8}
        fill={enabled ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}
