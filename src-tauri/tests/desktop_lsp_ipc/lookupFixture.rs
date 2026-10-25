//! Driver-boundary metadata fixture; not a SQL Server engine.
use anyhow::{ensure, Result};
use oxide_driver_protocol::SqlLookupContext;
use oxide_studio_lib::core::{
    driver::DatabaseDriver,
    protocol::{ColumnInfo, QueryResult, TableInfo},
};

pub(super) struct LookupFixture;
#[async_trait::async_trait]
impl DatabaseDriver for LookupFixture {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }
    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }
    async fn ping(&self) -> Result<()> {
        Ok(())
    }
    async fn query(&self, _: &str) -> Result<Vec<QueryResult>> {
        anyhow::bail!("metadata fixture never executes SQL")
    }
    async fn sql_lookup_context(&self, database: Option<&str>) -> Result<Option<SqlLookupContext>> {
        ensure!(
            database.is_none_or(|name| name == "db"),
            "wrong database in lookup fixture"
        );
        Ok(Some(SqlLookupContext {
            database: "db".into(),
            default_schema: "sales".into(),
        }))
    }
    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        ensure!(
            database == "db" && matches!(schema, "selected" | "sales"),
            "wrong metadata scope"
        );
        Ok(vec![TableInfo {
            name: "ledger".into(),
            schema: Some(schema.into()),
            table_type: Some("BASE TABLE".into()),
            comment: None,
        }])
    }
    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        ensure!(
            database == "db" && table == "ledger" && matches!(schema, "selected" | "sales"),
            "wrong column metadata scope"
        );
        Ok(vec![ColumnInfo {
            name: if schema == "sales" {
                "sales_value"
            } else {
                "selected_value"
            }
            .into(),
            data_type: if schema == "sales" { "bigint" } else { "int" }.into(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            is_auto_increment: false,
            identity_generation: None,
            is_generated: Some(false),
            is_hidden: Some(false),
            character_set: None,
            collation: None,
            default_value: None,
            comment: Some("driver fixture metadata".into()),
        }])
    }
}
