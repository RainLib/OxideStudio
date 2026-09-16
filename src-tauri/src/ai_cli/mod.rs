pub mod agent;
pub mod codebuddy;
pub mod codex;
mod codex_protocol;
mod executable;
pub mod runtime;
pub mod setup;

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
    pub service_tier: Option<String>,
    #[serde(default)]
    pub access_mode: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub environment_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliModelInfo {
    pub id: String,
    pub label: String,
    /// Keeps a concrete provider default distinct from the OxideStudio
    /// `default` sentinel stored in `is_default`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_provider_default: bool,
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_tiers: Vec<CliModelServiceTier>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliModelServiceTier {
    pub id: String,
    pub name: String,
    pub description: String,
}

impl CliModelInfo {
    pub fn new(id: impl Into<String>, label: impl Into<String>, is_default: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            is_provider_default: false,
            is_default,
            reasoning_efforts: Vec::new(),
            service_tiers: Vec::new(),
        }
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliCommandInfo {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argument_hint: Option<String>,
}

impl CliCommandInfo {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            argument_hint: None,
        }
    }

    pub fn with_argument_hint(mut self, hint: impl Into<String>) -> Self {
        self.argument_hint = Some(hint.into());
        self
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub provider: CliProviderKind,
    pub executable_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallationLaunchResult {
    pub provider: CliProviderKind,
    pub session_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CliInstallationPhase {
    Starting,
    Downloading,
    Installing,
    Verifying,
    Succeeded,
    Failed,
}

impl CliInstallationPhase {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallationStatus {
    pub session_id: String,
    pub provider: CliProviderKind,
    pub phase: CliInstallationPhase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<CliInstallResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAuthenticationLaunchResult {
    pub provider: CliProviderKind,
    pub session_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliAuthenticationMethod {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CliAuthenticationPhase {
    Starting,
    WaitingForBrowser,
    WaitingForCallback,
    Verifying,
    Succeeded,
    Failed,
    Cancelled,
    Expired,
}

impl CliAuthenticationPhase {
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Expired
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAuthenticationStatus {
    pub session_id: String,
    pub provider: CliProviderKind,
    pub phase: CliAuthenticationPhase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliEnvironmentRequest {
    pub provider: CliProviderKind,
    pub profile_id: String,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliEnvironmentSaveResult {
    pub keys: Vec<String>,
    pub revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileRequest {
    pub provider: CliProviderKind,
    pub profile_id: String,
}
