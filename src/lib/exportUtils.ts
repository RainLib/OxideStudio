import { QueryResult } from "@/services/tauri";

export function exportToCsv(result: QueryResult, filename = "export.csv") {
  if (!result || !result.rows) return;

  const headers = result.columns.map((c) => c.name);
  const rows = result.rows.map((row) => {
    // Fix implicit any by typing row explicitly or using keyof check
    // Since columns.name matches keys in row, we can assert type or use any
    const rowData = row as Record<string, any>;
    return headers
      .map((header) => {
        const val = rowData[header];
        if (val === null) return "";
        const str = String(val);
        // Escape quotes and wrap in quotes if contains comma or quote
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToJson(result: QueryResult, filename = "export.json") {
  if (!result || !result.rows) return;

  // Convert to array of objects
  const data = result.rows.map((row) => row); // Rows are already objects { col: val }

  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
