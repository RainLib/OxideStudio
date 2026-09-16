import { type ExplorerActivationMode } from "@/features/database-explorer/model/explorerActivation";
import type {
  DatabaseDriver,
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types";
import { type ReactNode } from "react";

export type SchemaLoadStatus = "idle" | "loading" | "success" | "error";

export interface SchemaLoadState {
  status: SchemaLoadStatus;
  tables: TableInfo[];
  objects: SchemaObjectInfo[];
  objectError: string | null;
  error: string | null;
}

export interface ObjectMemberLoadState {
  status: "loading" | "success" | "error";
  members: SchemaObjectInfo[];
}

export interface PostgresRemoteDatabaseContentsProps {
  explorerScopeId?: string;
  connectionId: string;
  driver?: DatabaseDriver;
  database: string;
  schemas: string[];
  refreshRequest?: { version: number; schema?: string };
  filterText?: string;
  matchesFilter?: (...values: Array<unknown>) => boolean;
  activationMode: ExplorerActivationMode;
  onTablesLoaded?: (schema: string, tables: TableInfo[]) => void;
  onOpenSchemaSnapshots?: (database: string, schema: string) => void;
  onOpenSchemaObjects?: (database: string, schema: string) => void;
  /** Query-console actions supplied by the Explorer host for this namespace. */
  renderQueryContextMenu?: (database: string, schema: string) => ReactNode;
  onOpenSchemaDataTransfer?: (database: string, schema: string) => void;
  onOpenSchemaDataCompare?: (database: string, schema: string) => void;
  onOpenTableSchemaSnapshots?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableDataTransfer?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableDataCompare?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableMaintenance?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onImportSqlScript?: (database: string, schema: string) => void;
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  onOpenTable: (
    database: string,
    schema: string,
    table: TableInfo,
  ) => void | Promise<void>;
}
