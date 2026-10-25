import {
  CONNECTION_ICON_OPTIONS,
  ConnectionGlyph,
} from "@/components/icons/ConnectionGlyph";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CONNECTION_COLORS } from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import { type ConnectionConfig } from "@/store/useConnectionStore";
import { Palette } from "lucide-react";

export function ConnectionAppearancePicker({
  connection,
  defaultIcon,
  onUpdate,
}: {
  connection: ConnectionConfig;
  defaultIcon: string;
  onUpdate: (
    field: keyof ConnectionConfig,
    value: ConnectionConfig[keyof ConnectionConfig],
    invalidateUrl?: boolean,
  ) => void;
}) {
  const usesDatabaseIcon = !connection.icon || connection.icon === defaultIcon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 border border-transparent px-2 hover:border-[hsl(var(--wb-border-subtle))]"
          aria-label="Customize connection appearance"
          title="Connection color and icon"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-[3px]"
            style={{
              color: connection.color || undefined,
              backgroundColor: connection.color
                ? `${connection.color}18`
                : undefined,
            }}
          >
            <ConnectionGlyph
              driver={connection.driver}
              icon={connection.icon}
              size={12}
              style={{ color: connection.color || undefined }}
            />
          </span>
          <span>Appearance</span>
          <Palette size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={5}
        className="w-[316px] p-0"
      >
        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2">
          <div className="text-[11px] font-semibold">Connection appearance</div>
          <div className="mt-0.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
            The database icon is used until you choose a custom one.
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div>
            <div className="mb-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]">
              Icon
            </div>
            <div
              className="flex min-h-7 flex-wrap items-center gap-1"
              role="radiogroup"
              aria-label="Connection icon"
            >
              <button
                type="button"
                role="radio"
                aria-checked={usesDatabaseIcon}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                  usesDatabaseIcon &&
                    "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
                )}
                onClick={() => onUpdate("icon", undefined)}
                title="Database default"
              >
                <DatabaseBrandIcon driver={connection.driver} size={14} />
              </button>
              {CONNECTION_ICON_OPTIONS.map((icon) => {
                const isSelected =
                  !usesDatabaseIcon && connection.icon === icon;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    key={icon}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                      isSelected &&
                        "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
                    )}
                    onClick={() => onUpdate("icon", icon)}
                    title={icon}
                  >
                    <ConnectionGlyph
                      driver={connection.driver}
                      icon={icon}
                      size={14}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]">
              Color
            </div>
            <div
              className="flex h-7 items-center gap-2"
              role="radiogroup"
              aria-label="Connection background color"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!connection.color}
                className={cn(
                  "relative h-4 w-4 rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))]",
                  !connection.color &&
                    "ring-2 ring-[hsl(var(--wb-accent))] ring-offset-2 ring-offset-[hsl(var(--wb-panel-raised))]",
                )}
                onClick={() => onUpdate("color", undefined)}
                aria-label="No connection background color"
                title="No background color"
              >
                <span className="absolute left-[2px] top-[7px] h-px w-[10px] -rotate-45 bg-[hsl(var(--wb-text-muted))]" />
              </button>
              {CONNECTION_COLORS.map((color) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={connection.color === color}
                  key={color}
                  className={cn(
                    "h-4 w-4 rounded-full border border-white/10",
                    connection.color === color &&
                      "ring-2 ring-[hsl(var(--wb-accent))] ring-offset-2 ring-offset-[hsl(var(--wb-panel-raised))]",
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => onUpdate("color", color)}
                  aria-label={`Connection color ${color}`}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
