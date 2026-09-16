export * from "./agent-host/contracts";
export {
  isAgentCitation,
  isAgentHostEvent,
  isAgentHostUnavailableError,
} from "./agent-host/validation";

import {
  exportAgentArtifact,
  importAgentTextAttachment,
  readAgentArtifact,
  searchAgentArtifact,
} from "./agent-host/artifacts";
import {
  listAgentConversationSnapshots,
  loadAgentConversationSnapshot,
  saveAgentConversationSnapshot,
} from "./agent-host/conversations";
import { listenAgentHostEvents } from "./agent-host/events";
import {
  clearAgentProjectState,
  getAgentContextMetrics,
  getAgentHostStatus,
} from "./agent-host/status";
import {
  answerAgentClarification,
  approveAgentAction,
  cancelAgentTurn,
  getAgentTurnRuntimeStatus,
  loadAgentTurnJournal,
  resumeAgentTurn,
  startAgentTurn,
} from "./agent-host/turns";

export const agentHostService = {
  getStatus: getAgentHostStatus,
  getContextMetrics: getAgentContextMetrics,
  saveConversationSnapshot: saveAgentConversationSnapshot,
  loadConversationSnapshot: loadAgentConversationSnapshot,
  listConversationSnapshots: listAgentConversationSnapshots,
  importTextAttachment: importAgentTextAttachment,
  readArtifact: readAgentArtifact,
  searchArtifact: searchAgentArtifact,
  exportArtifact: exportAgentArtifact,
  startTurn: startAgentTurn,
  resumeTurn: resumeAgentTurn,
  cancelTurn: cancelAgentTurn,
  getTurnRuntimeStatus: getAgentTurnRuntimeStatus,
  loadTurnJournal: loadAgentTurnJournal,
  answerClarification: answerAgentClarification,
  approveAction: approveAgentAction,
  clearProjectState: clearAgentProjectState,
  listen: listenAgentHostEvents,
};
