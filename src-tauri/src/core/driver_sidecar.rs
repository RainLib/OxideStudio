use super::driver_package::{
    validate_handshake, DatabaseDriverPackageRegistry, DriverPackageRuntime, DriverPackageStatus,
    InstalledDriverPackage, DRIVER_PROTOCOL_VERSION,
};
use futures::{SinkExt, StreamExt};
use oxide_driver_protocol::{
    DriverRequest, DriverRequestEnvelope, DriverResponse, DriverResponseEnvelope, DriverResult,
    DriverRuntimeCapabilities, HandshakeRequest,
};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};

const MAX_DRIVER_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

type PendingDriverRequest = oneshot::Sender<Result<DriverResult, String>>;
type PendingDriverRequests = Arc<Mutex<HashMap<u64, PendingDriverRequest>>>;

pub struct DatabaseDriverSidecar {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<FramedWrite<ChildStdin, LinesCodec>>>,
    pending: PendingDriverRequests,
    next_request_id: AtomicU64,
    capabilities: DriverRuntimeCapabilities,
}

impl DatabaseDriverSidecar {
    pub async fn spawn(
        package: &InstalledDriverPackage,
        registry: &DatabaseDriverPackageRegistry,
        host_version: &str,
    ) -> Result<Self, String> {
        if package.status != DriverPackageStatus::Ready {
            return Err("Only a verified driver package can be launched".to_string());
        }

        let java_binary = match &package.manifest.runtime {
            DriverPackageRuntime::Java(runtime) => {
                Some(registry.resolve_managed_java_runtime_binary(package, runtime.java_major)?)
            }
            DriverPackageRuntime::Native => None,
        };
        let mut command = sidecar_command(package, java_binary.as_deref())?;
        command
            .current_dir(&package.package_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env_clear();
        copy_safe_environment(&mut command);
        // The Java JDBC runtime is shared across signed vendor packages. Bind
        // its protocol identity from the verified manifest, never from a JAR
        // resource or package-controlled launcher argument.
        command
            .env("OXIDE_DRIVER_PACKAGE_ID", &package.manifest.package_id)
            .env(
                "OXIDE_DRIVER_PACKAGE_VERSION",
                &package.manifest.package_version,
            )
            .env("OXIDE_DRIVER_ID", &package.manifest.driver_id);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot launch database driver sidecar: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Database driver sidecar stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Database driver sidecar stdout is unavailable".to_string())?;
        if let Some(stderr) = child.stderr.take() {
            // Always drain stderr so a noisy sidecar cannot deadlock. It is not
            // persisted here because arbitrary driver output may contain secrets.
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stderr);
                let mut sink = tokio::io::sink();
                let _ = tokio::io::copy(&mut reader, &mut sink).await;
            });
        }

        let pending = Arc::new(Mutex::new(HashMap::new()));
        spawn_response_dispatcher(
            FramedRead::new(
                stdout,
                LinesCodec::new_with_max_length(MAX_DRIVER_MESSAGE_BYTES),
            ),
            pending.clone(),
        );
        let mut process = Self {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(FramedWrite::new(stdin, LinesCodec::new()))),
            pending,
            next_request_id: AtomicU64::new(1),
            capabilities: DriverRuntimeCapabilities::default(),
        };

        let result = process
            .request(
                DriverRequest::Handshake(HandshakeRequest {
                    protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
                    host_version: host_version.to_string(),
                    package_id: package.manifest.package_id.clone(),
                    driver_id: package.manifest.driver_id.clone(),
                }),
                HANDSHAKE_TIMEOUT,
            )
            .await;
        let handshake = match result {
            Ok(DriverResult::Handshake(handshake)) => handshake,
            Ok(_) => {
                process.terminate().await;
                return Err("Database driver returned an invalid handshake result".to_string());
            }
            Err(error) => {
                process.terminate().await;
                return Err(error);
            }
        };
        if let Err(error) = validate_handshake(&package.manifest, &handshake) {
            process.terminate().await;
            return Err(error);
        }
        process.capabilities = handshake.capabilities;
        Ok(process)
    }

    pub fn capabilities(&self) -> &DriverRuntimeCapabilities {
        &self.capabilities
    }

    pub async fn process_id(&self) -> Option<u32> {
        self.child.lock().await.id()
    }

    /// Returns whether the connection-owned process is still alive. This is
    /// deliberately limited to lifecycle state: the Driver Manager must not
    /// inspect sidecar output, connection secrets, or request payloads merely
    /// to report runtime health.
    pub async fn is_running(&self) -> bool {
        let mut child = self.child.lock().await;
        matches!(child.try_wait(), Ok(None))
    }

    pub async fn request(
        &self,
        request: DriverRequest,
        request_timeout: Duration,
    ) -> Result<DriverResult, String> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        if request_id == u64::MAX {
            return Err("Database driver request id overflow".to_string());
        }
        let message = serde_json::to_string(&DriverRequestEnvelope {
            id: request_id,
            request,
        })
        .map_err(|error| format!("Cannot encode database driver request: {error}"))?;
        if message.len() > MAX_DRIVER_MESSAGE_BYTES {
            return Err("Database driver request exceeds the message limit".to_string());
        }

        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(request_id, sender);
        let send_result = timeout(request_timeout, async {
            self.stdin.lock().await.send(message).await
        })
        .await
        .map_err(|_| "Database driver request timed out while sending".to_string())?
        .map_err(|error| format!("Cannot send database driver request: {error}"));
        if let Err(error) = send_result {
            self.pending.lock().await.remove(&request_id);
            return Err(error);
        }

        let response = match timeout(request_timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return Err("Database driver stopped before responding".to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&request_id);
                return Err("Database driver request timed out".to_string());
            }
        };
        response
    }

    pub async fn terminate(&self) {
        let pending = std::mem::take(&mut *self.pending.lock().await);
        for (_, sender) in pending {
            let _ = sender.send(Err("Database driver sidecar was terminated".to_string()));
        }
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

/// Build a launch command entirely from a verified manifest. Java packages are
/// deliberately restricted to the driver manager's Java 21 runtime; invoking
/// an arbitrary `java` from PATH would turn a signed driver package into an
/// ambient executable-resolution boundary.
fn sidecar_command(
    package: &InstalledDriverPackage,
    java_binary: Option<&Path>,
) -> Result<Command, String> {
    match &package.manifest.runtime {
        DriverPackageRuntime::Native => Ok(Command::new(&package.entrypoint)),
        DriverPackageRuntime::Java(java) => {
            let java_binary = java_binary.ok_or_else(|| {
                format!("Managed Java {} runtime is unavailable", java.java_major)
            })?;
            let mut classpath = vec![package.entrypoint.clone()];
            for entry in &java.classpath {
                classpath.push(package.package_root.join(&entry.path));
            }
            let classpath = std::env::join_paths(classpath)
                .map_err(|_| "Java driver classpath contains an invalid path".to_string())?
                .to_string_lossy()
                .into_owned();
            let mut command = Command::new(java_binary);
            command.arg("-cp").arg(classpath).arg(&java.main_class);
            Ok(command)
        }
    }
}

impl Drop for DatabaseDriverSidecar {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.start_kill();
        }
    }
}

