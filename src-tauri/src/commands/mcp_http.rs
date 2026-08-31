use crate::core::private_file::replace_private_file;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
};

const SETTINGS_FILE_NAME: &str = "mcp-http-settings.json";
const TOKEN_FILE_NAME: &str = "mcp-http-token";
const MAX_LOG_LINES: usize = 100;
const PUBLIC_TOOL_NAMES: &[&str] = &[
    "connection.listSummaries",
    "metadata.listObjects",
    "query.runReadOnly",
    "query.explainEstimate",
    "lsp.sqlContext",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct McpHttpServerSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub allow_remote: bool,
    pub allowed_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub project_id: String,
    pub connection_id: Option<String>,
    pub databases: Vec<String>,
    pub tools: Vec<String>,
    pub max_rows: usize,
    pub max_result_bytes: usize,
    pub query_timeout_secs: Option<u64>,
}

impl Default for McpHttpServerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".to_string(),
            port: 43_521,
            path: "/mcp".to_string(),
            allow_remote: false,
            allowed_hosts: Vec::new(),
            allowed_origins: Vec::new(),
            project_id: String::new(),
            connection_id: None,
            databases: Vec::new(),
            tools: PUBLIC_TOOL_NAMES
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
            max_rows: 200,
            max_result_bytes: 256 * 1024,
            query_timeout_secs: Some(30),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpServerStatus {
    pub enabled: bool,
    pub running: bool,
    pub endpoint: Option<String>,
    pub access_token: Option<String>,
    pub last_error: Option<String>,
    pub recent_logs: Vec<String>,
}

