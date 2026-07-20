import {
  ChevronDown,
  ChevronUp,
  Code2,
  Database,
  LocateFixed,
  Minus,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  SquareTerminal,
  Table2,
} from "lucide-react";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DatabaseDriver } from "@/services/tauri";
import { useEffect } from "react";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useI18n } from "@/i18n";

const menuContentClass =
  "min-w-[238px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]";
const menuItemClass =
  "h-7 cursor-default rounded-[3px] px-2 text-[12px] focus:bg-[hsl(var(--wb-active-strong))] focus:text-[hsl(var(--wb-text))]";

interface DatabaseExplorerHeaderProps {
  isLoading: boolean;
  onRevealActive: () => void;
  onExpandActive: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  onHide: () => void;
}

export function DatabaseExplorerHeader({
  isLoading,
  onRevealActive,
  onExpandActive,
  onCollapseAll,
  onRefresh,
  onHide,
}: DatabaseExplorerHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="wb-tool-header gap-2">
      <span className="truncate">{t("databaseExplorer.title")}</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="wb-icon-button h-5 w-5"
          onClick={onRevealActive}
          title={t("databaseExplorer.revealActive")}
        >
          <LocateFixed size={12} />
        </button>
        <button
          type="button"
          className="wb-icon-button h-5 w-5"
          onClick={onExpandActive}
          title={t("databaseExplorer.expandActive")}
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          className="wb-icon-button h-5 w-5"
          onClick={onCollapseAll}
          title={t("databaseExplorer.collapseAll")}
        >
          <ChevronUp size={13} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="wb-icon-button h-5 w-5"
              title={t("databaseExplorer.options")}
            >
              <MoreVertical size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={menuContentClass}>
            <DropdownMenuItem
              className={menuItemClass}
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                size={13}
                className={cn("mr-2", isLoading && "animate-spin")}
              />
              {t("databaseExplorer.synchronizeAll")}
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onClick={onCollapseAll}>
              <ChevronUp size={13} className="mr-2" />
              {t("databaseExplorer.collapseAll")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="wb-icon-button h-5 w-5"
          onClick={onHide}
          title={t("databaseExplorer.hide")}
        >
          <Minus size={13} />
        </button>
      </div>
    </header>
  );
}

interface DatabaseExplorerToolbarProps {
  isLoading: boolean;
  namespaceLabel: string;
  canCreateNamespace: boolean;
  canCreateTable: boolean;
  canCreateView: boolean;
  isFilterVisible: boolean;
  onNewQueryConsole: () => void;
  onNewDataSource: (driver: DatabaseDriver) => void;
  onCreateNamespace: () => void;
  onCreateTable: () => void;
  onCreateView: () => void;
  onRefresh: () => void;
  onToggleFilter: () => void;
}

export function DatabaseExplorerToolbar({
  isLoading,
  namespaceLabel,
  canCreateNamespace,
  canCreateTable,
  canCreateView,
  isFilterVisible,
  onNewQueryConsole,
  onNewDataSource,
  onCreateNamespace,
  onCreateTable,
  onCreateView,
  onRefresh,
  onToggleFilter,
}: DatabaseExplorerToolbarProps) {
  const driverProfiles = useDatabaseDriverCatalogStore(
    (state) => state.profiles,
  );
  const loadDatabaseDriverCatalog = useDatabaseDriverCatalogStore(
    (state) => state.load,
  );

  useEffect(() => {
    void loadDatabaseDriverCatalog();
  }, [loadDatabaseDriverCatalog]);

  return (
    <div className="wb-explorer-toolbar gap-0.5 border-0 bg-transparent px-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="wb-icon-button data-[state=open]:bg-[hsl(var(--wb-hover))] data-[state=open]:text-[hsl(var(--wb-text))]"
            title="New"
          >
            <Plus size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className={menuContentClass}
        >
          <DropdownMenuItem
            className={menuItemClass}
            onClick={onNewQueryConsole}
          >
            <SquareTerminal size={13} className="mr-2 text-sky-400" />
            Query Console
            <span className="ml-auto text-[10px] wb-muted">⌘T</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>
              <Database
                size={13}
                className="mr-2 text-[hsl(var(--wb-accent))]"
              />
              Data Source
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={menuContentClass}>
              {driverProfiles.map((profile) => (
                <DropdownMenuItem
                  key={profile.driver}
                  className={menuItemClass}
                  onClick={() => onNewDataSource(profile.driver)}
                >
                  <DatabaseBrandIcon
                    driver={profile.driver}
                    size={14}
                    className="mr-2 shrink-0"
                  />
                  {profile.menuLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {(canCreateNamespace || canCreateTable || canCreateView) && (
            <DropdownMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
          )}
          {canCreateNamespace && (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={onCreateNamespace}
            >
              <Database size={13} className="mr-2" />
              {namespaceLabel.charAt(0).toUpperCase() + namespaceLabel.slice(1)}
            </DropdownMenuItem>
          )}
          {canCreateTable && (
            <DropdownMenuItem className={menuItemClass} onClick={onCreateTable}>
              <Table2 size={13} className="mr-2" />
              Table
            </DropdownMenuItem>
          )}
          {canCreateView && (
            <DropdownMenuItem className={menuItemClass} onClick={onCreateView}>
              <Code2 size={13} className="mr-2" />
              View
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        className="wb-icon-button"
        onClick={onRefresh}
        title="Synchronize"
        disabled={isLoading}
      >
        <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
      </button>
      <button
        type="button"
        className="wb-icon-button"
        onClick={onNewQueryConsole}
        title="New Query Console"
      >
        <SquareTerminal size={13} />
      </button>
      <button
        type="button"
        className="wb-icon-button"
        onClick={onCreateTable}
        title="New Table"
        disabled={!canCreateTable}
      >
        <Table2 size={13} />
      </button>
      <button
        type="button"
        className="wb-icon-button"
        onClick={onToggleFilter}
        title="Filter Objects"
        data-active={isFilterVisible}
      >
        <Search size={13} />
      </button>
    </div>
  );
}
