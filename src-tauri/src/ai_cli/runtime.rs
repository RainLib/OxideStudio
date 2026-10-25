use super::codex_protocol::{codex_app_server_step, codex_initialize_request};
#[cfg(test)]
use super::codex_protocol::{codex_thread_start_params, codex_turn_start_params};
#[cfg(test)]
use super::executable::*;
pub use super::executable::{resolve_command, resolve_named_command, CliCommandSpec};
use anyhow::{anyhow, Context, Result};
use futures::StreamExt;
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, path::Path, process::Stdio, time::Duration};
use tempfile::TempDir;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::watch,
};
use tokio_util::codec::{FramedRead, LinesCodec};

const MAX_CAPTURE_BYTES: u64 = 256 * 1024;
const MAX_JSONL_LINE_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub struct CliCapturedOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub struct CliJsonlOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub parsed_events: usize,
}

pub fn apply_environment(command: &mut Command, environment: &BTreeMap<String, String>) {
    command.envs(environment);
    if !environment.contains_key("HTTP_PROXY") && !environment.contains_key("http_proxy") {
        if let Ok(proxy) = env::var("HTTP_PROXY") {
            command.env("HTTP_PROXY", proxy);
        }
    }
    if !environment.contains_key("HTTPS_PROXY") && !environment.contains_key("https_proxy") {
        if let Ok(proxy) = env::var("HTTPS_PROXY") {
            command.env("HTTPS_PROXY", proxy);
        }
    }
}

pub fn isolated_working_directory() -> Result<TempDir> {
    tempfile::Builder::new()
        .prefix("oxide-cli-agent-")
        .tempdir()
        .context("failed to create isolated CLI working directory")
}