struct RunningServer {
    settings: McpHttpServerSettings,
    child: Child,
    stderr_task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
struct Diagnostics {
    last_error: Option<String>,
    logs: VecDeque<String>,
}

pub struct McpHttpServerState {
    app: AppHandle,
    data_dir: PathBuf,
    operation_lock: tokio::sync::Mutex<()>,
    server: Mutex<Option<RunningServer>>,
    diagnostics: Arc<Mutex<Diagnostics>>,
    supervisor_started: AtomicBool,
}

impl McpHttpServerState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve application data directory: {error}"))?;
        Ok(Self {
            app: app.clone(),
            data_dir,
            operation_lock: tokio::sync::Mutex::new(()),
            server: Mutex::new(None),
            diagnostics: Arc::new(Mutex::new(Diagnostics::default())),
            supervisor_started: AtomicBool::new(false),
        })
    }

    fn settings_path(&self) -> PathBuf {
        self.data_dir.join(SETTINGS_FILE_NAME)
    }

    fn token_path(&self) -> PathBuf {
        self.data_dir.join(TOKEN_FILE_NAME)
    }

    fn load_settings(&self) -> Result<McpHttpServerSettings, String> {
        let path = self.settings_path();
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("invalid MCP HTTP settings: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(McpHttpServerSettings::default())
            }
            Err(error) => Err(format!("failed to read MCP HTTP settings: {error}")),
        }
    }

    fn save_settings(&self, settings: &McpHttpServerSettings) -> Result<(), String> {
        let payload = serde_json::to_vec_pretty(settings)
            .map_err(|error| format!("failed to encode MCP HTTP settings: {error}"))?;
        replace_private_file(&self.settings_path(), &payload, "mcp-http-settings")
            .map_err(|error| error.to_string())
    }

    fn load_or_create_token(&self) -> Result<String, String> {
        let path = self.token_path();
        if let Ok(token) = std::fs::read_to_string(&path) {
            let token = token.trim_end_matches(['\r', '\n']).to_string();
            if token.len() >= 32 && !token.chars().any(char::is_whitespace) {
                return Ok(token);
            }
        }
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        replace_private_file(&path, token.as_bytes(), "mcp-http-token")
            .map_err(|error| error.to_string())?;
        Ok(token)
    }

    fn rotate_token_file(&self) -> Result<(), String> {
        match std::fs::remove_file(self.token_path()) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("failed to rotate MCP HTTP token: {error}")),
        }
    }

    fn record_error(&self, message: impl Into<String>) {
        let message = message.into();
        let mut diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        diagnostics.last_error = Some(message.clone());
        push_log(&mut diagnostics, format!("ERROR {message}"));
    }

    fn status(&self, settings: &McpHttpServerSettings) -> McpHttpServerStatus {
        let (running, exited) = {
            let mut server = self
                .server
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let settings_match = server
                .as_ref()
                .is_some_and(|running| running.settings == *settings);
            let exited = server
                .as_mut()
                .and_then(|running| running.child.try_wait().ok().flatten());
            if exited.is_some() {
                if let Some(running) = server.take() {
                    running.stderr_task.abort();
                }
            }
            (server.is_some() && settings_match, exited)
        };
        if let Some(exit_status) = exited {
            self.record_error(format!(
                "oxide-agent stopped unexpectedly with status {exit_status}"
            ));
        }
        let diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        McpHttpServerStatus {
            enabled: settings.enabled,
            running,
            endpoint: settings.enabled.then(|| endpoint_for(settings)).flatten(),
            access_token: settings
                .enabled
                .then(|| self.load_or_create_token())
                .transpose()
                .ok()
                .flatten(),
            last_error: diagnostics.last_error.clone(),
            recent_logs: diagnostics.logs.iter().cloned().collect(),
        }
    }

    async fn stop_locked(&self) {
        let running = self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(mut running) = running {
            let _ = running.child.start_kill();
            if tokio::time::timeout(Duration::from_secs(3), running.child.wait())
                .await
                .is_err()
            {
                let _ = running.child.kill().await;
            }
            running.stderr_task.abort();
        }
    }

    async fn apply_settings(&self, settings: &McpHttpServerSettings) -> Result<(), String> {
        validate_settings(settings)?;
        let _operation = self.operation_lock.lock().await;
        let previous = self.load_settings()?;
        self.stop_locked().await;
        if settings.enabled {
            self.start_locked(settings).await?;
        }
        if let Err(error) = self.save_settings(settings) {
            self.stop_locked().await;
            if previous.enabled {
                if let Err(restore_error) = self.start_locked(&previous).await {
                    return Err(format!(
                        "{error}; additionally failed to restore the previous MCP HTTP service: {restore_error}"
                    ));
                }
            }
            return Err(error);
        }
        Ok(())
    }

    async fn rotate_token(&self, settings: &McpHttpServerSettings) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.stop_locked().await;
        self.rotate_token_file()?;
        self.load_or_create_token()?;
        if settings.enabled {
            self.start_locked(settings).await?;
        }
        Ok(())
    }

    async fn ensure_running_from_disk(&self) -> Result<McpHttpServerSettings, String> {
        let _operation = self.operation_lock.lock().await;
        let settings = self.load_settings()?;
        if settings.enabled && !self.status(&settings).running {
            self.stop_locked().await;
            self.start_locked(&settings).await?;
        }
        Ok(settings)
    }

    async fn start_locked(&self, settings: &McpHttpServerSettings) -> Result<(), String> {
        let binary = resolve_oxide_agent_binary(&self.app)?;
        self.load_or_create_token()?;
        let bind = SocketAddr::new(
            settings
                .host
                .parse::<IpAddr>()
                .map_err(|_| "MCP HTTP host must be an IP address".to_string())?,
            settings.port,
        );
        let mut command = Command::new(binary);
        command
            .arg("mcp")
            .arg("http")
            .arg("--project")
            .arg(&settings.project_id)
            .arg("--bind")
            .arg(bind.to_string())
            .arg("--path")
            .arg(&settings.path)
            .arg("--token-file")
            .arg(self.token_path())
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--max-rows")
            .arg(settings.max_rows.to_string())
            .arg("--max-result-bytes")
            .arg(settings.max_result_bytes.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(connection_id) = settings.connection_id.as_deref() {
            command.arg("--connection").arg(connection_id);
        }
        for database in &settings.databases {
            command.arg("--database").arg(database);
        }
        for tool in &settings.tools {
            command.arg("--tool").arg(tool);
        }
        if let Some(timeout) = settings.query_timeout_secs {
            command.arg("--query-timeout-secs").arg(timeout.to_string());
        }
        for host in &settings.allowed_hosts {
            command.arg("--allowed-host").arg(host);
        }
        for origin in &settings.allowed_origins {
            command.arg("--allowed-origin").arg(origin);
        }
        if settings.allow_remote {
            command.arg("--allow-remote");
        }
        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start the bundled oxide-agent: {error}"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to capture oxide-agent diagnostics".to_string())?;
        let diagnostics = self.diagnostics.clone();
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = sanitize_log_line(&line);
                let mut diagnostics = diagnostics
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                push_log(&mut diagnostics, line);
            }
        });

        let health_url = health_url(bind);
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(300))
            .build()
            .map_err(|error| format!("failed to create MCP health client: {error}"))?;
        let mut ready = false;
        for _ in 0..30 {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| format!("failed to inspect oxide-agent: {error}"))?
            {
                stderr_task.abort();
                return Err(format!(
                    "oxide-agent exited before becoming ready: {status}"
                ));
            }
            if let Ok(response) = client.get(&health_url).send().await {
                let is_oxide = response.status().is_success()
                    && response
                        .headers()
                        .get("x-oxide-agent-service")
                        .is_some_and(|value| value == "read-only-mcp-v1");
                if is_oxide {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    if child
                        .try_wait()
                        .map_err(|error| format!("failed to inspect oxide-agent: {error}"))?
                        .is_none()
                    {
                        ready = true;
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ready {
            let _ = child.kill().await;
            stderr_task.abort();
            return Err("oxide-agent did not become ready within 3 seconds".to_string());
        }

        *self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(RunningServer {
            settings: settings.clone(),
            child,
            stderr_task,
        });
        let mut diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        diagnostics.last_error = None;
        push_log(&mut diagnostics, "MCP HTTP service started".to_string());
        Ok(())
    }

    fn start_supervisor(self: &Arc<Self>) {
        if self.supervisor_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(15)).await;
                if let Err(error) = service.ensure_running_from_disk().await {
                    service.record_error(format!("automatic restart failed: {error}"));
                }
            }
        });
    }
}

