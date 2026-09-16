use super::approved_query_review::resolve_prompt_connection;
use super::connection_config::{
    connection_url_from_config, validate_connection_config, validate_stored_connection,
};
use super::connection_types::{ConnectedAgentTarget, ResolvedAgentConnection};
use super::host_errors::SidecarRequestError;
use super::identity_helpers::{bounded_text, input_digest};
use super::session_state::AgentHostInner;
use super::turn_state::ActiveTurn;
use crate::core::config::SavedConnection as ConfigSavedConnection;
use crate::core::dialect::all_database_capabilities;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::database_capabilities_for_driver;
use crate::core::dialect::DatabaseCapabilities;
use crate::core::driver::DatabaseDriver;
use crate::core::driver_package::is_safe_driver_package_token;
use crate::core::driver_package::DatabaseDriverPackageRegistry;
use crate::core::driver_package::DriverPackageStatus;
use crate::core::sqlite_worker_artifact::SqliteWorkerArtifactRegistry;
use crate::core::ssh::SshTunnel;
use crate::core::store::MetaStore;
use crate::drivers::connect_agent_read_only_preferred_driver;
use crate::drivers::connect_preferred_driver;
use crate::drivers::sqlite_ssh::RemoteSqliteDriver;
use anyhow::anyhow;
use serde_json::json;
use serde_json::Value;
use tauri::Manager;

