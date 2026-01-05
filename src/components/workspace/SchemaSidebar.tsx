import { cn } from "@/lib/utils";
import {
  Database,
  Table,
  Search,
  RefreshCw,
  Plus,
  Pin,
  PinOff,
  Eraser,
  Pencil,
  Download,
  TableProperties,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { CreateDatabaseDialog } from "./CreateDatabaseDialog";
import { RenameTableDialog } from "./RenameTableDialog";
import { DdlViewerDialog } from "./DdlViewerDialog";
import { useTableOperations } from "@/hooks/useTableOperations";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function SchemaSidebar() {
  const { activeConnectionId } = useConnectionStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    loadSchemas,
    loadTables,
    tables,
    pinnedTables,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
  } = useSchemaStore();

  const [filterText, setFilterText] = useState("");
  const [databaseFilter, setDatabaseFilter] = useState("");
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isCreateDbDialogOpen, setIsCreateDbDialogOpen] = useState(false);
  const [isTablesHovered, setIsTablesHovered] = useState(false);

  // Context Menu State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [ddlViewerOpen, setDdlViewerOpen] = useState(false);
  const [activeTable, setActiveTable] = useState("");
  const [ddlContent, setDdlContent] = useState("");

  const {
    truncateTable,
    renameTable,
    exportTableData,
    getTableDdl,
    editColumns,
  } = useTableOperations();

  const handleRenameClick = (table: string) => {
    setActiveTable(table);
    setRenameDialogOpen(true);
  };

  const handleDdlClick = async (table: string) => {
    setActiveTable(table);
    const ddl = await getTableDdl(table);
    setDdlContent(ddl);
    setDdlViewerOpen(true);
  };

  useEffect(() => {
    if (activeConnectionId) {
      loadSchemas(activeConnectionId);
    }
  }, [activeConnectionId, loadSchemas]);

  useEffect(() => {
    if (activeConnectionId && currentSchema) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [activeConnectionId, currentSchema, loadTables]);

  // Clear database filter when select closes
  useEffect(() => {
    if (!isSelectOpen) {
      setDatabaseFilter("");
      setFocusedIndex(0);
    }
  }, [isSelectOpen]);

  // Reset focus when filter changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [databaseFilter]);

  // Sort tables: pinned first, then alphabetical
  const sortedTables = [...tables].sort((a, b) => {
    const aPinned = pinnedTables.includes(a.name);
    const bPinned = pinnedTables.includes(b.name);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return a.name.localeCompare(b.name);
  });

  // Filter tables based on search text
  const filteredTables = sortedTables.filter((table) =>
    table.name.toLowerCase().includes(filterText.toLowerCase())
  );

  // Filter databases based on search text
  const filteredSchemas = schemas.filter((schema) =>
    schema.toLowerCase().includes(databaseFilter.toLowerCase())
  );

  // Handle keyboard input when select is open
  useEffect(() => {
    if (!isSelectOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle typing (alphanumeric and some special chars)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setDatabaseFilter((prev) => prev + e.key);
      }
      // Handle backspace
      else if (e.key === "Backspace") {
        e.preventDefault();
        setDatabaseFilter((prev) => prev.slice(0, -1));
      }
      // Handle Escape to clear filter or close
      else if (e.key === "Escape") {
        e.preventDefault();
        if (databaseFilter) {
          setDatabaseFilter("");
        } else {
          setIsSelectOpen(false);
        }
      }
      // Arrow key navigation
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          Math.min(prev + 1, filteredSchemas.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      }
      // Enter to select focused item
      else if (e.key === "Enter" && filteredSchemas.length > 0) {
        e.preventDefault();
        const selectedSchema = filteredSchemas[focusedIndex];
        if (selectedSchema) {
          setCurrentSchema(selectedSchema);
          setFilterText("");
          setIsSelectOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isSelectOpen,
    databaseFilter,
    focusedIndex,
    filteredSchemas,
    setCurrentSchema,
    setFilterText,
  ]);

  const { findOrCreateTableTab, runTabQuery, updateTabSql, createTableTab } =
    useTabStore();
  const { connections } = useConnectionStore();

  const handleTableSelect = (tableName: string) => {
    selectTable(tableName);
  };

  const handleTableDoubleClick = (tableName: string) => {
    if (!currentSchema || !activeConnectionId) return;

    // Use findOrCreateTableTab to reuse existing tabs
    const tabId = findOrCreateTableTab(
      activeConnectionId,
      currentSchema,
      tableName
    );

    // Get current connection to check driver
    const connection = connections.find((c) => c.id === activeConnectionId);
    const driver = connection?.driver || "postgres";

    // Use driver-aware quoting
    // We strictly rely on backend context switching now, so no schema prefix needed.
    const quote = driver === "mysql" ? "`" : '"';
    const sql = `SELECT * FROM ${quote}${tableName}${quote} LIMIT 100;`;

    updateTabSql(tabId, sql);
    runTabQuery(tabId, activeConnectionId);
  };

  // Highlight matching text
  const highlightMatch = (text: string, filter: string) => {
    if (!filter) return <span>{text}</span>;

    const index = text.toLowerCase().indexOf(filter.toLowerCase());
    if (index === -1) return <span>{text}</span>;

    const before = text.slice(0, index);
    const match = text.slice(index, index + filter.length);
    const after = text.slice(index + filter.length);

    return (
      <span>
        {before}
        <span className="bg-primary text-primary-foreground font-bold">
          {match}
        </span>
        {after}
      </span>
    );
  };

  const handleCreateTable = () => {
    if (activeConnectionId && currentSchema) {
      createTableTab(activeConnectionId, currentSchema);
    }
  };

  const handleCreateDatabase = () => {
    setIsCreateDbDialogOpen(true);
  };

  const handleRefresh = async () => {
    if (activeConnectionId) {
      // Force refresh schemas
      await loadSchemas(activeConnectionId, true);
      // If currentSchema is selected, force refresh tables too
      if (currentSchema) {
        await loadTables(activeConnectionId, currentSchema);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-tertiary">
      {/* Top: Database Selector Group */}
      <div className="p-2 border-b border-border bg-background-secondary/50 shrink-0">
        <div className="flex items-center gap-2">
          <Select
            value={currentSchema || ""}
            onValueChange={(value: string) => {
              setCurrentSchema(value);
              setFilterText(""); // Clear table filter when switching database
              setIsSelectOpen(false);
            }}
            open={isSelectOpen}
            onOpenChange={setIsSelectOpen}
          >
            <SelectTrigger className="w-full h-7 text-[11px] bg-background-tertiary border-border focus:border-primary text-foreground flex-1">
              <SelectValue placeholder="Select database..." />
            </SelectTrigger>
            <SelectContent className="bg-background-elevated border-border text-foreground">
              {/* Filter indicator at top-right (no input box) */}
              {databaseFilter && (
                <div className="sticky top-0 z-10 bg-background-elevated px-2 py-1.5 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground italic">
                    Type to filter...
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-background-tertiary text-primary font-mono border border-border">
                      {databaseFilter}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                      {filteredSchemas.length}/{schemas.length}
                    </span>
                  </div>
                </div>
              )}

              {/* Database list */}
              <div className="max-h-[300px] overflow-auto">
                {isLoading && schemas.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                    Loading...
                  </div>
                ) : filteredSchemas.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                    {databaseFilter ? (
                      <>
                        No match for{" "}
                        <span className="text-primary font-mono">
                          "{databaseFilter}"
                        </span>
                        <div className="text-[9px] mt-1 opacity-60">
                          Press Esc to clear
                        </div>
                      </>
                    ) : (
                      "No databases found"
                    )}
                  </div>
                ) : (
                  filteredSchemas.map((schema, index) => (
                    <SelectItem
                      key={schema}
                      value={schema}
                      className={cn(
                        "text-[11px] focus:bg-background-tertiary focus:text-foreground",
                        index === focusedIndex &&
                          "bg-background-tertiary text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Database size={12} className="text-gray-500" />
                        {highlightMatch(schema, databaseFilter)}
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background-tertiary rounded-sm"
            onClick={handleRefresh}
            title="Refresh Schemas"
            disabled={isLoading}
          >
            <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background-tertiary rounded-sm"
            onClick={handleCreateDatabase}
            title="Create New Database"
          >
            <Plus size={12} />
          </Button>
        </div>
      </div>

      {/* Middle: Filter Input for Tables */}
      <div className="p-2 border-b border-border bg-background-secondary/30 shrink-0">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Filter tables..."
            className="w-full bg-background-tertiary text-foreground text-[11px] h-7 pl-7 pr-2 rounded-sm border border-border focus:border-primary focus:outline-none transition-colors placeholder:text-muted-foreground/50"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            disabled={!currentSchema}
          />
        </div>
      </div>

      {/* Tables Section Header - Contextual */}
      <div
        className="flex items-center justify-between px-2 py-1.5 bg-background-tertiary shrink-0"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
            Tables
          </span>
          {currentSchema && (
            <span className="text-[9px] bg-background-secondary px-1.5 py-0.5 rounded text-muted-foreground border border-border">
              {filteredTables.length}
            </span>
          )}
        </div>

        {/* Action buttons - only show on hover of tables area */}
        {isTablesHovered && currentSchema && (
          <div
            className={cn(
              "flex items-center gap-1 transition-opacity duration-200",
              isTablesHovered ? "opacity-100" : "opacity-0"
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
              onClick={handleRefresh}
              title="Refresh Tables"
              disabled={isLoading}
            >
              <RefreshCw
                size={10}
                className={cn(isLoading && "animate-spin")}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
              onClick={handleCreateTable}
              title="Create New Table"
              disabled={!currentSchema}
            >
              <Plus size={10} />
            </Button>
          </div>
        )}
      </div>

      {/* Bottom: Tables List */}
      <div
        className="flex-1 overflow-auto bg-background-tertiary py-0 custom-scrollbar"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
        {!currentSchema ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Select a database to view tables
          </div>
        ) : isLoading && tables.length === 0 ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Loading tables...
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            {filterText ? `No tables match "${filterText}"` : "No tables found"}
          </div>
        ) : (
          <div className="px-1">
            {filteredTables.map((table) => {
              const isPinned = pinnedTables.includes(table.name);
              return (
                <ContextMenu
                  key={table.name}
                  onOpenChange={(open) => {
                    if (open) handleTableSelect(table.name);
                  }}
                >
                  <ContextMenuTrigger>
                    <div
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[11px] group transition-all select-none rounded-sm relative",
                        selectedTable === table.name
                          ? "bg-background-secondary text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-background-secondary/50"
                      )}
                      onClick={() => handleTableSelect(table.name)}
                      onDoubleClick={() => handleTableDoubleClick(table.name)}
                      title={table.name}
                    >
                      <Table
                        size={12}
                        className={cn(
                          "shrink-0 opacity-70",
                          selectedTable === table.name && "opacity-100",
                          isPinned && "text-primary opacity-100"
                        )}
                      />
                      <span
                        className={cn(
                          "truncate flex-1",
                          isPinned && "font-bold text-foreground"
                        )}
                      >
                        {table.name}
                      </span>

                      {/* Pin/Unpin Button - Visible on Hover */}
                      <div className="flex items-center gap-1">
                        {table.type && !isPinned && (
                          <span className="text-[9px] uppercase opacity-50 shrink-0 group-hover:hidden">
                            {table.type}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-4 w-4 shrink-0 transition-all duration-200",
                            isPinned
                              ? "text-primary opacity-100"
                              : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinTable(table.name);
                          }}
                          title={isPinned ? "Unpin Table" : "Pin Table"}
                        >
                          {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
                        </Button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => truncateTable(table.name)}>
                      <Eraser className="mr-2 h-3.5 w-3.5" />
                      Empty Table
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleRenameClick(table.name)}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Rename Table
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => exportTableData(table.name)}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export Data
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => editColumns(table.name)}>
                      <TableProperties className="mr-2 h-3.5 w-3.5" />
                      Edit Columns
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleDdlClick(table.name)}>
                      <Code2 className="mr-2 h-3.5 w-3.5" />
                      View DSL
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </div>

      <CreateDatabaseDialog
        isOpen={isCreateDbDialogOpen}
        onClose={() => setIsCreateDbDialogOpen(false)}
        activeConnectionId={activeConnectionId || ""}
      />
      <RenameTableDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        tableName={activeTable}
        onRename={renameTable}
      />
      <DdlViewerDialog
        isOpen={ddlViewerOpen}
        onClose={() => setDdlViewerOpen(false)}
        tableName={activeTable}
        ddl={ddlContent}
      />
    </div>
  );
}
