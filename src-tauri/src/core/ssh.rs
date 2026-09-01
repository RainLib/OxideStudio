use crate::core::config::{SshJumpHostConfig, SshTunnelConfig};
use crate::core::dialect::database_capabilities_for_driver;
use anyhow::{anyhow, bail, Context, Result};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::{client, ChannelMsg, ChannelStream};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{timeout, timeout_at, Instant};
use url::Url;
use uuid::Uuid;

const SSH_OPERATION_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_FORWARDING_CHANNELS: usize = 64;
const MAX_SSH_CAPTURE_BYTES: u64 = 1024 * 1024;
const MAX_SSH_UPLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_SSH_HOPS: usize = 4;

#[derive(Clone)]
struct SshHop {
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    strict_host_key_checking: bool,
}

impl SshHop {
    fn primary(config: &SshTunnelConfig) -> Self {
        Self {
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            auth_method: config.auth_method.clone(),
            password: config.password.clone(),
            private_key_path: config.private_key_path.clone(),
            private_key_passphrase: config.private_key_passphrase.clone(),
            strict_host_key_checking: config.strict_host_key_checking,
        }
    }

    fn jump(config: &SshJumpHostConfig) -> Self {
        Self {
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            auth_method: config.auth_method.clone(),
            password: config.password.clone(),
            private_key_path: config.private_key_path.clone(),
            private_key_passphrase: config.private_key_passphrase.clone(),
            strict_host_key_checking: config.strict_host_key_checking,
        }
    }

    fn identity(&self) -> String {
        format!(
            "{}@{}:{}",
            self.username.trim(),
            self.host.trim().to_ascii_lowercase(),
            self.port
        )
    }
}

struct ConnectedSshChain {
    final_session: client::Handle<SshClientHandler>,
    /// Earlier sessions must stay alive because every subsequent SSH client
    /// is carried by a direct-tcpip channel through the preceding hop.
    upstream_sessions: Vec<client::Handle<SshClientHandler>>,
}

#[derive(Clone)]
struct SshClientHandler {
    host: String,
    port: u16,
    strict_host_key_checking: bool,
}

impl client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool> {
        if !self.strict_host_key_checking {
            tracing::warn!(
                "SSH host key verification is disabled for {}:{}",
                self.host,
                self.port
            );
            return Ok(true);
        }

        match russh::keys::known_hosts::check_known_hosts(&self.host, self.port, server_public_key)
        {
            Ok(true) => Ok(true),
            Ok(false) => Err(anyhow!(
                "SSH host key for {}:{} is not present in ~/.ssh/known_hosts",
                self.host,
                self.port
            )),
            Err(error) => Err(anyhow!(
                "SSH host key verification failed for {}:{}: {}",
                self.host,
                self.port,
                error
            )),
        }
    }
}

/// One authenticated SSH session used by file-hosted database transports.
/// It reuses the same strict known-hosts policy as TCP forwarding, but does
/// not expose a general renderer-controlled shell API.
pub(crate) struct SshSession {
    session: client::Handle<SshClientHandler>,
    upstream_sessions: Vec<client::Handle<SshClientHandler>>,
    identity: String,
}

impl SshSession {
    pub(crate) async fn connect(config: &SshTunnelConfig) -> Result<Self> {
        let identity = ssh_hops(config)?
            .last()
            .expect("validated SSH hop list is non-empty")
            .identity();
        let chain = connect_ssh_chain(config).await?;
        Ok(Self {
            session: chain.final_session,
            upstream_sessions: chain.upstream_sessions,
            identity,
        })
    }

    pub(crate) fn identity(&self) -> &str {
        &self.identity
    }

    pub(crate) async fn capture_fixed(&self, command: &'static str) -> Result<String> {
        self.capture(command).await
    }

