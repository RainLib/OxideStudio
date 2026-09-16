import { cn } from "@/lib/utils";
import { Code2 } from "lucide-react";

export function PreviewSwitch({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof Code2;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-5 items-center gap-1 rounded-[3px] px-2 text-[9px] transition-colors",
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "wb-muted hover:text-[hsl(var(--wb-text))]",
      )}
      onClick={onClick}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}
