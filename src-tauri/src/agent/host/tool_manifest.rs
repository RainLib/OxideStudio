use super::identity_helpers::bounded_text;
use crate::agent::protocol::AgentProfile;
use crate::agent::protocol::AgentToolManifestEntry;
use anyhow::anyhow;
use anyhow::Result;

pub(super) const REQUIRED_CAPABILITIES: &[&str] = &[
    "chat",
    "plan",
    "agent",
    "model-proxy",
    "tool-proxy",
    "checkpoint-proxy",
    "artifact-proxy",
    "clarification",
    "approval",
    "subagents",
    "context-compaction",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RustHostTool {
    ProjectListFiles,
    ProjectReadFile,
    ProjectWriteFile,
    ConnectionList,
    ConnectionCapabilities,
    ProviderList,
    WorkspaceGetActiveTab,
    MetadataListCollections,
    MetadataListObjects,
    MetadataDescribeObject,
    QueryRunReadOnly,
    QueryExplain,
    QueryExecuteApproved,
    ShellExecute,
}

impl RustHostTool {
    pub(super) const ALL: [Self; 14] = [
        Self::ProjectListFiles,
        Self::ProjectReadFile,
        Self::ProjectWriteFile,
        Self::ConnectionList,
        Self::ConnectionCapabilities,
        Self::ProviderList,
        Self::WorkspaceGetActiveTab,
        Self::MetadataListCollections,
        Self::MetadataListObjects,
        Self::MetadataDescribeObject,
        Self::QueryRunReadOnly,
        Self::QueryExplain,
        Self::QueryExecuteApproved,
        Self::ShellExecute,
    ];

    pub(super) const fn name(self) -> &'static str {
        match self {
            Self::ProjectListFiles => "project.listFiles",
            Self::ProjectReadFile => "project.readFile",
            Self::ProjectWriteFile => "project.writeFile",
            Self::ConnectionList => "connection.list",
            Self::ConnectionCapabilities => "connection.capabilities",
            Self::ProviderList => "provider.list",
            Self::WorkspaceGetActiveTab => "workspace.getActiveTab",
            Self::MetadataListCollections => "metadata.listCollections",
            Self::MetadataListObjects => "metadata.listObjects",
            Self::MetadataDescribeObject => "metadata.describeObject",
            Self::QueryRunReadOnly => "query.runReadOnly",
            Self::QueryExplain => "query.explain",
            Self::QueryExecuteApproved => "query.executeApproved",
            Self::ShellExecute => "shell.execute",
        }
    }

    pub(super) const fn permissions(self) -> &'static [&'static str] {
        match self {
            Self::ProjectWriteFile | Self::QueryExecuteApproved => &["write"],
            Self::ShellExecute => &["external"],
            _ => &["read"],
        }
    }

    pub(super) fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tool| tool.name() == name)
    }
}

pub(super) fn installed_host_tool_names() -> Vec<String> {
    RustHostTool::ALL
        .into_iter()
        .map(|tool| tool.name().to_string())
        .collect()
}

pub(super) fn validate_host_tool_manifest(
    profile: AgentProfile,
    tools: &[AgentToolManifestEntry],
) -> Result<()> {
    for tool in tools {
        let Some(installed) = RustHostTool::from_name(&tool.name) else {
            return Err(anyhow!(
                "tool {} is not installed in the Rust Agent Host",
                bounded_text(&tool.name, 200)
            ));
        };
        if tool.permissions.len() != installed.permissions().len()
            || !installed
                .permissions()
                .iter()
                .all(|permission| tool.permissions.iter().any(|value| value == permission))
        {
            return Err(anyhow!(
                "tool {} permissions do not match the Rust Agent Host policy",
                bounded_text(&tool.name, 200)
            ));
        }
        if profile == AgentProfile::Chat && installed != RustHostTool::WorkspaceGetActiveTab {
            return Err(anyhow!(
                "tool {} is unavailable in Chat mode",
                bounded_text(&tool.name, 200)
            ));
        }
        if profile == AgentProfile::Plan
            && (installed == RustHostTool::ProjectWriteFile
                || tool
                    .permissions
                    .iter()
                    .any(|permission| permission != "read"))
        {
            return Err(anyhow!(
                "tool {} is not read-only and is unavailable in Plan mode",
                bounded_text(&tool.name, 200)
            ));
        }
    }
    Ok(())
}
