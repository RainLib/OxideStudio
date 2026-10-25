use super::*;
use oxide_studio_lib::core::document_read::{
    validate_document_target, DocumentReadQuery, DocumentReadRequest, DocumentSort,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DocumentFindInput {
    connection_id: Option<String>,
    database: Option<String>,
    collection: String,
    #[serde(default = "empty_document")]
    filter: Value,
    #[serde(default)]
    sort: Vec<DocumentSort>,
    #[serde(default = "empty_document")]
    projection: Value,
    #[serde(default)]
    offset: u64,
    #[serde(default = "default_document_limit")]
    limit: usize,
}

fn empty_document() -> Value {
    json!({})
}
fn default_document_limit() -> usize {
    50
}

pub(super) fn reject_document_approval_claims(input: &Value) -> Result<()> {
    // Predicates and projection field names are data: a business field named
    // "approved" cannot grant permission. Keep authority fields and MCP meta
    // on the existing approval policy; the typed query validates data separately.
    let Some(object) = input.as_object() else {
        return reject_self_reported_approval(input).map_err(anyhow::Error::from);
    };
    let authority = Value::Object(
        object
            .iter()
            .filter(|(key, _)| !matches!(key.as_str(), "filter" | "projection"))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    );
    reject_self_reported_approval(&authority).map_err(anyhow::Error::from)
}

impl ToolRuntime {
    pub(super) async fn find_documents(&self, input: DocumentFindInput) -> Result<Value> {
        validate_optional_text(input.database.as_deref(), "database", 64)?;
        validate_text(&input.collection, "collection", 256, false)?;
        let query = DocumentReadQuery {
            filter: input.filter,
            sort: input.sort,
            projection: input.projection,
            offset: input.offset,
            limit: input.limit,
        };
        query.validate()?;
        let connection = self
            .resolve_connection(input.connection_id.as_deref())
            .await?;
        let selected = self.select_driver(&connection)?;
        if selected.id != "mongodb" || selected.package_version.is_some() {
            return Err(anyhow!(
                "the selected driver does not implement public read-only document queries"
            ));
        }
        let database = self
            .grant
            .resolve_database(
                input.database.as_deref(),
                connection.config.database.as_deref(),
            )?
            .ok_or_else(|| anyhow!("database is required for document reads"))?;
        validate_document_target(&database, &input.collection)?;
        let deadline = self
            .query_timeout
            .map(|timeout| tokio::time::Instant::now() + timeout);
        let (driver, tunnel) =
            within_deadline(deadline, self.connect_read_only(&connection, &selected)).await?;
        let result = within_deadline(deadline, async {
            let page = driver
                .read_documents_read_only(DocumentReadRequest {
                    database: &database,
                    collection: &input.collection,
                    query: &query,
                    max_rows: self.grant.max_rows(),
                    max_bytes: self.grant.max_result_bytes().saturating_sub(2_048).max(512),
                    timeout: self
                        .query_timeout
                        .unwrap_or(Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS)),
                })
                .await?;
            Ok(json!({
                "connectionId": connection.stored.id,
                "database": database,
                "collection": input.collection,
                "source": "live",
                "driverPackageVersion": selected.package_version,
                "serverVersion": driver.server_version().await,
                "returnedCount": page.documents.len(),
                "documents": page.documents,
                "hasMore": page.has_more,
                "nextOffset": page.next_offset,
                "byteLimited": page.byte_limited,
            }))
        })
        .await;
        let cleanup = tokio::time::timeout(Duration::from_secs(5), driver.disconnect()).await;
        if let Some(tunnel) = tunnel {
            tunnel.shutdown().await;
        }
        match (result, cleanup) {
            (Ok(result), Ok(Ok(()))) => Ok(result),
            (Ok(_), _) => Err(anyhow!("failed to close the document read connection")),
            (Err(error), _) => Err(error),
        }
    }
}

async fn within_deadline<T>(
    deadline: Option<tokio::time::Instant>,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    match deadline {
        Some(deadline) => tokio::time::timeout_at(deadline, future)
            .await
            .map_err(|_| anyhow!("document read exceeded its configured deadline"))?,
        None => future.await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn business_field_names_cannot_grant_authority_and_remain_queryable() {
        reject_document_approval_claims(&json!({"collection":"items", "filter":{"approved":true, "nested":{"approvalToken":"a value"}}, "projection":{"approved":1}})).unwrap();
        for input in [
            json!({"collection":"items","approved":true}),
            json!({"collection":"items","options":{"approvalLease":"fake"}}),
        ] {
            assert!(reject_document_approval_claims(&input).is_err());
        }
    }

    #[test]
    fn document_inputs_are_closed_and_cannot_select_commands_or_approvals() {
        for forbidden in [
            "command",
            "aggregate",
            "update",
            "approved",
            "findOptions",
            "readConcern",
        ] {
            let mut input = json!({"collection":"items"});
            input[forbidden] = json!({});
            assert!(
                serde_json::from_value::<DocumentFindInput>(input).is_err(),
                "{forbidden}"
            );
        }
        assert!(serde_json::from_value::<DocumentFindInput>(
            json!({"collection":"items","sort":[{"field":"age","direction":1,"approved":true}]})
        )
        .is_err());
    }
}
