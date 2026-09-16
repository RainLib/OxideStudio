import {
  assistantTurnCanResume,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ChevronRight, Play } from "lucide-react";
import { useMemo, useState } from "react";
import {
  matchingFileChange,
  matchingFileProposal,
  ProcessDetail,
} from "./process-details";
import {
  ProcessDisclosureHeadline,
  TurnStatusIcon,
  turnProcessHeadline,
} from "./presentation";

export function LiveProcessTimeline({
  turn,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  turn: AssistantTurn;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const { t } = useI18n();
  const processItems = useMemo(
    () =>
      [...turn.process].sort((left, right) => left.sequence - right.sequence),
    [turn.process],
  );
  const hasRunningItem = processItems.some((item) => item.status === "running");

  return (
    <section
      className="space-y-1"
      aria-label={t("assistant.processAria")}
      data-assistant-live-process={turn.id}
      data-process-status={turn.status}
      data-process-running="true"
      aria-live="polite"
    >
      {processItems.map((item) => (
        <ProcessDetail
          key={item.id}
          item={item}
          turnId={turn.id}
          fileChange={matchingFileChange(item, turn.fileChanges)}
          fileProposal={matchingFileProposal(item, turn.fileProposals)}
          onOpenProjectFile={onOpenProjectFile}
          onOpenProjectFileProposal={onOpenProjectFileProposal}
        />
      ))}
      {!hasRunningItem && (
        <div
          className="flex min-h-6 min-w-0 items-center gap-2 py-0.5 text-[10px] font-medium text-[hsl(var(--wb-accent))]"
          data-assistant-live-status
          role="status"
        >
          <TurnStatusIcon turn={turn} />
          <span className="min-w-0 truncate">
            {turnProcessHeadline(turn, processItems, t)}
          </span>
        </div>
      )}
    </section>
  );
}

export function ProcessDisclosure({
  turn,
  onResume,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  turn: AssistantTurn;
  onResume: () => Promise<void>;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const processItems = useMemo(
    () =>
      [...turn.process].sort((left, right) => left.sequence - right.sequence),
    [turn.process],
  );
  const canExpand = processItems.length > 0;

  return (
    <section
      aria-label={t("assistant.processAria")}
      data-assistant-process-disclosure={turn.id}
      data-process-status={turn.status}
      data-process-running="false"
    >
      <div className="flex min-h-6 items-start">
        {canExpand ? (
          <button
            type="button"
            className="group flex min-h-6 min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[10px] outline-none focus-visible:text-[hsl(var(--wb-accent))]"
            aria-expanded={expanded}
            aria-controls={`assistant-process-details-${turn.id}`}
            onClick={() => setExpanded((current) => !current)}
          >
            <TurnStatusIcon turn={turn} />
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <span
                className={cn("min-w-0 truncate", "text-[hsl(var(--wb-text))]")}
                data-assistant-process-headline
              >
                <ProcessDisclosureHeadline
                  turn={turn}
                  processItems={processItems}
                />
              </span>
              <ChevronRight
                size={10}
                className={cn(
                  "shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none",
                  "text-[hsl(var(--wb-text-muted))]",
                  expanded && "rotate-90",
                )}
                aria-hidden="true"
                data-assistant-process-chevron
              />
            </span>
          </button>
        ) : (
          <div
            className="flex min-h-6 min-w-0 flex-1 items-center gap-2 py-0.5 text-[10px]"
            role="status"
            aria-live="polite"
          >
            <TurnStatusIcon turn={turn} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                "text-[hsl(var(--wb-text))]",
              )}
              data-assistant-process-headline
            >
              <ProcessDisclosureHeadline
                turn={turn}
                processItems={processItems}
              />
            </span>
          </div>
        )}

        {assistantTurnCanResume(turn) && (
          <button
            type="button"
            className="wb-text-button h-6 shrink-0 px-1.5 text-[10px]"
            onClick={() => void onResume()}
          >
            <Play size={10} />
            {t("common.resume")}
          </button>
        )}
      </div>

      {canExpand && expanded && (
        <div
          id={`assistant-process-details-${turn.id}`}
          className="space-y-1 pb-1 pt-1 pl-5"
        >
          {processItems.map((item) => (
            <ProcessDetail
              key={item.id}
              item={item}
              turnId={turn.id}
              fileChange={matchingFileChange(item, turn.fileChanges)}
              fileProposal={matchingFileProposal(item, turn.fileProposals)}
              onOpenProjectFile={onOpenProjectFile}
              onOpenProjectFileProposal={onOpenProjectFileProposal}
            />
          ))}
        </div>
      )}
    </section>
  );
}
