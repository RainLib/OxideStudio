import type { AssistantContextSettings } from "@/ai/assistant/contextPreview";
import { ASSISTANT_MODE_OPTIONS } from "@/ai/assistant/modes";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useAssistantPromptInteraction } from "@/features/assistant-composer/hooks/useAssistantPromptInteraction";
import { type AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import { AssistantCommandMenu } from "@/features/assistant-composer/ui/AssistantCommandMenu";
import { AssistantContextPopover } from "@/features/assistant-composer/ui/AssistantContextPopover";
import { AssistantContextReferences } from "@/features/assistant-composer/ui/AssistantContextReferences";
import { AssistantModeMenu } from "@/features/assistant-composer/ui/AssistantModeMenu";
import { AssistantNamespaceMenu } from "@/features/assistant-composer/ui/AssistantNamespaceMenu";
import { useI18n } from "@/i18n";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AssistantModelControl } from "./AssistantModelControl";
import { AssistantAccessControl } from "./AssistantAccessControl";
import { AssistantProviderCommandList } from "./AssistantProviderCommandList";

export function AssistantPromptBox({
  message,
  onMessageChange,
  onSubmit,
  onStop,
  mode,
  onModeChange,
  activeContextLabel,
  selectedNamespace,
  namespaceOptions,
  onNamespaceChange,
  onRequestNamespaceOptions,
  contextPreview,
  contextSettings,
  onContextSettingChange,
  isSubmitting,
  isToolRunning,
  isCancelling,
  model,
  modelEndpoint,
  modelStatus,
  modelOptions,
  modelCatalogStatus,
  modelCatalogWarning,
  modelCatalogRefreshing,
  reasoningEffort,
  serviceTier,
  accessMode,
  commandOptions,
  onModelChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onAccessModeChange,
  onRetryModel,
  submissionBlockReason,
  modeOptions = ASSISTANT_MODE_OPTIONS,
  attachments,
  databaseMentions,
  attachmentError,
  isAddingAttachment,
  onAddAttachment,
  onRemoveAttachment,
  onRemoveDatabaseMention,
}: AssistantPromptBoxProps) {
  const { t } = useI18n();
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelPanelId = useId();
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const canSubmit =
    Boolean(message.trim()) &&
    !isSubmitting &&
    !isToolRunning &&
    !submissionBlockReason;
  const submitLabel =
    mode === "plan"
      ? t("assistant.createPlan")
      : mode === "agent"
        ? t("assistant.runAgent")
        : t("assistant.send");
  const contextLocked = isSubmitting || isToolRunning;
  const updateContextSetting = (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => onContextSettingChange(key, checked);

  useEffect(() => {
    if (contextLocked) setModelPanelOpen(false);
  }, [contextLocked]);

  const {
    textareaRef,
    commandMenuOpen,
    commandSuggestions,
    activeCommandIndex,
    setActiveCommandIndex,
    acceptCommand,
    dismissCommands,
    textareaHandlers,
  } = useAssistantPromptInteraction({
    message,
    onMessageChange,
    onSubmit,
    commandOptions,
    canSubmit,
    contextLocked,
    modelPanelOpen,
    setModelPanelOpen,
  });

  return (
    <div className="shrink-0 bg-[hsl(var(--wb-panel))] px-2.5 pb-2.5 pt-2">
      <Popover
        open={commandMenuOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            dismissCommands();
          }
        }}
      >
        <PopoverAnchor asChild>
          <div
            data-assistant-composer="true"
            className="rounded-[12px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] transition-colors duration-150 focus-within:border-[hsl(var(--wb-accent))] motion-reduce:transition-none"
          >
            {(databaseMentions.length > 0 || attachments.length > 0) && (
              <AssistantContextReferences
                databaseMentions={databaseMentions}
                onRemoveDatabaseMention={onRemoveDatabaseMention}
                contextLocked={contextLocked}
                attachments={attachments}
                onRemoveAttachment={onRemoveAttachment}
              />
            )}
            <textarea
              ref={textareaRef}
              data-assistant-prompt="true"
              defaultValue={message}
              {...textareaHandlers}
              placeholder={t("assistant.prompt")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              rows={1}
              className="custom-scrollbar min-h-[60px] max-h-[180px] w-full resize-none bg-transparent px-3 pb-1.5 pt-3 text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
              aria-label={t("assistant.messageAria")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commandMenuOpen}
              aria-controls={
                commandMenuOpen ? "assistant-provider-commands" : undefined
              }
              aria-activedescendant={
                commandMenuOpen
                  ? `assistant-provider-command-${activeCommandIndex}`
                  : undefined
              }
            />

            <div className="flex min-h-9 items-center justify-between gap-2 px-2 pb-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  className="wb-icon-button relative h-6 w-6"
                  onClick={onAddAttachment}
                  disabled={
                    contextLocked ||
                    isAddingAttachment ||
                    attachments.length >= 4
                  }
                  title={
                    attachments.length >= 4
                      ? "Up to 4 text attachments per request"
                      : "Attach a text or data file (64 KiB each)"
                  }
                  aria-label="Attach file"
                >
                  <Paperclip size={11} aria-hidden="true" />
                </button>
                {(commandOptions?.length ?? 0) > 0 && (
                  <AssistantCommandMenu
                    contextLocked={contextLocked}
                    commandOptions={commandOptions}
                    acceptCommand={acceptCommand}
                  />
                )}
                <AssistantNamespaceMenu
                  onRequestNamespaceOptions={onRequestNamespaceOptions}
                  contextLocked={contextLocked}
                  selectedNamespace={selectedNamespace}
                  onNamespaceChange={onNamespaceChange}
                  namespaceOptions={namespaceOptions}
                />

                <AssistantModeMenu
                  isSubmitting={isSubmitting}
                  isToolRunning={isToolRunning}
                  modeOptions={modeOptions}
                  onModeChange={onModeChange}
                  mode={mode}
                />

                <AssistantContextPopover
                  t={t}
                  contextPreview={contextPreview}
                  contextSettings={contextSettings}
                  activeContextLabel={activeContextLabel}
                  contextLocked={contextLocked}
                  updateContextSetting={updateContextSetting}
                />
              </div>

              <div className="flex min-w-0 items-center gap-0.5">
                {mode === "agent" && accessMode && onAccessModeChange && (
                  <AssistantAccessControl
                    accessMode={accessMode}
                    disabled={isSubmitting || isToolRunning}
                    onAccessModeChange={onAccessModeChange}
                  />
                )}
                <AssistantModelControl
                  triggerRef={modelTriggerRef}
                  model={model}
                  endpoint={modelEndpoint}
                  status={modelStatus}
                  disabled={isSubmitting || isToolRunning}
                  open={modelPanelOpen}
                  panelId={modelPanelId}
                  modelOptions={modelOptions}
                  catalogStatus={modelCatalogStatus}
                  catalogWarning={modelCatalogWarning}
                  catalogRefreshing={modelCatalogRefreshing}
                  reasoningEffort={reasoningEffort}
                  serviceTier={serviceTier}
                  onOpenChange={(open) => {
                    setModelPanelOpen(open);
                    if (open) {
                      dismissCommands();
                    }
                  }}
                  onModelChange={onModelChange}
                  onReasoningEffortChange={onReasoningEffortChange}
                  onServiceTierChange={onServiceTierChange}
                  onRetry={onRetryModel}
                />

                {isSubmitting || isToolRunning ? (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground outline-none transition-colors hover:bg-destructive/90 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                    onClick={onStop}
                    disabled={isCancelling}
                    title="Stop active assistant tool"
                    aria-label={
                      isCancelling ? "Stopping assistant" : "Stop assistant"
                    }
                  >
                    <Square size={10} className="fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wb-primary-button h-7 w-7 justify-center rounded-full px-0"
                    onClick={onSubmit}
                    disabled={!canSubmit}
                    title={submissionBlockReason || submitLabel}
                    aria-label={submitLabel}
                    aria-describedby={
                      submissionBlockReason && message.trim()
                        ? "assistant-submit-block-reason"
                        : undefined
                    }
                  >
                    <ArrowUp size={13} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            </div>

            {submissionBlockReason && message.trim() && !contextLocked && (
              <div
                id="assistant-submit-block-reason"
                role="status"
                className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4 text-amber-400"
              >
                {submissionBlockReason}
              </div>
            )}
            {attachmentError && !contextLocked && (
              <div
                role="alert"
                className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4 text-[hsl(var(--destructive))]"
              >
                {attachmentError}
              </div>
            )}
          </div>
        </PopoverAnchor>

        {commandMenuOpen && (
          <PopoverContent
            id="assistant-provider-commands"
            align="start"
            side="top"
            sideOffset={7}
            collisionPadding={10}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="custom-scrollbar max-h-[236px] w-[min(var(--radix-popover-trigger-width),calc(100vw-20px))] overflow-y-auto rounded-[10px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1.5 text-[hsl(var(--wb-text))] shadow-[0_6px_12px_rgba(0,0,0,0.34)]"
            role="listbox"
            aria-label="Provider commands"
          >
            <AssistantProviderCommandList
              commands={commandSuggestions}
              activeIndex={activeCommandIndex}
              onActiveIndexChange={setActiveCommandIndex}
              onAccept={acceptCommand}
            />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}
