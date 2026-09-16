import { CollectionInfo, FunctionInfo, TableInfo } from "@/services/tauri";

export interface SchemaState {
  schemas: string[];
  tables: TableInfo[];
  collections: CollectionInfo[];
  collectionNextCursor: string | null;
  collectionTotal: number | null;
  collectionLoadingKey: string | null;
  collectionFilter: string;
  functions: FunctionInfo[];
  pinnedTables: string[];
  currentSchema: string | null;
  defaultSchema: string | null; // User's preferred default
  selectedTable: string | null;
  lastLoadedConnectionId: string | null; // Guard for duplicate calls
  lastLoadedObjectKey: string | null;
  isLoading: boolean;
  isCollectionsLoading: boolean;
  isFunctionsLoading: boolean;
  metadataVersion: number;
  connectionSnapshots: Record<string, ConnectionMetadataSnapshot>;
  objectSnapshots: Record<string, SchemaObjectSnapshot>;
  metadataNodeStates: Record<string, MetadataNodeState>;

  loadSchemas: (connectionId: string, force?: boolean) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean,
  ) => Promise<void>;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean,
    filter?: string,
    revalidateCached?: boolean,
  ) => Promise<void>;
  loadMoreCollections: (
    connectionId: string,
    namespace: string,
  ) => Promise<void>;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean,
  ) => Promise<void>;
  bumpMetadataVersion: () => void;
  togglePinTable: (tableName: string) => void;
  setCurrentSchema: (schema: string) => Promise<void>;
  setDefaultSchema: (schema: string) => Promise<void>; // Persist user's choice
  selectTable: (table: string | null) => void;
  snapshotActiveMetadata: () => void;
  restoreConnectionSnapshot: (connectionId: string) => boolean;
  hydrateConnectionMetadataFromCache: (
    connectionId: string,
  ) => Promise<boolean>;
  hydrateSchemaObjectsFromCache: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  loadSchemaObjectsForSearch: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  forgetConnectionMetadata: (connectionId: string) => Promise<void>;
  forgetSchemaMetadata: (connectionId: string, schema: string) => Promise<void>;
  setMetadataNodeState: (
    key: string,
    state: Partial<MetadataNodeState> & Pick<MetadataNodeState, "status">,
  ) => void;
  markMetadataNodeStale: (key: string, message?: string) => void;
  clearMetadataNodeState: (key: string) => void;
  clearActiveMetadata: () => void;
  reset: () => void;
}

export type MetadataNodeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "stale"
  | "error";

export interface MetadataNodeState {
  status: MetadataNodeStatus;
  message?: string | null;
  updatedAt?: number | null;
  source?: "cache" | "remote" | null;
}

export interface ConnectionMetadataSnapshot {
  schemas: string[];
  tables: TableInfo[];
  collections: CollectionInfo[];
  collectionNextCursor?: string | null;
  collectionTotal?: number | null;
  collectionFilter?: string;
  functions: FunctionInfo[];
  pinnedTables: string[];
  currentSchema: string | null;
  defaultSchema: string | null;
  selectedTable: string | null;
  lastLoadedConnectionId: string | null;
  lastLoadedObjectKey: string | null;
  metadataVersion: number;
}

export interface SchemaObjectSnapshot {
  tables: TableInfo[];
  collections: CollectionInfo[];
  functions: FunctionInfo[];
  pinnedTables: string[];
  selectedTable: string | null;
  lastLoadedObjectKey: string | null;
}

export interface MetadataLoadFlight {
  force: boolean;
  promise: Promise<void>;
}

export interface MetadataRequestContext {
  connectionId: string;
  generation: number;
  projectId: string;
}