impl Drop for McpHttpServerState {
    fn drop(&mut self) {
        if let Some(mut running) = self
            .server
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = running.child.start_kill();
            running.stderr_task.abort();
        }
    }
}

#[tauri::command]
pub async fn load_mcp_http_server_settings(
    service: State<'_, Arc<McpHttpServerState>>,
) -> Result<McpHttpServerSettings, String> {
    service.load_settings()
}

#[tauri::command]
pub async fn save_mcp_http_server_settings(
    settings: McpHttpServerSettings,
    service: State<'_, Arc<McpHttpServerState>>,
) -> Result<McpHttpServerStatus, String> {
    service.apply_settings(&settings).await?;
    Ok(service.status(&settings))
}

#[tauri::command]
pub async fn mcp_http_server_status(
    service: State<'_, Arc<McpHttpServerState>>,
) -> Result<McpHttpServerStatus, String> {
    let settings = service.ensure_running_from_disk().await?;
    Ok(service.status(&settings))
}

#[tauri::command]
pub async fn rotate_mcp_http_server_token(
    service: State<'_, Arc<McpHttpServerState>>,
) -> Result<McpHttpServerStatus, String> {
    let settings = service.load_settings()?;
    service.rotate_token(&settings).await?;
    Ok(service.status(&settings))
}

pub async fn start_if_enabled(service: Arc<McpHttpServerState>) {
    match service.ensure_running_from_disk().await {
        Ok(_) => {}
        Err(error) => service.record_error(error),
    }
    service.start_supervisor();
}

fn validate_settings(settings: &McpHttpServerSettings) -> Result<(), String> {
    let ip = settings
        .host
        .parse::<IpAddr>()
        .map_err(|_| "MCP HTTP host must be an IP address".to_string())?;
    if settings.port == 0 {
        return Err("MCP HTTP port must be between 1 and 65535".to_string());
    }
    if settings.path == "/"
        || !settings.path.starts_with('/')
        || settings.path.ends_with('/')
        || settings.path.contains('?')
        || settings.path.contains('#')
        || settings.path.contains("//")
    {
        return Err("MCP HTTP path must be an absolute path such as /mcp".to_string());
    }
    validate_scope_value(&settings.project_id, "project", 128, settings.enabled)?;
    if let Some(connection) = settings.connection_id.as_deref() {
        validate_scope_value(connection, "connection", 128, true)?;
    }
    for database in &settings.databases {
        validate_scope_value(database, "database", 256, true)?;
    }
    let known_tools: HashSet<&str> = PUBLIC_TOOL_NAMES.iter().copied().collect();
    if settings.enabled && settings.tools.is_empty() {
        return Err("at least one public MCP tool must be selected".to_string());
    }
    for tool in &settings.tools {
        if !known_tools.contains(tool.as_str()) {
            return Err(format!("unknown public MCP tool: {tool}"));
        }
    }
    if settings.max_rows == 0 || settings.max_rows > 1_000 {
        return Err("MCP maximum rows must be between 1 and 1000".to_string());
    }
    if !(4_096..=1_048_576).contains(&settings.max_result_bytes) {
        return Err("MCP maximum result bytes must be between 4096 and 1048576".to_string());
    }
    if !ip.is_loopback() {
        if !settings.allow_remote {
            return Err(
                "non-loopback MCP HTTP binding requires remote access to be explicitly enabled"
                    .to_string(),
            );
        }
        if settings.allowed_hosts.is_empty() || settings.allowed_origins.is_empty() {
            return Err(
                "remote MCP HTTP binding requires allowed hosts and allowed origins".to_string(),
            );
        }
    }
    Ok(())
}

