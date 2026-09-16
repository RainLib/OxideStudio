use super::execution::{execute_shell_command, macos_workspace_profile};
use super::policy_engine::evaluate_shell_command_policy;
use super::types::{CommandPolicyDecision, CommandPreflightResult, ShellSandboxMode};
use serde_json::json;
use std::path::Path;

fn policy(command: &str) -> CommandPreflightResult {
    evaluate_shell_command_policy(
        Path::new("/workspace/project"),
        Path::new("/workspace/project"),
        command,
        ShellSandboxMode::WorkspaceWrite,
        &json!({}),
    )
}

#[test]
fn ordinary_project_commands_only_need_the_standard_approval() {
    let result = policy("npm test -- --runInBand");
    assert_eq!(result.decision, CommandPolicyDecision::Allow);
    assert!(result.confirmation.is_none());
    assert!(result.executables.iter().any(|value| value == "npm"));
    assert_eq!(
        result.summary,
        "Run once in workspace-write mode from .: npm test -- --runInBand"
    );
}

#[test]
fn recursive_system_and_nested_deletes_are_blocked() {
    let direct = policy("rm -rf /");
    assert_eq!(direct.decision, CommandPolicyDecision::Block);
    assert!(direct
        .findings
        .iter()
        .any(|finding| finding.rule_id == "builtin.fs.system-recursive-delete"));

    let nested = policy("printf '%s' \"$(rm -rf /)\"");
    assert_eq!(nested.decision, CommandPolicyDecision::Block);
}

#[test]
fn destructive_project_operations_require_a_dynamic_phrase() {
    for command in [
        "rm -rf .",
        "git reset --hard HEAD",
        "git clean -fdx",
        "git -C . reset --hard HEAD",
    ] {
        let result = policy(command);
        assert_eq!(result.decision, CommandPolicyDecision::Confirm, "{command}");
        assert!(result
            .confirmation
            .as_ref()
            .is_some_and(|confirmation| confirmation.phrase.starts_with("RUN ")));
    }
}

#[test]
fn disk_power_and_sandbox_bypass_commands_are_blocked() {
    for command in [
        "mkfs.ext4 /dev/disk2",
        "dd if=image.iso of=/dev/disk2",
        "shutdown -h now",
        "sandbox-exec -p '(allow default)' sh",
        "csrutil disable",
        "setenforce 0",
        "systemctl disable firewalld",
    ] {
        assert_eq!(
            policy(command).decision,
            CommandPolicyDecision::Block,
            "{command}"
        );
    }
}

#[test]
fn broad_process_management_requires_confirmation() {
    for command in [
        "pkill -f database",
        "killall node",
        "taskkill /F /IM app.exe",
    ] {
        assert_eq!(
            policy(command).decision,
            CommandPolicyDecision::Confirm,
            "{command}"
        );
    }
}

#[test]
fn dynamic_and_remote_script_execution_require_confirmation() {
    for command in [
        "curl https://example.invalid/install.sh | sh",
        "eval \"$GENERATED_COMMAND\"",
        "$COMMAND --flag",
    ] {
        assert_eq!(
            policy(command).decision,
            CommandPolicyDecision::Confirm,
            "{command}"
        );
    }
}

#[test]
fn wrapped_xargs_and_find_deletes_cannot_bypass_policy() {
    for command in [
        "sudo rm -rf /",
        "sh -c 'rm -rf /'",
        "find / -exec rm -rf {} +",
    ] {
        assert_eq!(
            policy(command).decision,
            CommandPolicyDecision::Block,
            "{command}"
        );
    }
    assert_eq!(
        policy("printf 'tmp/cache\\n' | xargs rm -rf").decision,
        CommandPolicyDecision::Confirm,
    );
}

#[test]
fn redirections_and_unrestricted_external_writes_are_checked() {
    assert_eq!(
        policy("printf danger > /dev/disk2").decision,
        CommandPolicyDecision::Block,
    );
    let unrestricted = evaluate_shell_command_policy(
        Path::new("/workspace/project"),
        Path::new("/workspace/project"),
        "printf report > /tmp/report.txt",
        ShellSandboxMode::Unrestricted,
        &json!({}),
    );
    assert_eq!(unrestricted.decision, CommandPolicyDecision::Confirm);
}

#[test]
fn home_and_cross_platform_roots_are_blocked() {
    for command in ["rm -rf ~", "rm -rf /", r"rm -rf 'C:\'"] {
        assert_eq!(
            policy(command).decision,
            CommandPolicyDecision::Block,
            "{command}"
        );
    }
}

