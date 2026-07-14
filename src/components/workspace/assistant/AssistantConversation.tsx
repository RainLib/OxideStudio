import { cn } from "@/lib/utils";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { AssistantMessageContent } from "./AssistantMessageContent";
import type {
  AssistantAttachment,
  UiActionRequest,
  UiActionResult,
} from "@/ai/ui-actions/types";
import { AssistantAttachmentList } from "./AssistantAttachmentList";

export interface AssistantConversationEntry {
  id: string;
  requestId?: string;
  role: "user" | "assistant";
  content: string;
  status?: "normal" | "error";
  attachments?: AssistantAttachment[];
}

interface AssistantConversationProps {
  entries: AssistantConversationEntry[];
  isResponding: boolean;
  pendingLabel: string;
  onUsePrompt: (prompt: string) => void;
  onExecuteAttachment: (request: UiActionRequest) => Promise<UiActionResult>;
}

const STARTER_PROMPTS = [
  "Explain the SQL in my active editor",
  "Inspect the current database structure",
  "Plan a safe schema change",
] as const;

export function AssistantConversation({
  entries,
  isResponding,
  pendingLabel,
  onUsePrompt,
  onExecuteAttachment,
}: AssistantConversationProps) {
  if (entries.length === 0 && !isResponding) {
    return <AssistantWelcome onUsePrompt={onUsePrompt} />;
  }

  return (
    <div
      className="space-y-3 px-3 py-3"
      aria-label="Assistant conversation"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "text-[11px] leading-[1.6] text-[hsl(var(--wb-text))]",
            entry.role === "user"
              ? "ml-auto max-w-[88%] rounded-[8px] bg-[hsl(var(--wb-active)/0.72)] px-2.5 py-2"
              : "flex max-w-full items-start gap-2",
            entry.status === "error" && "text-[hsl(var(--destructive))]"
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
      ))}

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