fn validate_scope_value(
    value: &str,
    label: &str,
    max_chars: usize,
    required: bool,
) -> Result<(), String> {
    let value = value.trim();
    if required && value.is_empty() {
        return Err(format!("MCP {label} scope is required"));
    }
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(format!("MCP {label} scope is invalid"));
    }
    Ok(())
}

fn endpoint_for(settings: &McpHttpServerSettings) -> Option<String> {
    let host = match settings.host.as_str() {
        "0.0.0.0" | "::" => settings.allowed_hosts.first()?.as_str(),
        host => host,
    };
    let authority = if host.contains(':') && host.parse::<IpAddr>().is_ok_and(|ip| ip.is_ipv6()) {
        format!("[{host}]:{}", settings.port)
    } else if host
        .rsplit_once(':')
        .is_some_and(|(_, port)| port.parse::<u16>().is_ok())
    {
        host.to_string()
    } else {
        format!("{host}:{}", settings.port)
    };
    Some(format!("http://{authority}{}", settings.path))
}

fn health_url(bind: SocketAddr) -> String {
    let ip = if bind.ip().is_unspecified() {
        if bind.is_ipv6() {
            IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)
        } else {
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        }
    } else {
        bind.ip()
    };
    format!("http://{}/healthz", SocketAddr::new(ip, bind.port()))
}

fn push_log(diagnostics: &mut Diagnostics, line: String) {
    diagnostics.logs.push_back(line);
    while diagnostics.logs.len() > MAX_LOG_LINES {
        diagnostics.logs.pop_front();
    }
}

fn sanitize_log_line(line: &str) -> String {
    let mut line = line.trim().to_string();
    if line.len() > 2_000 {
        line.truncate(2_000);
        line.push('…');
    }
    line
}

fn resolve_oxide_agent_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(windows) {
        "oxide-agent.exe"
    } else {
        "oxide-agent"
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable));
            candidates.push(parent.join("resources").join(executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(executable));
        candidates.push(resources.join("binaries").join(executable));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("target").join("debug").join(executable));
    candidates.push(manifest.join("target").join("release").join(executable));
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(
        manifest
            .join("binaries")
            .join(format!("oxide-agent-{target}{extension}")),
    );
    candidates
        .into_iter()
        .find(|path| is_regular_file(path))
        .ok_or_else(|| "the bundled oxide-agent executable was not found".to_string())
}

fn is_regular_file(path: &Path) -> bool {
    path.symlink_metadata()
        .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_reject_remote_scope_without_both_allowlists() {
        let settings = McpHttpServerSettings {
            enabled: true,
            host: "0.0.0.0".to_string(),
            allow_remote: true,
            project_id: "project-a".to_string(),
            ..Default::default()
        };
        assert!(validate_settings(&settings).is_err());
        let settings = McpHttpServerSettings {
            allowed_hosts: vec!["mcp.example.test".to_string()],
            allowed_origins: vec!["https://client.example.test".to_string()],
            ..settings
        };
        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn settings_reject_unknown_tools_and_missing_enabled_project() {
        let missing_project = McpHttpServerSettings {
            enabled: true,
            ..Default::default()
        };
        assert!(validate_settings(&missing_project).is_err());
        let unknown_tool = McpHttpServerSettings {
            enabled: true,
            project_id: "project-a".to_string(),
            tools: vec!["query.executeApproved".to_string()],
            ..Default::default()
        };
        assert!(validate_settings(&unknown_tool).is_err());
    }

    #[test]
    fn endpoint_uses_reachable_remote_host_and_brackets_ipv6() {
        let remote = McpHttpServerSettings {
            enabled: true,
            host: "0.0.0.0".to_string(),
            port: 5_225,
            path: "/mcp".to_string(),
            allowed_hosts: vec!["mcp.example.test".to_string()],
            ..Default::default()
        };
        assert_eq!(
            endpoint_for(&remote).as_deref(),
            Some("http://mcp.example.test:5225/mcp")
        );
        let ipv6 = McpHttpServerSettings {
            host: "::1".to_string(),
            ..remote
        };
        assert_eq!(
            endpoint_for(&ipv6).as_deref(),
            Some("http://[::1]:5225/mcp")
        );
    }
}
