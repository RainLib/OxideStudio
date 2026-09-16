import type {
  DatabaseCapabilities,
  TableDataTransferEndpoint,
} from "@/services/tauri/types";
import type { ConnectionConfig } from "@/store/useConnectionStore";

export interface TableDataTransferDialogProps {
  open: boolean;
  projectId?: string | null;
  source: TableDataTransferEndpoint;
  initialSourceScope?: "table" | "schema" | "database";
  initialSourceTables?: string[];
  initialTarget?: Omit<TableDataTransferEndpoint, "table">;
  sourceSchemas?: string[];
  sourceCapabilities?: DatabaseCapabilities | null;
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferred: () => void;
}