fn spawn_response_dispatcher(
    mut stdout: FramedRead<tokio::process::ChildStdout, LinesCodec>,
    pending: PendingDriverRequests,
) {
    tokio::spawn(async move {
        let terminal_error = loop {
            let Some(line) = stdout.next().await else {
                break "Database driver stopped before responding".to_string();
            };
            let line = match line {
                Ok(line) => line,
                Err(error) => break format!("Cannot read database driver response: {error}"),
            };
            let response: DriverResponseEnvelope = match serde_json::from_str(&line) {
                Ok(response) => response,
                Err(error) => break format!("Database driver returned invalid JSON: {error}"),
            };
            let result = match response.response {
                DriverResponse::Ok(result) => Ok(result),
                DriverResponse::Error(error) => Err(format!(
                    "Database driver error {}: {}",
                    error.code, error.message
                )),
            };
            // A caller may have timed out locally and removed its pending
            // receiver before a slow sidecar finishes.  That late reply must
            // not poison unrelated requests that are still in flight.
            if let Some(sender) = pending.lock().await.remove(&response.id) {
                let _ = sender.send(result);
            }
        };
        let pending = std::mem::take(&mut *pending.lock().await);
        for (_, sender) in pending {
            let _ = sender.send(Err(terminal_error.clone()));
        }
    });
}