pub async fn run_captured(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: Option<&Path>,
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> Result<CliCapturedOutput> {
    let mut command = spec.command();
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {}", spec.program))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        if let Some(stdin) = stdin {
            if stdin.len() > MAX_PROMPT_BYTES {
                return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
            }
            child_stdin
                .write_all(stdin)
                .await
                .context("failed to write CLI input")?;
        }
        child_stdin.shutdown().await.ok();
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CLI stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("CLI stderr is unavailable"))?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => status.context("failed to wait for CLI process")?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(anyhow!("CLI process timed out"));
        }
    };
    let stdout = stdout_task.await.context("CLI stdout task failed")??;
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliCapturedOutput {
        success: status.success(),
        exit_code: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

async fn read_bounded<R>(reader: R) -> Result<Vec<u8>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take(MAX_CAPTURE_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .context("failed to read CLI output")?;
    if bytes.len() as u64 > MAX_CAPTURE_BYTES {
        bytes.truncate(MAX_CAPTURE_BYTES as usize);
    }
    Ok(bytes)
}

#[allow(clippy::too_many_arguments)]
pub async fn run_jsonl_process<F>(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: &Path,
    stdin: &[u8],
    timeout: Duration,
    mut cancellation: watch::Receiver<bool>,
    mut on_json: F,
) -> Result<CliJsonlOutput>
where
    F: FnMut(Value) + Send,
{
    if stdin.len() > MAX_PROMPT_BYTES {
        return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
    }
    let mut command = spec.command();
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {}", spec.program))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(stdin)
            .await
            .context("failed to write CLI input")?;
        child_stdin.shutdown().await.ok();
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CLI stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("CLI stderr is unavailable"))?;
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let mut lines = FramedRead::new(
        stdout,
        LinesCodec::new_with_max_length(MAX_JSONL_LINE_BYTES),
    );
    let idle_deadline = tokio::time::sleep(timeout);
    tokio::pin!(idle_deadline);
    let hard_deadline = tokio::time::sleep(Duration::from_secs(2 * 60 * 60));
    tokio::pin!(hard_deadline);
    let mut parsed_events = 0usize;
    loop {
        tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() {
                    let _ = child.kill().await;
                    return Err(anyhow!("CLI process cancelled"));
                }
            }
            _ = &mut idle_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process became unresponsive and timed out"));
            }
            _ = &mut hard_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process exceeded the maximum two-hour turn duration"));
            }
            line = lines.next() => match line {
                Some(Ok(line)) => {
                    idle_deadline.as_mut().reset(tokio::time::Instant::now() + timeout);
                    if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                        parsed_events += 1;
                        on_json(value);
                    }
                }
                Some(Err(error)) => return Err(anyhow!("CLI JSONL output is invalid: {error}")),
                None => break,
            }
        }
    }
    let status = child
        .wait()
        .await
        .context("failed to wait for CLI process")?;
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliJsonlOutput {
        success: status.success(),
        exit_code: status.code(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        parsed_events,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn run_codex_app_server<F>(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: &Path,
    prompt: &[u8],
    model: Option<&str>,
    effort: Option<&str>,
    service_tier: Option<&str>,
    full_access: bool,
    collaboration_mode: &str,
    timeout: Duration,
    mut cancellation: watch::Receiver<bool>,
    mut on_json: F,
) -> Result<CliJsonlOutput>
where
    F: FnMut(Value) + Send,
{
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
    }
    let prompt = std::str::from_utf8(prompt).context("Codex input is not valid UTF-8")?;
    let mut command = spec.command();
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {} app-server", spec.program))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stderr is unavailable"))?;
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let mut lines = FramedRead::new(
        stdout,
        LinesCodec::new_with_max_length(MAX_JSONL_LINE_BYTES),
    );

    write_json_line(&mut stdin, &codex_initialize_request()).await?;

    let idle_deadline = tokio::time::sleep(timeout);
    tokio::pin!(idle_deadline);
    let hard_deadline = tokio::time::sleep(Duration::from_secs(2 * 60 * 60));
    tokio::pin!(hard_deadline);
    let mut thread_id: Option<String> = None;
    let mut turn_id: Option<String> = None;
    let mut parsed_events = 0usize;
    let mut completed_successfully = false;

    loop {
        tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() {
                    if let (Some(thread_id), Some(turn_id)) = (&thread_id, &turn_id) {
                        let _ = write_json_line(
                            &mut stdin,
                            &json!({
                                "id": 90,
                                "method": "turn/interrupt",
                                "params": { "threadId": thread_id, "turnId": turn_id }
                            }),
                        ).await;
                    }
                    let _ = child.kill().await;
                    return Err(anyhow!("CLI process cancelled"));
                }
            }
            _ = &mut idle_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process became unresponsive and timed out"));
            }
            _ = &mut hard_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process exceeded the maximum two-hour turn duration"));
            }
            line = lines.next() => {
                let Some(line) = line else {
                    break;
                };
                let line = line.map_err(|error| anyhow!("Codex app-server output is invalid: {error}"))?;
                idle_deadline.as_mut().reset(tokio::time::Instant::now() + timeout);
                let value = serde_json::from_str::<Value>(line.trim())
                    .context("Codex app-server emitted invalid JSONL")?;

                let step = codex_app_server_step(
                    value,
                    cwd,
                    prompt,
                    model,
                    effort,
                    service_tier,
                    full_access,
                    collaboration_mode,
                    &mut thread_id,
                    &mut turn_id,
                )?;
                for message in step.outbound {
                    write_json_line(&mut stdin, &message).await?;
                }
                if let Some(event) = step.event {
                    parsed_events += 1;
                    on_json(event);
                }
                if let Some(completed) = step.completed_successfully {
                    completed_successfully = completed;
                    break;
                }
            }
        }
    }

    let _ = child.kill().await;
    let status = child.wait().await.ok();
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliJsonlOutput {
        success: completed_successfully,
        exit_code: status.and_then(|status| status.code()),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        parsed_events,
    })
}

async fn write_json_line(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_vec(value)?;
    payload.push(b'\n');
    stdin.write_all(&payload).await?;
    stdin.flush().await?;
    Ok(())
}

