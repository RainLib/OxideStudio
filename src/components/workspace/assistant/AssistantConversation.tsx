import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { AssistantMessageContent } from "./AssistantMessageContent";
import type {
  AssistantAttachment,
  UiActionRequest,
  UiActionResult,
} from "@/ai/ui-actions/types";
import { AssistantAttachmentList } from "./AssistantAttachmentList";
import type { ReactNode } from "react";
import type { AssistantTurn } from "@/ai/assistant/turns";
import { AssistantTurnProcess } from "./AssistantTurnProcess";

export interface AssistantConversationEntry {
  id: string;
  requestId?: string;
  role: "user" | "assistant";
  content: string;
  status?: "normal" | "error" | "process";
  attachments?: AssistantAttachment[];
}

interface AssistantConversationProps {
  entries?: AssistantConversationEntry[];
  turns?: AssistantTurn[];
  isResponding: boolean;
  pendingLabel: string;
  onUsePrompt: (prompt: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
  renderProcess?: (entry: AssistantConversationEntry) => ReactNode;
  contextFingerprint?: string;
  onAnswerClarification?: (
    turnId: string,
    clarificationId: string,
    questionId: string,
    answer: string,
    contextFingerprint: string,
  ) => Promise<void>;
  onDecideApproval?: (
    turnId: string,
    approvalId: string,
    decision: "approve" | "reject",
    contextFingerprint: string,
  ) => Promise<void>;
  onCancelTurn?: (turnId: string) => Promise<void>;
  onResumeTurn?: (
    turnId: string,
    contextFingerprint: string,
  ) => Promise<void>;
}

const STARTER_PROMPTS = [
  "Explain the SQL in my active editor",
  "Inspect the current database structure",
  "Plan a safe schema change",
] as const;

export function AssistantConversation({
  entries = [],
  turns,
  isResponding,
  pendingLabel,
  onUsePrompt,
  onExecuteAttachment,
  renderProcess,
  contextFingerprint = "",
  onAnswerClarification = async () => undefined,
  onDecideApproval = async () => undefined,
  onCancelTurn = async () => undefined,
  onResumeTurn = async () => undefined,
}: AssistantConversationProps) {
  if (turns) {
    return (
      <TurnConversation
        turns={turns}
        onUsePrompt={onUsePrompt}
        onExecuteAttachment={onExecuteAttachment}
        contextFingerprint={contextFingerprint}
        onAnswerClarification={onAnswerClarification}
        onDecideApproval={onDecideApproval}
        onCancelTurn={onCancelTurn}
        onResumeTurn={onResumeTurn}
      />
    );
  }

  if (entries.length === 0 && !isResponding) {
    return <AssistantWelcome onUsePrompt={onUsePrompt} />;
  }

  return (
    <div
      className="space-y-3 px-3 py-3"
      aria-label="Assistant conversation"
    >
      {entries.map((entry) => {
        if (entry.status === "process") {
          const process = renderProcess?.(entry);
          return (
            <div
              key={entry.id}
              className="-mx-3"
              data-assistant-entry-id={entry.id}
              data-assistant-entry-kind="process"
            >
              {process ?? <ArchivedProcessSummary content={entry.content} />}
              {entry.attachments && entry.attachments.length > 0 && (
                <div className="mx-3 mb-3 pl-5">
                  <AssistantAttachmentList
                    attachments={entry.attachments}
                    onExecute={onExecuteAttachment}
                  />
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            key={entry.id}
            data-assistant-entry-id={entry.id}
            data-assistant-entry-kind={
              entry.status === "error" ? "error" : entry.role
            }
            className={cn(
              "text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]",
              entry.role === "user"
                ? "ml-auto max-w-[88%] rounded-[8px] bg-[hsl(var(--wb-active)/0.72)] px-2.5 py-2"
                : "flex max-w-full items-start gap-2",
              entry.status === "error" && "text-[hsl(var(--destructive))]",
            )}
          >
            <span className="sr-only">
              {entry.role === "user" ? "You" : "Assistant"}
            </span>
            {entry.role === "assistant" && (
              <Sparkles
                size={12}
                className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
              />
            )}
            {entry.role === "assistant" ? (
              <div className="min-w-0 flex-1">
                <AssistantMessageContent content={entry.content} />
                <AssistantAttachmentList
                  attachments={entry.attachments || []}
                  onExecute={onExecuteAttachment}
                />
              </div>
            ) : (
              <div className="min-w-0 whitespace-pre-wrap break-words">
                {entry.content}
              </div>
            )}
          </div>
        );
      })}

      {isResponding && (
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--wb-text-muted))]">
          <Loader2
            size={12}
            className="shrink-0 animate-spin text-[hsl(var(--wb-accent))]"
          />
          {pendingLabel}
        </div>
      )}
    </div>
  );
}

function TurnConversation({
  turns,
  onUsePrompt,
  onExecuteAttachment,
  contextFingerprint,
  onAnswerClarification,
  onDecideApproval,
  onCancelTurn,
  onResumeTurn,
}: {
  turns: AssistantTurn[];
  onUsePrompt: (prompt: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
  contextFingerprint: string;
  onAnswerClarification: NonNullable<
    AssistantConversationProps["onAnswerClarification"]
  >;
  onDecideApproval: NonNullable<
    AssistantConversationProps["onDecideApproval"]
  >;
  onCancelTurn: NonNullable<AssistantConversationProps["onCancelTurn"]>;
  onResumeTurn: NonNullable<AssistantConversationProps["onResumeTurn"]>;
}) {
  if (turns.length === 0) {
    return <AssistantWelcome onUsePrompt={onUsePrompt} />;
  }

  return (
    <div className="space-y-5 px-3 py-3" aria-label="Assistant conversation">
      {turns.map((turn) => (
        <article
          key={turn.id}
          className="space-y-3"
          data-assistant-turn-id={turn.id}
          data-assistant-entry-id={turn.id}
          data-assistant-entry-kind="turn"
        >
          <div className="ml-auto max-w-[88%] rounded-[8px] bg-[hsl(var(--wb-active)/0.72)] px-2.5 py-2 text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]">
            <span className="sr-only">You</span>
            <div className="min-w-0 whitespace-pre-wrap break-words">
              {turn.userMessage}
            </div>
          </div>

          <AssistantTurnProcess
            turn={turn}
            contextFingerprint={contextFingerprint}
            onAnswerClarification={onAnswerClarification}
            onDecideApproval={onDecideApproval}
            onCancel={onCancelTurn}
            onResume={onResumeTurn}
          />

          {turn.clarifications
            .filter((clarification) => clarification.answer)
            .map((clarification) => (
              <div
                key={`${clarification.clarificationId}:${clarification.questionId}:answer`}
                className="space-y-1 border-l border-[hsl(var(--wb-border-subtle))] pl-2 text-[10px] leading-4"
              >
                <div className="text-[hsl(var(--wb-text-muted))]">
                  {clarification.question}
                </div>
                <div className="text-[hsl(var(--wb-text))]">
                  {clarification.answer}
                </div>
              </div>
            ))}

          {(turn.final?.content || turn.draft) && (
            <div className="flex max-w-full items-start gap-2 text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]">
              <Sparkles
                size={12}
                className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
              />
              <div className="min-w-0 flex-1">
                <AssistantMessageContent
                  content={turn.final?.content || turn.draft}
                />
                {turn.final && (
                  <AssistantAttachmentList
                    attachments={turn.final.attachments}
                    onExecute={onExecuteAttachment}
                  />
                )}
              </div>
            </div>
          )}

          {turn.error && (
            <div className="flex items-start gap-2 text-[10px] leading-4 text-[hsl(var(--destructive))]">
              <Sparkles size={11} className="mt-0.5 shrink-0" />
              <span>{turn.error}</span>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function ArchivedProcessSummary({ content }: { content: string }) {
  return (
    <div className="mx-3 flex min-h-7 items-start gap-2 px-1.5 py-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
      <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1">{content}</span>
    </div>
  );
}

function AssistantWelcome({
  onUsePrompt,
}: {
  onUsePrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-5 py-8">
      <div className="w-full max-w-[300px]">
        <Sparkles
          size={20}
          className="mb-3 text-[hsl(var(--wb-accent))]"
        />
        <h2 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
          Work with your database
        </h2>
        <p className="mt-1 max-w-[34ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
          Ask a question, review a plan, or let Agent inspect the active
          workspace with safety gates in place.
        </p>

        <div className="mt-4 border-y border-[hsl(var(--wb-border-subtle))]">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="group flex min-h-8 w-full items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-1.5 py-1.5 text-left text-[10px] text-[hsl(var(--wb-text-muted))] transition-colors last:border-b-0 hover:bg-[hsl(var(--wb-hover)/0.58)] hover:text-[hsl(var(--wb-text))]"
              onClick={() => onUsePrompt(prompt)}
            >
              <span className="min-w-0 flex-1">{prompt}</span>
              <ArrowUpRight
                size={11}
                className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
