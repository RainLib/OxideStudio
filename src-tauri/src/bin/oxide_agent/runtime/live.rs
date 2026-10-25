use super::*;
use oxide_studio_lib::core::{dialect::canonical_driver_name, driver::DatabaseDriver};

#[derive(Debug, Clone, Copy, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum MetadataKind {
    Databases,
    Schemas,
    Relations,
    Collections,
    Columns,
    Indexes,
    Constraints,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LiveMetadataInput {
    connection_id: Option<String>,
    kind: MetadataKind,
    database: Option<String>,
    schema: Option<String>,
    relation: Option<String>,
    #[serde(default)]
    prefix: String,
    #[serde(default)]
    offset: usize,
    #[serde(default = "default_metadata_limit")]
    limit: usize,
}

impl ToolRuntime {
    pub(super) async fn inspect_live_metadata(&self, input: LiveMetadataInput) -> Result<Value> {
        validate_optional_text(input.database.as_deref(), "database", 256)?;
        validate_optional_text(input.schema.as_deref(), "schema", 256)?;
        validate_optional_text(input.relation.as_deref(), "relation", 512)?;
        validate_text(&input.prefix, "prefix", 256, true)?;
        if input.offset > 1_000_000 || !(1..=200).contains(&input.limit) {
            return Err(anyhow!(
                "metadata offset or limit is outside its permitted range"
            ));
        }
        let connection = self
            .resolve_connection(input.connection_id.as_deref())
            .await?;
        let selected = self.select_driver(&connection)?;
        let scope = MetadataScope::resolve(&self.grant, &connection, &selected, &input)?;
        let deadline = self
            .query_timeout
            .map(|timeout| tokio::time::Instant::now() + timeout);
        let connect = self.connect_read_only(&connection, &selected);
        let (driver, tunnel) = within_metadata_deadline(deadline, connect).await?;
        let result = within_metadata_deadline(deadline, async {
            let objects =
                read_metadata(driver.as_ref(), &selected, &input, &scope, &self.grant).await?;
            let page = metadata_page(objects, &input);
            Ok(json!({
                "connectionId": connection.stored.id,
                "source": "live",
                "database": scope.database,
                "schema": scope.schema,
                "kind": input.kind,
                "serverVersion": driver.server_version().await,
                "driverPackageVersion": selected.package_version,
                "objects": page.0,
                "total": page.1,
                "nextOffset": page.2,
            }))
        })
        .await;
        let cleanup = tokio::time::timeout(Duration::from_secs(5), driver.disconnect()).await;
        if let Some(tunnel) = tunnel {
            tunnel.shutdown().await;
        }
        match (result, cleanup) {
            (Ok(result), Ok(Ok(()))) => Ok(result),
            (Ok(_), _) => Err(anyhow!("failed to close the live metadata connection")),
            (Err(error), _) => Err(error),
        }
    }
}

async fn within_metadata_deadline<T>(
    deadline: Option<tokio::time::Instant>,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    match deadline {
        Some(deadline) => tokio::time::timeout_at(deadline, future)
            .await
            .map_err(|_| anyhow!("live metadata exceeded its configured deadline"))?,
        None => future.await,
    }
}

struct MetadataScope {
    database: Option<String>,
    schema: Option<String>,
    index_scope: bool,
}

