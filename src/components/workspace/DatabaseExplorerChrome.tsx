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
  ShieldCheck,
  SquareTerminal,
  Table2,
} from "lucide-react";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  dataSourceDriverChoices,
  filterDataSourceDriverChoices,
} from "@/features/database-drivers";
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
import { databaseService, type DatabaseDriver, type DatabaseDriverInstallation } from "@/services/tauri";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
  const [revealFeedback, setRevealFeedback] = useState(0);
  return (
    <header className="wb-tool-header gap-2">
      <span className="truncate">{t("databaseExplorer.title")}</span>
      <div className="wb-tool-header-actions flex items-center gap-0.5">
        <button
          type="button"
          className="wb-icon-button relative h-5 w-5 overflow-hidden"
          onClick={() => {
            setRevealFeedback((value) => value + 1);
            onRevealActive();
          }}
          title={t("databaseExplorer.revealActive")}
        >
          <LocateFixed
            key={`reveal-icon-${revealFeedback}`}
            size={12}
            className={cn(revealFeedback > 0 && "wb-locate-feedback-icon")}
          />
          {revealFeedback > 0 ? (
            <span
              key={`reveal-pulse-${revealFeedback}`}
              className="wb-locate-feedback-pulse pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full border border-[hsl(var(--wb-accent))]"
              aria-hidden="true"
            />
          ) : null}
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
  canManageAdministration?: boolean;
  onManageAdministration?: () => void;
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
  canManageAdministration = false,
  onManageAdministration,
}: DatabaseExplorerToolbarProps) {
  const driverProfiles = useDatabaseDriverCatalogStore(
    (state) => state.profiles,
  );
  const loadDatabaseDriverCatalog = useDatabaseDriverCatalogStore(
    (state) => state.load,
  );
  const [driverPackages, setDriverPackages] = useState<
    DatabaseDriverInstallation[]
  >([]);
  const [driverQuery, setDriverQuery] = useState("");
  const clearDriverQueryTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    void loadDatabaseDriverCatalog();
  }, [loadDatabaseDriverCatalog]);

  useEffect(() => {
    let active = true;
    void databaseService
      .listDatabaseDriverInstallations()
      .then((installations) => {
        if (active) setDriverPackages(installations);
      })
      .catch(() => {
        if (active) setDriverPackages([]);
      });
    return () => {
      active = false;
    };
  }, [driverProfiles]);

  useEffect(
    () => () => {
      if (clearDriverQueryTimeout.current) {
        clearTimeout(clearDriverQueryTimeout.current);
      }
    },
    [],
  );

  const driverChoices = useMemo(
    () => dataSourceDriverChoices(driverProfiles, driverPackages),
    [driverPackages, driverProfiles],
  );
  const visibleDriverChoices = useMemo(
    () => filterDataSourceDriverChoices(driverChoices, driverQuery),
    [driverChoices, driverQuery],
  );
  const updateDriverTypeahead = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key === "Escape") {
      if (driverQuery) event.preventDefault();
      setDriverQuery("");
      return;
    }
    if (key === "Enter" && visibleDriverChoices[0]) {
      event.preventDefault();
      onNewDataSource(visibleDriverChoices[0].driver);
      return;
    }
    if (key === "Backspace") {
      setDriverQuery((value) => value.slice(0, -1));
      return;
    }
    if (key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    setDriverQuery((value) => `${value}${key}`);
    if (clearDriverQueryTimeout.current) {
      clearTimeout(clearDriverQueryTimeout.current);
    }
    clearDriverQueryTimeout.current = setTimeout(() => setDriverQuery(""), 900);
  };

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
            <DropdownMenuSubTrigger
              className={menuItemClass}
              onKeyDownCapture={updateDriverTypeahead}
            >
              <Database
                size={13}
                className="mr-2 text-[hsl(var(--wb-accent))]"
              />
              Data Source
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className={cn(
                menuContentClass,
                "flex h-[min(412px,calc(100dvh-152px))] flex-col p-0",
              )}
              onKeyDownCapture={updateDriverTypeahead}
            >
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2 text-[10px] wb-muted">
                <Search size={11} />
                <span className="min-w-0 flex-1 truncate">
                  {driverQuery ? `Search: ${driverQuery}` : "Type to search databases"}
                </span>
                <span>{visibleDriverChoices.length}/{driverChoices.length}</span>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y py-1 custom-scrollbar"
                onWheel={(event) => event.stopPropagation()}
              >
                {visibleDriverChoices.map((choice) => (
                  <DropdownMenuItem
                    key={choice.driver}
                    className={menuItemClass}
                    onClick={() => onNewDataSource(choice.driver)}
                  >
                    <DatabaseBrandIcon
                      driver={choice.driver}
                      size={14}
                      className="mr-2 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                    {choice.availability !== "available" && (
                      <span className="ml-2 shrink-0 text-[9px] text-amber-400">
                        {choice.availability === "activationRequired"
                          ? "Activate"
                          : "Install"}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
                {visibleDriverChoices.length === 0 && (
                  <div className="px-2 py-4 text-center text-[11px] wb-muted">
                    No database products match “{driverQuery}”.
                  </div>
                )}
              </div>
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
        className="wb-icon-button wb-state-feedback"
        onClick={onRefresh}
        title="Synchronize"
        disabled={isLoading}
      >
        <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
      </button>
      <button
        type="button"
        className="wb-icon-button wb-state-feedback"
        onClick={onNewQueryConsole}
        title="New Query Console"
      >
        <SquareTerminal size={13} />
      </button>
      {canManageAdministration && onManageAdministration && (
        <button
          type="button"
          className="wb-icon-button wb-state-feedback"
          onClick={onManageAdministration}
          title="Database Administration"
        >
          <ShieldCheck size={13} />
        </button>
      )}
      <button
        type="button"
        className="wb-icon-button wb-state-feedback"
        onClick={onCreateTable}
        title="New Table"
        disabled={!canCreateTable}
      >
        <Table2 size={13} />
      </button>
      <button
        type="button"
        className="wb-icon-button wb-state-feedback"
        onClick={onToggleFilter}
        title="Filter Objects"
        data-active={isFilterVisible}
      >
        <Search size={13} />
      </button>
    </div>
  );
}
