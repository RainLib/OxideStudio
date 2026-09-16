import {
  type SettingsSection,
  type SettingsTreeGroup,
} from "@/features/settings/model/settingsNavigation";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

export function SettingsTreeItem({
  item,
  activeSection,
  expanded,
  onToggle,
  onSelect,
}: {
  item: SettingsTreeGroup;
  activeSection: SettingsSection;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
  const Icon = item.icon;
  return (
    <div>
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1 rounded-[3px] px-1.5 text-left text-[12px] font-semibold text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown
            size={13}
            className="shrink-0 text-[hsl(var(--wb-text-muted))]"
          />
        ) : (
          <ChevronRight
            size={13}
            className="shrink-0 text-[hsl(var(--wb-text-muted))]"
          />
        )}
        <Icon size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
        <span className="truncate">{item.label}</span>
      </button>

      {expanded && (
        <div>
          {item.children.map((child) => (
            <button
              key={child.id}
              type="button"
              className={cn(
                "flex h-6 w-full items-center rounded-[3px] pl-12 pr-2 text-left text-[12px]",
                child.section === activeSection
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]",
              )}
              onClick={() => onSelect(child.section)}
            >
              <span className="truncate">{child.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