impl MetadataScope {
    fn resolve(
        grant: &Grant,
        connection: &ResolvedConnection,
        selected: &SelectedDriver,
        input: &LiveMetadataInput,
    ) -> Result<Self> {
        let driver =
            canonical_driver_name(&connection.stored.driver).unwrap_or(&connection.stored.driver);
        let index_scope = matches!(driver, "elasticsearch" | "meilisearch");
        let capabilities = &selected.capabilities;
        if input.kind == MetadataKind::Relations && !capabilities.supports_table_browsing
            || input.kind == MetadataKind::Collections
                && !(capabilities.supports_collection_browsing
                    || capabilities.supports_key_value_browsing)
            || input.kind == MetadataKind::Indexes && !capabilities.supports_table_indexes
            || input.kind == MetadataKind::Constraints && !capabilities.supports_table_constraints
        {
            return Err(anyhow!(
                "this driver does not provide the requested metadata kind"
            ));
        }
        if grant
            .allowed_databases()
            .is_some_and(|allowed| allowed.is_empty())
        {
            return Err(anyhow!("database access is disabled for this grant"));
        }
        if matches!(
            input.kind,
            MetadataKind::Columns | MetadataKind::Indexes | MetadataKind::Constraints
        ) && input.relation.is_none()
        {
            return Err(anyhow!(
                "relation is required for column, index, or constraint metadata"
            ));
        }
        if input.kind == MetadataKind::Databases {
            if let Some(database) = input.database.as_deref() {
                grant.resolve_database(Some(database), None)?;
            }
            return Ok(Self {
                database: input.database.clone(),
                schema: None,
                index_scope,
            });
        }
        if index_scope {
            if input
                .schema
                .as_deref()
                .is_some_and(|schema| schema != "default")
            {
                return Err(anyhow!(
                    "search metadata uses the default namespace and an explicit index relation"
                ));
            }
            if let Some(relation) = input.relation.as_deref() {
                grant.resolve_database(Some(relation), None)?;
                if input
                    .database
                    .as_deref()
                    .is_some_and(|database| !database.eq_ignore_ascii_case(relation))
                {
                    return Err(anyhow!(
                        "index metadata database must match the selected relation"
                    ));
                }
            } else if let Some(database) = input.database.as_deref() {
                grant.resolve_database(Some(database), None)?;
            }
            return Ok(Self {
                database: input.database.clone(),
                schema: Some("default".to_string()),
                index_scope,
            });
        }
        let postgres = selected.separate_schema();
        let file = selected.is_single_database();
        let configured = if file {
            Some("main")
        } else if selected.is_file() {
            None
        } else {
            connection.config.database.as_deref()
        };
        let requested = input
            .database
            .as_deref()
            .or_else(|| (!postgres).then_some(input.schema.as_deref()).flatten());
        let database = grant.resolve_database(requested, configured)?;
        let schema = if postgres {
            input.schema.clone()
        } else {
            if let (Some(schema), Some(database)) = (input.schema.as_deref(), database.as_deref()) {
                if !schema.eq_ignore_ascii_case(database) {
                    return Err(anyhow!(
                        "schema must match the selected database for this driver"
                    ));
                }
            }
            database.clone().or_else(|| input.schema.clone())
        };
        if !matches!(input.kind, MetadataKind::Schemas) && schema.is_none() {
            return Err(anyhow!("schema is required for object metadata"));
        }
        if file && schema.as_deref().is_some_and(|schema| schema != "main") {
            return Err(anyhow!(
                "headless file metadata is restricted to the saved main database"
            ));
        }
        Ok(Self {
            database,
            schema,
            index_scope,
        })
    }
}

