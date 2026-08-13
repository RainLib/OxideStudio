import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  Check,
  Copy,
  Loader2,
  Pencil,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { AssistantMessageContent } from "./AssistantMessageContent";
import type {
  AssistantAttachment,
  UiActionRequest,
  UiActionResult,
} from "@/ai/ui-actions/types";
import { AssistantAttachmentList } from "./AssistantAttachmentList";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AssistantTurn } from "@/ai/assistant/turns";
import { AssistantTurnProcess } from "./AssistantTurnProcess";
import { AssistantArtifactList } from "./AssistantArtifactList";
import { AssistantCitationList } from "./AssistantCitationList";

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
  starterPrompts?: readonly string[];
  onPreviewSqlPatch?: (replacement: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
  expectedProjectRoot?: string | null;
  renderProcess?: (entry: AssistantConversationEntry) => ReactNode;
  contextFingerprint?: string;
  onDecideApproval?: (
    turnId: string,
    approvalId: string,
    decision: "approve" | "reject",
    contextFingerprint: string,
    confirmationText?: string,
  ) => Promise<void>;
  onResumeTurn?: (turnId: string, contextFingerprint: string) => Promise<void>;
}

const DEFAULT_STARTER_PROMPTS = [
  "Explain the SQL in my active editor",
  "Inspect the current database structure",
  "Plan a safe schema change",
] as const;
const DEFAULT_VISIBLE_TURNS = 30;
const TURN_HISTORY_PAGE_SIZE = 30;

