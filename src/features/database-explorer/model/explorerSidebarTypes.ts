import { type TableBatchSelection } from "@/features/database-explorer/model/tableBatchSelection";
import type {
  DatabaseCapabilities,
  NacosConfigLocation,
  SchemaObjectInfo,
  TableDataTransferEndpoint,
  TableInfo,
} from "@/services/tauri/types";

export interface PostgresRemoteDatabaseState {
  connectionId: string | null;
  schemas: Record<string, string[]>;
  tables: Record<string, Record<string, TableInfo[]>>;
  objects: Record<string, Record<string, SchemaObjectInfo[]>>;
}

export interface ExplorerDataTransferRequest {
  source: TableDataTransferEndpoint;
  sourceCapabilities: DatabaseCapabilities;
  initialSourceScope: "table" | "schema" | "database";
  sourceSchemas: string[];
  initialSourceTables?: string[];
  initialTarget?: Omit<TableDataTransferEndpoint, "table">;
}

export interface ExplorerDataCompareRequest {
  source: TableDataTransferEndpoint;
  sourceTables: string[];
  sourceCapabilities: DatabaseCapabilities;
}

export interface ExplorerMongoCollectionTransferRequest {
  sourceConnectionId: string;
  sourceConnectionName: string;
  sourceDatabase: string;
  sourceCollection: string;
}

export interface ExplorerNacosConfigTransferRequest {
  sourceConnectionId: string;
  sourceConnectionName: string;
  source: NacosConfigLocation;
}

export interface ExplorerTableBatchSelection extends TableBatchSelection {
  scopeKey: string;
}
