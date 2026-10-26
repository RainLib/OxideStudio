use super::{
    metadata_parent_path,
    proto::{MutationRequest, MutationStatement},
    ManagedGatewayDriver,
};
use crate::core::{
    driver::ManagedTablePermissions,
    managed_sql::managed_mutation_plan,
    protocol::{ParameterizedStatement, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use oxide_enterprise_contracts::AccessAction;

impl ManagedGatewayDriver {
    pub(super) async fn parameterized_read(
        &self,
        database: Option<&str>,
        sql: &str,
        parameters: &[crate::core::protocol::QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let database = self.resolve_sql_database(database).await?;
        crate::core::statement::validate_read_only_sql(
            sql,
            crate::core::statement::StatementScanDialect::Postgres,
        )
        .map_err(|error| anyhow!(error))?;
        let path = self.query_resource_path(sql, Some(&database), None)?;
        let (mut client, session, scope) = self.open_client(AccessAction::QueryRead, path).await?;
        let mut stream = client
            .execute_read_only(super::proto::QueryRequest {
                access_ticket: session.ticket,
                scope: Some(scope),
                sql: sql.to_string(),
                database: Some(database),
                schema: None,
                parameters_json: serde_json::to_vec(parameters)?,
            })
            .await?
            .into_inner();
        let mut results = Vec::new();
        while let Some(chunk) = stream.message().await? {
            if chunk.encoding != super::proto::query_chunk::Encoding::Json as i32 {
                return Err(anyhow!("Unsupported managed query encoding"));
            }
            results.extend(serde_json::from_slice::<Vec<QueryResult>>(&chunk.payload)?);
        }
        Ok(results)
    }
    pub(super) fn mutation_feature_enabled(&self) -> bool {
        self.features
            .read()
            .is_ok_and(|features| features.contains("sql.mutation.postgres.v1"))
            && matches!(self.descriptor.driver.as_str(), "postgres" | "postgresql")
    }

    pub(super) async fn execute_mutation_batch(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        if !self.mutation_feature_enabled() {
            return Err(anyhow!(
                "This Gateway does not implement managed PostgreSQL mutations"
            ));
        }
        if statements.is_empty() || statements.len() > 100 {
            return Err(anyhow!("Mutation batches must contain 1 to 100 statements"));
        }
        let database = self.resolve_sql_database(database).await?;
        let plans = statements
            .iter()
            .map(|statement| managed_mutation_plan(&statement.sql, &database, schema))
            .collect::<Result<Vec<_>>>()?;
        let action = plans[0].action;
        let target = &plans[0].target;
        if plans
            .iter()
            .any(|plan| plan.action != action || &plan.target != target)
        {
            return Err(anyhow!(
                "Mutation batch must target one table with one permission action"
            ));
        }
        let (mut client, session, scope) = self.open_client(action, target.clone()).await?;
        let statements = statements
            .iter()
            .map(|statement| {
                Ok(MutationStatement {
                    sql: statement.sql.clone(),
                    parameters_json: serde_json::to_vec(&statement.params)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let response = client
            .execute_mutation(MutationRequest {
                access_ticket: session.ticket,
                scope: Some(scope),
                database,
                schema: schema.map(str::to_string),
                statements,
            })
            .await
            .context("Managed mutation was rejected")?
            .into_inner();
        if response.policy_revision != session.policy_revision {
            return Err(anyhow!(
                "Managed mutation response policy changed; refresh the table before continuing"
            ));
        }
        Ok(response.rows_affected)
    }

    pub(super) async fn execute_mutation_query(
        &self,
        sql: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let affected = self
            .execute_mutation_batch(
                database,
                schema,
                &[ParameterizedStatement {
                    sql: sql.to_string(),
                    params: Vec::new(),
                }],
            )
            .await?;
        let result = QueryResult::execution("Statement", affected.first().copied().unwrap_or(0));
        Ok(vec![result])
    }

    pub(super) async fn table_permissions(
        &self,
        database: Option<&str>,
        schema: &str,
        table: &str,
    ) -> Result<ManagedTablePermissions> {
        let mut result = ManagedTablePermissions {
            data_write: false,
            schema_ddl: false,
            policy_revision: self.descriptor.policy_revision.clone(),
        };
        if !self.mutation_feature_enabled() {
            return Ok(result);
        }
        let database = self.resolve_sql_database(database).await?;
        let path = metadata_parent_path("definition", Some(&database), Some(schema), Some(table))?;
        let mut revision = None;
        for (action, allowed) in [
            (AccessAction::DataWrite, &mut result.data_write),
            (AccessAction::SchemaDdl, &mut result.schema_ddl),
        ] {
            if !self.descriptor.capabilities.contains(action.as_str()) {
                continue;
            }
            match self
                .enterprise
                .create_access_session(super::ManagedAccessSessionRequest {
                    organization_id: self.descriptor.organization_id,
                    project_id: self.descriptor.project_id,
                    data_source_id: self.descriptor.data_source_id,
                    action,
                    resource_path: path.clone(),
                    max_rows: Some(500),
                    max_result_bytes: Some(1_048_576),
                })
                .await
            {
                Ok(session) => {
                    if revision
                        .as_ref()
                        .is_some_and(|value| value != &session.policy_revision)
                    {
                        return Err(anyhow!(
                            "Enterprise permissions changed while loading; refresh the table"
                        ));
                    }
                    revision = Some(session.policy_revision);
                    *allowed = true;
                }
                Err(error)
                    if error
                        .downcast_ref::<reqwest::Error>()
                        .and_then(reqwest::Error::status)
                        == Some(reqwest::StatusCode::FORBIDDEN) => {}
                Err(error) => return Err(error),
            }
        }
        if let Some(revision) = revision {
            result.policy_revision = revision;
        }
        Ok(result)
    }
}
