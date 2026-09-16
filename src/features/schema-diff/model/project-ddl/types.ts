import type {
  DatabaseDriver,
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export type ProjectDdlSnapshotIdentity = {
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: DatabaseDriver;
  databaseName?: string | null;
  schemaName: string;
};

export type ProjectDdlParseResult = {
  dialect: ProjectDdlDialect;
  relations: SchemaRelationSnapshot[];
  schemaObjects: SchemaObjectSnapshot[];
  warnings: string[];
};

export type ProjectDdlDialect =
  | "generic"
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "sqlite"
  | "oracle";

export type ProjectDdlDialectDetection = {
  dialect: ProjectDdlDialect;
  confidence: "high" | "medium" | "low";
  evidence: string[];
};
