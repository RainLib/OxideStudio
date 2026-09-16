import type { AssistantContextPreview } from "@/ai/assistant/contextPreview";
import { type AssistantContextSettings } from "@/ai/assistant/contextPreview";
import { type AssistantDatabaseTableMention } from "@/ai/assistant/databaseTableContext";
import type { AssistantMode } from "@/ai/assistant/modes";
import { assistantProviderDefinition } from "@/ai/assistant/providerDefinitions";
import type { UiActionRequest, UiActionResult } from "@/ai/ui-actions/types";
import { AssistantClarificationDock } from "@/components/workspace/assistant/AssistantClarificationDock";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { AssistantConversationHistory } from "@/components/workspace/assistant/AssistantConversationHistory";
import { AssistantConversationMinimap } from "@/components/workspace/assistant/AssistantConversationMinimap";
import { AssistantHeader } from "@/components/workspace/assistant/AssistantHeader";
import type { AssistantModelStatus } from "@/components/workspace/assistant/AssistantModelControl";
import {
  AssistantPendingChangesPanel,
  pendingAssistantFileProposals,
  type PendingAssistantFileProposal,
} from "@/components/workspace/assistant/AssistantPendingChangesPanel";
import { AssistantPromptBox } from "@/components/workspace/assistant/AssistantPromptBox";
import {
  AssistantProviderControl,
  AssistantProviderWelcome,
} from "@/components/workspace/assistant/AssistantProviderControl";
import { AssistantProviderSetup } from "@/components/workspace/assistant/AssistantProviderSetup";
import { type PendingTextAttachment } from "@/features/assistant-panel/model/panelTypes";
import type { AssistantAgentSession } from "@/features/assistant-session/model/sessionTypes";
import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import type { AiCliCatalogController } from "@/hooks/useAiCliCatalog";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import { cn } from "@/lib/utils";
import type {
  AiCliAccessMode,
  AiCliModelInfo,
  AiCliServiceTier,
  AiProviderConfig,
} from "@/services/tauri/ai.service";
import { type AiProviderKind } from "@/services/tauri/ai.service";
import type { AiSettingsValues } from "@/store/useAiSettingsStore";
import type { AssistantCliSetupState } from "@/store/useAssistantCliSetupStore";
import type { AssistantComposeRequest } from "@/store/useAssistantComposerStore";
import { ArrowDown, Sparkles, X } from "lucide-react";

