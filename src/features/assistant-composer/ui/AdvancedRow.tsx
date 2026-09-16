import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export function AdvancedRow({
  label,
  value,
  active,
  menu,
  ariaLabel,
  onOpen,
}: {
  label: string;
  value: string;
  active: boolean;
  menu: "model" | "effort" | "speed";
  ariaLabel?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-assistant-menu-trigger={menu}
      className={cn(
        "flex h-8 w-full items-center rounded-[7px] px-2 text-[10px] outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
        active && "bg-[hsl(var(--wb-active))]",
      )}
      onClick={onOpen}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onOpen();
      }}
      onFocus={onOpen}
      aria-label={ariaLabel}
      aria-expanded={active}
    >
      <span className="shrink-0 font-medium">{label}</span>
      <span className="ml-auto max-w-[126px] truncate text-[hsl(var(--wb-text-muted))]">
        {value}
      </span>
      <ChevronRight size={12} className="ml-1 shrink-0" aria-hidden="true" />
    </button>
  );
}
