import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  characterDetail,
  compactionDetail,
  contextDetail,
  contextPressureDetail,
  historyDetail,
  modelUsageDetail,
  omissionDetail,
  tokenBudgetDetail,
} from "@/features/assistant-composer/model/contextDetails";
import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import {
  ContextFact,
  ContextSample,
  ContextToggle,
} from "@/features/assistant-composer/ui/ContextFields";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  Cloud,
  Database,
  FileText,
  Gauge,
  History,
  KeyRound,
  Layers3,
  MessageSquare,
  ShieldCheck,
  TextSelect,
  Wrench,
} from "lucide-react";

interface AssistantContextPopoverProps
  extends Pick<
    AssistantPromptBoxProps,
    "contextPreview" | "contextSettings" | "activeContextLabel"
  > {
  contextLocked: boolean;
  t: ReturnType<typeof useI18n>["t"];
  updateContextSetting: AssistantPromptBoxProps["onContextSettingChange"];
}

export function AssistantContextPopover({
  t,
  contextPreview,
  contextSettings,
  activeContextLabel,
  contextLocked,
  updateContextSetting,
}: AssistantContextPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-icon-button relative h-6 w-6"
          title={t("assistant.workspaceContext")}
          aria-label={t("assistant.workspaceContextAria")}
        >
          <Layers3 size={11} />
          {contextPreview.selection.available &&
            contextSettings.includeSelection && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--wb-accent))]" />
            )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="max-h-[min(620px,calc(100vh-24px))] w-[360px] overflow-y-auto p-0 text-[10px]"
      >
        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">Context for next request</div>
            <span className="rounded-[4px] bg-[hsl(var(--wb-active))] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
              {contextPreview.resolvedMode}
            </span>
          </div>
          <div className="mt-1.5 flex items-start gap-2 text-[hsl(var(--wb-text-muted))]">
            {contextPreview.destination === "provider" ? (
              <Cloud size={12} className="mt-0.5 shrink-0" />
            ) : (
              <ShieldCheck size={12} className="mt-0.5 shrink-0" />
            )}
            <span className="min-w-0 break-words leading-4">
              {contextPreview.destinationLabel}
            </span>
          </div>
        </div>

        <div className="space-y-0.5 px-2 py-2">
          <ContextFact
            icon={Database}
            label="Database identity"
            detail={contextPreview.databaseIdentity}
          />
          <ContextFact
            icon={MessageSquare}
            label="Your prompt"
            detail={characterDetail(contextPreview.prompt)}
          />
          <ContextFact
            icon={Gauge}
            label="Estimated input"
            detail={tokenBudgetDetail(contextPreview)}
          />
          {contextPreview.sendsToolManifest && (
            <ContextFact
              icon={Wrench}
              label="Tool manifest"
              detail={`${contextPreview.toolManifestCount} tools · ~${contextPreview.tokenBudget.toolManifestTokens.toLocaleString()} tokens · names, permissions and input schemas`}
            />
          )}
          {contextPreview.previousCompaction && (
            <ContextFact
              icon={Layers3}
              label="Project compaction · 7d"
              detail={compactionDetail(contextPreview)}
            />
          )}
          {contextPreview.previousModelUsage && (
            <ContextFact
              icon={Gauge}
              label="Provider usage · 7d"
              detail={modelUsageDetail(contextPreview)}
            />
          )}
          {contextPreview.omissions.length > 0 && (
            <ContextFact
              icon={ShieldCheck}
              label="Omitted sources"
              detail={omissionDetail(contextPreview)}
            />
          )}
        </div>

        {contextPreview.tokenBudget.pressure !== "comfortable" && (
          <div
            className={cn(
              "border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-[9px] leading-4",
              contextPreview.tokenBudget.pressure === "compaction-likely"
                ? "text-amber-300"
                : "text-[hsl(var(--wb-text-muted))]",
            )}
          >
            {contextPressureDetail(contextPreview)}
          </div>
        )}

        <div className="border-y border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
          <ContextToggle
            icon={FileText}
            label="Active editor"
            detail={contextDetail(contextPreview.editor, activeContextLabel)}
            checked={contextSettings.includeEditorContent}
            disabled={contextLocked || !contextPreview.editor.available}
            onCheckedChange={(checked) =>
              updateContextSetting("includeEditorContent", checked)
            }
          />
          <ContextToggle
            icon={TextSelect}
            label="Editor selection"
            detail={`${contextDetail(
              contextPreview.selection,
            )} · sent as focused context; active editor may also contain it`}
            checked={contextSettings.includeSelection}
            disabled={contextLocked || !contextPreview.selection.available}
            onCheckedChange={(checked) =>
              updateContextSetting("includeSelection", checked)
            }
          />
          <ContextToggle
            icon={History}
            label="Conversation history"
            detail={historyDetail(contextPreview)}
            checked={contextSettings.includeHistory}
            disabled={
              contextLocked || contextPreview.history.availableMessages === 0
            }
            onCheckedChange={(checked) =>
              updateContextSetting("includeHistory", checked)
            }
          />
          <ContextToggle
            icon={Wrench}
            label="Tool results to model"
            detail={contextPreview.toolResultDetail}
            checked={
              contextPreview.canShareToolResults &&
              contextSettings.shareToolResults
            }
            disabled={contextLocked || !contextPreview.canShareToolResults}
            onCheckedChange={(checked) =>
              updateContextSetting("shareToolResults", checked)
            }
          />
        </div>

        {(contextPreview.editor.sample || contextPreview.selection.sample) && (
          <div className="space-y-2 px-3 py-2.5">
            {contextPreview.selection.sample && (
              <ContextSample
                label="Selection preview"
                value={contextPreview.selection.sample}
              />
            )}
            {contextPreview.editor.sample && (
              <ContextSample
                label="Editor preview"
                value={contextPreview.editor.sample}
              />
            )}
          </div>
        )}

        <div className="flex items-start gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 leading-4 text-[hsl(var(--wb-text-muted))]">
          <KeyRound size={12} className="mt-0.5 shrink-0" />
          <p>
            Stored passwords, connection URLs and the provider API key are not
            inserted automatically. Included editor text may itself contain
            secrets, so review the preview. Context is frozen when you send.
            Reviewable project file edits apply immediately and can be undone;
            database and external mutations still require approval.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