    pub(crate) async fn upload_atomic_executable(
        &self,
        remote_path: &str,
        bytes: &[u8],
    ) -> Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_SSH_UPLOAD_BYTES {
            bail!("SQLite worker payload is empty or exceeds 64 MiB");
        }
        let quoted = shell_quote(remote_path)?;
        let temporary_path = format!("{remote_path}.oxide-part-{}", Uuid::new_v4());
        let temporary = shell_quote(&temporary_path)?;
        let command = format!(
            "mkdir -p \"$(dirname {quoted})\" && cat > {temporary} && chmod 700 {temporary} && mv -- {temporary} {quoted}"
        );
        let result = self.exec_with_input(&command, bytes).await;
        if result.is_err() {
            let _ = self.remove_file(&temporary_path).await;
        }
        result
    }

    pub(crate) async fn download_to_local_file(
        &self,
        remote_path: &str,
        destination: &std::path::Path,
        expected_bytes: u64,
    ) -> Result<u64> {
        if expected_bytes == 0 {
            bail!("Remote SQLite transfer receipt was empty");
        }
        let mut channel = timeout(SSH_OPERATION_TIMEOUT, self.session.channel_open_session())
            .await
            .context("Timed out opening SQLite download channel")?
            .context("Failed to open SQLite download channel")?;
        channel
            .exec(true, format!("cat {}", shell_quote(remote_path)?))
            .await
            .context("Failed to start SQLite download")?;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .await
            .context("Failed to create local SQLite transfer file")?;
        let copied = {
            let mut reader = channel.make_reader().take(expected_bytes.saturating_add(1));
            tokio::io::copy(&mut reader, &mut file)
                .await
                .context("Failed to download SQLite file")?
        };
        if copied > expected_bytes {
            let _ = channel.close().await;
            bail!("Downloaded SQLite file exceeded its worker receipt");
        }
        file.flush()
            .await
            .context("Failed to flush downloaded SQLite file")?;
        file.sync_all()
            .await
            .context("Failed to sync downloaded SQLite file")?;
        validate_exit_status(wait_for_exit_status(&mut channel).await)?;
        if copied != expected_bytes {
            bail!("Downloaded SQLite file size does not match its worker receipt");
        }
        Ok(copied)
    }

    pub(crate) async fn upload_local_file_atomic(
        &self,
        source: &std::path::Path,
        remote_path: &str,
    ) -> Result<u64> {
        let metadata = tokio::fs::metadata(source)
            .await
            .context("Cannot inspect local SQLite transfer file")?;
        if !metadata.is_file() || metadata.len() == 0 {
            bail!("Local SQLite transfer source is missing or empty");
        }
        let quoted = shell_quote(remote_path)?;
        let temporary_path = format!("{remote_path}.oxide-part-{}", Uuid::new_v4());
        let temporary = shell_quote(&temporary_path)?;
        let command = format!(
            "mkdir -p \"$(dirname {quoted})\" && cat > {temporary} && mv -- {temporary} {quoted}"
        );
        let mut channel = timeout(SSH_OPERATION_TIMEOUT, self.session.channel_open_session())
            .await
            .context("Timed out opening SQLite upload channel")?
            .context("Failed to open SQLite upload channel")?;
        let upload = async {
            channel
                .exec(true, command)
                .await
                .context("Failed to start SQLite upload")?;
            let file = tokio::fs::File::open(source)
                .await
                .context("Failed to open local SQLite transfer file")?;
            channel
                .data(file)
                .await
                .context("Failed to upload SQLite file")?;
            channel
                .eof()
                .await
                .context("Failed to finish SQLite upload")?;
            validate_exit_status(wait_for_exit_status(&mut channel).await)
        }
        .await;
        if let Err(error) = upload {
            let _ = self.remove_file(&temporary_path).await;
            return Err(error);
        }
        Ok(metadata.len())
    }

    pub(crate) async fn remove_file(&self, remote_path: &str) -> Result<()> {
        let command = format!("rm -f -- {}", shell_quote(remote_path)?);
        self.exec_with_input(&command, &[]).await
    }

    pub(crate) async fn ensure_regular_file(&self, remote_path: &str) -> Result<()> {
        let command = format!("test -f {}", shell_quote(remote_path)?);
        self.exec_with_input(&command, &[]).await
    }

    pub(crate) async fn sha256(&self, remote_path: &str) -> Result<String> {
        let command = format!("sha256sum {}", shell_quote(remote_path)?);
        let output = self.capture(&command).await?;
        output
            .split_whitespace()
            .next()
            .filter(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            })
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| anyhow!("Remote host returned an invalid SHA-256 digest"))
    }

    pub(crate) async fn start_stdio(
        &self,
        executable_path: &str,
    ) -> Result<ChannelStream<client::Msg>> {
        let channel = timeout(SSH_OPERATION_TIMEOUT, self.session.channel_open_session())
            .await
            .context("Timed out opening SQLite worker SSH channel")?
            .context("Failed to open SQLite worker SSH channel")?;
        channel
            .exec(true, format!("exec {}", shell_quote(executable_path)?))
            .await
            .context("Failed to start SQLite worker")?;
        Ok(channel.into_stream())
    }

    pub(crate) async fn shutdown(&self) {
        if let Err(error) = self
            .session
            .disconnect(russh::Disconnect::ByApplication, "SSH session closed", "en")
            .await
        {
            tracing::debug!("Failed to send SSH session disconnect: {error}");
        }
        for session in &self.upstream_sessions {
            if let Err(error) = session
                .disconnect(russh::Disconnect::ByApplication, "SSH chain closed", "en")
                .await
            {
                tracing::debug!("Failed to close an upstream SSH hop: {error}");
            }
        }
    }

    async fn capture(&self, command: &str) -> Result<String> {
        let bytes = self.capture_bytes(command, MAX_SSH_CAPTURE_BYTES).await?;
        String::from_utf8(bytes).context("Remote command returned non-UTF-8 output")
    }

    async fn capture_bytes(&self, command: &str, max_bytes: u64) -> Result<Vec<u8>> {
        let mut channel = timeout(SSH_OPERATION_TIMEOUT, self.session.channel_open_session())
            .await
            .context("Timed out opening SSH command channel")?
            .context("Failed to open SSH command channel")?;
        channel
            .exec(true, command)
            .await
            .context("Failed to start remote command")?;
        let mut output = Vec::new();
        {
            let mut reader = channel.make_reader().take(max_bytes.saturating_add(1));
            reader
                .read_to_end(&mut output)
                .await
                .context("Failed to read remote command output")?;
        }
        let exit_status = wait_for_exit_status(&mut channel).await;
        validate_exit_status(exit_status)?;
        if output.len() as u64 > max_bytes {
            bail!("Remote command output exceeded its configured limit");
        }
        Ok(output)
    }

    async fn exec_with_input(&self, command: &str, input: &[u8]) -> Result<()> {
        let mut channel = timeout(SSH_OPERATION_TIMEOUT, self.session.channel_open_session())
            .await
            .context("Timed out opening SSH command channel")?
            .context("Failed to open SSH command channel")?;
        channel
            .exec(true, command)
            .await
            .context("Failed to start remote command")?;
        if !input.is_empty() {
            channel
                .data(input)
                .await
                .context("Failed to upload remote file")?;
        }
        channel
            .eof()
            .await
            .context("Failed to finish remote command input")?;
        validate_exit_status(wait_for_exit_status(&mut channel).await)
    }
}

