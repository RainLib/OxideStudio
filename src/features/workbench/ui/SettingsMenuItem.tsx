import { type LucideIcon } from "lucide-react";

export function SettingsMenuItem({
  icon: Icon,
  label,
  shortcut,
  badge,
  active,
  iconSpinning,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  shortcut?: string;
  badge?: string;
  active?: boolean;
  iconSpinning?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left transition-colors ${
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
      }`}
      onClick={onClick}
    >
      <span className="flex w-4 shrink-0 justify-center text-[hsl(var(--wb-text-muted))]">
        {Icon ? (
          <Icon size={14} className={iconSpinning ? "animate-spin" : ""} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-accent)/0.16)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--wb-accent))]">
          {badge}
        </span>
      )}
      {shortcut && (
        <span className="shrink-0 text-[12px] text-[hsl(var(--wb-text-muted))]">
          {shortcut}
        </span>
      )}
    </button>
  );
}
