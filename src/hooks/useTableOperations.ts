import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { queryService } from "@/services/tauri";
import { useTabStore } from "@/store/useTabStore";

export function useTableOperations() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { currentSchema, loadTables } = useSchemaStore();
  const { createTab } = useTabStore();

  const getDriver = () => {
    const conn = connections.find((c) => c.id === activeConnectionId);
    return conn?.driver || "postgres";
  };

  const getQuote = () => {
    return getDriver() === "mysql" ? "`" : '"';
  };

  const truncateTable = async (tableName: string) => {
    if (!activeConnectionId || !currentSchema) return;
    const quote = getQuote();
    const sql = `TRUNCATE TABLE ${quote}${currentSchema}${quote}.${quote}${tableName}${quote};`;

    try {
      await queryService.executeQuery(activeConnectionId, sql);
      // toast.success(`Table ${tableName} truncated successfully`);
      console.log(`Table ${tableName} truncated successfully`);
    } catch (e: any) {
      console.error(e);
      // toast.error(`Failed to truncate table: ${e.message}`);
    }
  };

  const renameTable = async (oldName: string, newName: string) => {
    if (!activeConnectionId || !currentSchema) return;
    const quote = getQuote();
    const driver = getDriver();

    let sql = "";
    if (driver === "postgres") {
      sql = `ALTER TABLE ${quote}${currentSchema}${quote}.${quote}${oldName}${quote} RENAME TO ${quote}${newName}${quote};`;
    } else {
      // MySQL
      sql = `RENAME TABLE ${quote}${currentSchema}${quote}.${quote}${oldName}${quote} TO ${quote}${currentSchema}${quote}.${quote}${newName}${quote};`;
    }

    try {
      await queryService.executeQuery(activeConnectionId, sql);
      console.log(`Table renamed from ${oldName} to ${newName}`);
      // Refresh list
      await loadTables(activeConnectionId, currentSchema);
    } catch (e: any) {
      console.error(e);
      throw e; // Let dialog handle error
    }
  };

  const exportTableData = async (
    tableName: string,
    format: "csv" | "json" = "csv"
  ) => {
    if (!activeConnectionId || !currentSchema) return;
    const quote = getQuote();
    // Limit export to 10000 rows for safety for now
    const sql = `SELECT * FROM ${quote}${currentSchema}${quote}.${quote}${tableName}${quote} LIMIT 10000;`;

    try {
      const results = await queryService.executeQuery(activeConnectionId, sql);
      if (!results || results.length === 0 || !results[0]?.rows) {
        console.warn("No data to export");
        return;
      }

      const columns = results[0].columns?.map((c) => c.name) || [];
      const rows = results[0].rows || [];

      let content = "";
      let mimeType = "";

      if (format === "csv") {
        mimeType = "text/csv;charset=utf-8;";
        // Header
        content += columns.join(",") + "\n";
        // Rows
        rows.forEach((row) => {
          const processedRow = row.map((val) => {
            if (val === null) return "NULL";
            const str = String(val);
            // Escape quotes
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          });
          content += processedRow.join(",") + "\n";
        });
      } else {
        mimeType = "application/json;charset=utf-8;";
        const checkData = rows.map((row) => {
          const obj: any = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          return obj;
        });
        content = JSON.stringify(checkData, null, 2);
      }

      // Trigger Download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${tableName}_export.${format}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      console.error("Export failed:", e);
    }
  };

  const getTableDdl = async (tableName: string): Promise<string> => {
    if (!activeConnectionId || !currentSchema) return "";
    const driver = getDriver();
    const quote = getQuote();

    if (driver === "mysql") {
      try {
        const sql = `SHOW CREATE TABLE ${quote}${currentSchema}${quote}.${quote}${tableName}${quote};`;
        const res = await queryService.executeQuery(activeConnectionId, sql);
        // MySQL returns [Table, Create Table] usually
        if (res && res[0] && res[0].rows?.length > 0) {
          return res[0]!.rows![0]![1] || "-- DDL not found";
        }
      } catch (e) {
        console.error(e);
        return `-- Failed to fetch DDL: ${e}`;
      }
    } else {
      // Postgres - Simplified attempt
      // TODO: Use pg_dump or advanced query if needed
      return `-- Postgres DDL generation is not fully supported yet.\n-- You can view columns in the structure tab.`;
    }
    return "-- DDL not supported for this driver";
  };

  const editColumns = (tableName: string) => {
    // Just open a tab with ALTER TABLE template for now?
    // Or maybe there's a dedicated view?
    // For now, let's open a query tab with a helpful comment
    const quote = getQuote();
    const sql = `-- Edit columns for ${tableName}\nALTER TABLE ${quote}${currentSchema}${quote}.${quote}${tableName}${quote}\n  ADD COLUMN new_column VARCHAR(255);\n`;
    createTab("query", `Edit ${tableName}`, sql);
  };

  return {
    truncateTable,
    renameTable,
    exportTableData,
    getTableDdl,
    editColumns,
  };
}
