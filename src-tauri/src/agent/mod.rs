pub mod bridge;
pub mod host;
pub mod model;
pub mod protocol;
pub mod shell;
pub mod store;

pub use bridge::PrivateBridgeSession;
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