interface AssistantSidebarViewProps {
  session: AssistantAgentSession;
  aiProvider: AiProviderKind;
  aiEnabled: boolean;
  modelConfig: AiProviderConfig | null;
  contextProviderLabel: string | null;
  modelStatus: AssistantModelStatus;
  cliSetupForCurrentIdentity: AssistantCliSetupState | null;
  selectAssistantProvider: (provider: AiProviderKind) => void;
  conversationScope: string | undefined;
  conversationId: string | undefined;
  activeProjectId: string;
  activateConversation: (nextConversationId: string) => void;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  startNewConversation: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  autoFollowConversationRef: React.RefObject<boolean>;
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  showProviderWelcome: boolean;
  openAiSettings: () => void;
  cliSetupRequired: boolean;
  installAssistantProvider: () => Promise<void>;
  authenticateAssistantProvider: (
    methodId?: string | undefined,
  ) => Promise<void>;
  cancelAssistantAuthentication: () => Promise<void>;
  retryAssistantProvider: () => void;
  pendingLabel:
    | "Waiting for your answer"
    | "Waiting for approval"
    | "Planning..."
    | "Stopping..."
    | "Working..."
    | "Thinking...";
  handleUsePrompt: (prompt: string) => void;
  handlePreviewSqlPatch: (replacement: string) => void;
  handleExecuteAttachment: (
    request: UiActionRequest,
  ) => Promise<UiActionResult>;
  openPendingFileProposal: (item: PendingAssistantFileProposal) => void;
  activeProjectRoot: string | null;
  contextFingerprint: string;
  turnsContentVersion: string;
  showScrollToBottom: boolean;
  keepPendingFileChange: (item: PendingAssistantFileProposal) => void;
  undoPendingFileChange: (item: PendingAssistantFileProposal) => Promise<void>;
  composeRequest: AssistantComposeRequest | null;
  message: string;
  handleUseComposeRequest: () => void;
  consumeComposeRequest: (requestId: string) => void;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  handleSubmit: () => Promise<void>;
  assistantMode: AssistantMode;
  updateAiSettings: (settings: Partial<AiSettingsValues>) => void;
  activeContextLabel: string;
  assistantNamespace: string | null;
  assistantSchemaOptions: string[];
  setAssistantNamespace: React.Dispatch<React.SetStateAction<string | null>>;
  activeConnectionId: string | null;
  loadSchemas: (
    connectionId: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  contextPreview: AssistantContextPreview;
  contextSettings: AssistantContextSettings;
  setContextSettings: React.Dispatch<
    React.SetStateAction<AssistantContextSettings>
  >;
  displayedModel: string;
  displayedEndpoint: string;
  cliModelOptions: AiCliModelInfo[];
  cliCatalog: AiCliCatalogController;
  cliCatalogWarning: string;
  displayedReasoningEffort: string | undefined;
  codexCliServiceTier: AiCliServiceTier;
  codexCliAccessMode: AiCliAccessMode;
  authIssueId: string | null;
  setDismissedAuthIssueId: React.Dispatch<React.SetStateAction<string | null>>;
  assistantSubmissionBlockReason: string | null;
  attachments: PendingTextAttachment[];
  databaseMentions: AssistantDatabaseTableMention[];
  attachmentError: string | null;
  isAddingAttachment: boolean;
  handleAddAttachment: () => Promise<void>;
  setAttachments: React.Dispatch<React.SetStateAction<PendingTextAttachment[]>>;
  setDatabaseMentions: React.Dispatch<
    React.SetStateAction<AssistantDatabaseTableMention[]>
  >;
}

export function AssistantSidebarView({
  session,
  aiProvider,
  aiEnabled,
  modelConfig,
  contextProviderLabel,
  modelStatus,
  cliSetupForCurrentIdentity,
  selectAssistantProvider,
  conversationScope,
  conversationId,
  activeProjectId,
  activateConversation,
  setToolWindowVisible,
  startNewConversation,
  scrollContainerRef,
  autoFollowConversationRef,
  setShowScrollToBottom,
  showProviderWelcome,
  openAiSettings,
  cliSetupRequired,
  installAssistantProvider,
  authenticateAssistantProvider,
  cancelAssistantAuthentication,
  retryAssistantProvider,
  pendingLabel,
  handleUsePrompt,
  handlePreviewSqlPatch,
  handleExecuteAttachment,
  openPendingFileProposal,
  activeProjectRoot,
  contextFingerprint,
  turnsContentVersion,
  showScrollToBottom,
  keepPendingFileChange,
  undoPendingFileChange,
  composeRequest,
  message,
  handleUseComposeRequest,
  consumeComposeRequest,
  setMessage,
  handleSubmit,
  assistantMode,
  updateAiSettings,
  activeContextLabel,
  assistantNamespace,
  assistantSchemaOptions,
  setAssistantNamespace,
  activeConnectionId,
  loadSchemas,
  contextPreview,
  contextSettings,
  setContextSettings,
  displayedModel,
  displayedEndpoint,
  cliModelOptions,
  cliCatalog,
  cliCatalogWarning,
  displayedReasoningEffort,
  codexCliServiceTier,
  codexCliAccessMode,
  authIssueId,
  setDismissedAuthIssueId,
  assistantSubmissionBlockReason,
  attachments,
  databaseMentions,
  attachmentError,
  isAddingAttachment,
  handleAddAttachment,
  setAttachments,
  setDatabaseMentions,
}: AssistantSidebarViewProps) {
  return (
    <div className="wb-assistant-shell flex h-full flex-col wb-panel">
      <AssistantHeader
        isRunning={session.isBusy}
        providerControl={
          <AssistantProviderControl
            provider={aiProvider}
            enabled={aiEnabled}
            destination={
              modelConfig?.kind === "openai-compatible"
                ? contextProviderLabel
                : null
            }
            modelStatus={modelStatus}
            cliSetup={cliSetupForCurrentIdentity}
            isBusy={session.isBusy}
            inHeader
            onSelect={selectAssistantProvider}
          />
        }
        historyControl={
          conversationScope && conversationId ? (
            <AssistantConversationHistory
              projectId={activeProjectId}
              conversationScope={conversationScope}
              activeConversationId={conversationId}
              disabled={session.isBusy}
              onSelect={activateConversation}
            />
          ) : null
        }
        onHide={() => setToolWindowVisible("assistant", false)}
        onNewChat={startNewConversation}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[hsl(var(--wb-editor))]">
        <div
          ref={scrollContainerRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            autoFollowConversationRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              72;
            setShowScrollToBottom(!autoFollowConversationRef.current);
          }}
          className={cn(
            "custom-scrollbar h-full overflow-auto",
            session.turns.length >= 4 && "wb-assistant-scroll-with-minimap",
          )}
        >
          {session.isHydrating ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
              aria-live="polite"
              data-assistant-hydrating
            >
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--wb-border))] border-t-[hsl(var(--wb-accent))]" />
              <div className="text-[10px] font-medium">
                Restoring Assistant conversation
              </div>
              <div className="max-w-xs text-[9px] leading-4 wb-muted">
                Reconciling the encrypted snapshot and any unfinished activity
                before accepting a new request.
              </div>
            </div>
          ) : showProviderWelcome ? (
            <AssistantProviderWelcome
              isBusy={session.isBusy}
              onSelect={selectAssistantProvider}
              onOpenSettings={openAiSettings}
            />
          ) : cliSetupRequired &&
            modelConfig?.kind !== "openai-compatible" &&
            cliSetupForCurrentIdentity ? (
            <AssistantProviderSetup
              provider={
                aiProvider === "codex-cli" ? "codex-cli" : "codebuddy-cli"
              }
              state={cliSetupForCurrentIdentity}
              onInstall={() => void installAssistantProvider()}
              onAuthenticate={(methodId) =>
                void authenticateAssistantProvider(methodId)
              }
              onCancelAuthentication={() =>
                void cancelAssistantAuthentication()
              }
              onRetry={retryAssistantProvider}
              onOpenSettings={openAiSettings}
            />
          ) : (
            <>
              {(session.hydrationError || session.hostError) &&
                session.turns.length === 0 && (
                  <div className="mx-3 mt-3 border-y border-amber-500/25 bg-amber-500/5 px-2 py-2 text-[10px] leading-4 text-amber-300">
                    {session.hydrationError || session.hostError}
                    <button
                      type="button"
                      className="ml-2 underline underline-offset-2 hover:text-[hsl(var(--wb-text))]"
                      onClick={() => {
                        if (session.hydrationError) session.retryHydration();
                        else void session.refreshStatus();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

              <AssistantConversation
                turns={session.turns}
                starterPrompts={
                  assistantProviderDefinition(aiProvider).starterPrompts
                }
                isResponding={false}
                pendingLabel={pendingLabel}
                onUsePrompt={handleUsePrompt}
                onPreviewSqlPatch={handlePreviewSqlPatch}
                onExecuteAttachment={handleExecuteAttachment}
                onOpenProjectFile={openProjectFileInEditor}
                onOpenProjectFileProposal={(turnId, callId) => {
                  const item = pendingAssistantFileProposals(
                    session.turns,
                  ).find(
                    (candidate) =>
                      candidate.turnId === turnId &&
                      candidate.proposal.callId === callId,
                  );
                  if (item) openPendingFileProposal(item);
                }}
                expectedProjectRoot={activeProjectRoot}
                contextFingerprint={contextFingerprint}
                onDecideApproval={session.decideApproval}
                onResumeTurn={session.resumeTurn}
              />
            </>
          )}
        </div>

        <AssistantConversationMinimap
          turns={session.turns}
          scrollContainerRef={scrollContainerRef}
          contentVersion={turnsContentVersion}
        />
        {showScrollToBottom && (
          <button
            type="button"
            className="absolute bottom-3 right-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text-muted))] shadow-md hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
            onClick={() => {
              const element = scrollContainerRef.current;
              if (!element) return;
              element.scrollTo({
                top: element.scrollHeight,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
              });
              autoFollowConversationRef.current = true;
              setShowScrollToBottom(false);
            }}
            title="Scroll to latest response"
            aria-label="Scroll to latest response"
          >
            <ArrowDown size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {!showProviderWelcome && !cliSetupRequired && (
        <div className="relative shrink-0">
          <AssistantClarificationDock
            turn={
              session.activeTurn?.status === "awaiting_input"
                ? session.activeTurn
                : null
            }
            contextFingerprint={contextFingerprint}
            onAnswer={session.answerClarification}
          />

          <AssistantPendingChangesPanel
            turns={session.turns}
            onOpen={openPendingFileProposal}
            onKeep={keepPendingFileChange}
            onUndo={undoPendingFileChange}
          />

          {composeRequest?.source === "query-error" && message.trim() && (
            <div
              className="flex items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2.5 py-1.5 text-[10px]"
              data-assistant-compose-suggestion
            >
              <Sparkles
                size={11}
                className="shrink-0 text-[hsl(var(--wb-accent))]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text-muted))]">
                Query error fix prompt ready
              </span>
              <button
                type="button"
                className="wb-text-button h-6 px-1.5 text-[10px]"
                onClick={handleUseComposeRequest}
              >
                Use prompt
              </button>
              <button
                type="button"
                className="wb-icon-button h-6 w-6"
                onClick={() => consumeComposeRequest(composeRequest.id)}
                title="Dismiss suggested prompt"
                aria-label="Dismiss suggested prompt"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </div>
          )}

          <AssistantPromptBox
            message={message}
            onMessageChange={setMessage}
            onSubmit={handleSubmit}
            onStop={() => {
              if (session.activeTurn)
                void session.cancelTurn(session.activeTurn.id);
            }}
            mode={assistantMode}
            onModeChange={(mode) => {
              if (session.isBusy) return;
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliAssistantMode: mode }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliAssistantMode: mode }
                    : { assistantMode: mode },
              );
            }}
            activeContextLabel={activeContextLabel}
            selectedNamespace={assistantNamespace}
            namespaceOptions={assistantSchemaOptions}
            onNamespaceChange={setAssistantNamespace}
            onRequestNamespaceOptions={() => {
              if (activeConnectionId) void loadSchemas(activeConnectionId);
            }}
            contextPreview={contextPreview}
            contextSettings={contextSettings}
            onContextSettingChange={(key, checked) =>
              setContextSettings((current) => ({ ...current, [key]: checked }))
            }
            isSubmitting={session.activeTurn?.status === "planning"}
            isToolRunning={
              session.isBusy && session.activeTurn?.status !== "planning"
            }
            isCancelling={session.activeTurn?.status === "cancelling"}
            model={displayedModel}
            modelEndpoint={displayedEndpoint}
            modelStatus={modelStatus}
            modelOptions={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliModelOptions
                : undefined
            }
            modelCatalogStatus={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalog.status
                : undefined
            }
            modelCatalogWarning={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalogWarning || undefined
                : undefined
            }
            reasoningEffort={displayedReasoningEffort}
            serviceTier={
              aiProvider === "codex-cli" ? codexCliServiceTier : undefined
            }
            accessMode={
              aiProvider === "codex-cli" ? codexCliAccessMode : undefined
            }
            commandOptions={
              aiProvider === "codex-cli" || aiProvider === "codebuddy-cli"
                ? cliCatalog.commands
                : undefined
            }
            onModelChange={(model) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliModel: model }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliModel: model }
                    : { model },
              )
            }
            onReasoningEffortChange={(reasoningEffort) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliReasoningEffort: reasoningEffort }
                  : aiProvider === "codebuddy-cli"
                    ? { codeBuddyCliReasoningEffort: reasoningEffort }
                    : {},
              )
            }
            onServiceTierChange={(serviceTier) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliServiceTier: serviceTier }
                  : {},
              )
            }
            onAccessModeChange={(accessMode) =>
              updateAiSettings(
                aiProvider === "codex-cli"
                  ? { codexCliAccessMode: accessMode }
                  : {},
              )
            }
            onRetryModel={() => {
              if (authIssueId) setDismissedAuthIssueId(authIssueId);
              const catalogNeedsRefresh =
                (aiProvider === "codex-cli" ||
                  aiProvider === "codebuddy-cli") &&
                (cliCatalog.status === "error" ||
                  cliCatalog.warning ||
                  cliCatalog.effortWarning);
              if (catalogNeedsRefresh) {
                cliCatalog.refresh();
                // A catalog retry is not an installation or authentication
                // retry. Re-probing here briefly replaces a usable composer
                // with the setup surface and makes model selection flicker.
                return;
              }
              retryAssistantProvider();
            }}
            submissionBlockReason={assistantSubmissionBlockReason}
            modeOptions={assistantProviderDefinition(aiProvider).modeOptions}
            attachments={attachments}
            databaseMentions={databaseMentions}
            attachmentError={attachmentError}
            isAddingAttachment={isAddingAttachment}
            onAddAttachment={() => void handleAddAttachment()}
            onRemoveAttachment={(attachmentId) =>
              setAttachments((current) =>
                current.filter((attachment) => attachment.id !== attachmentId),
              )
            }
            onRemoveDatabaseMention={(mention) =>
              setDatabaseMentions((current) =>
                current.filter(
                  (candidate) =>
                    candidate.connectionId !== mention.connectionId ||
                    candidate.database !== mention.database ||
                    candidate.schema !== mention.schema ||
                    candidate.table !== mention.table,
                ),
              )
            }
          />
        </div>
      )}
    </div>
  );
}
