use super::{
    authorization::authorize_postgres_mutation_target,
    models::DataPlaneService,
    policy::{require_ticket_driver, require_ticket_target_binding},
};
use crate::proto::{MutationRequest, MutationResponse};
use oxide_enterprise_contracts::AccessAction;
use oxide_studio_lib::core::{
    managed_sql::managed_mutation_plan,
    protocol::{ParameterizedStatement, QueryParameter},
};
use std::time::Duration;
use tonic::{Request, Response, Status};

impl DataPlaneService {
    pub(super) async fn execute_managed_mutation(
        &self,
        request: Request<MutationRequest>,
    ) -> Result<Response<MutationResponse>, Status> {
        let peer = Self::peer_certificate_fingerprint(&request)?;
        let request = request.into_inner();
        if request.statements.is_empty()
            || request.statements.len() > 100
            || request
                .statements
                .iter()
                .map(|statement| statement.sql.len() + statement.parameters_json.len())
                .sum::<usize>()
                > 1_048_576
        {
            return Err(Status::invalid_argument(
                "Mutation batch must contain 1 to 100 statements and at most 1 MiB",
            ));
        }
        let plans = request
            .statements
            .iter()
            .map(|statement| {
                managed_mutation_plan(&statement.sql, &request.database, request.schema.as_deref())
                    .map_err(|error| Status::invalid_argument(error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let action = plans[0].action;
        let target = plans[0].target.clone();
        if plans
            .iter()
            .any(|plan| plan.action != action || plan.target != target)
        {
            return Err(Status::invalid_argument(
                "A mutation batch must target one table with one permission action",
            ));
        }
        let (claims, authorization) = self.authorize(
            &request.access_ticket,
            request.scope.as_ref(),
            action,
            &peer,
        )?;
        let source = self.require_source(authorization.data_source_id)?;
        require_ticket_driver(&claims, source)?;
        require_ticket_target_binding(&claims, source)?;
        if !matches!(source.driver.as_str(), "postgres" | "postgresql")
            || !source
                .capabilities
                .iter()
                .any(|capability| capability == action.as_str())
        {
            return Err(Status::permission_denied(
                "This managed source does not enable PostgreSQL mutations",
            ));
        }
        authorize_postgres_mutation_target(
            &authorization.resource_path,
            &target,
            &claims.allowed_resource_paths,
            &claims.forbidden_resource_paths,
        )?;
        let statements = request
            .statements
            .into_iter()
            .map(|statement| {
                let params: Vec<QueryParameter> =
                    serde_json::from_slice(&statement.parameters_json).map_err(|_| {
                        Status::invalid_argument(
                            "Mutation parameters must be a typed parameter array",
                        )
                    })?;
                if params.len() > 1000 {
                    return Err(Status::invalid_argument("Too many mutation parameters"));
                }
                Ok(ParameterizedStatement {
                    sql: statement.sql,
                    params,
                })
            })
            .collect::<Result<Vec<_>, Status>>()?;
        let driver = self.driver(authorization.data_source_id).await?;
        let database = request.database;
        let schema = target[1].clone();
        let revocations = self.revocations.clone();
        // The worker owns rollback even if the RPC caller disconnects. Never
        // automatically retry a mutation whose commit reply might be lost.
        let worker = tokio::spawn(async move {
            let session = format!("managed-mutation-{}", uuid::Uuid::new_v4());
            driver
                .begin_database_transaction(&session, &database, Some(&schema))
                .await
                .map_err(super::authorization::metadata_error)?;
            let outcome=tokio::time::timeout(Duration::from_secs(20),async {
                let namespace=oxide_studio_lib::core::dialect::DatabaseKind::Postgres.quote_identifier(&schema);
                driver.query_transaction(&session,&format!("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '2s'; SET LOCAL search_path = pg_catalog, {namespace};")).await.map_err(super::authorization::metadata_error)?;
                let qualified=oxide_studio_lib::core::dialect::DatabaseKind::Postgres.qualified_table(Some(&schema),&target[2]);
                driver.query_transaction(&session,"SET LOCAL standard_conforming_strings = on;").await.map_err(super::authorization::metadata_error)?;
                driver.query_transaction(&session,&format!("LOCK TABLE ONLY {qualified} IN SHARE ROW EXCLUSIVE MODE;")).await.map_err(super::authorization::metadata_error)?;
                let literal=qualified.replace('\'',"''");
                let catalog=driver.query_transaction(&session,&format!("SELECT c.relkind='r' AND NOT c.relispartition AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid) FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('{literal}');")).await.map_err(super::authorization::metadata_error)?;
                if catalog.first().and_then(|result|result.rows.first()).and_then(|row|row.first()).and_then(serde_json::Value::as_bool)!=Some(true) {
                    return Err(Status::permission_denied("Managed mutations require an ordinary table without inheritance or partitions"));
                }
                let affected=driver.execute_parameterized_transaction(&session,&statements).await.map_err(super::authorization::metadata_error)?;
                let rows=affected.iter().try_fold(0u64,|sum,count|sum.checked_add(*count)).ok_or_else(||Status::resource_exhausted("Mutation row count overflow"))?;
                if action==AccessAction::DataWrite && rows>u64::from(claims.max_rows) {
                    return Err(Status::resource_exhausted("Mutation exceeds its authorized row limit; rolled back"));
                }
                revocations.authorize_device_certificate(&claims.device_certificate_fingerprint)?;
                revocations.authorize_ticket_nonce(claims.nonce)?;
                let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                if now>=claims.expires_at { return Err(Status::permission_denied("Mutation ticket expired before commit; rolled back")); }
                Ok(affected)
            }).await.unwrap_or_else(|_|Err(Status::deadline_exceeded("Managed mutation timed out; rolled back")));
            match outcome {
                Ok(affected) => {
                    if let Err(error) = driver.commit_transaction(&session).await {
                        let _ = driver.rollback_transaction(&session).await;
                        return Err(super::authorization::metadata_error(error));
                    }
                    Ok(MutationResponse {
                        rows_affected: affected,
                        policy_revision: claims.policy_revision,
                    })
                }
                Err(error) => {
                    let _ = driver.rollback_transaction(&session).await;
                    Err(error)
                }
            }
        });
        worker
            .await
            .map_err(|_| Status::internal("Managed mutation worker failed"))?
            .map(Response::new)
    }
}
