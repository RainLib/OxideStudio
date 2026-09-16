use anyhow::bail;
use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;

pub(super) const SHELL_OUTPUT_LIMIT_BYTES: usize = 128 * 1024;
pub const DEFAULT_SHELL_TIMEOUT_MS: u64 = 30_000;
pub const MAX_SHELL_TIMEOUT_MS: u64 = 120_000;
pub(super) const MAX_COMMAND_POLICY_FILE_BYTES: u64 = 256 * 1024;
pub(super) const MAX_COMMAND_POLICY_RULES: usize = 100;
pub(super) const MAX_COMMAND_POLICY_PATTERN_CHARS: usize = 512;
pub const PROJECT_COMMAND_POLICY_PATH: &str = ".oxide/command-policy.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandPolicyDecision {
    Allow,
    Confirm,
    Block,
}

impl CommandPolicyDecision {
    pub(super) fn severity(self) -> u8 {
        match self {
            Self::Allow => 0,
            Self::Confirm => 1,
            Self::Block => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPolicyFinding {
    pub rule_id: String,
    pub decision: CommandPolicyDecision,
    pub title: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandConfirmation {
    pub kind: String,
    pub phrase: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreflightResult {
    pub decision: CommandPolicyDecision,
    pub policy_digest: String,
    pub summary: String,
    pub findings: Vec<CommandPolicyFinding>,
    pub executables: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation: Option<CommandConfirmation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CommandPolicyDocument {
    pub(super) version: u32,
    #[serde(default)]
    pub(super) rules: Vec<CommandPolicyRule>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CommandPolicyRule {
    pub(super) id: String,
    pub(super) action: CommandPolicyDecision,
    #[serde(default)]
    pub(super) executables: Vec<String>,
    #[serde(default)]
    pub(super) argument_regex: Option<String>,
    #[serde(default)]
    pub(super) cwd_glob: Option<String>,
    #[serde(default)]
    pub(super) sandbox_modes: Vec<String>,
    #[serde(default)]
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ParsedCommand {
    pub(super) text: String,
    pub(super) tokens: Vec<String>,
    pub(super) executable: Option<String>,
    pub(super) dynamic: bool,
}

#[derive(Debug, Default)]
pub(super) struct ShellSyntax {
    pub(super) commands: Vec<ParsedCommand>,
    pub(super) has_error: bool,
    pub(super) has_command_substitution: bool,
    pub(super) has_process_substitution: bool,
}

pub trait CommandPolicyHook {
    fn evaluate(&self, context: &CommandPolicyContext<'_>) -> Vec<CommandPolicyFinding>;
}

pub struct CommandPolicyContext<'a> {
    pub project_root: &'a Path,
    pub working_directory: &'a Path,
    pub command: &'a str,
    pub sandbox_mode: ShellSandboxMode,
    pub(super) syntax: &'a ShellSyntax,
}

pub(super) struct BuiltInCommandPolicyHook;

pub(super) struct DeclarativeCommandPolicyHook {
    pub(super) source: &'static str,
    pub(super) rules: Vec<CommandPolicyRule>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellSandboxMode {
    WorkspaceWrite,
    Unrestricted,
}

impl ShellSandboxMode {
    pub fn parse(value: Option<&str>) -> Result<Self> {
        match value.unwrap_or("workspace-write") {
            "workspace-write" => Ok(Self::WorkspaceWrite),
            "unrestricted" => Ok(Self::Unrestricted),
            value => bail!("unsupported shell sandbox mode: {value}"),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceWrite => "workspace-write",
            Self::Unrestricted => "unrestricted",
        }
    }
}
