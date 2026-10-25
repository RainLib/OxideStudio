use crate::core::protocol::QueryResult;
use anyhow::{anyhow, Context, Result};
use mongodb::{bson::doc, Client};
use tokio::sync::Mutex;

use super::commands::{
    build_aggregate_command, build_delete_command, build_find_command, build_update_command,
    json_to_document,
};
use super::documents::extract_cursor_batch;
use super::models::{MongoCommandInput, MongoDbDriver};
use super::results::{
    command_result, documents_result, mongodb_default_database, mongodb_use_database_result,
    validate_mongodb_database_name,
};

impl MongoDbDriver {
    pub fn new(url: &str) -> Self {
        Self {
            agent_owned: false,
            url: url.to_string(),
            default_database: mongodb_default_database(url),
            active_database: Mutex::new(mongodb_default_database(url)),
            client: Mutex::new(None),
            server_version: Mutex::new(None),
        }
    }

    pub fn new_agent_owned(url: &str) -> Self {
        Self {
            agent_owned: true,
            ..Self::new(url)
        }
    }

    pub(super) async fn client(&self) -> Result<Client> {
        self.client
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("MongoDB connection is not established"))
    }

    pub(super) async fn active_database_name(&self) -> String {
        let active = self.active_database.lock().await.clone();
        if active.trim().is_empty() {
            self.default_database.clone()
        } else {
            active
        }
    }

    pub(super) async fn database_name_for(&self, value: Option<&str>) -> Result<String> {
        if let Some(database) = value.map(str::trim).filter(|value| !value.is_empty()) {
            return validate_mongodb_database_name(database);
        }
        Ok(self.active_database_name().await)
    }

    pub(super) async fn execute_commands(
        &self,
        commands: Vec<MongoCommandInput>,
    ) -> Result<Vec<QueryResult>> {
        if commands.is_empty() {
            return Err(anyhow!("MongoDB command is required"));
        }

        let mut results = Vec::with_capacity(commands.len());
        for command in commands {
            results.push(self.execute_command(command).await?);
        }
        Ok(results)
    }

    pub(super) async fn execute_command(&self, input: MongoCommandInput) -> Result<QueryResult> {
        if let Some(database) = input.use_database.as_deref() {
            let database = validate_mongodb_database_name(database)?;
            // `use` is the same local selection operation as the Explorer's
            // database picker. It never sends a synthetic server command or
            // exposes an arbitrary command surface.
            *self.active_database.lock().await = database.clone();
            return Ok(mongodb_use_database_result(&database));
        }
        let client = self.client().await?;
        let database_name = self.database_name_for(input.database.as_deref()).await?;
        let database = client.database(&database_name);

        if let Some(command) = input.command.as_ref() {
            let result = database
                .run_command(json_to_document(command, "command")?)
                .await
                .context("MongoDB command failed")?;
            return Ok(command_result(&database_name, "command", None, result));
        }

        let collection = input
            .collection
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("MongoDB collection is required"))?;

        if input.find.is_some() || input.has_no_operation() {
            let result = database
                .run_command(build_find_command(collection, &input)?)
                .await
                .context("MongoDB find command failed")?;
            return Ok(documents_result(extract_cursor_batch(result)?));
        }

        if let Some(pipeline) = input.aggregate.as_ref() {
            let result = database
                .run_command(build_aggregate_command(
                    collection,
                    pipeline,
                    input.aggregate_options.as_ref(),
                )?)
                .await
                .context("MongoDB aggregate command failed")?;
            return Ok(documents_result(extract_cursor_batch(result)?));
        }

        if let Some(filter) = input.count_documents.as_ref() {
            let result = database
                .run_command(doc! {
                    "count": collection,
                    "query": json_to_document(filter, "countDocuments")?,
                })
                .await
                .context("MongoDB count command failed")?;
            return Ok(command_result(
                &database_name,
                "countDocuments",
                Some(collection),
                result,
            ));
        }

        if let Some(document) = input.insert_one.as_ref() {
            let document = json_to_document(document, "insertOne")?;
            let result = database
                .run_command(doc! {
                    "insert": collection,
                    "documents": [document],
                })
                .await
                .context("MongoDB insertOne command failed")?;
            return Ok(command_result(
                &database_name,
                "insertOne",
                Some(collection),
                result,
            ));
        }

        if let Some(documents) = input.insert_many.as_ref() {
            let documents = documents
                .iter()
                .map(|value| json_to_document(value, "insertMany document"))
                .collect::<Result<Vec<_>>>()?;
            let result = database
                .run_command(doc! {
                    "insert": collection,
                    "documents": documents,
                })
                .await
                .context("MongoDB insertMany command failed")?;
            return Ok(command_result(
                &database_name,
                "insertMany",
                Some(collection),
                result,
            ));
        }

        if let Some(update) = input.update_one.as_ref() {
            let result = database
                .run_command(build_update_command(collection, update, false)?)
                .await
                .context("MongoDB updateOne command failed")?;
            return Ok(command_result(
                &database_name,
                "updateOne",
                Some(collection),
                result,
            ));
        }

        if let Some(update) = input.update_many.as_ref() {
            let result = database
                .run_command(build_update_command(collection, update, true)?)
                .await
                .context("MongoDB updateMany command failed")?;
            return Ok(command_result(
                &database_name,
                "updateMany",
                Some(collection),
                result,
            ));
        }

        if let Some(filter) = input.delete_one.as_ref() {
            let result = database
                .run_command(build_delete_command(collection, filter, 1)?)
                .await
                .context("MongoDB deleteOne command failed")?;
            return Ok(command_result(
                &database_name,
                "deleteOne",
                Some(collection),
                result,
            ));
        }

        if let Some(filter) = input.delete_many.as_ref() {
            let result = database
                .run_command(build_delete_command(collection, filter, 0)?)
                .await
                .context("MongoDB deleteMany command failed")?;
            return Ok(command_result(
                &database_name,
                "deleteMany",
                Some(collection),
                result,
            ));
        }

        Err(anyhow!("Unsupported MongoDB command"))
    }
}

/// OIDC is an interactive native-driver flow.  It must never be delegated to
/// an arbitrary external package just because that package happens to be the
/// active MongoDB implementation for regular connections.
pub(crate) fn mongodb_url_uses_oidc(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value.trim()) else {
        return false;
    };
    url.query_pairs().any(|(key, candidate)| {
        key.eq_ignore_ascii_case("authMechanism") && candidate.eq_ignore_ascii_case("MONGODB-OIDC")
    })
}
