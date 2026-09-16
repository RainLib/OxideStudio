use super::policy_config::{
    bounded_policy_text, global_command_policy, hex_digest, policy_configuration_finding,
    project_command_policy, stable_policy_document,
};
use super::syntax::parse_shell_syntax;
use super::types::{
    BuiltInCommandPolicyHook, CommandConfirmation, CommandPolicyContext, CommandPolicyDecision,
    CommandPolicyHook, CommandPreflightResult, DeclarativeCommandPolicyHook, ShellSandboxMode,
};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

pub fn evaluate_shell_command_policy(
    project_root: &Path,
    working_directory: &Path,
    command_text: &str,
    sandbox_mode: ShellSandboxMode,
    app_settings: &Value,
) -> CommandPreflightResult {
    let command_text = command_text.trim();
    let syntax = parse_shell_syntax(command_text);
    let context = CommandPolicyContext {
        project_root,
        working_directory,
        command: command_text,
        sandbox_mode,
        syntax: &syntax,
    };
    let mut findings = BuiltInCommandPolicyHook.evaluate(&context);
    let mut policy_material = Vec::new();

    match global_command_policy(app_settings) {
        Ok(Some(document)) => {
            policy_material.push(format!("global:{}", stable_policy_document(&document)));
            findings.extend(
                DeclarativeCommandPolicyHook {
                    source: "global",
                    rules: document.rules,
                }
                .evaluate(&context),
            );
        }
        Ok(None) => policy_material.push("global:none".to_string()),
        Err(error) => findings.push(policy_configuration_finding("global", error)),
    }

    match project_command_policy(project_root) {
        Ok(Some((document, material))) => {
            policy_material.push(format!("project:{material}"));
            findings.extend(
                DeclarativeCommandPolicyHook {
                    source: "project",
                    rules: document.rules,
                }
                .evaluate(&context),
            );
        }
        Ok(None) => policy_material.push("project:none".to_string()),
        Err(error) => findings.push(policy_configuration_finding("project", error)),
    }

    findings.sort_by(|left, right| {
        right
            .decision
            .severity()
            .cmp(&left.decision.severity())
            .then_with(|| left.rule_id.cmp(&right.rule_id))
    });
    findings.dedup_by(|left, right| left.rule_id == right.rule_id);
    let decision = findings
        .iter()
        .map(|finding| finding.decision)
        .max_by_key(|decision| decision.severity())
        .unwrap_or(CommandPolicyDecision::Allow);
    let executables = syntax
        .commands
        .iter()
        .filter_map(|command| command.executable.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let digest_value = serde_json::json!({
        "version": 1,
        "command": command_text,
        "projectRoot": project_root.to_string_lossy(),
        "workingDirectory": working_directory.to_string_lossy(),
        "sandboxMode": sandbox_mode.as_str(),
        "decision": decision,
        "findings": findings,
        "policyMaterial": policy_material,
    });
    let policy_digest = hex_digest(
        serde_json::to_vec(&digest_value)
            .unwrap_or_else(|_| command_text.as_bytes().to_vec())
            .as_slice(),
    );
    let confirmation = (decision == CommandPolicyDecision::Confirm).then(|| {
        let short = policy_digest
            .chars()
            .take(6)
            .collect::<String>()
            .to_ascii_uppercase();
        CommandConfirmation {
            kind: "phrase".to_string(),
            phrase: format!("RUN {short}"),
            prompt: "Type the phrase exactly to run this high-risk command once.".to_string(),
        }
    });
    let relative_cwd = working_directory
        .strip_prefix(project_root)
        .ok()
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| ".".to_string());
    let normalized_command = command_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let summary = format!(
        "Run once in {} mode from {}: {}",
        sandbox_mode.as_str(),
        relative_cwd,
        bounded_policy_text(&normalized_command, 2_000),
    );

    CommandPreflightResult {
        decision,
        policy_digest,
        summary,
        findings,
        executables,
        confirmation,
    }
}