async fn read_metadata(
    driver: &dyn DatabaseDriver,
    selected: &SelectedDriver,
    input: &LiveMetadataInput,
    scope: &MetadataScope,
    grant: &Grant,
) -> Result<Vec<Value>> {
    let schema = scope.schema.as_deref().unwrap_or_default();
    let relation = input.relation.as_deref().unwrap_or_default();
    let postgres = selected.separate_schema();
    let database_scoped =
        selected.capabilities.supports_database_catalogs || selected.id == "postgres";
    let values = match input.kind {
        MetadataKind::Databases | MetadataKind::Schemas => {
            let mut names = if scope.index_scope && input.kind == MetadataKind::Databases {
                read_collections(driver, "default")
                    .await?
                    .into_iter()
                    .map(|item| item.name)
                    .collect()
            } else if input.kind == MetadataKind::Databases {
                driver.get_databases().await?
            } else if postgres {
                match scope.database.as_deref().filter(|_| database_scoped) {
                    Some(database) => driver.get_database_schemas(database).await?,
                    None => driver.get_schemas().await?,
                }
            } else {
                driver.get_schemas().await?
            };
            if input.kind == MetadataKind::Databases || !postgres && !scope.index_scope {
                names.retain(|name| database_is_allowed(name, grant, scope));
            }
            names
                .into_iter()
                .map(|name| json!({"name": name}))
                .collect()
        }
        MetadataKind::Relations => serde_json::to_value(
            match scope.database.as_deref().filter(|_| database_scoped) {
                Some(database) => driver.get_database_tables(database, schema).await?,
                None => driver.get_tables(schema).await?,
            },
        )?,
        MetadataKind::Collections => serde_json::to_value(read_collections(driver, schema).await?)?,
        MetadataKind::Columns => serde_json::to_value(
            match scope.database.as_deref().filter(|_| database_scoped) {
                Some(database) => {
                    driver
                        .get_database_columns(database, schema, relation)
                        .await?
                }
                None => driver.get_columns(schema, relation).await?,
            },
        )?,
        MetadataKind::Indexes => serde_json::to_value(
            match scope.database.as_deref().filter(|_| database_scoped) {
                Some(database) => {
                    driver
                        .get_database_indexes(database, schema, relation)
                        .await?
                }
                None => driver.get_indexes(schema, relation).await?,
            },
        )?,
        MetadataKind::Constraints => serde_json::to_value(
            match scope.database.as_deref().filter(|_| database_scoped) {
                Some(database) => {
                    driver
                        .get_database_constraints(database, schema, relation)
                        .await?
                }
                None => driver.get_constraints(schema, relation).await?,
            },
        )?,
    };
    let Value::Array(mut values) = values else {
        return Err(anyhow!("driver returned an invalid metadata list"));
    };
    if input.kind == MetadataKind::Collections && scope.index_scope {
        values.retain(|value| {
            value["name"]
                .as_str()
                .is_some_and(|name| database_is_allowed(name, grant, scope))
        });
    }
    Ok(values)
}

async fn read_collections(
    driver: &dyn DatabaseDriver,
    schema: &str,
) -> Result<Vec<oxide_studio_lib::core::protocol::CollectionInfo>> {
    let mut cursor = None;
    let mut seen = std::collections::HashSet::new();
    let mut values = Vec::new();
    loop {
        let page = driver
            .get_collections_page(schema, cursor.as_deref(), 1_000, None)
            .await?;
        values.extend(page.items);
        if values.len() > 100_000 {
            return Err(anyhow!(
                "live collection metadata exceeds the 100000-object inspection budget"
            ));
        }
        let Some(next) = page.next_cursor else {
            return Ok(values);
        };
        if !seen.insert(next.clone()) || seen.len() > 1_000 {
            return Err(anyhow!(
                "live collection metadata did not reach a bounded terminal cursor"
            ));
        }
        cursor = Some(next);
    }
}

fn database_is_allowed(name: &str, grant: &Grant, scope: &MetadataScope) -> bool {
    grant.allowed_databases().is_none_or(|allowed| {
        allowed
            .iter()
            .any(|database| database_names_match(database, name))
    }) && scope
        .database
        .as_deref()
        .is_none_or(|database| database_names_match(database, name))
}

fn metadata_page(
    mut values: Vec<Value>,
    input: &LiveMetadataInput,
) -> (Vec<Value>, usize, Option<usize>) {
    let prefix = input.prefix.to_lowercase();
    values.retain(|value| {
        value["name"]
            .as_str()
            .is_some_and(|name| name.to_lowercase().starts_with(&prefix))
    });
    values.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    let total = values.len();
    let next = input.offset.saturating_add(input.limit);
    (
        values
            .into_iter()
            .skip(input.offset)
            .take(input.limit)
            .collect(),
        total,
        (next < total).then_some(next),
    )
}
