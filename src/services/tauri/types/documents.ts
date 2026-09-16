import type { QueryResult } from "./query";

export interface DocumentPage {
  result: QueryResult;
  nextCursor?: string | null;
  total?: number | null;
}

export interface MongoDocumentCloneRequest {
  database: string;
  collection: string;
  sourceId: unknown;
  /** Omit for the initial Host-owned source load. */
  draftDocument?: Record<string, unknown> | null;
}

export interface MongoDocumentClonePlan {
  database: string;
  collection: string;
  sourceId: unknown;
  /** Canonical Extended JSON including the source `_id`. */
  sourceDocument: Record<string, unknown>;
  /** Canonical Extended JSON shown in the editor; source `_id` is omitted. */
  draftDocument: Record<string, unknown>;
  /** Exact canonical document which will be inserted. */
  previewDocument: Record<string, unknown>;
  editedFields: string[];
  sourceDigest: string;
  confirmationToken: string;
  serverVersion?: string | null;
}

export interface MongoDocumentCloneReceipt {
  insertedId: unknown;
  message: string;
}

export interface MongoDocumentEditRequest {
  database: string;
  collection: string;
  sourceId: unknown;
  /** Canonical Extended JSON without the immutable `_id`. */
  draftDocument?: Record<string, unknown> | null;
}

export interface MongoDocumentEditPlan {
  database: string;
  collection: string;
  sourceId: unknown;
  sourceDocument: Record<string, unknown>;
  draftDocument: Record<string, unknown>;
  previewDocument: Record<string, unknown>;
  editedFields: string[];
  sourceDigest: string;
  confirmationToken: string;
  serverVersion?: string | null;
}

export interface MongoDocumentEditReceipt {
  matchedCount: number;
  modifiedCount: number;
  message: string;
}

export interface MongoDocumentDeleteRequest {
  database: string;
  collection: string;
  sourceId: unknown;
}

export interface MongoDocumentDeletePlan {
  database: string;
  collection: string;
  sourceId: unknown;
  sourceDocument: Record<string, unknown>;
  sourceDigest: string;
  confirmationToken: string;
  confirmationPhrase: string;
  serverVersion?: string | null;
}

export interface MongoDocumentDeleteReceipt {
  deletedCount: number;
  message: string;
}

/** BSON-preserving collection migration; kept separate from relational table transfer. */
export type MongoCollectionTransferMode = "append" | "overwrite";

export interface MongoCollectionTransferRequest {
  sourceConnectionId: string;
  sourceDatabase: string;
  sourceCollection: string;
  targetConnectionId: string;
  targetDatabase: string;
  targetCollection: string;
  mode?: MongoCollectionTransferMode;
}

export interface MongoCollectionTransferPlan {
  sourceDatabase: string;
  sourceCollection: string;
  targetDatabase: string;
  targetCollection: string;
  mode: MongoCollectionTransferMode;
  sourceDocumentCount: number;
  targetDocumentCount: number;
  batchSize: number;
  preservesBsonTypes: boolean;
  /** False for cross-connection reads: source changes must be reviewed/retried. */
  isSnapshotConsistent: boolean;
  confirmationPhrase?: string | null;
  confirmationToken: string;
  sourceServerVersion?: string | null;
  targetServerVersion?: string | null;
}

export interface MongoCollectionTransferReceipt {
  insertedCount: number;
  deletedCount: number;
  sourceDocumentCount: number;
  message: string;
}
