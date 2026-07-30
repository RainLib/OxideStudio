import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DatabaseDriverProfile } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import type { DatabaseDriver } from "@/services/tauri";
import type { ConnectionConfig } from "@/store/useConnectionStore";
import { Plus } from "lucide-react";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";

interface DataSourceListProps {
  dataSources: ConnectionConfig[];
  selectedConnectionId: string | null;
  driverProfiles: DatabaseDriverProfile[];
  onSelect: (connectionId: string) => void;
  onCreate: (driver: DatabaseDriver) => void;
}

const menuClass =
  "min-w-[220px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]";

export function DataSourceList({
  dataSources,
  selectedConnectionId,
  driverProfiles,
  onSelect,
  onCreate,
}: DataSourceListProps) {
  return (
    <aside className="flex w-[238px] shrink-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
      <div className="flex h-9 items-center justify-between px-3 text-[12px] font-semibold">
        <span>Data Sources</span>
        <span className="text-[10px] font-normal wb-muted">{dataSources.length}</span>
      </div>
      <div className="flex h-8 items-center border-y border-[hsl(var(--wb-border-subtle))] px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="wb-icon-button" title="New Data Source">
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={menuClass}>
            {driverProfiles.map((profile) => (
              <DropdownMenuItem
                key={profile.driver}
                className="h-7 cursor-default rounded-[3px] px-2 text-[12px] focus:bg-[hsl(var(--wb-active-strong))]"
                onClick={() => onCreate(profile.driver)}
              >
                <DatabaseBrandIcon
                  driver={profile.driver}
                  size={13}
                  className="mr-2 shrink-0"
                />
                {profile.menuLabel}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 custom-scrollbar">
        {dataSources.map((connection) => {
          const profile = driverProfiles.find(
            (item) => item.driver === connection.driver
          );
          const isSelected = connection.id === selectedConnectionId;

          return (
            <button
              type="button"
              key={connection.id}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px]",
                isSelected
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              )}
              onClick={() => onSelect(connection.id)}
            >
              <ConnectionGlyph
                driver={connection.driver}
                icon={connection.icon}
                size={13}
                className={cn(
                  "shrink-0",
                  !connection.color && profile?.iconClassName
                )}
                style={{ color: connection.color || undefined }}
              />
              <span className="min-w-0 flex-1 truncate">{connection.name}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