impl AgentHostInner {
    pub(super) async fn resolve_connection(
        &self,
        turn: &ActiveTurn,
        input: &Value,
    ) -> std::result::Result<ResolvedAgentConnection, SidecarRequestError> {
        let store = self
            .app
            .try_state::<MetaStore>()
            .ok_or_else(|| SidecarRequestError::tool("connection metadata store is unavailable"))?;
        let project_exists = store
            .get_project(&turn.project_id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?
            .is_some();
        if !project_exists {
            return Err(SidecarRequestError::security(anyhow!(
                "active agent project no longer exists"
            )));
        }
        let connections = store
            .get_connections(&turn.project_id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        if connections.is_empty() {
            return Err(SidecarRequestError {
                code: -32_063,
                message: "no saved database connection is available in this project".to_string(),
                data: Some(json!({
                    "kind":"connection_required",
                    "recoverable":true,
                    "projectId":turn.project_id,
                })),
            });
        }

        // Stable priority: explicit tool input, a unique connection named or
        // typed in the user's prompt, active tab/workspace context, then the
        // only project-scoped candidate. Remaining ambiguity is returned as
        // structured data so the sidecar can ask inline and retry safely.
        let explicit_id = input
            .get("connectionId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let tab_id = turn
            .tab_connection_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let context_id = turn
            .connection_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let prompt_connection = resolve_prompt_connection(&connections, &turn.prompt);
        let selected = if let Some(id) = explicit_id {
            connections.iter().find(|connection| connection.id == id)
        } else if let Some(connection) = prompt_connection {
            Some(connection)
        } else if let Some(id) = tab_id {
            connections.iter().find(|connection| connection.id == id)
        } else if let Some(id) = context_id {
            connections.iter().find(|connection| connection.id == id)
        } else if connections.len() == 1 {
            connections.first()
        } else {
            None
        };
        let Some(selected) = selected else {
            if explicit_id.is_some() || tab_id.is_some() || context_id.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "requested connection is not part of the active project"
                )));
            }
            return Err(SidecarRequestError {
                code: -32_064,
                message:
                    "multiple database connections are available; ask the user which one to use"
                        .to_string(),
                data: Some(json!({
                    "kind":"connection_selection_required",
                    "recoverable":true,
                    "candidates":connections.iter().map(|connection| json!({
                        "id":connection.id,
                        "name":connection.name,
                        "driver":connection.driver,
                    })).collect::<Vec<_>>(),
                })),
            });
        };
        validate_stored_connection(&turn.project_id, selected)?;
        let config: ConfigSavedConnection = serde_json::from_value(selected.config.clone())
            .map_err(|_| {
                SidecarRequestError::security(anyhow!("saved connection configuration is invalid"))
            })?;
        validate_connection_config(&turn.project_id, selected, &config)?;
        let (capabilities, sidecar_read_only_enforced) = self.resolve_agent_driver_contract(
            &selected.driver,
            config.driver_package_version.as_deref(),
        )?;
        let configured_database = config
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let database = turn
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or({
                if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::Network
                ) && capabilities.supports_database_catalogs
                {
                    configured_database.map(ToString::to_string)
                } else {
                    None
                }
            });
        let namespace = input
            .get("namespace")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                turn.tab_namespace
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .or_else(|| {
                turn.namespace
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .or(database.as_deref())
            .or({
                if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::Network
                ) {
                    configured_database
                } else {
                    None
                }
            })
            .unwrap_or_else(|| {
                if capabilities.driver == "postgres" {
                    "public"
                } else if capabilities.driver == "redis" {
                    "0"
                } else if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::File
                ) {
                    "main"
                } else {
                    ""
                }
            })
            .to_string();
        let config_digest = input_digest(&json!({
            "projectId": selected.project_id,
            "id": selected.id,
            "driver": selected.driver,
            "config": selected.config,
            "updatedAt": selected.updated_at,
        }));
        Ok(ResolvedAgentConnection {
            id: selected.id.clone(),
            driver: selected.driver.clone(),
            capabilities,
            sidecar_read_only_enforced,
            config,
            config_digest,
            database,
            namespace,
        })
    }

    /// Resolve the same signed driver contract used by the normal connection
    /// path. New sidecar-only database families are not present in the static
    /// dialect table, so Agent tooling must never use that table as its only
    /// capability source.
    pub(super) fn resolve_agent_driver_contract(
        &self,
        driver: &str,
        package_version: Option<&str>,
    ) -> std::result::Result<(DatabaseCapabilities, bool), SidecarRequestError> {
        let requested = driver.trim();
        let normalized = requested.to_ascii_lowercase();
        let canonical = canonical_driver_name(requested).unwrap_or(normalized.as_str());
        if !is_safe_driver_package_token(canonical) {
            return Err(SidecarRequestError::security(anyhow!(
                "saved connection driver is invalid"
            )));
        }
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let has_active_package = registry.list_installed().into_iter().any(|package| {
            package.active && package.manifest.driver_id.eq_ignore_ascii_case(canonical)
        });
        if package_version
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
            || has_active_package
        {
            let package = match package_version
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(version) => registry.resolve_version(canonical, version),
                None => registry.resolve_active(canonical),
            }
            .map_err(SidecarRequestError::tool)?;
            return package
                .manifest
                .capabilities
                .map(|capabilities| (capabilities, true))
                .ok_or_else(|| {
                    SidecarRequestError::tool(
                        "external driver package does not declare Agent-safe database capabilities",
                    )
                });
        }
        database_capabilities_for_driver(canonical)
            .map(|capabilities| (capabilities, false))
            .map_err(|error| SidecarRequestError::tool(error.to_string()))
    }

    /// Advertise installed external families to the Agent alongside bundled
    /// drivers. Only a ready, active, capability-declaring package may replace
    /// a bundled profile; invalid or inactive packages stay invisible here.
    pub(super) fn agent_provider_capabilities(&self) -> Vec<DatabaseCapabilities> {
        let mut capabilities = all_database_capabilities();
        let Some(registry) = self.app.try_state::<DatabaseDriverPackageRegistry>() else {
            return capabilities;
        };
        for package in registry.list_installed().into_iter().filter(|package| {
            package.active
                && package.status == DriverPackageStatus::Ready
                && package.manifest.capabilities.is_some()
        }) {
            let Some(package_capabilities) = package.manifest.capabilities else {
                continue;
            };
            if let Some(index) = capabilities.iter().position(|current| {
                current
                    .driver
                    .eq_ignore_ascii_case(&package_capabilities.driver)
            }) {
                capabilities[index] = package_capabilities;
            } else {
                capabilities.push(package_capabilities);
            }
        }
        capabilities.sort_by(|left, right| {
            left.display_name
                .to_ascii_lowercase()
                .cmp(&right.display_name.to_ascii_lowercase())
        });
        capabilities
    }

    pub(super) async fn ensure_agent_connection(
        &self,
        project_id: &str,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let is_current = self
            .connected_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.agent_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let _guard = self.connection_lock.lock().await;
        let is_current = self
            .connected_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.agent_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let url = connection_url_from_config(&target.capabilities, &target.config)
            .map_err(SidecarRequestError::security)?;
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let remote_sqlite = canonical_driver_name(&target.driver)
            .is_some_and(|driver| driver.eq_ignore_ascii_case("sqlite"))
            && target
                .config
                .ssh_tunnel
                .as_ref()
                .is_some_and(|ssh| ssh.enabled && ssh.remote_sqlite.is_some());
        let (driver, tunnel): (Box<dyn DatabaseDriver>, Option<SshTunnel>) = if remote_sqlite {
            if target.config.driver_package_version.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "remote SQLite cannot use an external driver package"
                )));
            }
            let worker_registry = self
                .app
                .try_state::<SqliteWorkerArtifactRegistry>()
                .ok_or_else(|| {
                    SidecarRequestError::tool("SQLite worker registry is unavailable")
                })?;
            let ssh = target.config.ssh_tunnel.as_ref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!("remote SQLite SSH settings are unavailable"))
            })?;
            let driver = RemoteSqliteDriver::open(&worker_registry, &target.id, &url, ssh, true)
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (Box::new(driver), None)
        } else {
            let (connection_url, tunnel) =
                SshTunnel::prepare(&target.driver, &url, target.config.ssh_tunnel.as_ref())
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let driver = connect_agent_read_only_preferred_driver(
                &registry,
                &target.driver,
                &connection_url,
                target.id.clone(),
                target.config.driver_package_version.as_deref(),
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (driver, tunnel)
        };
        if let Err(error) = driver.ping().await {
            let _ = driver.disconnect().await;
            if let Some(tunnel) = tunnel {
                tunnel.shutdown().await;
            }
            return Err(SidecarRequestError::tool(format!(
                "database connection test failed: {error}"
            )));
        }
        self.agent_connections
            .replace_connection_with_tunnel(target.id.clone(), driver, tunnel)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        self.connected_targets.write().await.insert(
            target.id.clone(),
            ConnectedAgentTarget {
                project_id: project_id.to_string(),
                config_digest: target.config_digest.clone(),
            },
        );
        Ok(())
    }

    pub(super) async fn ensure_mutation_connection(
        &self,
        project_id: &str,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        self.ensure_trusted_mutation_adapter(target)?;
        let is_current = self
            .connected_mutation_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.mutation_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let _guard = self.mutation_connection_lock.lock().await;
        let is_current = self
            .connected_mutation_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.mutation_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let url = connection_url_from_config(&target.capabilities, &target.config)
            .map_err(SidecarRequestError::security)?;
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let remote_sqlite = canonical_driver_name(&target.driver)
            .is_some_and(|driver| driver.eq_ignore_ascii_case("sqlite"))
            && target
                .config
                .ssh_tunnel
                .as_ref()
                .is_some_and(|ssh| ssh.enabled && ssh.remote_sqlite.is_some());
        let (driver, tunnel): (Box<dyn DatabaseDriver>, Option<SshTunnel>) = if remote_sqlite {
            if target.config.driver_package_version.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "remote SQLite cannot use an external driver package"
                )));
            }
            let worker_registry = self
                .app
                .try_state::<SqliteWorkerArtifactRegistry>()
                .ok_or_else(|| {
                    SidecarRequestError::tool("SQLite worker registry is unavailable")
                })?;
            let ssh = target.config.ssh_tunnel.as_ref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!("remote SQLite SSH settings are unavailable"))
            })?;
            let driver = RemoteSqliteDriver::open(
                &worker_registry,
                &format!("agent-mutation-{}", target.id),
                &url,
                ssh,
                false,
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (Box::new(driver), None)
        } else {
            let (connection_url, tunnel) =
                SshTunnel::prepare(&target.driver, &url, target.config.ssh_tunnel.as_ref())
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let driver = connect_preferred_driver(
                &registry,
                &target.driver,
                &connection_url,
                format!("agent-mutation-{}", target.id),
                target.config.driver_package_version.as_deref(),
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (driver, tunnel)
        };
        if let Err(error) = driver.ping().await {
            let _ = driver.disconnect().await;
            if let Some(tunnel) = tunnel {
                tunnel.shutdown().await;
            }
            return Err(SidecarRequestError::tool(format!(
                "database mutation connection test failed: {error}"
            )));
        }
        self.mutation_connections
            .replace_connection_with_tunnel(target.id.clone(), driver, tunnel)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        self.connected_mutation_targets.write().await.insert(
            target.id.clone(),
            ConnectedAgentTarget {
                project_id: project_id.to_string(),
                config_digest: target.config_digest.clone(),
            },
        );
        Ok(())
    }

    pub(super) fn ensure_trusted_mutation_adapter(
        &self,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let requested = target.driver.trim();
        let normalized = requested.to_ascii_lowercase();
        let canonical = canonical_driver_name(requested).unwrap_or(normalized.as_str());
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let external_selected = target
            .config
            .driver_package_version
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || registry.list_installed().into_iter().any(|package| {
                package.active && package.manifest.driver_id.eq_ignore_ascii_case(canonical)
            });
        if external_selected
            || !matches!(
                canonical,
                "postgres" | "mysql" | "sqlite" | "mongodb" | "redis" | "elasticsearch"
            )
        {
            return Err(SidecarRequestError {
                code: -32_068,
                message: "This driver does not expose a reviewed Agent mutation adapter; generate a script for manual execution instead".to_string(),
                data: Some(json!({
                    "kind":"agent_mutation_unsupported",
                    "recoverable":false,
                    "driver":bounded_text(canonical, 80),
                })),
            });
        }
        Ok(())
    }
}