fn copy_safe_environment(command: &mut Command) {
    for name in [
        "PATH",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "SYSTEMROOT",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::driver_package::{DriverPackageManifest, DRIVER_PACKAGE_SCHEMA_VERSION};
    use sha2::{Digest, Sha256};
    use std::fs;

    #[cfg(unix)]
    fn write_test_package(root: &std::path::Path, response: &str) -> InstalledDriverPackage {
        use std::os::unix::fs::PermissionsExt;

        let package_root = root.join("test-driver").join("1.0.0");
        fs::create_dir_all(&package_root).unwrap();
        let entrypoint = package_root.join("driver");
        let script = format!(
            "#!/bin/sh\nIFS= read -r request || exit 1\nprintf '%s\\n' '{}'\nIFS= read -r request || exit 0\n",
            response.replace('\'', "'\\''")
        );
        fs::write(&entrypoint, script.as_bytes()).unwrap();
        let mut permissions = fs::metadata(&entrypoint).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&entrypoint, permissions).unwrap();
        let manifest = DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.test-driver".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "test-driver".to_string(),
            display_name: "Test Driver".to_string(),
            client_library: "fixture".to_string(),
            client_version: "1".to_string(),
            entrypoint: "driver".to_string(),
            sha256: format!("{:x}", Sha256::digest(script.as_bytes())),
            runtime: DriverPackageRuntime::Native,
            supported_targets: Vec::new(),
            server_version_range: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: None,
        };
        fs::write(
            package_root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(root.join("test-driver").join("current"), "1.0.0\n").unwrap();
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(root.to_path_buf())
            .resolve_active("test-driver")
            .unwrap()
    }

    #[test]
    fn java_packages_refuse_to_use_ambient_java_when_managed_runtime_is_missing() {
        let directory = tempfile::tempdir().unwrap();
        let package_root = directory.path().join("example").join("1.0.0");
        fs::create_dir_all(&package_root).unwrap();
        fs::write(package_root.join("agent.jar"), b"fixture").unwrap();
        let package = InstalledDriverPackage {
            manifest: DriverPackageManifest {
                schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
                package_id: "oxide.example".to_string(),
                package_version: "1.0.0".to_string(),
                protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
                driver_id: "example".to_string(),
                display_name: "Example JDBC".to_string(),
                client_library: "fixture".to_string(),
                client_version: "1".to_string(),
                entrypoint: "agent.jar".to_string(),
                sha256: format!("{:x}", Sha256::digest(b"fixture")),
                runtime: DriverPackageRuntime::Java(
                    crate::core::driver_package::DriverPackageJavaRuntime {
                        java_major: 21,
                        main_class: "studio.oxide.jdbc.DriverMain".to_string(),
                        classpath: Vec::new(),
                    },
                ),
                supported_targets: Vec::new(),
                server_version_range: None,
                connection_url_template: None,
                capabilities: None,
                schema_migration: None,
            },
            entrypoint: package_root.join("agent.jar"),
            package_root,
            active: true,
            status: DriverPackageStatus::Ready,
            status_message: None,
            catalog_entry: None,
        };
        assert!(sidecar_command(&package, None)
            .unwrap_err()
            .contains("Managed Java 21 runtime"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn starts_only_after_a_manifest_bound_handshake() {
        let directory = tempfile::tempdir().unwrap();
        let response = serde_json::json!({
            "id": 1,
            "status": "ok",
            "result": {
                "kind": "handshake",
                "value": {
                    "protocolVersion": DRIVER_PROTOCOL_VERSION,
                    "packageId": "oxide.test-driver",
                    "packageVersion": "1.0.0",
                    "driverId": "test-driver",
                    "capabilities": {
                        "metadata": true,
                        "query": true,
                        "cancellation": false,
                        "transactions": false,
                        "databaseScopedQueries": false
                    }
                }
            }
        })
        .to_string();
        let package = write_test_package(directory.path(), &response);
        let registry =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
        let process = DatabaseDriverSidecar::spawn(&package, &registry, "test-host")
            .await
            .unwrap();
        assert!(process.capabilities().query);
        process.terminate().await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kills_a_sidecar_that_claims_a_different_identity() {
        let directory = tempfile::tempdir().unwrap();
        let response = serde_json::json!({
            "id": 1,
            "status": "ok",
            "result": {
                "kind": "handshake",
                "value": {
                    "protocolVersion": DRIVER_PROTOCOL_VERSION,
                    "packageId": "oxide.impostor",
                    "packageVersion": "1.0.0",
                    "driverId": "test-driver",
                    "capabilities": { "query": true }
                }
            }
        })
        .to_string();
        let package = write_test_package(directory.path(), &response);
        let registry =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
        let error = DatabaseDriverSidecar::spawn(&package, &registry, "test-host")
            .await
            .err()
            .unwrap();
        assert!(error.contains("identity"));
    }
}
