pub mod bridge;
#[cfg(feature = "desktop")]
pub mod host;
#[cfg(feature = "desktop")]
pub mod model;
pub mod protocol;
#[cfg(feature = "desktop")]
pub mod shell;
#[cfg(feature = "desktop")]
pub mod store;

#[cfg(feature = "desktop")]
pub use bridge::PrivateBridgeSession;
#[cfg(feature = "desktop")]
pub use host::AgentHostManager;
pub use protocol::{
    AgentActionAccepted, AgentAnswerClarificationRequest, AgentApproveActionRequest,
    AgentArtifactExportRequest, AgentArtifactExportResult, AgentArtifactReadRequest,
    AgentArtifactReadResult, AgentArtifactSearchRequest, AgentArtifactSearchResult,
    AgentCancelTurnRequest, AgentContextMetrics, AgentConversationSnapshot,
    AgentConversationSnapshotSaveRequest, AgentHostStatus, AgentProjectStateCleared,
    AgentProviderKind, AgentTextAttachment, AgentTurnAccepted, AgentTurnJournal, AgentTurnRequest,
    AgentTurnRuntimeStatus,
};
