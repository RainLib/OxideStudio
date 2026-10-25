use crate::core::{
    driver::{
        DatabaseDriver, DocumentCloneReceipt, DocumentCloneRequest, DocumentDeleteReceipt,
        DocumentDeleteRequest, DocumentEditReceipt, DocumentEditRequest, DocumentTransferBatch,
        DocumentTransferClearReceipt, DocumentTransferClearRequest, DocumentTransferReadRequest,
        DocumentTransferWriteReceipt, DocumentTransferWriteRequest, PreparedDocumentClone,
        PreparedDocumentDelete, PreparedDocumentEdit,
    },
    protocol::{CollectionInfo, ColumnInfo, DatabaseCreateRequest, IndexInfo, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use futures::{stream, StreamExt, TryStreamExt};
use mongodb::{
    bson::{doc, Bson, Document},
    options::{ClientOptions, ServerMonitoringMode},
    results::CollectionType,
    Client,
};

use super::commands::{json_to_bson, json_to_document, parse_mongodb_commands};
use super::documents::{
    exact_source_filter, extract_cursor_batch, prepare_mongodb_document_clone,
    prepare_mongodb_document_delete, prepare_mongodb_document_edit,
};
use super::models::{
    MongoDbDriver, MONGODB_COLLECTION_COUNT_CONCURRENCY, MONGODB_DATABASE_INITIALIZATION_COLLECTION,
};
use super::results::{
    infer_mongodb_columns, mongodb_indexes_to_info, mongodb_server_version,
    validate_mongodb_collection_name, validate_mongodb_database_name,
};

#[async_trait]
impl DatabaseDriver for MongoDbDriver {
    async fn connect(&mut self) -> Result<()> {
        let default_database = self.default_database.clone();
        let mut options = ClientOptions::parse(&self.url)
            .await
            .with_context(|| format!("Failed to connect to MongoDB at {}", self.url))?;
        super::super::mongodb_oidc::configure_client_options(&mut options)
            .context("Failed to configure MongoDB OIDC authentication")?;
        if self.agent_owned {
            // Short-lived public tool connections must not wait for the SDK's
            // ten-second streaming monitor interval during graceful shutdown.
            options.server_monitoring_mode = Some(ServerMonitoringMode::Poll);
            options.heartbeat_freq = Some(std::time::Duration::from_secs(1));
        }
        let client = Client::with_options(options).context("Failed to create MongoDB client")?;
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .context("MongoDB ping failed")?;

        // `buildInfo` is available on supported MongoDB server versions, but
        // a narrowly scoped account may not have permission to read it. A
        // missing version must never make an otherwise valid connection fail:
        // the language server will use its conservative compatibility set.
        let server_version = client
            .database("admin")
            .run_command(doc! { "buildInfo": 1 })
            .await
            .ok()
            .and_then(|response| mongodb_server_version(&response));

        *self.client.lock().await = Some(client);
        *self.active_database.lock().await = default_database;
        *self.server_version.lock().await = server_version;
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        let client = self.client.lock().await.take();
        if self.agent_owned {
            if let Some(client) = client {
                client.shutdown().await;
            }
        }
        *self.active_database.lock().await = self.default_database.clone();
        *self.server_version.lock().await = None;
        Ok(())
    }

    async fn read_documents_read_only(
        &self,
        request: crate::core::document_read::DocumentReadRequest<'_>,
    ) -> Result<crate::core::document_read::DocumentReadPage> {
        self.read_only_documents(request).await
    }

    async fn server_version(&self) -> Option<String> {
        self.server_version.lock().await.clone()
    }

    async fn ping(&self) -> Result<()> {
        self.client()
            .await?
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .context("MongoDB ping failed")?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let commands = parse_mongodb_commands(sql)?;
        self.execute_commands(commands).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let database = validate_mongodb_database_name(schema)?;
        *self.active_database.lock().await = database.clone();
        let mut commands = parse_mongodb_commands(sql)?;
        let mut scoped_database = Some(database);
        for command in &mut commands {
            if command.database.is_none() {
                command.database = scoped_database.clone();
            }
            // Shell `use` is sequential: commands after it inherit the new
            // active database instead of the query tab's old target.
            if command.use_database.is_some() {
                scoped_database = None;
            }
        }
        self.execute_commands(commands).await
    }

    async fn read_document_transfer_batch(
        &self,
        request: DocumentTransferReadRequest<'_>,
    ) -> Result<DocumentTransferBatch> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let limit = request.limit.clamp(1, 1_000) as i64;
        let offset = i64::try_from(request.offset)
            .map_err(|_| anyhow!("MongoDB transfer offset is too large"))?;
        let database = self.client().await?.database(&database_name);
        // Sorting by _id gives a deterministic batch order and mirrors DBX's
        // transfer reader. This is still a non-snapshot read: the desktop
        // command makes that explicit in its transfer receipt.
        let result = database
            .run_command(doc! {
                "find": &collection_name,
                "filter": {},
                "sort": { "_id": 1 },
                "skip": offset,
                "limit": limit,
            })
            .await
            .with_context(|| {
                format!(
                    "Failed to read MongoDB transfer batch for {database_name}.{collection_name}"
                )
            })?;
        let documents = extract_cursor_batch(result)?
            .into_iter()
            .map(|document| Bson::Document(document).into_canonical_extjson())
            .collect();
        let total = database
            .collection::<Document>(&collection_name)
            .count_documents(doc! {})
            .await
            .with_context(|| {
                format!("Failed to count MongoDB collection {database_name}.{collection_name}")
            })?;
        Ok(DocumentTransferBatch { documents, total })
    }

    async fn write_document_transfer_batch(
        &self,
        request: DocumentTransferWriteRequest<'_>,
    ) -> Result<DocumentTransferWriteReceipt> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        if request.documents.is_empty() {
            return Ok(DocumentTransferWriteReceipt { inserted_count: 0 });
        }
        let documents = request
            .documents
            .iter()
            .map(|document| json_to_document(document, "MongoDB transfer document"))
            .collect::<Result<Vec<_>>>()?;
        let inserted_count = documents.len() as u64;
        self.client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name)
            .insert_many(documents)
            .ordered(true)
            .await
            .with_context(|| {
                format!(
                    "Failed to write MongoDB transfer batch for {database_name}.{collection_name}"
                )
            })?;
        Ok(DocumentTransferWriteReceipt { inserted_count })
    }

    async fn clear_document_transfer_collection(
        &self,
        request: DocumentTransferClearRequest<'_>,
    ) -> Result<DocumentTransferClearReceipt> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let result = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name)
            .delete_many(doc! {})
            .await
            .with_context(|| {
                format!("Failed to clear MongoDB collection {database_name}.{collection_name}")
            })?;
        Ok(DocumentTransferClearReceipt {
            deleted_count: result.deleted_count,
        })
    }

    async fn prepare_document_clone(
        &self,
        request: DocumentCloneRequest<'_>,
    ) -> Result<PreparedDocumentClone> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB clone source _id")?;
        let source = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name)
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to read the MongoDB clone source")?
            .ok_or_else(|| {
                anyhow!(
                    "MongoDB clone source no longer exists; refresh the collection and select it again"
                )
            })?;
        prepare_mongodb_document_clone(&source, request.draft_document)
    }

    async fn execute_document_clone(
        &self,
        request: DocumentCloneRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<DocumentCloneReceipt> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB clone source _id")?;
        let collection = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name);
        let source = collection
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to re-read the MongoDB clone source")?
            .ok_or_else(|| {
                anyhow!(
                    "MongoDB clone source no longer exists; refresh the collection and select it again"
                )
            })?;
        let prepared = prepare_mongodb_document_clone(&source, request.draft_document)?;
        if prepared.source_digest != expected_source_digest {
            return Err(anyhow!(
                "MongoDB clone source changed after preview; review the latest document before cloning"
            ));
        }
        let cloned = json_to_document(&prepared.cloned_document, "MongoDB clone document")?;
        let inserted = collection
            .insert_one(cloned)
            .await
            .context("MongoDB document clone failed")?;
        Ok(DocumentCloneReceipt {
            inserted_id: inserted.inserted_id.into_canonical_extjson(),
        })
    }

    async fn prepare_document_edit(
        &self,
        request: DocumentEditRequest<'_>,
    ) -> Result<PreparedDocumentEdit> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB edit source _id")?;
        let source = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name)
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to read the MongoDB edit source")?
            .ok_or_else(|| {
                anyhow!("MongoDB edit source no longer exists; refresh and select it again")
            })?;
        prepare_mongodb_document_edit(&source, request.draft_document)
    }

    async fn execute_document_edit(
        &self,
        request: DocumentEditRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<DocumentEditReceipt> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB edit source _id")?;
        let collection = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name);
        let source = collection
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to re-read the MongoDB edit source")?
            .ok_or_else(|| {
                anyhow!("MongoDB edit source no longer exists; refresh and select it again")
            })?;
        let prepared = prepare_mongodb_document_edit(&source, request.draft_document)?;
        if prepared.source_digest != expected_source_digest {
            return Err(anyhow!(
                "MongoDB document changed after preview; review the latest document before saving"
            ));
        }
        if prepared.edited_fields.is_empty() {
            return Err(anyhow!(
                "MongoDB document edit does not contain any changes"
            ));
        }
        let replacement = json_to_document(&prepared.updated_document, "MongoDB edited document")?;
        let result = collection
            .replace_one(exact_source_filter(&source)?, replacement)
            .await
            .context("MongoDB document edit failed")?;
        if result.matched_count != 1 {
            return Err(anyhow!(
                "MongoDB document changed while the edit was being saved; refresh before retrying"
            ));
        }
        Ok(DocumentEditReceipt {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
        })
    }

    async fn prepare_document_delete(
        &self,
        request: DocumentDeleteRequest<'_>,
    ) -> Result<PreparedDocumentDelete> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB delete source _id")?;
        let source = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name)
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to read the MongoDB delete source")?
            .ok_or_else(|| {
                anyhow!("MongoDB delete source no longer exists; refresh and select it again")
            })?;
        Ok(prepare_mongodb_document_delete(&source)?)
    }

    async fn execute_document_delete(
        &self,
        request: DocumentDeleteRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<DocumentDeleteReceipt> {
        let database_name = validate_mongodb_database_name(request.namespace)?;
        let collection_name = validate_mongodb_collection_name(request.collection)?;
        let source_id = json_to_bson(request.source_id, "MongoDB delete source _id")?;
        let collection = self
            .client()
            .await?
            .database(&database_name)
            .collection::<Document>(&collection_name);
        let source = collection
            .find_one(doc! { "_id": source_id })
            .await
            .context("Failed to re-read the MongoDB delete source")?
            .ok_or_else(|| {
                anyhow!("MongoDB delete source no longer exists; refresh and select it again")
            })?;
        let prepared = prepare_mongodb_document_delete(&source)?;
        if prepared.source_digest != expected_source_digest {
            return Err(anyhow!(
                "MongoDB document changed after preview; review the latest document before deleting"
            ));
        }
        let result = collection
            .delete_one(exact_source_filter(&source)?)
            .await
            .context("MongoDB document delete failed")?;
        if result.deleted_count != 1 {
            return Err(anyhow!(
                "MongoDB document changed while it was being deleted; refresh before retrying"
            ));
        }
        Ok(DocumentDeleteReceipt {
            deleted_count: result.deleted_count,
        })
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let names = self
            .client()
            .await?
            .list_database_names()
            .await
            .context("Failed to list MongoDB databases")?;
        Ok(names)
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        let namespace = namespace.trim();
        let database_name = if namespace.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(namespace)?
        };
        *self.active_database.lock().await = database_name.clone();
        let database = self.client().await?.database(&database_name);
        // `listCollections` supplies the collection/view distinction in one
        // catalog request. The former name-only path mislabeled views and then
        // executed one count request at a time for every object (an N+1
        // latency cliff on large databases).
        let mut cursor = database
            .list_collections()
            .await
            .with_context(|| format!("Failed to list MongoDB collections for {database_name}"))?;
        let mut specs = Vec::new();
        while let Some(spec) = cursor.try_next().await.with_context(|| {
            format!("Failed to read MongoDB collection metadata for {database_name}")
        })? {
            specs.push((
                spec.name,
                mongodb_collection_type_label(&spec.collection_type).to_string(),
            ));
        }
        specs.sort_by(|(left, _), (right, _)| left.cmp(right));

        let mut collections = stream::iter(specs.into_iter().map(|(name, collection_type)| {
            let database = database.clone();
            async move {
                // MongoDB views do not provide a reliable estimated document
                // count. Keep the badge absent rather than issuing a command
                // guaranteed to fail or presenting a view as a base collection.
                let document_count =
                    if mongodb_collection_supports_estimated_count(&collection_type) {
                        database
                            .collection::<Document>(&name)
                            .estimated_document_count()
                            .await
                            .ok()
                    } else {
                        None
                    };
                (name, collection_type, document_count)
            }
        }))
        .buffer_unordered(MONGODB_COLLECTION_COUNT_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .map(|(name, collection_type, document_count)| {
            mongodb_collection_info(&database_name, name, collection_type, document_count)
        })
        .collect::<Vec<_>>();
        collections.sort_by(|left, right| left.name.cmp(&right.name));

        Ok(collections)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let schema = schema.trim();
        let database_name = if schema.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(schema)?
        };
        let collection = table.trim();
        if collection.is_empty() {
            return Ok(Vec::new());
        }

        let result = self
            .client()
            .await?
            .database(&database_name)
            .run_command(doc! {
                "find": collection,
                "filter": {},
                "limit": 20_i32,
            })
            .await
            .with_context(|| {
                format!("Failed to sample MongoDB documents for {database_name}.{collection}")
            })?;
        let documents = extract_cursor_batch(result)?;
        Ok(infer_mongodb_columns(&documents))
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let schema = schema.trim();
        let database_name = if schema.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(schema)?
        };
        let collection = table.trim();
        if collection.is_empty() {
            return Ok(Vec::new());
        }

        let result = self
            .client()
            .await?
            .database(&database_name)
            .run_command(doc! {
                "listIndexes": collection,
            })
            .await
            .with_context(|| {
                format!("Failed to list MongoDB indexes for {database_name}.{collection}")
            })?;
        Ok(mongodb_indexes_to_info(extract_cursor_batch(result)?))
    }

    async fn create_database(&self, request: DatabaseCreateRequest) -> Result<()> {
        let database_name = validate_mongodb_database_name(&request.name)?;
        if request
            .namespace_kind
            .as_deref()
            .is_some_and(|kind| kind != "database")
        {
            return Err(anyhow!("MongoDB can only create database namespaces"));
        }
        if request.charset.is_some() || request.collation.is_some() || request.owner.is_some() {
            return Err(anyhow!(
                "MongoDB database creation does not support charset, collation, or owner options"
            ));
        }

        // MongoDB materializes a database only after its first collection or
        // document is created. Keep this operation semantic and bounded: the
        // renderer cannot replace the initialization command with arbitrary
        // database input.
        self.client()
            .await?
            .database(&database_name)
            .run_command(doc! { "create": MONGODB_DATABASE_INITIALIZATION_COLLECTION })
            .await
            .with_context(|| format!("Failed to create MongoDB database {database_name}"))?;
        *self.active_database.lock().await = database_name;
        Ok(())
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let database = validate_mongodb_database_name(schema)?;
        *self.active_database.lock().await = database;
        Ok(())
    }
}

pub(super) fn mongodb_collection_info(
    database_name: &str,
    name: String,
    collection_type: String,
    document_count: Option<u64>,
) -> CollectionInfo {
    CollectionInfo {
        name,
        namespace: Some(database_name.to_string()),
        collection_type: Some(collection_type),
        document_count,
    }
}

pub(super) fn mongodb_collection_supports_estimated_count(collection_type: &str) -> bool {
    !collection_type.trim().eq_ignore_ascii_case("view")
}

pub(super) fn mongodb_collection_type_label(collection_type: &CollectionType) -> &'static str {
    match collection_type {
        CollectionType::View => "view",
        CollectionType::Collection => "collection",
        CollectionType::Timeseries => "timeseries",
        // The MongoDB driver marks this enum non-exhaustive so a newer server
        // type does not make the desktop client unusable. Preserve a safe base
        // collection label until the runtime contract adds explicit support.
        _ => "collection",
    }
}
