pub mod codebuddy;
pub mod codex;
pub mod runtime;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum CliProviderKind {
    CodexCli,
    CodebuddyCli,
}

impl CliProviderKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CodexCli => "codex-cli",
            Self::CodebuddyCli => "codebuddy-cli",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::CodexCli => "Codex CLI",
            Self::CodebuddyCli => "CodeBuddy Code CLI",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProviderConfig {
    pub kind: CliProviderKind,
    pub profile_id: String,
    #[serde(default)]
    pub executable_path: Option<String>,
    pub model: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub environment_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliModelInfo {
    pub id: String,
    pub label: String,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<String>,
}

impl CliModelInfo {
    pub fn new(id: impl Into<String>, label: impl Into<String>, is_default: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            is_default,
            reasoning_efforts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDetectionResult {
    pub provider: CliProviderKind,
    pub available: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConnectionTestResult {
    pub message: String,
    pub model: String,
    pub executable_path: String,
    pub version: Option<String>,
    pub latency_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliEnvironmentRequest {
    pub provider: CliProviderKind,
    pub profile_id: String,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileRequest {
    pub provider: CliProviderKind,
    pub profile_id: String,
}
