mod acp;
#[cfg(test)]
mod tests;

use crate::ai_cli::{
    runtime::{bounded_diagnostic, resolve_command, run_captured, CliCommandSpec},
    CliCommandInfo, CliConnectionTestResult, CliDetectionResult, CliModelInfo, CliProviderConfig,
    CliProviderKind,
};
use acp::discover_catalog_via_acp;
use anyhow::{anyhow, Result};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, HashMap},
    future::Future,
    hash::{Hash, Hasher},
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const CAPABILITY_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const EFFORT_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
struct CachedCapabilities {
    loaded_at: Instant,
    models: Vec<CliModelInfo>,
    commands: Option<Vec<CliCommandInfo>>,
    current_model: Option<String>,
}

#[derive(Clone)]
struct CachedEfforts {
    loaded_at: Instant,
    efforts: Vec<String>,
}

static CAPABILITY_CACHE: LazyLock<Mutex<HashMap<u64, CachedCapabilities>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CAPABILITY_DISCOVERY_LOCKS: LazyLock<Mutex<HashMap<u64, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static EFFORT_CACHE: LazyLock<Mutex<HashMap<u64, CachedEfforts>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static EFFORT_DISCOVERY_LOCKS: LazyLock<Mutex<HashMap<u64, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
struct AcpCatalog {
    models: Vec<CliModelInfo>,
    current_model: Option<String>,
    efforts: Vec<String>,
    commands: Option<Vec<CliCommandInfo>>,
}

pub async fn detect(
    configured_path: Option<&str>,
    environment: &BTreeMap<String, String>,
) -> CliDetectionResult {
    match resolve_command(CliProviderKind::CodebuddyCli, configured_path).await {
        Ok(command) => match version(&command, environment).await {
            Ok(version) => CliDetectionResult {
                provider: CliProviderKind::CodebuddyCli,
                available: true,
                executable_path: command.resolved_path.clone(),
                version: Some(version),
                message: "CodeBuddy Code CLI is available".to_string(),
            },
            Err(error) => CliDetectionResult {
                provider: CliProviderKind::CodebuddyCli,
                available: false,
                executable_path: command.resolved_path.clone(),
                version: None,
                message: classify_error(&error.to_string()),
            },
        },
        Err(error) => CliDetectionResult {
            provider: CliProviderKind::CodebuddyCli,
            available: false,
            executable_path: None,
            version: None,
            message: classify_error(&error.to_string()),
        },
    }
}

pub async fn list_models(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliModelInfo>> {
    list_models_with_refresh(config, environment, false).await
}

pub async fn list_models_with_refresh(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    force_refresh: bool,
) -> Result<Vec<CliModelInfo>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    Ok(
        get_or_discover_capabilities(&command, environment, force_refresh)
            .await?
            .models,
    )
}

fn provider_identity_key(command: &CliCommandSpec, environment: &BTreeMap<String, String>) -> u64 {
    let mut hasher = DefaultHasher::new();
    command.program.hash(&mut hasher);
    command.prefix_args.hash(&mut hasher);
    environment.hash(&mut hasher);
    hasher.finish()
}

pub async fn list_efforts(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<String>> {
    list_efforts_with_refresh(config, environment, false).await
}

pub async fn list_efforts_with_refresh(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    force_refresh: bool,
) -> Result<Vec<String>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    let model = normalize_model_id(config.model.trim());
    let key = effort_cache_key(&command, environment, &model);
    get_or_discover_efforts_by_key(key, force_refresh, || async {
        Ok(discover_catalog_via_acp(&command, environment, &model)
            .await?
            .efforts)
    })
    .await
}

fn effort_cache_key(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    command.program.hash(&mut hasher);
    command.prefix_args.hash(&mut hasher);
    environment.hash(&mut hasher);
    model.hash(&mut hasher);
    hasher.finish()
}

