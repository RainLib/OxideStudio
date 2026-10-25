//! Construct saved connection URLs without opening a connection or changing configuration.
use crate::core::{
    config::SavedConnection as ConfigSavedConnection, dialect::DatabaseCapabilities,
};
use anyhow::{anyhow, Context, Result};

pub fn connection_url_with_capabilities(
    driver: &str,
    config: &ConfigSavedConnection,
    capabilities: &DatabaseCapabilities,
    external: bool,
) -> Result<String> {
    if let Some(value) = config
        .connection_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let value = config.url.trim();
            (!value.is_empty()).then_some(value)
        })
    {
        let value = if external {
            value
        } else {
            value.strip_prefix("jdbc:").unwrap_or(value)
        };
        if external
            || capabilities.connection_mode == crate::core::dialect::DatabaseConnectionMode::File
        {
            return Ok(value.to_string());
        }
        let parsed = url::Url::parse(value).context("saved connection URL is invalid")?;
        if parsed.host_str().is_none() && parsed.scheme() != "redis" {
            return Err(anyhow!("saved connection URL must include a host"));
        }
        return Ok(value.to_string());
    }

    if capabilities.connection_mode == crate::core::dialect::DatabaseConnectionMode::File {
        return config
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                config
                    .host
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .map(str::to_string)
            .ok_or_else(|| anyhow!("saved file database is required"));
    }
    let host = config
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("saved connection host is required"))?;
    let supplied_ssl = config
        .ssl_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let disabled_ssl = supplied_ssl.is_some_and(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "disable" | "disabled" | "false" | "0"
        )
    });
    let ssl_enabled = supplied_ssl.is_some() && !disabled_ssl;
    let scheme = match capabilities.driver.as_str() {
        "postgres" => "postgres",
        "mysql" => "mysql",
        "mongodb" => "mongodb",
        "redis" => {
            if ssl_enabled {
                "rediss"
            } else {
                "redis"
            }
        }
        "clickhouse" | "rqlite" | "elasticsearch" | "meilisearch" | "etcd" | "consul" | "nacos"
        | "influxdb" | "influxdb3" | "victoriametrics" => {
            if ssl_enabled {
                "https"
            } else {
                "http"
            }
        }
        _ => {
            return Err(anyhow!(
                "headless access requires a saved connection URL for driver {driver}"
            ))
        }
    };
    let mut connection_url = url::Url::parse(&format!("{scheme}://{host}"))
        .context("failed to construct saved connection URL")?;
    connection_url
        .set_port(Some(config.port.unwrap_or(capabilities.default_port)))
        .map_err(|_| anyhow!("saved connection port is invalid"))?;
    if let Some(user) = config.user.as_deref().filter(|value| !value.is_empty()) {
        connection_url
            .set_username(user)
            .map_err(|_| anyhow!("saved connection username is invalid"))?;
    }
    if let Some(password) = config.password.as_deref().filter(|value| !value.is_empty()) {
        connection_url
            .set_password(Some(password))
            .map_err(|_| anyhow!("saved connection password is invalid"))?;
    }
    if let Some(database) = config
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| capabilities.supports_connection_database && !value.is_empty())
    {
        connection_url
            .path_segments_mut()
            .map_err(|_| anyhow!("saved connection database path is invalid"))?
            .clear()
            .push(database);
    }
    if let Some(ssl_mode) = supplied_ssl {
        match capabilities.driver.as_str() {
            "postgres" => {
                connection_url
                    .query_pairs_mut()
                    .append_pair("sslmode", if disabled_ssl { "disable" } else { ssl_mode });
            }
            "mysql" => {
                connection_url
                    .query_pairs_mut()
                    .append_pair("ssl-mode", if disabled_ssl { "disabled" } else { ssl_mode });
            }
            "mongodb" => {
                if ssl_enabled {
                    connection_url.query_pairs_mut().append_pair("tls", "true");
                }
            }
            _ => {}
        }
    }
    Ok(connection_url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::dialect::database_capabilities_for_driver;
    use sqlx::{
        mysql::{MySqlConnectOptions, MySqlSslMode},
        postgres::{PgConnectOptions, PgSslMode},
    };
    use std::str::FromStr;
    #[test]
    fn native_sql_driver_options_honor_explicit_transport_disable() -> Result<()> {
        for setting in ["disable", "disabled", "false", "0"] {
            for driver in ["postgres", "mysql"] {
                let config: ConfigSavedConnection = serde_json::from_value(
                    serde_json::json!({"id":"fixture","projectId":"p","name":"fixture","driver":driver,"url":"","host":"127.0.0.1","sslMode":setting}),
                )?;
                let value = connection_url_with_capabilities(
                    driver,
                    &config,
                    &database_capabilities_for_driver(driver)?,
                    false,
                )?;
                if driver == "postgres" {
                    assert!(matches!(
                        PgConnectOptions::from_str(&value)?.get_ssl_mode(),
                        PgSslMode::Disable
                    ));
                } else {
                    assert!(matches!(
                        MySqlConnectOptions::from_str(&value)?.get_ssl_mode(),
                        MySqlSslMode::Disabled
                    ));
                }
            }
        }
        Ok(())
    }
}
