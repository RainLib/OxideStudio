import { useCallback, useMemo } from "react";
import { DataEditor, GridCell, GridColumn, Item, GridCellKind, Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useTabStore } from "@/store/useTabStore";
import { Button } from "@/components/ui/button";
import { Download, FileJson } from "lucide-react";
import { exportToCsv, exportToJson } from "@/lib/exportUtils";

export function DataGrid() {
    const { tabs, activeTabId } = useTabStore();
    const activeTab = tabs.find(t => t.id === activeTabId);

    // For now, handle single result set.
    const result = activeTab?.results?.[0];
    const error = activeTab?.error;

    // ... columns and getCellContent same as before
    const columns = useMemo<GridColumn[]>(() => {
        if (!result) return [];
        return result.columns.map(col => ({
            title: col.name,
            id: col.name,
            width: 150
        }));
    }, [result]);

    const getCellContent = useCallback((cell: Item): GridCell => {
        if (!result) return { kind: GridCellKind.Text, displayData: "", data: "" };
        const [col, row] = cell;
        const rowData = result.rows[row];
        const val = rowData[col];

        // Basic type handling
        const display = val === null ? "NULL" : String(val);

        return {
            kind: GridCellKind.Text,
            allowOverlay: true,
            displayData: display,
            data: display,
        };
    }, [result]);

    if (!activeTab) {
        return <div className="h-full flex items-center justify-center text-muted-foreground">No active tab</div>
    }

    if (error) {
        return <div className="h-full p-4 text-red-500 overflow-auto whitespace-pre-wrap font-mono text-sm">{error}</div>
    }

    // Wrap in a flex col to add toolbar
    return (
      <div className="flex flex-col h-full">
         {/* Toolbar */}
         <div className="h-9 border-b flex items-center px-2 bg-muted/10 gap-2">
            <div className="text-xs text-muted-foreground mr-auto">
                {result ? `${result.rows.length} rows` : "No results"}
            </div>
            {result && (
                <>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => exportToCsv(result)}>
                        <Download size={12} /> CSV
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => exportToJson(result)}>
                        <FileJson size={12} /> JSON
                    </Button>
                </>
            )}
         </div>

         {/* Grid Area */}
         <div className="flex-1 min-h-0 relative">
            {!result ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">Run a query to see results</div>
            ) : result.rows.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">No rows returned</div>
            ) : (
                <DataEditor
                    getCellContent={getCellContent}
                    columns={columns}
                    rows={result.rows.length}
                    smoothScrollX
                    smoothScrollY
                    width="100%"
                    height="100%"
                    theme={{
                        bgCell: "var(--background)",
                        bgHeader: "var(--muted)",
                        textHeader: "var(--foreground)",
                        textDark: "var(--foreground)",
                        borderColor: "var(--border)",
                    } as Partial<Theme>}
                />
            )}
         </div>
      </div>
    );
}