async fn get_or_discover_efforts_by_key<F, Fut>(
    key: u64,
    force_refresh: bool,
    discover: F,
) -> Result<Vec<String>>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Vec<String>>>,
{
    let force_baseline = if force_refresh {
        EFFORT_CACHE
            .lock()
            .await
            .get(&key)
            .map(|cached| cached.loaded_at)
    } else {
        None
    };
    let now = Instant::now();
    if !force_refresh {
        if let Some(cached) = EFFORT_CACHE.lock().await.get(&key) {
            if now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL {
                return Ok(cached.efforts.clone());
            }
        }
    }

    let discovery_lock = {
        let mut locks = EFFORT_DISCOVERY_LOCKS.lock().await;
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _discovery_guard = discovery_lock.lock().await;

    // A concurrent request for the same executable, environment and model may
    // have finished while this task waited for the model-scoped lock. Forced
    // callers only reuse a value produced after their request started.
    let now = Instant::now();
    if let Some(cached) = EFFORT_CACHE.lock().await.get(&key) {
        if now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL {
            let refreshed_while_waiting = force_refresh
                && force_baseline
                    .map(|baseline| cached.loaded_at != baseline)
                    .unwrap_or(true);
            if !force_refresh || refreshed_while_waiting {
                return Ok(cached.efforts.clone());
            }
        }
    }

    let efforts = discover().await?;
    let mut cache = EFFORT_CACHE.lock().await;
    cache.retain(|_, cached| now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL);
    cache.insert(
        key,
        CachedEfforts {
            loaded_at: now,
            efforts: efforts.clone(),
        },
    );
    Ok(efforts)
}

pub async fn list_commands(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliCommandInfo>> {
    list_commands_with_refresh(config, environment, false).await
}

pub async fn list_commands_with_refresh(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    force_refresh: bool,
) -> Result<Vec<CliCommandInfo>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    get_or_discover_capabilities(&command, environment, force_refresh)
        .await?
        .commands
        .ok_or_else(|| anyhow!("CodeBuddy ACP session did not publish its command catalog"))
}

pub async fn test_connection(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<CliConnectionTestResult> {
    let started = Instant::now();
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    let cli_version = version(&command, environment).await?;
    // Account state, model catalog and session creation are all verified over
    // ACP. Stream-json's apiKeySource is only a service origin and must never
    // be interpreted as proof that a user is signed in.
    let capabilities = get_or_discover_capabilities(&command, environment, false)
        .await
        .map_err(|error| anyhow!(classify_error(&error.to_string())))?;
    let configured = config.model.trim();
    let model = capabilities
        .current_model
        .or_else(|| (!configured.is_empty()).then(|| configured.to_string()))
        .unwrap_or_else(|| "default".to_string());
    Ok(CliConnectionTestResult {
        message: "CodeBuddy Code CLI is ready. Existing sign-in verified.".to_string(),
        model,
        executable_path: command.resolved_path.unwrap_or(command.program),
        version: Some(cli_version),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

async fn version(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<String> {
    let output = run_captured(
        command,
        &["--version".to_string()],
        environment,
        None,
        None,
        VERSION_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(anyhow!(classify_error(&output.stderr)));
    }
    Ok(output
        .stdout
        .lines()
        .chain(output.stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("CodeBuddy Code CLI")
        .chars()
        .take(200)
        .collect())
}

fn normalize_model_id(value: &str) -> String {
    let value = value.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("default")
        || value.eq_ignore_ascii_case("default-model")
    {
        "default".to_string()
    } else {
        value.to_string()
    }
}

fn fresh_cached_capabilities(
    cache: &HashMap<u64, CachedCapabilities>,
    key: u64,
    now: Instant,
) -> Option<CachedCapabilities> {
    cache
        .get(&key)
        .filter(|cached| now.saturating_duration_since(cached.loaded_at) < CAPABILITY_CACHE_TTL)
        .cloned()
}

async fn get_or_discover_capabilities(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    force_refresh: bool,
) -> Result<CachedCapabilities> {
    let key = provider_identity_key(command, environment);
    get_or_discover_capabilities_by_key(key, force_refresh, || async {
        let catalog = discover_catalog_via_acp(command, environment, "").await?;
        if catalog.models.is_empty() {
            return Err(anyhow!("CodeBuddy ACP session returned no usable models"));
        }
        Ok(CachedCapabilities {
            loaded_at: Instant::now(),
            models: catalog.models,
            commands: catalog.commands,
            current_model: catalog.current_model,
        })
    })
    .await
}

async fn get_or_discover_capabilities_by_key<F, Fut>(
    key: u64,
    force_refresh: bool,
    discover: F,
) -> Result<CachedCapabilities>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<CachedCapabilities>>,
{
    let force_baseline = if force_refresh {
        CAPABILITY_CACHE
            .lock()
            .await
            .get(&key)
            .map(|cached| cached.loaded_at)
    } else {
        None
    };
    if !force_refresh {
        if let Some(cached) =
            fresh_cached_capabilities(&*CAPABILITY_CACHE.lock().await, key, Instant::now())
        {
            return Ok(cached);
        }
    }

    let discovery_lock = {
        let mut locks = CAPABILITY_DISCOVERY_LOCKS.lock().await;
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _discovery_guard = discovery_lock.lock().await;

    // A concurrent caller may have completed discovery while this caller was
    // waiting for the identity-scoped lock. Forced callers only reuse a value
    // produced after their request started.
    if let Some(cached) =
        fresh_cached_capabilities(&*CAPABILITY_CACHE.lock().await, key, Instant::now())
    {
        let refreshed_while_waiting = force_refresh
            && force_baseline
                .map(|baseline| cached.loaded_at != baseline)
                .unwrap_or(true);
        if !force_refresh || refreshed_while_waiting {
            return Ok(cached);
        }
    }

    let now = Instant::now();
    let mut cached = discover().await?;
    cached.loaded_at = now;
    let mut cache = CAPABILITY_CACHE.lock().await;
    cache.retain(|_, entry| now.saturating_duration_since(entry.loaded_at) < CAPABILITY_CACHE_TTL);
    cache.insert(key, cached.clone());
    Ok(cached)
}

fn classify_error(value: &str) -> String {
    let diagnostic = bounded_diagnostic(value);
    let lower = diagnostic.to_ascii_lowercase();
    if lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("login required")
        || lower.contains("unauthorized")
    {
        return "CodeBuddy Code is not authenticated. Sign in from the OxideStudio Assistant and try again.".to_string();
    }
    if lower.contains("not installed")
        || lower.contains("not found")
        || lower.contains("no such file")
    {
        return "CodeBuddy Code CLI is not installed or cannot be found. Install it or select its executable path.".to_string();
    }
    if diagnostic.is_empty() {
        "CodeBuddy Code CLI failed without diagnostic output".to_string()
    } else {
        format!("CodeBuddy Code CLI failed: {diagnostic}")
    }
}
