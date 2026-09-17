use super::{
    BTreeMap, CliProviderConfig, DeserializeOwned, Future, MetaStore, Serialize, SystemTime,
    UNIX_EPOCH,
};

pub(super) const CLI_CAPABILITY_CACHE_SCHEMA_VERSION: &str = "1";
pub(super) const CLI_CAPABILITY_CACHE_NAMESPACE: &str = "cli-capability-catalog-v1";
// CLI providers can add, rename, or retire models independently of an
// OxideStudio release. Keep the cross-restart snapshot short-lived; the
// renderer immediately uses it and then verifies it in the background.
pub(super) const CLI_CAPABILITY_CACHE_TTL_MS: i64 = 5 * 60 * 1000;
pub(super) fn cli_capability_cache_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn cli_capability_cache_key(
    meta_store: &MetaStore,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    resource_kind: &str,
    runtime_version: Option<&str>,
) -> anyhow::Result<String> {
    let mut configured_environment_keys = config
        .environment_keys
        .iter()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    configured_environment_keys.sort_unstable();
    configured_environment_keys.dedup();

    let profile_id = config.profile_id.trim();
    let executable_path = config
        .executable_path
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    let runtime_version = runtime_version.map(str::trim).unwrap_or_default();
    let selected_model = if resource_kind == "efforts" {
        config.model.trim()
    } else {
        ""
    };
    let mut components = vec![
        ("schemaVersion", CLI_CAPABILITY_CACHE_SCHEMA_VERSION),
        ("resourceKind", resource_kind),
        ("provider", config.kind.as_str()),
        ("profileId", profile_id),
        ("executablePath", executable_path),
        ("runtimeVersion", runtime_version),
        ("selectedModel", selected_model),
    ];
    for key in configured_environment_keys {
        components.push(("configuredEnvironmentKey", key));
    }
    // BTreeMap iteration is deterministic. Values are authenticated directly
    // into the HMAC and never serialized, persisted or logged.
    for (key, value) in environment {
        components.push(("environmentName", key.as_str()));
        components.push(("environmentValue", value.as_str()));
    }
    meta_store.opaque_cache_key(CLI_CAPABILITY_CACHE_NAMESPACE, components)
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn load_cached_cli_capability<T, F, Fut>(
    meta_store: &MetaStore,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    resource_kind: &'static str,
    runtime_version: Option<&str>,
    force_refresh: bool,
    now_ms: i64,
    discover: F,
) -> anyhow::Result<Vec<T>>
where
    T: DeserializeOwned + Serialize,
    F: FnOnce() -> Fut,
    Fut: Future<Output = anyhow::Result<Vec<T>>>,
{
    let cache_key = match cli_capability_cache_key(
        meta_store,
        config,
        environment,
        resource_kind,
        runtime_version,
    ) {
        Ok(cache_key) => Some(cache_key),
        Err(error) => {
            tracing::warn!(
                resource_kind,
                error = %error,
                "CLI capability cache key derivation failed; using live discovery"
            );
            None
        }
    };

    if !force_refresh {
        if let Some(cache_key) = cache_key.as_deref() {
            match meta_store
                .get_cli_capability_cache(cache_key, resource_kind, now_ms)
                .await
            {
                Ok(Some(payload)) => match serde_json::from_value(payload) {
                    Ok(values) => return Ok(values),
                    Err(error) => tracing::warn!(
                        resource_kind,
                        error = %error,
                        "Ignoring incompatible CLI capability cache payload"
                    ),
                },
                Ok(None) => {}
                Err(error) => tracing::warn!(
                    resource_kind,
                    error = %error,
                    "CLI capability cache read failed; using live discovery"
                ),
            }
        }
    }

    let values = discover().await?;
    if let Some(cache_key) = cache_key.as_deref() {
        match serde_json::to_value(&values) {
            Ok(payload) => {
                if let Err(error) = meta_store
                    .save_cli_capability_cache(
                        cache_key,
                        resource_kind,
                        &payload,
                        now_ms.saturating_add(CLI_CAPABILITY_CACHE_TTL_MS),
                    )
                    .await
                {
                    tracing::warn!(
                        resource_kind,
                        error = %error,
                        "CLI capability cache write failed"
                    );
                }
            }
            Err(error) => tracing::warn!(
                resource_kind,
                error = %error,
                "CLI capability result could not be cached"
            ),
        }
    }
    Ok(values)
}
