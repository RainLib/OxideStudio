import { invokeWithInterceptors } from "../client";
import type {
  DocumentPage,
  ElasticsearchIndexClearPlan,
  MongoCollectionTransferPlan,
  MongoCollectionTransferReceipt,
  MongoCollectionTransferRequest,
  MongoDocumentClonePlan,
  MongoDocumentCloneReceipt,
  MongoDocumentCloneRequest,
  MongoDocumentDeletePlan,
  MongoDocumentDeleteReceipt,
  MongoDocumentDeleteRequest,
  MongoDocumentEditPlan,
  MongoDocumentEditReceipt,
  MongoDocumentEditRequest,
  SearchIndexClearResult,
  SearchIndexMetadataKind,
} from "../types";

export async function getDocumentPage(
  connectionId: string,
  namespace: string,
  collection: string,
  cursor?: string | null,
  limit = 100,
  filter?: string | null,
  sort?: string | null,
): Promise<DocumentPage> {
  return invokeWithInterceptors<DocumentPage>("get_document_page", {
    connectionId,
    namespace,
    collection,
    cursor: cursor || null,
    limit,
    filter: filter || null,
    sort: sort || null,
  });
}

export async function closeDocumentCursor(
  connectionId: string,
  cursor: string,
): Promise<void> {
  await invokeWithInterceptors<void>("close_document_cursor", {
    connectionId,
    cursor,
  });
}

export async function getElasticsearchIndexMetadata(
  connectionId: string,
  driver: string,
  index: string,
  kind: SearchIndexMetadataKind,
): Promise<unknown> {
  return invokeWithInterceptors<unknown>("get_elasticsearch_index_metadata", {
    connectionId,
    driver,
    index,
    kind,
  });
}

export async function previewElasticsearchIndexClear(
  connectionId: string,
  driver: string,
  index: string,
): Promise<ElasticsearchIndexClearPlan> {
  return invokeWithInterceptors<ElasticsearchIndexClearPlan>(
    "preview_elasticsearch_index_clear",
    { connectionId, driver, index },
  );
}

export async function executeElasticsearchIndexClear(
  connectionId: string,
  driver: string,
  request: {
    index: string;
    confirmationToken: string;
    confirmationPhrase?: string;
  },
): Promise<SearchIndexClearResult> {
  return invokeWithInterceptors<SearchIndexClearResult>(
    "execute_elasticsearch_index_clear",
    { connectionId, driver, request },
  );
}

export async function previewMongoDocumentClone(
  connectionId: string,
  driver: string,
  request: MongoDocumentCloneRequest,
): Promise<MongoDocumentClonePlan> {
  return invokeWithInterceptors<MongoDocumentClonePlan>(
    "preview_mongodb_document_clone",
    { connectionId, driver, request },
  );
}

export async function executeMongoDocumentClone(
  connectionId: string,
  driver: string,
  request: MongoDocumentCloneRequest,
  confirmationToken: string,
): Promise<MongoDocumentCloneReceipt> {
  return invokeWithInterceptors<MongoDocumentCloneReceipt>(
    "execute_mongodb_document_clone",
    {
      connectionId,
      driver,
      request: { clone: request, confirmationToken },
    },
  );
}

export async function previewMongoDocumentEdit(
  connectionId: string,
  driver: string,
  request: MongoDocumentEditRequest,
): Promise<MongoDocumentEditPlan> {
  return invokeWithInterceptors<MongoDocumentEditPlan>(
    "preview_mongodb_document_edit",
    { connectionId, driver, request },
  );
}

export async function executeMongoDocumentEdit(
  connectionId: string,
  driver: string,
  request: MongoDocumentEditRequest,
  confirmationToken: string,
): Promise<MongoDocumentEditReceipt> {
  return invokeWithInterceptors<MongoDocumentEditReceipt>(
    "execute_mongodb_document_edit",
    { connectionId, driver, request: { edit: request, confirmationToken } },
  );
}

export async function previewMongoDocumentDelete(
  connectionId: string,
  driver: string,
  request: MongoDocumentDeleteRequest,
): Promise<MongoDocumentDeletePlan> {
  return invokeWithInterceptors<MongoDocumentDeletePlan>(
    "preview_mongodb_document_delete",
    { connectionId, driver, request },
  );
}

export async function executeMongoDocumentDelete(
  connectionId: string,
  driver: string,
  request: MongoDocumentDeleteRequest,
  confirmationToken: string,
  confirmationPhrase: string,
): Promise<MongoDocumentDeleteReceipt> {
  return invokeWithInterceptors<MongoDocumentDeleteReceipt>(
    "execute_mongodb_document_delete",
    {
      connectionId,
      driver,
      request: { delete: request, confirmationToken, confirmationPhrase },
    },
  );
}

/** Preview a MongoDB-only collection migration. Canonical Extended JSON keeps
 * BSON values intact; the backend will reject unsupported external drivers. */
export async function previewMongoCollectionTransfer(
  request: MongoCollectionTransferRequest,
): Promise<MongoCollectionTransferPlan> {
  return invokeWithInterceptors<MongoCollectionTransferPlan>(
    "preview_mongodb_collection_transfer",
    { request },
  );
}

export async function executeMongoCollectionTransfer(
  transfer: MongoCollectionTransferRequest,
  confirmationToken: string,
  confirmationPhrase = "",
): Promise<MongoCollectionTransferReceipt> {
  return invokeWithInterceptors<MongoCollectionTransferReceipt>(
    "execute_mongodb_collection_transfer",
    {
      request: { transfer, confirmationToken, confirmationPhrase },
    },
  );
}