pub fn bounded_diagnostic(value: &str) -> String {
    value.trim().chars().take(2_000).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    // Windows command shims share console/process resources and become
    // nondeterministic when the Rust harness launches all protocol fixtures
    // at once. Serialize only these subprocess tests; production CLI turns
    // remain fully concurrent.
    static CLI_FIXTURE_PROCESS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn rejects_command_lines_disguised_as_executable_names() {
        assert!(validate_configured_program(Some("codex --dangerous"), "codex").is_err());
        assert!(validate_configured_program(Some("CODEX_HOME=x codex"), "codex").is_err());
        assert_eq!(validate_configured_program(None, "codex").unwrap(), "codex");
    }

    #[test]
    fn diagnostics_are_bounded() {
        assert_eq!(bounded_diagnostic(&"x".repeat(3_000)).len(), 2_000);
    }

    #[test]
    fn codex_initialize_negotiates_collaboration_mode_capability() {
        assert_eq!(
            codex_initialize_request().pointer("/params/capabilities/experimentalApi"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn codex_access_mode_params_match_app_server_protocol() {
        let restricted_thread =
            codex_thread_start_params(Path::new("project"), Some("gpt-test"), None, false);
        assert_eq!(restricted_thread["sandbox"], json!("read-only"));

        let restricted_turn = codex_turn_start_params(
            "thread-1",
            "inspect",
            Some("gpt-test"),
            Some("high"),
            None,
            "default",
            false,
        );
        assert_eq!(
            restricted_turn["sandboxPolicy"],
            json!({ "type": "readOnly", "networkAccess": false })
        );

        let full_thread = codex_thread_start_params(
            Path::new("project"),
            Some("gpt-test"),
            Some("priority"),
            true,
        );
        assert_eq!(full_thread["sandbox"], json!("danger-full-access"));
        assert_eq!(full_thread["serviceTier"], json!("priority"));

        let full_turn = codex_turn_start_params(
            "thread-1",
            "edit",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            "default",
            true,
        );
        assert_eq!(
            full_turn["sandboxPolicy"],
            json!({ "type": "dangerFullAccess" })
        );
        assert_eq!(full_turn["effort"], json!("ultra"));
        assert_eq!(full_turn["serviceTier"], json!("priority"));
    }

    #[cfg(windows)]
    #[test]
    fn npm_windows_shim_uses_node_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let npm_script = directory.path().join("npm");
        let npm_cmd = directory.path().join("npm.cmd");
        let node_exe = directory.path().join("node.exe");
        let npm_cli = directory
            .path()
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        std::fs::create_dir_all(npm_cli.parent().unwrap()).unwrap();
        std::fs::write(&npm_script, "#!/bin/sh\n").unwrap();
        std::fs::write(&npm_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&node_exe, []).unwrap();
        std::fs::write(&npm_cli, "").unwrap();

        let resolved =
            find_program_in_directories("npm", vec![directory.path().to_path_buf()]).unwrap();
        assert_eq!(resolved, npm_cmd);

        let spec = windows_npm_node_entrypoint(&npm_cmd).unwrap();
        assert_eq!(spec.program, node_exe.to_string_lossy().into_owned());
        assert_eq!(
            spec.prefix_args,
            vec![npm_cli.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), npm_cmd.to_str());

        let extensionless_spec = windows_npm_node_entrypoint(&npm_script).unwrap();
        assert_eq!(extensionless_spec.program, spec.program);
        assert_eq!(extensionless_spec.prefix_args, spec.prefix_args);
    }

    #[cfg(windows)]
    #[test]
    fn managed_codex_windows_shim_uses_local_package_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("node_modules/.bin");
        let codex_cmd = bin.join("codex.cmd");
        let codex_js = directory
            .path()
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(codex_js.parent().unwrap()).unwrap();
        std::fs::write(&codex_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&codex_js, "").unwrap();

        let spec = windows_codex_node_entrypoint(&codex_cmd).unwrap();
        assert_eq!(
            spec.prefix_args,
            vec![codex_js.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), codex_cmd.to_str());
    }

    #[cfg(windows)]
    #[test]
    fn managed_codebuddy_windows_shim_uses_local_package_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("node_modules/.bin");
        let codebuddy_cmd = bin.join("codebuddy.cmd");
        let codebuddy_entrypoint = directory
            .path()
            .join("node_modules")
            .join("@tencent-ai")
            .join("codebuddy-code")
            .join("bin")
            .join("codebuddy");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(codebuddy_entrypoint.parent().unwrap()).unwrap();
        std::fs::write(&codebuddy_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&codebuddy_entrypoint, "").unwrap();

        let spec = windows_codebuddy_node_entrypoint(&codebuddy_cmd).unwrap();
        assert_eq!(
            spec.prefix_args,
            vec![codebuddy_entrypoint.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), codebuddy_cmd.to_str());
    }

    #[tokio::test]
    async fn fake_cli_streams_jsonl_and_collects_stderr() {
        let _process_guard = CLI_FIXTURE_PROCESS_LOCK.lock().await;
        let fixture = fake_cli_fixture(false);
        let values = Arc::new(StdMutex::new(Vec::new()));
        let captured = Arc::clone(&values);
        let (_cancellation, receiver) = watch::channel(false);
        let output = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_secs(5),
            receiver,
            move |value| captured.lock().unwrap().push(value),
        )
        .await
        .unwrap();
        assert!(output.success);
        assert_eq!(output.parsed_events, 2);
        assert!(output.stderr.contains("fixture diagnostic"));
        assert_eq!(values.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn fake_cli_timeout_terminates_the_process() {
        let _process_guard = CLI_FIXTURE_PROCESS_LOCK.lock().await;
        let fixture = fake_cli_fixture(true);
        let (_cancellation, receiver) = watch::channel(false);
        let error = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_millis(50),
            receiver,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn fake_cli_cancellation_terminates_the_process() {
        let _process_guard = CLI_FIXTURE_PROCESS_LOCK.lock().await;
        let fixture = fake_cli_fixture(true);
        let (cancellation, receiver) = watch::channel(false);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let _ = cancellation.send(true);
        });
        let error = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_secs(5),
            receiver,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("cancelled"));
    }

    #[test]
    fn codex_app_server_state_machine_runs_thread_and_turn_protocol() {
        let mut thread_id = None;
        let mut turn_id = None;
        let cwd = Path::new("workspace");
        let initialize = codex_app_server_step(
            json!({ "id": 1, "result": {} }),
            cwd,
            "inspect the active SQL",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            true,
            "default",
            &mut thread_id,
            &mut turn_id,
        )
        .unwrap();
        assert_eq!(initialize.outbound[0], json!({ "method": "initialized" }));
        assert_eq!(initialize.outbound[1]["method"], json!("thread/start"));
        assert_eq!(
            initialize.outbound[1]["params"]["serviceTier"],
            json!("priority")
        );

        let thread = codex_app_server_step(
            json!({ "id": 2, "result": { "thread": { "id": "thread-1" } } }),
            cwd,
            "inspect the active SQL",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            true,
            "default",
            &mut thread_id,
            &mut turn_id,
        )
        .unwrap();
        assert_eq!(thread_id.as_deref(), Some("thread-1"));
        assert_eq!(thread.outbound[0]["method"], json!("turn/start"));
        assert_eq!(thread.outbound[0]["params"]["effort"], json!("ultra"));

        let turn = codex_app_server_step(
            json!({ "id": 3, "result": { "turn": { "id": "turn-1" } } }),
            cwd,
            "inspect the active SQL",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            true,
            "default",
            &mut thread_id,
            &mut turn_id,
        )
        .unwrap();
        assert!(turn.outbound.is_empty());
        assert_eq!(turn_id.as_deref(), Some("turn-1"));

        let completed = codex_app_server_step(
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1", "status": "completed" }
                }
            }),
            cwd,
            "inspect the active SQL",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            true,
            "default",
            &mut thread_id,
            &mut turn_id,
        )
        .unwrap();
        assert_eq!(completed.completed_successfully, Some(true));
        assert_eq!(
            completed
                .event
                .as_ref()
                .and_then(|value| value.get("method"))
                .and_then(Value::as_str),
            Some("turn/completed")
        );
    }

    struct FakeCliFixture {
        directory: TempDir,
        spec: CliCommandSpec,
    }

    fn fake_cli_fixture(wait: bool) -> FakeCliFixture {
        let directory = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let (script, body) = {
            let script = directory.path().join("fake-cli.cmd");
            let wait_command = if wait {
                "@ping -n 6 127.0.0.1 >nul\r\n"
            } else {
                ""
            };
            let body = format!(
                "@echo {{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"ok\"}}}}\r\n@echo {{\"type\":\"result\",\"subtype\":\"success\"}}\r\n@echo fixture diagnostic 1>&2\r\n{wait_command}"
            );
            (script, body)
        };
        #[cfg(unix)]
        let (script, body) = {
            let script = directory.path().join("fake-cli.sh");
            let wait_command = if wait { "sleep 5\n" } else { "" };
            let body = format!(
                "printf '%s\\n' '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"ok\"}}}}'\nprintf '%s\\n' '{{\"type\":\"result\",\"subtype\":\"success\"}}'\nprintf '%s\\n' 'fixture diagnostic' >&2\n{wait_command}"
            );
            (script, body)
        };
        std::fs::write(&script, body).unwrap();
        #[cfg(windows)]
        let spec = CliCommandSpec {
            program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
            prefix_args: vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                script.to_string_lossy().into_owned(),
            ],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        #[cfg(unix)]
        let spec = CliCommandSpec {
            program: "/bin/sh".to_string(),
            prefix_args: vec![script.to_string_lossy().into_owned()],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        FakeCliFixture { directory, spec }
    }
}
