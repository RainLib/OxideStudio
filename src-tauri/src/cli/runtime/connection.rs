use super::{
    connection_url_with_capabilities, dialect_for_driver, ConfigSavedConnection,
    ResolvedConnection, StatementScanDialect, ToolRuntime,
};
use anyhow::{anyhow, Context, Result};
use oxide_studio_lib::{
    core::{
        dialect::{
            canonical_driver_name, database_capabilities_for_driver, DatabaseCapabilities,
            DatabaseConnectionMode,
        },
        driver::DatabaseDriver,
        driver_package::is_safe_driver_package_token,
        ssh::SshTunnel,
    },
    drivers::connect_agent_read_only_preferred_driver,
};
use std::time::Duration;

pub(super) fn driver_identity(driver: &str) -> Result<String> {
    let driver = canonical_driver_name(driver)
        .unwrap_or(driver.trim())
        .to_ascii_lowercase();
    if !is_safe_driver_package_token(&driver) {
        return Err(anyhow!("saved driver identifier is invalid"));
    }
    Ok(driver)
}

pub(super) struct SelectedDriver {
    pub id: String,
    pub capabilities: DatabaseCapabilities,
    pub package_version: Option<String>,
}

impl SelectedDriver {
    pub fn is_file(&self) -> bool {
        self.capabilities.connection_mode == DatabaseConnectionMode::File
    }

    pub fn is_single_database(&self) -> bool {
        !self.capabilities.supports_database_catalogs
            && (self.is_file() || !self.capabilities.supports_connection_database)
    }

    pub fn separate_schema(&self) -> bool {
        matches!(
            self.capabilities.lsp_language_id.as_str(),
            "postgres" | "duckdb"
        ) || self.capabilities.supports_schemas
            && !matches!(
                self.capabilities.lsp_language_id.as_str(),
                "mysql" | "sqlite"
            )
    }

    pub fn query_dialect(&self) -> Result<StatementScanDialect> {
        if !self.capabilities.supports_sql_query {
            return Err(anyhow!(
                "this driver does not provide read-only SQL queries"
            ));
        }
        if self.package_version.is_none() {
            return dialect_for_driver(&self.id);
        }
        match self.capabilities.lsp_language_id.as_str() {
            "postgres" | "sqlite" | "duckdb" => Ok(StatementScanDialect::Postgres),
            "mysql" | "clickhouse" => Ok(StatementScanDialect::Mysql),
            _ => Err(anyhow!(
                "this external package does not declare a reviewed bounded SQL dialect"
            )),
        }
    }
}

impl ToolRuntime {
    pub(super) fn legacy_namespace_is_database(
        &self,
        connection: &super::StoredConnection,
    ) -> bool {
        if connection
            .config
            .get("driverPackageVersion")
            .is_some_and(|value| !value.is_null())
            || database_capabilities_for_driver(&connection.driver).is_err()
        {
            return false;
        }
        let Ok(id) = driver_identity(&connection.driver) else {
            return false;
        };
        id != "postgres"
            && self.driver_packages.as_ref().is_ok_and(|registry| {
                registry
                    .resolve_preferred(&id, None)
                    .is_ok_and(|package| package.is_none())
            })
    }

    pub(super) fn select_driver(&self, connection: &ResolvedConnection) -> Result<SelectedDriver> {
        let id = driver_identity(&connection.stored.driver)?;
        let registry = self
            .driver_packages
            .as_ref()
            .map_err(|error| anyhow!("Cannot resolve driver store: {error}"))?;
        let package = registry
            .resolve_preferred(&id, connection.config.driver_package_version.as_deref())
            .map_err(anyhow::Error::msg)?;
        let capabilities = match package
            .as_ref()
            .and_then(|package| package.manifest.capabilities.clone())
        {
            Some(capabilities) => capabilities,
            None => database_capabilities_for_driver(&id)?,
        };
        Ok(SelectedDriver {
            id,
            capabilities,
            package_version: package.map(|package| package.manifest.package_version),
        })
    }

    pub(super) async fn connect_read_only(
        &self,
        connection: &ResolvedConnection,
        selected: &SelectedDriver,
    ) -> Result<(Box<dyn DatabaseDriver>, Option<SshTunnel>)> {
        let config: ConfigSavedConnection = self.runtime_connection_config(connection).await?;
        let url = connection_url_with_capabilities(
            &selected.id,
            &config,
            &selected.capabilities,
            selected.package_version.is_some(),
        )?;
        let (url, tunnel) = SshTunnel::prepare(&selected.id, &url, config.ssh_tunnel.as_ref())
            .await
            .context("failed to prepare the saved connection")?;
        let registry = self
            .driver_packages
            .as_ref()
            .map_err(|error| anyhow!(error.clone()))?;
        let connected = connect_agent_read_only_preferred_driver(
            registry,
            &selected.id,
            &url,
            connection.stored.id.clone(),
            selected.package_version.as_deref(),
        )
        .await;
        let driver = match connected {
            Ok(driver) => driver,
            Err(error) => {
                if let Some(tunnel) = tunnel {
                    tunnel.shutdown().await;
                }
                return Err(error).context("failed to connect to the saved database");
            }
        };
        let result = async {
            if selected.package_version.is_some()
                && driver
                    .package_capabilities()
                    .is_some_and(|caps| caps != selected.capabilities)
            {
                return Err(anyhow!(
                    "selected driver capabilities changed; repeat the tool request"
                ));
            }
            driver.ping().await
        }
        .await;
        if let Err(error) = result {
            let _ = tokio::time::timeout(Duration::from_secs(5), driver.disconnect()).await;
            if let Some(tunnel) = tunnel {
                tunnel.shutdown().await;
            }
            return Err(error).context("saved database connection is unavailable");
        }
        Ok((driver, tunnel))
    }
}
