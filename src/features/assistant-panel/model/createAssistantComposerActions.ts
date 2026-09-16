import { boundedConversationHistory } from "@/ai/assistant/chatContext";
import {
  applyAssistantContextSettings,
  createAssistantTurnInput,
  type AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import {
  appendAssistantDatabaseTableContext,
  mergeAssistantDatabaseTableMentions,
  type AssistantDatabaseTableMention,
} from "@/ai/assistant/databaseTableContext";
import type { AssistantMode } from "@/ai/assistant/modes";
import { resolveAssistantMode } from "@/ai/assistant/modes";
import type { AssistantConversationMessage } from "@/ai/assistant/types";
import { createWorkspaceAiToolContext } from "@/ai/tools/defaultRegistry";
import type { UiActionRegistry } from "@/ai/ui-actions/registry";
import type { UiActionRequest } from "@/ai/ui-actions/types";
import { type PendingTextAttachment } from "@/features/assistant-panel/model/panelTypes";
import {
  assistantToolManifestForProfile,
  createAgentTurnId,
  promptWithTextAttachments,
} from "@/features/assistant-panel/model/turnComposition";
import type { AssistantAgentSession } from "@/features/assistant-session/model/sessionTypes";
import { createAssistantSqlPatchPreview } from "@/lib/assistantSqlPatch";
import type { AgentToolManifestEntry } from "@/services/tauri/agent-host.service";
import { agentHostService } from "@/services/tauri/agent-host.service";
import type { AiProviderConfig } from "@/services/tauri/ai.service";
import type { AssistantComposeRequest } from "@/store/useAssistantComposerStore";
import { useTabStore } from "@/store/useTabStore";

interface AssistantComposerActionsContext {
  message: string;
  session: Pick<AssistantAgentSession, "isBusy" | "startTurn">;
  assistantSubmissionBlockReason: string | null;
  assistantMode: AssistantMode;
  attachments: PendingTextAttachment[];
  databaseMentions: AssistantDatabaseTableMention[];
  setAttachmentError: React.Dispatch<React.SetStateAction<string | null>>;
  contextSettings: AssistantContextSettings;
  assistantNamespace: string | null;
  selectedText: string | null;
  conversationHistory: AssistantConversationMessage[];
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<PendingTextAttachment[]>>;
  setDatabaseMentions: React.Dispatch<
    React.SetStateAction<AssistantDatabaseTableMention[]>
  >;
  autoFollowConversationRef: React.RefObject<boolean>;
  activeProjectId: string;
  modelConfig: AiProviderConfig | null;
  aiStreaming: boolean;
  aiToolCalling: boolean;
  aiStructuredOutput: boolean;
  aiMaxInputTokens: number;
  aiMaxOutputTokens: number;
  activeConnectionDatabase: string | null;
  agentToolManifest: AgentToolManifestEntry[];
  isAddingAttachment: boolean;
  setIsAddingAttachment: React.Dispatch<React.SetStateAction<boolean>>;
  uiActionRegistry: UiActionRegistry;
  composeRequest: AssistantComposeRequest | null;
  consumeComposeRequest: (requestId: string) => void;
}

export function createAssistantComposerActions({
  message,
  session,
  assistantSubmissionBlockReason,
  assistantMode,
  attachments,
  databaseMentions,
  setAttachmentError,
  contextSettings,
  assistantNamespace,
  selectedText,
  conversationHistory,
  setMessage,
  setAttachments,
  setDatabaseMentions,
  autoFollowConversationRef,
  activeProjectId,
  modelConfig,
  aiStreaming,
  aiToolCalling,
  aiStructuredOutput,
  aiMaxInputTokens,
  aiMaxOutputTokens,
  activeConnectionDatabase,
  agentToolManifest,
  isAddingAttachment,
  setIsAddingAttachment,
  uiActionRegistry,
  composeRequest,
  consumeComposeRequest,
}: AssistantComposerActionsContext) {
  const handleSubmit = async () => {
    const prompt = message.trim();
    if (!prompt || session.isBusy || assistantSubmissionBlockReason) return;
    const mode = resolveAssistantMode(assistantMode, prompt);
    const submittedAttachments = attachments;
    const submittedDatabaseMentions = databaseMentions;
    const submittedPrompt = promptWithTextAttachments(
      appendAssistantDatabaseTableContext(prompt, submittedDatabaseMentions),
      submittedAttachments,
    );
    if (submittedPrompt.length > 200_000) {
      setAttachmentError(
        "Prompt and attachment text must stay under 200,000 characters.",
      );
      return;
    }
    const contextSettingsSnapshot = { ...contextSettings };
    const scopedContext = applyAssistantContextSettings(
      createWorkspaceAiToolContext(undefined, {
        activeNamespace: assistantNamespace,
      }),
      contextSettingsSnapshot,
    );
    const turnInput = createAssistantTurnInput(
      submittedPrompt,
      assistantMode,
      selectedText,
      conversationHistory,
      contextSettingsSnapshot,
    );
    const turnId = createAgentTurnId();
    const binding = scopedContext.workspaceContext!;
    setMessage("");
    setAttachments([]);
    setDatabaseMentions([]);
    setAttachmentError(null);
    autoFollowConversationRef.current = true;
    await session.startTurn({
      requestId: `request:${turnId}`,
      turnId,
      projectId: activeProjectId,
      requestedMode: assistantMode,
      profile: mode,
      messages: boundedConversationHistory(turnInput.history),
      prompt: submittedPrompt,
      displayMessage: prompt,
      inputAttachments: submittedAttachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        byteCount: attachment.byteCount,
      })),
      provider: modelConfig
        ? {
            ...modelConfig,
            capabilities: {
              streaming: aiStreaming,
              toolCalling: aiToolCalling,
              structuredOutput: aiStructuredOutput,
              maxInputTokens: aiMaxInputTokens,
              maxOutputTokens: aiMaxOutputTokens,
            },
          }
        : null,
      workspace: {
        projectId: activeProjectId,
        connectionId: scopedContext.activeConnectionId ?? null,
        database:
          scopedContext.activeTab?.databaseName ??
          binding.activeDatabaseName ??
          activeConnectionDatabase,
        namespace: scopedContext.activeNamespace ?? null,
        activeTabId: binding.activeTabId,
        configRevision: binding.documentRevision,
        fingerprint: binding.fingerprint,
        summary: {
          driver: scopedContext.activeDriver ?? null,
          activeTab: scopedContext.activeTab ?? null,
          selectedText: turnInput.selectedText ?? null,
          contextPolicy: contextSettingsSnapshot,
          attachments: submittedAttachments.map((attachment) => ({
            fileName: attachment.fileName,
            byteCount: attachment.byteCount,
          })),
        },
      },
      tools: assistantToolManifestForProfile(mode, agentToolManifest),
      contextVersion: binding.fingerprint,
    });
  };

  const handleAddAttachment = async () => {
    if (session.isBusy || attachments.length >= 4 || isAddingAttachment) return;
    setIsAddingAttachment(true);
    setAttachmentError(null);
    try {
      const attachment = await agentHostService.importTextAttachment();
      if (!attachment) return;
      const nextTotal =
        attachments.reduce((total, item) => total + item.byteCount, 0) +
        attachment.byteCount;
      if (nextTotal > 128 * 1024) {
        setAttachmentError("Attachments are limited to 128 KiB per request.");
        return;
      }
      setAttachments((current) => [
        ...current,
        {
          ...attachment,
          id: `attachment:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
        },
      ]);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsAddingAttachment(false);
    }
  };

  const handleExecuteAttachment = async (request: UiActionRequest) => {
    return await uiActionRegistry.execute(request);
  };
  const handleUsePrompt = (prompt: string) => {
    setMessage(prompt);
    window.requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>(
        '[data-assistant-prompt="true"]',
      );
      composer?.focus();
      composer?.setSelectionRange(prompt.length, prompt.length);
    });
  };
  const handleUseComposeRequest = () => {
    if (!composeRequest) return;
    if (composeRequest.source === "database-tables") {
      setDatabaseMentions((current) =>
        composeRequest.replaceExisting
          ? composeRequest.tableMentions
          : mergeAssistantDatabaseTableMentions(
              current,
              composeRequest.tableMentions,
            ),
      );
      consumeComposeRequest(composeRequest.id);
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLTextAreaElement>('[data-assistant-prompt="true"]')
          ?.focus();
      });
      return;
    }
    const targetExists = useTabStore
      .getState()
      .tabs.some((tab) => tab.id === composeRequest.tabId);
    if (targetExists) {
      useTabStore.getState().setActiveTab(composeRequest.tabId);
    }
    handleUsePrompt(composeRequest.prompt);
    consumeComposeRequest(composeRequest.id);
  };
  const handlePreviewSqlPatch = (replacement: string) => {
    const tabState = useTabStore.getState();
    const tab = tabState.tabs.find(
      (candidate) => candidate.id === tabState.activeTabId,
    );
    if (!tab) return;
    const patch = createAssistantSqlPatchPreview(
      tab,
      replacement,
      `assistant-patch:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
      tab.queryError?.database?.documentExecutionRange,
    );
    if (!patch) {
      setAttachmentError(
        "This SQL block cannot be previewed in the active editor.",
      );
      return;
    }
    setAttachmentError(null);
    tabState.previewEditorPatch(tab.id, patch);
  };

  return {
    handleSubmit,
    handleAddAttachment,
    handleExecuteAttachment,
    handleUsePrompt,
    handleUseComposeRequest,
    handlePreviewSqlPatch,
  };
}
