import { cn } from "@/lib/utils";
import { Bot, Loader2, UserRound } from "lucide-react";

export interface AssistantConversationEntry {
  id: string;
  requestId?: string;
  role: "user" | "assistant";
  content: string;
  status?: "normal" | "error";
}

interface AssistantConversationProps {
  entries: AssistantConversationEntry[];
  isPlanning: boolean;
}

export function AssistantConversation({
  entries,
  isPlanning,
}: AssistantConversationProps) {
  if (entries.length === 0 && !isPlanning) return null;

  return (
    <div
      className="divide-y divide-[hsl(var(--wb-border-subtle))] border-b border-[hsl(var(--wb-border-subtle))]"
      aria-label="Assistant conversation"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex items-start gap-2 px-3 py-2.5 text-[11px] leading-[1.55]",
            entry.role === "user"
              ? "bg-[hsl(var(--wb-active)/0.46)]"
              : "bg-[hsl(var(--wb-editor))]"
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
              entry.role === "user"
                ? "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text-muted))]"
                : "border-[hsl(var(--wb-accent)/0.35)] bg-[hsl(var(--wb-accent)/0.1)] text-[hsl(var(--wb-accent))]"
            )}
          >
            {entry.role === "user" ? (
              <UserRound size={11} />
            ) : (
              <Bot size={11} />
            )}
          </span>
          <div
            className={cn(
              "min-w-0 flex-1 whitespace-pre-wrap break-words text-[hsl(var(--wb-text))]",
              entry.status === "error" && "text-[hsl(var(--destructive))]"
            )}
          >
            {entry.content}
          </div>
        </div>
      ))}
      {isPlanning && (
        <div className="flex items-center gap-2 bg-[hsl(var(--wb-editor))] px-3 py-2.5 text-[11px] text-[hsl(var(--wb-text-muted))]">
          <span className="flex h-5 w-5 items-center justify-center text-[hsl(var(--wb-accent))]">
            <Loader2 size={12} className="animate-spin" />
          </span>
          Planning with workspace context...
        </div>
      )}
    </div>
  );
}