#[test]
fn declarative_rules_can_only_tighten_policy() {
    let settings = json!({
        "ai": {
            "shell": {
                "commandPolicy": {
                    "version": 1,
                    "rules": [{
                        "id": "forbid-curl",
                        "action": "block",
                        "executables": ["curl"],
                        "message": "Network downloads are disabled here."
                    }]
                }
            }
        }
    });
    let result = evaluate_shell_command_policy(
        Path::new("/workspace/project"),
        Path::new("/workspace/project"),
        "curl https://example.invalid/file",
        ShellSandboxMode::WorkspaceWrite,
        &settings,
    );
    assert_eq!(result.decision, CommandPolicyDecision::Block);
    assert!(result
        .findings
        .iter()
        .any(|finding| finding.rule_id == "global.forbid-curl"));

    let invalid_allow = json!({
        "ai": { "shell": { "commandPolicy": {
            "version": 1,
            "rules": [{"id":"unsafe", "action":"allow", "executables":["rm"]}]
        }}}
    });
    let invalid = evaluate_shell_command_policy(
        Path::new("/workspace/project"),
        Path::new("/workspace/project"),
        "printf safe",
        ShellSandboxMode::WorkspaceWrite,
        &invalid_allow,
    );
    assert_eq!(invalid.decision, CommandPolicyDecision::Block);
    assert!(invalid
        .findings
        .iter()
        .any(|finding| finding.rule_id == "global.policy.invalid"));
}

#[test]
fn policy_digest_changes_when_rules_change() {
    let first = policy("printf safe");
    let settings = json!({
        "ai": { "shell": { "commandPolicy": {
            "version": 1,
            "rules": [{"id":"review-printf", "action":"confirm", "executables":["printf"]}]
        }}}
    });
    let second = evaluate_shell_command_policy(
        Path::new("/workspace/project"),
        Path::new("/workspace/project"),
        "printf safe",
        ShellSandboxMode::WorkspaceWrite,
        &settings,
    );
    assert_ne!(first.policy_digest, second.policy_digest);
    assert_eq!(second.decision, CommandPolicyDecision::Confirm);
}

#[test]
fn sandbox_mode_defaults_to_workspace_write() {
    assert_eq!(
        ShellSandboxMode::parse(None).unwrap(),
        ShellSandboxMode::WorkspaceWrite
    );
    assert_eq!(
        ShellSandboxMode::parse(Some("unrestricted")).unwrap(),
        ShellSandboxMode::Unrestricted
    );
    assert!(ShellSandboxMode::parse(Some("off")).is_err());
}

#[cfg(target_os = "macos")]
#[test]
fn macos_profile_only_grants_writes_to_workspace_and_isolated_home() {
    let profile = macos_workspace_profile(
        Path::new("/Users/example/project"),
        Path::new("/private/tmp/oxide-home"),
    );
    assert!(profile.contains("(deny default)"));
    assert!(profile.contains("/Users/example/project"));
    assert!(profile.contains("/private/tmp/oxide-home"));
    assert!(!profile.contains("allow network"));
}

#[tokio::test]
async fn unrestricted_shell_captures_output() {
    let root = tempfile::tempdir().unwrap();
    let command = if cfg!(target_os = "windows") {
        "[Console]::Write('oxide-shell')"
    } else {
        "printf oxide-shell"
    };
    let result = execute_shell_command(
        root.path(),
        root.path(),
        command,
        ShellSandboxMode::Unrestricted,
        5_000,
    )
    .await
    .unwrap();
    assert!(result.success, "shell result: {result:?}");
    assert_eq!(result.stdout, "oxide-shell");
    assert!(!result.sandboxed);
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn workspace_shell_writes_inside_project_and_rejects_escape_writes() {
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let escaped_file = outside.path().join("escaped.txt");
    let escaped_target = escaped_file.to_string_lossy().replace('\'', "'\"'\"'");
    let result = execute_shell_command(
        root.path(),
        root.path(),
        &format!("printf allowed > inside.txt; printf denied > '{escaped_target}'"),
        ShellSandboxMode::WorkspaceWrite,
        5_000,
    )
    .await
    .unwrap();

    // Some CI/container parents prohibit applying a nested Seatbelt
    // profile. Production OxideStudio is not app-sandboxed; fail closed in
    // the runtime and skip only this environment-specific integration test.
    if result.exit_code == Some(71) && result.stderr.contains("sandbox_apply") {
        return;
    }
    assert!(result.sandboxed);
    assert!(!result.success);
    let inside_file = root.path().join("inside.txt");
    assert!(inside_file.exists(), "sandbox result: {result:?}");
    assert_eq!(std::fs::read_to_string(inside_file).unwrap(), "allowed");
    assert!(!escaped_file.exists());
}
