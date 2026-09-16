import type { TabData } from "@/features/workspace-tabs/model/types";
import { tableService } from "@/services/tauri";
import type {
  TableJsonImportPreview,
  TableXlsxImportPreview,
} from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";
import { isTauri } from "@tauri-apps/api/core";

interface TableImportPickersOptions {
  importInputRef: React.RefObject<HTMLInputElement | null>;
  setCsvImportSource: React.Dispatch<
    React.SetStateAction<{
      file: File;
      nativePath?: string | undefined;
      previewTruncated?: boolean | undefined;
      contentDigest?: string | undefined;
    } | null>
  >;
  activeTab: TabData | undefined;
  setJsonImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: TableJsonImportPreview;
    } | null>
  >;
  setXlsxImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: TableXlsxImportPreview;
    } | null>
  >;
}

export function createTableImportPickers({
  importInputRef,
  setCsvImportSource,
  activeTab,
  setJsonImportSource,
  setXlsxImportSource,
}: TableImportPickersOptions) {
  const openCsvImportPicker = async () => {
    if (!isTauri()) {
      importInputRef.current?.click();
      return;
    }

    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Delimited text", extensions: ["csv", "tsv", "txt"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const preview = await tableService.previewTableCsvImport(selected);
      const bytes = new Uint8Array(preview.bytes);
      const file = new File([bytes], preview.fileName, { type: "text/plain" });
      setCsvImportSource({
        file,
        nativePath: selected,
        previewTruncated: preview.truncated,
        contentDigest: preview.contentDigest,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id
            ? { ...tab, error: `Delimited text preview failed: ${message}` }
            : tab,
        ),
      }));
    }
  };

  const openJsonImportPicker = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON data", extensions: ["json", "jsonl", "ndjson"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const preview = await tableService.previewTableJsonImport(selected);
      setJsonImportSource({ nativePath: selected, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id
            ? { ...tab, error: `JSON preview failed: ${message}` }
            : tab,
        ),
      }));
    }
  };

  const openXlsxImportPicker = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const preview = await tableService.previewTableXlsxImport(selected);
      setXlsxImportSource({ nativePath: selected, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab?.id
            ? { ...tab, error: `XLSX preview failed: ${message}` }
            : tab,
        ),
      }));
    }
  };

  return { openCsvImportPicker, openJsonImportPicker, openXlsxImportPicker };
}
