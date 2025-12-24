import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";

interface RowData {
  [key: string]: string | number;
}

interface DataGridProps {
  data: RowData[];
  columns: { id: string; title: string; width?: number }[];
}

export function DataGrid({ data, columns }: DataGridProps) {
  // 转换列格式
  const gridColumns: GridColumn[] = columns.map((col) => ({
    title: col.title,
    id: col.id,
    width: col.width ?? 150,
  }));

  // 提供单元格内容
  const getCellContent = (cell: Item): GridCell => {
    const [col, row] = cell;
    const rowData = data[row];
    const columnId = columns[col]?.id;

    if (!rowData || !columnId) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        allowOverlay: false,
      };
    }

    const value = rowData[columnId];

    return {
      kind: GridCellKind.Text,
      data: String(value ?? ""),
      displayData: String(value ?? ""),
      allowOverlay: true,
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