async fn wait_for_exit_status(channel: &mut russh::Channel<client::Msg>) -> Option<u32> {
    let mut exit_status = None;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::ExitStatus {
                exit_status: status,
            }) => exit_status = Some(status),
            Some(ChannelMsg::Close) | None => return exit_status,
            Some(_) => {}
        }
    }
}

fn validate_exit_status(exit_status: Option<u32>) -> Result<()> {
    match exit_status {
        Some(0) => Ok(()),
        Some(status) => bail!("Remote command exited with status {status}"),
        None => bail!("Remote command closed without an exit status"),
    }
}

fn shell_quote(path: &str) -> Result<String> {
    if path.trim().is_empty() || path.contains('\0') || path.contains('\n') || path.contains('\r') {
        bail!("Remote path is invalid");
    }
    Ok(format!("'{}'", path.replace('\'', "'\"'\"'")))
}

fn ssh_hops(config: &SshTunnelConfig) -> Result<Vec<SshHop>> {
    let mut hops = Vec::with_capacity(config.jump_hosts.len().saturating_add(1));
    hops.push(SshHop::primary(config));
    hops.extend(config.jump_hosts.iter().map(SshHop::jump));
    if hops.len() > MAX_SSH_HOPS {
        bail!("SSH chains support at most {MAX_SSH_HOPS} hops");
    }
    for (index, hop) in hops.iter().enumerate() {
        validate_hop(hop, index + 1)?;
    }
    Ok(hops)
}

