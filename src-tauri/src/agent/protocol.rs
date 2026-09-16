pub const AGENT_HOST_PROTOCOL_VERSION: u32 = 1;
pub const AGENT_HOST_MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
pub const AGENT_HOST_EVENT_CHANNEL: &str = "agent://event";
const MAX_HEADER_BYTES: usize = 8 * 1024;

pub const HOST_INITIALIZE_METHOD: &str = "host.initialize";
pub const HOST_START_TURN_METHOD: &str = "turn.start";
pub const HOST_RESUME_TURN_METHOD: &str = "turn.resume";
pub const HOST_CANCEL_TURN_METHOD: &str = "turn.cancel";
pub const HOST_ANSWER_CLARIFICATION_METHOD: &str = "turn.answerClarification";
pub const HOST_RESOLVE_APPROVAL_METHOD: &str = "turn.resolveApproval";

pub const SIDECAR_MODEL_COMPLETE_METHOD: &str = "model.complete";
pub const SIDECAR_MODEL_STREAM_METHOD: &str = "model.stream";
pub const HOST_MODEL_CHUNK_METHOD: &str = "model.chunk";
pub const SIDECAR_TOOL_PREFLIGHT_METHOD: &str = "tool.preflight";
pub const SIDECAR_TOOL_INVOKE_METHOD: &str = "tool.invoke";
pub const SIDECAR_CHECKPOINT_LOAD_METHOD: &str = "checkpoint.load";
pub const SIDECAR_CHECKPOINT_SAVE_METHOD: &str = "checkpoint.save";
pub const SIDECAR_GRAPH_CHECKPOINT_GET_METHOD: &str = "graph.checkpoint.get";
pub const SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD: &str = "graph.checkpoint.list";
pub const SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD: &str = "graph.checkpoint.put";
pub const SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD: &str = "graph.checkpoint.putWrites";
pub const SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD: &str = "graph.checkpoint.deleteThread";
pub const SIDECAR_ARTIFACT_READ_METHOD: &str = "artifact.read";
pub const SIDECAR_ARTIFACT_SEARCH_METHOD: &str = "artifact.search";
pub const SIDECAR_EVENT_METHOD: &str = "agent.event";

mod artifacts;
mod graph;
mod invocation;
mod provider;
mod rpc;
#[cfg(test)]
mod tests;
mod turns;

pub use artifacts::*;
pub use graph::*;
pub use invocation::*;
pub use provider::*;
pub use rpc::*;
pub use turns::*;
