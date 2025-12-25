import { cn } from "@/lib/utils";
import {
  Database,
  Table,
  Search,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { useEffect, useState } from "react";

export function SchemaSidebar() {
  const { activeConnectionId } = useConnectionStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    loadSchemas,
    loadTables,
    tables, // These are tables for the *currentSchema*
    setCurrentSchema,
    selectTable,
    selectedTable,
  } = useSchemaStore();

  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    if (activeConnectionId) {
      // Load schemas when connection is active
      loadSchemas(activeConnectionId);
    }
  }, [activeConnectionId, loadSchemas]);

  useEffect(() => {
    if (activeConnectionId && currentSchema) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [activeConnectionId, currentSchema, loadTables]);

  const { createTab, runTabQuery, updateTabSql } = useTabStore();

  const handleSchemaClick = (schema: string) => {
    if (currentSchema === schema) {
      // Toggle logic if needed
    } else {
      setCurrentSchema(schema);
    }
  };

  const handleTableClick = (tableName: string) => {
    selectTable(tableName);
    if (!currentSchema) return;

    // Open a dedicated table tab
    const tabId = createTab("table", tableName, "", {
      tableName,
      schemaName: currentSchema,
    });

    if (activeConnectionId) {
      // For table tabs, we'll need a way to fetch the initial data
      // For now, we'll use a SELECT query, but we could optimize this later
      const sql = `SELECT * FROM "${currentSchema}"."${tableName}" LIMIT 100;`;
      updateTabSql(tabId, sql);
      runTabQuery(tabId, activeConnectionId);
    }
  };

  const filteredSchemas = schemas.filter((s) =>
    s.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Filter Input */}
      <div className="p-2 border-b border-[#333] bg-[#222]">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            placeholder="Search databases..."
            className="w-full bg-[#161616] text-gray-300 text-[11px] h-7 pl-7 pr-2 rounded-sm border border-[#333] focus:border-[#f39c12] focus:outline-none transition-colors placeholder:text-gray-600"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      </div>

      {/* Tree View Content: Database List */}
      <div className="flex-1 overflow-auto bg-[#1e1e1e] py-1 custom-scrollbar">
        {isLoading && schemas.length === 0 ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Loading databases...
          </div>
        ) : (
          <div>
            {filteredSchemas.map((schema) => {
              const isActive = currentSchema === schema;

              return (
                <div key={schema}>
                  {/* Database Item */}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[12px] group transition-all select-none hover:bg-[#252525]",
                      isActive ? "text-gray-100" : "text-gray-400"
                    )}
                    onClick={() => handleSchemaClick(schema)}
                    title={schema}
                  >
                    <div className="text-gray-500">
                      {isActive ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </div>
                    <Database
                      size={13}
                      className={cn(
                        "shrink-0",
                        isActive ? "text-[#f39c12]" : "text-gray-500"
                      )}
                    />
                    <span className="truncate font-medium flex-1">
                      {schema}
                    </span>
                  </div>

                  {/* Tables List (if active) */}
                  {isActive && (
                    <div className="ml-5 border-l border-[#333] pl-1">
                      {isLoading && tables.length === 0 ? (
                        <div className="py-2 pl-4 text-[10px] text-gray-600 italic">
                          Loading tables...
                        </div>
                      ) : (
                        <div>
                          {tables.map((table) => (
                            <div
                              key={table.name}
                              className={cn(
                                "flex items-center gap-2 pl-2 pr-2 py-1 cursor-pointer text-[11px] group transition-all select-none rounded-r-sm",
                                selectedTable === table.name
                                  ? "bg-[#2d2d2d] text-[#f39c12]"
                                  : "text-gray-400 hover:text-gray-200 hover:bg-[#252525]"
                              )}
                              onClick={() => handleTableClick(table.name)}
                              title={table.name}
                            >
                              <Table
                                size={12}
                                className={cn(
                                  "shrink-0 opacity-70",
                                  selectedTable === table.name && "opacity-100"
                                )}
                              />
                              <span className="truncate">{table.name}</span>
                            </div>
                          ))}
                          {tables.length === 0 && (
                            <div className="py-2 pl-2 text-[10px] text-gray-600 italic">
                              No tables
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