fn ssh_client_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60)),
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

fn ssh_handler(hop: &SshHop) -> SshClientHandler {
    SshClientHandler {
        host: hop.host.trim().to_string(),
        port: hop.port,
        strict_host_key_checking: hop.strict_host_key_checking,
    }
}

async fn connect_ssh_chain(config: &SshTunnelConfig) -> Result<ConnectedSshChain> {
    let hops = ssh_hops(config)?;
    let first = hops.first().expect("validated SSH hop list is non-empty");
    let mut session = connect_ssh_hop_direct(first).await?;
    let mut upstream_sessions = Vec::with_capacity(hops.len().saturating_sub(1));

    for hop in hops.iter().skip(1) {
        let channel = timeout(
            SSH_OPERATION_TIMEOUT,
            session.channel_open_direct_tcpip(
                hop.host.trim().to_string(),
                u32::from(hop.port),
                "127.0.0.1",
                0,
            ),
        )
        .await
        .context("Timed out opening SSH jump-host forwarding channel")?
        .with_context(|| {
            format!(
                "Failed to open an SSH forwarding channel to hop {}:{}",
                hop.host.trim(),
                hop.port
            )
        })?;
        let handler = ssh_handler(hop);
        let mut next_session = timeout(
            SSH_OPERATION_TIMEOUT,
            client::connect_stream(ssh_client_config(), channel.into_stream(), handler),
        )
        .await
        .context("Timed out negotiating SSH jump host")?
        .with_context(|| {
            format!(
                "Failed to connect to SSH jump host {}:{}",
                hop.host.trim(),
                hop.port
            )
        })?;
        authenticate_session(&mut next_session, hop).await?;
        upstream_sessions.push(session);
        session = next_session;
    }

    Ok(ConnectedSshChain {
        final_session: session,
        upstream_sessions,
    })
}

/// Authenticate every configured SSH hop without opening a database
/// connection or retaining a local forwarder. This is deliberately separate
/// from `SshTunnel::prepare`: connection settings can validate bastion
/// credentials and host keys before database address or credentials are
/// complete.
pub async fn test_ssh_tunnel(config: &SshTunnelConfig) -> Result<()> {
    if !config.enabled {
        bail!("SSH tunnel must be enabled before it can be tested");
    }

    let ConnectedSshChain {
        final_session,
        upstream_sessions,
    } = connect_ssh_chain(config).await?;

    if let Err(error) = final_session
        .disconnect(
            russh::Disconnect::ByApplication,
            "SSH tunnel test complete",
            "en",
        )
        .await
    {
        tracing::debug!("Failed to close tested SSH session: {error}");
    }
    for session in upstream_sessions.into_iter().rev() {
        if let Err(error) = session
            .disconnect(
                russh::Disconnect::ByApplication,
                "SSH tunnel test complete",
                "en",
            )
            .await
        {
            tracing::debug!("Failed to close tested SSH jump-host session: {error}");
        }
    }
    Ok(())
}

async fn connect_ssh_hop_direct(hop: &SshHop) -> Result<client::Handle<SshClientHandler>> {
    let handler = ssh_handler(hop);
    let mut session = timeout(
        SSH_OPERATION_TIMEOUT,
        client::connect(
            ssh_client_config(),
            (handler.host.as_str(), handler.port),
            handler.clone(),
        ),
    )
    .await
    .context("Timed out connecting to SSH server")?
    .with_context(|| {
        format!(
            "Failed to connect to SSH server {}:{}",
            hop.host.trim(),
            hop.port
        )
    })?;
    authenticate_session(&mut session, hop).await?;
    Ok(session)
}

