use super::types::{
    CommandPolicyDecision, CommandPolicyDocument, CommandPolicyFinding,
    MAX_COMMAND_POLICY_FILE_BYTES, MAX_COMMAND_POLICY_PATTERN_CHARS, MAX_COMMAND_POLICY_RULES,
    PROJECT_COMMAND_POLICY_PATH,
};
use regex::Regex;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::path::Path;

pub(super) fn global_command_policy(
    settings: &Value,
) -> std::result::Result<Option<CommandPolicyDocument>, String> {
    let Some(value) = settings
        .get("ai")
        .and_then(|value| value.get("shell"))
        .and_then(|value| value.get("commandPolicy"))
    else {
        return Ok(None);
    };
    parse_policy_document(value.clone(), "settings.json ai.shell.commandPolicy").map(Some)
}

pub(super) fn project_command_policy(
    project_root: &Path,
) -> std::result::Result<Option<(CommandPolicyDocument, String)>, String> {
    let path = project_root.join(PROJECT_COMMAND_POLICY_PATH);
    if !path.exists() {
        return Ok(None);
    }
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "{} must be a regular project file, not a symlink",
            path.display()
        ));
    }
    if metadata.len() > MAX_COMMAND_POLICY_FILE_BYTES {
        return Err(format!(
            "{} exceeds the 256 KiB policy limit",
            path.display()
        ));
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid JSON in {}: {error}", path.display()))?;
    let document = parse_policy_document(value, PROJECT_COMMAND_POLICY_PATH)?;
    Ok(Some((document, hex_digest(&bytes))))
}

pub(super) fn parse_policy_document(
    value: Value,
    source: &str,
) -> std::result::Result<CommandPolicyDocument, String> {
    let document: CommandPolicyDocument =
        serde_json::from_value(value).map_err(|error| format!("invalid {source}: {error}"))?;
    if document.version != 1 {
        return Err(format!(
            "{source} uses unsupported version {}",
            document.version
        ));
    }
    if document.rules.len() > MAX_COMMAND_POLICY_RULES {
        return Err(format!(
            "{source} contains more than {MAX_COMMAND_POLICY_RULES} rules"
        ));
    }
    for (index, rule) in document.rules.iter().enumerate() {
        if rule.id.trim().is_empty() || rule.id.chars().count() > 120 {
            return Err(format!(
                "{source} rules[{index}].id must contain 1 to 120 characters"
            ));
        }
        if rule.action == CommandPolicyDecision::Allow {
            return Err(format!(
                "{source} rules[{index}].action cannot lower protection to allow"
            ));
        }
        if rule.executables.is_empty()
            && rule.argument_regex.is_none()
            && rule.cwd_glob.is_none()
            && rule.sandbox_modes.is_empty()
        {
            return Err(format!(
                "{source} rules[{index}] must include at least one matcher"
            ));
        }
        if rule.executables.len() > 100 {
            return Err(format!(
                "{source} rules[{index}].executables contains more than 100 entries"
            ));
        }
        if rule.sandbox_modes.len() > 2 {
            return Err(format!(
                "{source} rules[{index}].sandboxModes contains too many entries"
            ));
        }
        for executable in &rule.executables {
            validate_policy_pattern(source, index, "executables", executable)?;
            if executable.contains('/') || executable.contains('\\') {
                return Err(format!(
                    "{source} rules[{index}].executables must use command basenames"
                ));
            }
        }
        if let Some(pattern) = rule.argument_regex.as_deref() {
            validate_policy_pattern(source, index, "argumentRegex", pattern)?;
            Regex::new(pattern).map_err(|error| {
                format!("{source} rules[{index}].argumentRegex is invalid: {error}")
            })?;
        }
        if let Some(pattern) = rule.cwd_glob.as_deref() {
            validate_policy_pattern(source, index, "cwdGlob", pattern)?;
        }
        if rule
            .sandbox_modes
            .iter()
            .any(|mode| !matches!(mode.as_str(), "workspace-write" | "unrestricted"))
        {
            return Err(format!(
                "{source} rules[{index}].sandboxModes contains an unsupported mode"
            ));
        }
        if rule
            .message
            .as_ref()
            .is_some_and(|message| message.chars().count() > 500)
        {
            return Err(format!(
                "{source} rules[{index}].message exceeds 500 characters"
            ));
        }
    }
    Ok(document)
}

pub(super) fn validate_policy_pattern(
    source: &str,
    index: usize,
    field: &str,
    value: &str,
) -> std::result::Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > MAX_COMMAND_POLICY_PATTERN_CHARS {
        return Err(format!(
            "{source} rules[{index}].{field} must contain 1 to {MAX_COMMAND_POLICY_PATTERN_CHARS} characters"
        ));
    }
    Ok(())
}

pub(super) fn stable_policy_document(document: &CommandPolicyDocument) -> String {
    serde_json::to_vec(&document.rules)
        .map(|bytes| hex_digest(&bytes))
        .unwrap_or_else(|_| "invalid".to_string())
}

pub(super) fn policy_configuration_finding(source: &str, detail: String) -> CommandPolicyFinding {
    finding(
        &format!("{source}.policy.invalid"),
        CommandPolicyDecision::Block,
        "Command policy configuration is invalid",
        &detail,
        None,
    )
}

pub(super) fn finding(
    rule_id: &str,
    decision: CommandPolicyDecision,
    title: &str,
    detail: &str,
    evidence: Option<&str>,
) -> CommandPolicyFinding {
    CommandPolicyFinding {
        rule_id: rule_id.to_string(),
        decision,
        title: title.to_string(),
        detail: detail.to_string(),
        evidence: evidence.map(|value| bounded_policy_text(value, 240)),
    }
}

pub(super) fn bounded_policy_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub(super) fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
