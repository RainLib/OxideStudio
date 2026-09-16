use super::host_errors::SidecarRequestError;
use crate::core::config::SavedConnection as ConfigSavedConnection;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::DatabaseCapabilities;
use crate::core::driver_package::is_safe_driver_package_token;
use crate::core::store::SavedConnection as StoreSavedConnection;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;

pub(super) fn validate_stored_connection(
    project_id: &str,
    connection: &StoreSavedConnection,
) -> std::result::Result<(), SidecarRequestError> {
    if connection.project_id != project_id {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection project scope is invalid"
        )));
    }
    if connection.id.trim().is_empty() || connection.id.chars().count() > 240 {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection id is invalid"
        )));
    }
    if !is_safe_driver_package_token(connection.driver.trim()) {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection driver is invalid"
        )));
    }
    Ok(())
}

pub(super) fn validate_connection_config(
    project_id: &str,
    stored: &StoreSavedConnection,
    config: &ConfigSavedConnection,
) -> std::result::Result<(), SidecarRequestError> {
    if config.project_id != project_id || config.id != stored.id {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection configuration does not match its project identity"
        )));
    }
    let stored_driver = canonical_driver_name(&stored.driver)
        .unwrap_or(stored.driver.trim())
        .to_ascii_lowercase();
    let configured_driver = canonical_driver_name(&config.driver)
        .unwrap_or(config.driver.trim())
        .to_ascii_lowercase();
    if !is_safe_driver_package_token(&stored_driver)
        || !is_safe_driver_package_token(&configured_driver)
        || stored_driver != configured_driver
    {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection driver does not match its configuration"
        )));
    }
    Ok(())
}

pub(super) fn connection_url_from_config(
    capabilities: &DatabaseCapabilities,
    config: &ConfigSavedConnection,
) -> Result<String> {
    let is_file_connection = matches!(
        capabilities.connection_mode,
        crate::core::dialect::DatabaseConnectionMode::File
    );
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
        let value = value.strip_prefix("jdbc:").unwrap_or(value);
        // File-backed packages (SQLite and signed external implementations
        // such as DuckDB) receive the raw location rather than a network URL.
        if is_file_connection {
            return Ok(value.to_string());
        }
        let parsed = url::Url::parse(value).context("saved connection URL is invalid")?;
        if parsed.host_str().is_none() && parsed.scheme() != "redis" {
            return Err(anyhow!("saved connection URL must include a host"));
        }
        return apply_saved_elasticsearch_options(capabilities, value, config);
    }

    if is_file_connection {
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
            .ok_or_else(|| anyhow!("saved SQLite database file is required"));
    }
    let host = config
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("saved connection host is required"))?;
    let ssl_enabled = config
        .ssl_mode
        .as_deref()
        .is_some_and(|value| !value.eq_ignore_ascii_case("disable"));
    let scheme = match capabilities.driver.as_str() {
        "postgres" => "postgres",
        "mysql" => "mysql",
        "mongodb" => "mongodb",
        "redis" => "redis",
        "elasticsearch" if ssl_enabled => "https",
        "elasticsearch" => "http",
        _ => return Err(anyhow!("unsupported saved connection driver")),
    };
    let mut url = url::Url::parse(&format!("{scheme}://{host}"))
        .context("failed to construct saved connection URL")?;
    url.set_port(Some(config.port.unwrap_or(capabilities.default_port)))
        .map_err(|_| anyhow!("saved connection port is invalid"))?;
    if let Some(user) = config.user.as_deref().filter(|value| !value.is_empty()) {
        url.set_username(user)
            .map_err(|_| anyhow!("saved connection username is invalid"))?;
    }
    if let Some(password) = config.password.as_deref().filter(|value| !value.is_empty()) {
        url.set_password(Some(password))
            .map_err(|_| anyhow!("saved connection password is invalid"))?;
    }
    if let Some(database) = config
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        url.set_path(database);
    }
    if let Some(ssl_mode) = config
        .ssl_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("disable"))
    {
        let parameter = match capabilities.driver.as_str() {
            "postgres" => "sslmode",
            "mysql" => "ssl-mode",
            "mongodb" | "redis" => "tls",
            "elasticsearch" => "ssl",
            _ => "sslmode",
        };
        url.query_pairs_mut().append_pair(parameter, ssl_mode);
    }
    apply_saved_elasticsearch_options(capabilities, url.as_str(), config)
}

pub(super) fn apply_saved_elasticsearch_options(
    capabilities: &DatabaseCapabilities,
    value: &str,
    config: &ConfigSavedConnection,
) -> Result<String> {
    if capabilities.driver != "elasticsearch" {
        return Ok(value.to_string());
    }
    let mut url = url::Url::parse(value).context("saved Elasticsearch URL is invalid")?;
    const INTERNAL_KEYS: &[&str] = &[
        "mode",
        "kibanaBasePath",
        "connectivityCheckPath",
        "connectivityCheckDisabled",
        "indexGroupingPattern",
    ];
    let retained = url
        .query_pairs()
        .filter(|(key, _)| {
            !INTERNAL_KEYS
                .iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate))
        })
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    url.query_pairs_mut().extend_pairs(retained);

    if config
        .elasticsearch_mode
        .as_deref()
        .is_some_and(|mode| mode.eq_ignore_ascii_case("kibana"))
    {
        url.query_pairs_mut().append_pair("mode", "kibana");
        if let Some(base_path) = config
            .elasticsearch_kibana_base_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            let normalized = format!("/{}", base_path.trim_matches('/'));
            url.query_pairs_mut()
                .append_pair("kibanaBasePath", &normalized);
        }
    }
    if let Some(check_path) = config
        .elasticsearch_connectivity_check_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty() && *path != "/")
    {
        let first_line = check_path.lines().next().unwrap_or("").trim();
        let path = first_line
            .strip_prefix("GET ")
            .or_else(|| first_line.strip_prefix("get "))
            .or_else(|| first_line.strip_prefix("Get "))
            .unwrap_or(first_line)
            .trim();
        if !path.is_empty() && path != "/" {
            let normalized = format!("/{}", path.trim_start_matches('/'));
            url.query_pairs_mut()
                .append_pair("connectivityCheckPath", &normalized);
        }
    }
    if config.elasticsearch_connectivity_check_disabled {
        url.query_pairs_mut()
            .append_pair("connectivityCheckDisabled", "true");
    }
    if let Some(pattern) = config
        .index_grouping_pattern
        .as_deref()
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
    {
        url.query_pairs_mut()
            .append_pair("indexGroupingPattern", pattern);
    }
    Ok(url.to_string())
}