async fn authenticate_session(
    session: &mut client::Handle<SshClientHandler>,
    hop: &SshHop,
) -> Result<()> {
    let authenticated = match hop.auth_method.trim() {
        "password" => timeout(
            SSH_OPERATION_TIMEOUT,
            session.authenticate_password(
                hop.username.trim(),
                hop.password.as_deref().unwrap_or_default(),
            ),
        )
        .await
        .context("SSH password authentication timed out")?
        .context("SSH password authentication failed")?,
        "privateKey" | "private-key" => {
            let key_path = hop
                .private_key_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .expect("SSH private key path was validated");
            let key_path = expand_home_path(key_path);
            let key = Arc::new(
                load_secret_key(&key_path, hop.private_key_passphrase.as_deref()).with_context(
                    || format!("Failed to load SSH private key {}", key_path.display()),
                )?,
            );
            let hash = session
                .best_supported_rsa_hash()
                .await
                .context("Failed to negotiate SSH key algorithm")?
                .flatten();
            timeout(
                SSH_OPERATION_TIMEOUT,
                session.authenticate_publickey(
                    hop.username.trim(),
                    PrivateKeyWithHashAlg::new(key, hash),
                ),
            )
            .await
            .context("SSH private-key authentication timed out")?
            .context("SSH private-key authentication failed")?
        }
        method => bail!("Unsupported SSH authentication method: {method}"),
    };

    if !authenticated.success() {
        bail!(
            "SSH authentication was rejected for user {}",
            hop.username.trim()
        );
    }
    Ok(())
}

/// Owns an authenticated SSH session and a loopback-only local forwarder.
/// Dropping the value closes the listener and all active forwarding tasks.
pub struct SshTunnel {
    local_port: u16,
    shutdown: watch::Sender<bool>,
    accept_task: Option<JoinHandle<()>>,
}

impl SshTunnel {
    pub async fn prepare(
        driver: &str,
        database_url: &str,
        config: Option<&SshTunnelConfig>,
    ) -> Result<(String, Option<Self>)> {
        let Some(config) = config.filter(|config| config.enabled) else {
            return Ok((database_url.to_string(), None));
        };

        let (target_host, target_port) = database_target(driver, database_url)?;
        let tunnel = Self::connect(config, target_host, target_port).await?;
        let local_url = rewrite_database_url(database_url, tunnel.local_port)?;
        Ok((local_url, Some(tunnel)))
    }