export function AssistantConversation({
  entries = [],
  turns,
  isResponding,
  pendingLabel,
  onUsePrompt,
  starterPrompts = DEFAULT_STARTER_PROMPTS,
  onPreviewSqlPatch,
  onExecuteAttachment,
  onOpenProjectFile,
  onOpenProjectFileProposal,
  expectedProjectRoot,
  renderProcess,
  contextFingerprint = "",
  onDecideApproval = async () => undefined,
  onResumeTurn = async () => undefined,
}: AssistantConversationProps) {
  if (turns) {
    return (
      <TurnConversation
        turns={turns}
        onUsePrompt={onUsePrompt}
        starterPrompts={starterPrompts}
        onPreviewSqlPatch={onPreviewSqlPatch}
        onExecuteAttachment={onExecuteAttachment}
        onOpenProjectFile={onOpenProjectFile}
        onOpenProjectFileProposal={onOpenProjectFileProposal}
        expectedProjectRoot={expectedProjectRoot}
        contextFingerprint={contextFingerprint}
        onDecideApproval={onDecideApproval}
        onResumeTurn={onResumeTurn}
      />
    );
  }

  if (entries.length === 0 && !isResponding) {
    return (
      <AssistantWelcome
        onUsePrompt={onUsePrompt}
        starterPrompts={starterPrompts}
      />
    );
  }

  return (
    <div className="space-y-3 px-3 py-3" aria-label="Assistant conversation">
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
                <AssistantMessageContent
                  content={entry.content}
                  onPreviewSqlPatch={onPreviewSqlPatch}
                />
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
  starterPrompts,
  onPreviewSqlPatch,
  onExecuteAttachment,
  onOpenProjectFile,
  onOpenProjectFileProposal,
  expectedProjectRoot,
  contextFingerprint,
  onDecideApproval,
  onResumeTurn,
}: {
  turns: AssistantTurn[];
  onUsePrompt: (prompt: string) => void;
  starterPrompts: readonly string[];
  onPreviewSqlPatch?: (replacement: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
  expectedProjectRoot?: string | null;
  contextFingerprint: string;
  onDecideApproval: NonNullable<AssistantConversationProps["onDecideApproval"]>;
  onResumeTurn: NonNullable<AssistantConversationProps["onResumeTurn"]>;
}) {
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [visibleTurnLimit, setVisibleTurnLimit] = useState(
    DEFAULT_VISIBLE_TURNS,
  );
  const conversationIdentity = turns[0]?.id ?? "empty";
  useEffect(() => {
    setVisibleTurnLimit(DEFAULT_VISIBLE_TURNS);
  }, [conversationIdentity]);

  const visibleTurns = useMemo(() => {
    const windowStart = Math.max(0, turns.length - visibleTurnLimit);
    return turns.filter(
      (turn, index) =>
        index >= windowStart || !isTerminalTurnStatus(turn.status),
    );
  }, [turns, visibleTurnLimit]);
  const hiddenTurnCount = turns.length - visibleTurns.length;
  const callbackRefs = useRef<TurnRowCallbacks>({
    onUsePrompt,
    onPreviewSqlPatch,
    onExecuteAttachment,
    onOpenProjectFile,
    onOpenProjectFileProposal,
    onDecideApproval,
    onResumeTurn,
  });
  callbackRefs.current = {
    onUsePrompt,
    onPreviewSqlPatch,
    onExecuteAttachment,
    onOpenProjectFile,
    onOpenProjectFileProposal,
    onDecideApproval,
    onResumeTurn,
  };

  const copyAnswer = useCallback(async (turn: AssistantTurn) => {
    const content = turn.final?.content || turn.draft;
    if (!content.trim()) return;
    await navigator.clipboard.writeText(content);
    setCopiedTurnId(turn.id);
    window.setTimeout(
      () =>
        setCopiedTurnId((current) => (current === turn.id ? null : current)),
      1_500,
    );
  }, []);
  const usePrompt = useCallback(
    (prompt: string) => callbackRefs.current.onUsePrompt(prompt),
    [],
  );
  const previewSqlPatch = useCallback(
    (replacement: string) =>
      callbackRefs.current.onPreviewSqlPatch?.(replacement),
    [],
  );
  const executeAttachment = useCallback(
    (request: UiActionRequest) =>
      callbackRefs.current.onExecuteAttachment(request),
    [],
  );
  const openProjectFile = useCallback(
    (relativePath: string) =>
      callbackRefs.current.onOpenProjectFile?.(relativePath) ??
      Promise.resolve(),
    [],
  );
  const openProjectFileProposal = useCallback(
    (turnId: string, callId: string) =>
      callbackRefs.current.onOpenProjectFileProposal?.(turnId, callId),
    [],
  );
  const decideApproval = useCallback(
    (...args: Parameters<NonNullable<TurnRowCallbacks["onDecideApproval"]>>) =>
      callbackRefs.current.onDecideApproval(...args),
    [],
  );
  const resumeTurn = useCallback(
    (...args: Parameters<NonNullable<TurnRowCallbacks["onResumeTurn"]>>) =>
      callbackRefs.current.onResumeTurn(...args),
    [],
  );

  if (turns.length === 0) {
    return (
      <AssistantWelcome
        onUsePrompt={onUsePrompt}
        starterPrompts={starterPrompts}
      />
    );
  }

  return (
    <div className="space-y-5 px-3 py-3" aria-label="Assistant conversation">
      {hiddenTurnCount > 0 && (
        <div className="flex justify-center" data-assistant-history-window>
          <button
            type="button"
            className="wb-text-button min-h-7 rounded-full px-3 text-[10px] text-[hsl(var(--wb-text-muted))]"
            onClick={() =>
              setVisibleTurnLimit((current) =>
                Math.min(turns.length, current + TURN_HISTORY_PAGE_SIZE),
              )
            }
            aria-label={`Show ${Math.min(hiddenTurnCount, TURN_HISTORY_PAGE_SIZE)} earlier assistant turns`}
          >
            Show {Math.min(hiddenTurnCount, TURN_HISTORY_PAGE_SIZE)} earlier
            turns
          </button>
        </div>
      )}
      {visibleTurns.map((turn) => (
        <AssistantTurnRow
          key={turn.id}
          turn={turn}
          contextFingerprint={contextFingerprint}
          expectedProjectRoot={expectedProjectRoot}
          copied={copiedTurnId === turn.id}
          onUsePrompt={usePrompt}
          onPreviewSqlPatch={onPreviewSqlPatch ? previewSqlPatch : undefined}
          onExecuteAttachment={executeAttachment}
          onOpenProjectFile={onOpenProjectFile ? openProjectFile : undefined}
          onOpenProjectFileProposal={
            onOpenProjectFileProposal ? openProjectFileProposal : undefined
          }
          onDecideApproval={decideApproval}
          onResumeTurn={resumeTurn}
          onCopyAnswer={copyAnswer}
        />
      ))}
    </div>
  );
}

function isTerminalTurnStatus(status: AssistantTurn["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

type TurnRowCallbacks = Pick<
  AssistantConversationProps,
  | "onUsePrompt"
  | "onPreviewSqlPatch"
  | "onExecuteAttachment"
  | "onOpenProjectFile"
  | "onOpenProjectFileProposal"
  | "onDecideApproval"
  | "onResumeTurn"
> & {
  onDecideApproval: NonNullable<AssistantConversationProps["onDecideApproval"]>;
  onResumeTurn: NonNullable<AssistantConversationProps["onResumeTurn"]>;
};

interface AssistantTurnRowProps {
  turn: AssistantTurn;
  contextFingerprint: string;
  expectedProjectRoot?: string | null;
  copied: boolean;
  onUsePrompt: (prompt: string) => void;
  onPreviewSqlPatch?: (replacement: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
  onDecideApproval: NonNullable<AssistantConversationProps["onDecideApproval"]>;
  onResumeTurn: NonNullable<AssistantConversationProps["onResumeTurn"]>;
  onCopyAnswer: (turn: AssistantTurn) => Promise<void>;
}

const AssistantTurnRow = memo(function AssistantTurnRow({
  turn,
  contextFingerprint,
  expectedProjectRoot,
  copied,
  onUsePrompt,
  onPreviewSqlPatch,
  onExecuteAttachment,
  onOpenProjectFile,
  onOpenProjectFileProposal,
  onDecideApproval,
  onResumeTurn,
  onCopyAnswer,
}: AssistantTurnRowProps) {
  return (
    <article
      className="space-y-3"
      data-assistant-turn-id={turn.id}
      data-assistant-entry-id={turn.id}
      data-assistant-entry-kind="turn"
    >
      <div className="group/user ml-auto max-w-[88%]">
        <div className="rounded-[8px] bg-[hsl(var(--wb-active)/0.72)] px-2.5 py-2 text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]">
          <span className="sr-only">You</span>
          <div className="min-w-0 whitespace-pre-wrap break-words">
            {turn.userMessage}
          </div>
          {turn.userAttachments && turn.userAttachments.length > 0 && (
            <div
              className="mt-2 flex flex-wrap gap-1"
              aria-label="Attached files"
            >
              {turn.userAttachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.72)] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-text-muted))]"
                  title={`${attachment.fileName} · ${attachment.byteCount.toLocaleString()} bytes`}
                >
                  <FileText size={9} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{attachment.fileName}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover/user:opacity-100 group-focus-within/user:opacity-100">
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => onUsePrompt(turn.userMessage)}
            disabled={turn.status === "planning" || turn.status === "running"}
            title="Edit this prompt in the composer"
            aria-label="Edit prompt"
          >
            <Pencil size={10} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AssistantTurnProcess
        turn={turn}
        contextFingerprint={contextFingerprint}
        onDecideApproval={onDecideApproval}
        onResume={onResumeTurn}
        expectedProjectRoot={expectedProjectRoot}
        onOpenProjectFile={onOpenProjectFile}
        onOpenProjectFileProposal={onOpenProjectFileProposal}
      />

      {turn.status === "completed" &&
        (turn.final?.content ||
          turn.draft ||
          (turn.final?.artifactRefs?.length ?? 0) > 0) && (
          <div
            className="flex max-w-full items-start gap-2 text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]"
            data-assistant-final-response
          >
            <Sparkles
              size={12}
              className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
            />
            <div className="min-w-0 flex-1">
              <AssistantMessageContent
                content={turn.final?.content || turn.draft}
                onPreviewSqlPatch={onPreviewSqlPatch}
                trustedProjectFilePaths={(turn.fileChanges ?? []).map(
                  (change) => change.relativePath,
                )}
                onOpenProjectFile={onOpenProjectFile}
              />
              {turn.final && (
                <>
                  <AssistantAttachmentList
                    attachments={turn.final.attachments}
                    onExecute={onExecuteAttachment}
                  />
                  <AssistantCitationList
                    citations={turn.final.citations ?? []}
                    onExecute={onExecuteAttachment}
                  />
                  <AssistantArtifactList
                    projectId={turn.projectId}
                    artifactRefs={turn.final.artifactRefs ?? []}
                  />
                </>
              )}
              {turn.final?.content && (
                <div className="mt-1.5 flex items-center gap-0.5 text-[hsl(var(--wb-text-muted))]">
                  <button
                    type="button"
                    className="wb-icon-button h-6 w-6"
                    onClick={() => void onCopyAnswer(turn)}
                    title="Copy response"
                    aria-label="Copy response"
                  >
                    {copied ? (
                      <Check size={10} aria-hidden="true" />
                    ) : (
                      <Copy size={10} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="wb-icon-button h-6 w-6"
                    onClick={() => onUsePrompt(turn.userMessage)}
                    title="Use this prompt again"
                    aria-label="Use prompt again"
                  >
                    <RotateCcw size={10} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      {turn.error && (
        <div className="flex items-start gap-2 text-[10px] leading-4 text-amber-300">
          <CircleAlert size={11} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{turn.error}</p>
            {turn.errorDetail && (
              <details className="group mt-1 text-[9px] text-[hsl(var(--wb-text-muted))]">
                <summary className="flex cursor-pointer list-none items-center gap-1 marker:content-none hover:text-[hsl(var(--wb-text))] [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={10}
                    className="transition-transform duration-150 group-open:rotate-90"
                  />
                  Technical details
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-[3px] bg-black/15 px-2 py-1.5 font-mono leading-4">
                  {turn.errorDetail}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
      {turn.error && !turn.final?.content && turn.status !== "paused" && (
        <button
          type="button"
          className="wb-text-button ml-5 h-6 gap-1 px-1.5 text-[9px]"
          onClick={() => onUsePrompt(turn.userMessage)}
        >
          <RotateCcw size={10} aria-hidden="true" />
          Try again
        </button>
      )}
    </article>
  );
});

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
  starterPrompts,
}: {
  onUsePrompt: (prompt: string) => void;
  starterPrompts: readonly string[];
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-5 py-8">
      <div className="w-full max-w-[300px]">
        <Sparkles size={20} className="mb-3 text-[hsl(var(--wb-accent))]" />
        <h2 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
          Work with your database
        </h2>
        <p className="mt-1 max-w-[34ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
          Ask a question, review a plan, or let Agent inspect the active
          workspace with safety gates in place.
        </p>

        <div className="mt-4 border-y border-[hsl(var(--wb-border-subtle))]">
          {starterPrompts.map((prompt) => (
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
