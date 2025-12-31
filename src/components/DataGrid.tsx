import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { ColumnDef } from "@/services/tauri";

interface DataGridProps {
  data: any[][];
  columns: ColumnDef[];
}

export function DataGrid({ data, columns }: DataGridProps) {
  if (!columns || !data) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        No data to display
      </div>
    );
  }

  // Convert columns
  const gridColumns: GridColumn[] = columns.map((col) => ({
    title: col.name,
    id: col.name,
    width: 150,
  }));

  // Provide cell content
  const getCellContent = (cell: Item): GridCell => {
    const [col, row] = cell;
    const rowData = data[row];

    if (!rowData) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: false,
      };
    }

    const value = rowData[col];

    return {
      kind: GridCellKind.Text,
      data: value === null || value === undefined ? "NULL" : String(value),
      displayData:
        value === null || value === undefined ? "NULL" : String(value),
      allowOverlay: true,
      themeOverride: value === null ? { textDark: "#888" } : undefined, // Dim explicit NULLs
    };
  };

  return (
    <div className="w-full h-full">
      <DataEditor
        columns={gridColumns}
        rows={data.length}
        getCellContent={getCellContent}
        smoothScrollX={true}
        smoothScrollY={true}
        rowMarkers="both"
        theme={{
          bgCell: "hsl(var(--background))",
          bgCellMedium: "hsl(var(--muted))",
          bgHeader: "hsl(var(--secondary))",
          bgHeaderHasFocus: "hsl(var(--secondary))",
          bgHeaderHovered: "hsl(var(--accent))",
          textDark: "hsl(var(--foreground))",
          textHeader: "hsl(var(--foreground))",
          borderColor: "hsl(var(--border))",
          accentColor: "hsl(var(--primary))",
        }}
      />
    </div>
  );
}