    async fn connect(
        config: &SshTunnelConfig,
        target_host: String,
        target_port: u16,
    ) -> Result<Self> {
        let ConnectedSshChain {
            final_session,
            upstream_sessions,
        } = connect_ssh_chain(config).await?;

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .context("Failed to create local SSH tunnel listener")?;
        let local_port = listener.local_addr()?.port();
        let session = Arc::new(final_session);
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let accept_task = tokio::spawn(async move {
            let mut forwarding_tasks = tokio::task::JoinSet::new();
            loop {
                let accepted = tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                        continue;
                    }
                    completed = forwarding_tasks.join_next(), if !forwarding_tasks.is_empty() => {
                        if let Some(Err(error)) = completed {
                            tracing::debug!("SSH forwarding task ended unexpectedly: {error}");
                        }
                        continue;
                    }
                    accepted = listener.accept(), if forwarding_tasks.len() < MAX_FORWARDING_CHANNELS => accepted,
                };

                let (mut local_stream, originator) = match accepted {
                    Ok(value) => value,
                    Err(error) => {
                        tracing::warn!("SSH tunnel listener failed: {error}");
                        break;
                    }
                };

                let session = session.clone();
                let target_host = target_host.clone();
                let mut connection_shutdown = shutdown_rx.clone();
                forwarding_tasks.spawn(async move {
                    let channel = timeout(
                        SSH_OPERATION_TIMEOUT,
                        session
                            .channel_open_direct_tcpip(
                                target_host,
                                u32::from(target_port),
                                originator.ip().to_string(),
                                u32::from(originator.port()),
                            ),
                    )
                    .await;

                    let mut remote_stream = match channel {
                        Ok(Ok(channel)) => channel.into_stream(),
                        Ok(Err(error)) => {
                            tracing::warn!("Failed to open SSH forwarding channel: {error}");
                            return;
                        }
                        Err(_) => {
                            tracing::warn!("Timed out opening SSH forwarding channel");
                            return;
                        }
                    };

                    tokio::select! {
                        result = copy_bidirectional(&mut local_stream, &mut remote_stream) => {
                            if let Err(error) = result {
                                tracing::debug!("SSH forwarding channel closed with error: {error}");
                            }
                        }
                        _ = connection_shutdown.changed() => {}
                    }
                });
            }

            forwarding_tasks.shutdown().await;
            if let Err(error) = session
                .disconnect(russh::Disconnect::ByApplication, "SSH tunnel closed", "en")
                .await
            {
                tracing::debug!("Failed to send SSH disconnect message: {error}");
            }
            for upstream in upstream_sessions {
                if let Err(error) = upstream
                    .disconnect(russh::Disconnect::ByApplication, "SSH chain closed", "en")
                    .await
                {
                    tracing::debug!("Failed to close an upstream SSH hop: {error}");
                }
            }
        });

        Ok(Self {
            local_port,
            shutdown,
            accept_task: Some(accept_task),
        })
    }

    pub async fn shutdown(mut self) {
        let _ = self.shutdown.send(true);
        if let Some(mut task) = self.accept_task.take() {
            let deadline = Instant::now() + SSH_SHUTDOWN_TIMEOUT;
            if timeout_at(deadline, &mut task).await.is_err() {
                task.abort();
            }
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

fn validate_hop(hop: &SshHop, position: usize) -> Result<()> {
    let label = if position == 1 {
        "SSH host".to_string()
    } else {
        format!("SSH hop {position}")
    };
    if hop.host.trim().is_empty() {
        bail!("{label} host is required");
    }
    if hop.port == 0 {
        bail!("{label} port must be between 1 and 65535");
    }
    if hop.username.trim().is_empty() {
        bail!("{label} username is required");
    }
    match hop.auth_method.trim() {
        "password" if hop.password.as_deref().unwrap_or_default().is_empty() => {
            bail!("{label} password is required")
        }
        "privateKey" | "private-key"
            if hop
                .private_key_path
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty() =>
        {
            bail!("{label} private key path is required")
        }
        "password" | "privateKey" | "private-key" => Ok(()),
        method => bail!("Unsupported SSH authentication method: {method}"),
    }
}

fn expand_home_path(path: &str) -> std::path::PathBuf {
    let Some(relative) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) else {
        return path.into();
    };
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
        .map(|home| home.join(relative))
        .unwrap_or_else(|| path.into())
}

fn database_target(driver: &str, database_url: &str) -> Result<(String, u16)> {
    let url = Url::parse(database_url)
        .context("SSH tunneling requires a URL-style database connection")?;
    if url.scheme().eq_ignore_ascii_case("mongodb+srv") {
        bail!("SSH tunneling does not support mongodb+srv URLs; use a single mongodb:// host and port");
    }
    if url.host_str().is_some_and(|host| host.contains(',')) {
        bail!("SSH tunneling requires a single database host");
    }
    let host = url
        .host_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Database connection URL does not contain a host"))?;
    let port = url
        .port_or_known_default()
        .or_else(|| {
            database_capabilities_for_driver(driver)
                .ok()
                .map(|capabilities| capabilities.default_port)
        })
        .ok_or_else(|| anyhow!("Database connection URL does not contain a port"))?;
    if port == 0 {
        bail!("Database port must be between 1 and 65535");
    }
    Ok((host, port))
}

fn rewrite_database_url(database_url: &str, local_port: u16) -> Result<String> {
    let mut url = Url::parse(database_url).context("Failed to parse database connection URL")?;
    url.set_host(Some("127.0.0.1"))
        .map_err(|_| anyhow!("Failed to rewrite database host for SSH tunnel"))?;
    url.set_port(Some(local_port))
        .map_err(|_| anyhow!("Failed to rewrite database port for SSH tunnel"))?;
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_database_endpoint_without_losing_credentials_or_options() {
        let rewritten = rewrite_database_url(
            "postgres://user:secret@db.internal:5432/app?sslmode=require",
            41234,
        )
        .unwrap();

        assert_eq!(
            rewritten,
            "postgres://user:secret@127.0.0.1:41234/app?sslmode=require"
        );
    }

    #[test]
    fn derives_default_database_ports() {
        assert_eq!(
            database_target("mysql", "mysql://user:pass@db.internal/app").unwrap(),
            ("db.internal".to_string(), 3306)
        );
        assert_eq!(
            database_target("redis", "redis://cache.internal/0").unwrap(),
            ("cache.internal".to_string(), 6379)
        );
        assert_eq!(
            database_target("elasticsearch", "https://search.internal/index").unwrap(),
            ("search.internal".to_string(), 443)
        );
    }

    #[test]
    fn rejects_mongodb_srv_and_multi_host_urls() {
        assert!(database_target("mongodb", "mongodb+srv://cluster.example.com/app").is_err());
        assert!(
            database_target("mongodb", "mongodb://mongo-a.internal,mongo-b.internal/app").is_err()
        );
    }

    #[test]
    fn rejects_incomplete_ssh_configuration() {
        let config = SshTunnelConfig {
            enabled: true,
            host: String::new(),
            port: 22,
            username: "deploy".to_string(),
            auth_method: "password".to_string(),
            password: Some("secret".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            strict_host_key_checking: true,
            jump_hosts: Vec::new(),
            remote_sqlite: None,
        };

        assert!(ssh_hops(&config)
            .err()
            .expect("incomplete hop must fail")
            .to_string()
            .contains("host"));
    }

    #[tokio::test]
    async fn ssh_tunnel_probe_rejects_disabled_configuration_without_network_io() {
        let config = SshTunnelConfig {
            enabled: false,
            host: "bastion.example.com".to_string(),
            port: 22,
            username: "deploy".to_string(),
            auth_method: "password".to_string(),
            password: Some("secret".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            strict_host_key_checking: true,
            jump_hosts: Vec::new(),
            remote_sqlite: None,
        };

        assert_eq!(
            test_ssh_tunnel(&config).await.unwrap_err().to_string(),
            "SSH tunnel must be enabled before it can be tested"
        );
    }

    #[test]
    fn resolves_ordered_jump_hosts_and_validates_each_hop() {
        let config = SshTunnelConfig {
            enabled: true,
            host: "bastion-a.example.com".to_string(),
            port: 22,
            username: "first".to_string(),
            auth_method: "password".to_string(),
            password: Some("secret-a".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            strict_host_key_checking: true,
            jump_hosts: vec![SshJumpHostConfig {
                host: "bastion-b.example.com".to_string(),
                port: 2200,
                username: "second".to_string(),
                auth_method: "privateKey".to_string(),
                password: None,
                private_key_path: Some("~/.ssh/id_ed25519".to_string()),
                private_key_passphrase: Some("secret-b".to_string()),
                strict_host_key_checking: true,
            }],
            remote_sqlite: None,
        };

        let hops = ssh_hops(&config).unwrap();
        assert_eq!(hops.len(), 2);
        assert_eq!(hops[0].identity(), "first@bastion-a.example.com:22");
        assert_eq!(hops[1].identity(), "second@bastion-b.example.com:2200");

        let mut invalid = config;
        invalid.jump_hosts[0].password = Some(String::new());
        invalid.jump_hosts[0].auth_method = "password".to_string();
        assert!(ssh_hops(&invalid)
            .err()
            .expect("invalid later hop must fail")
            .to_string()
            .contains("hop 2 password"));
    }

    #[test]
    fn remote_paths_are_single_argument_shell_quoted() {
        assert_eq!(
            shell_quote("/srv/data/customer's app.db").unwrap(),
            "'/srv/data/customer'\"'\"'s app.db'"
        );
        assert!(shell_quote("/srv/data/app.db\nrm -rf /tmp").is_err());
        assert!(shell_quote("").is_err());
    }
}
