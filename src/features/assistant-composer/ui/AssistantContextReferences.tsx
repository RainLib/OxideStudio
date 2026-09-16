import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import { Database, FileText, X } from "lucide-react";

interface AssistantContextReferencesProps
  extends Pick<
    AssistantPromptBoxProps,
    | "databaseMentions"
    | "onRemoveDatabaseMention"
    | "attachments"
    | "onRemoveAttachment"
  > {
  contextLocked: boolean;
}

export function AssistantContextReferences({
  databaseMentions,
  onRemoveDatabaseMention,
  contextLocked,
  attachments,
  onRemoveAttachment,
}: AssistantContextReferencesProps) {
  return (
    <div
      className="flex flex-wrap gap-1.5 px-2 pt-2"
      aria-label="Assistant context references"
    >
      {databaseMentions.map((mention) => {
        const qualifiedName = [mention.schema, mention.table]
          .filter(Boolean)
          .join(".");
        const scope = [mention.connectionName, mention.database]
          .filter(Boolean)
          .join(" · ");
        const key = [
          mention.connectionId,
          mention.database,
          mention.schema,
          mention.table,
        ].join("\u0000");
        return (
          <span
            key={key}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] border border-[hsl(var(--wb-accent)/0.28)] bg-[hsl(var(--wb-accent)/0.08)] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text-muted))]"
            title={scope ? `${qualifiedName} · ${scope}` : qualifiedName}
            data-assistant-table-mention={qualifiedName}
          >
            <Database
              size={10}
              className="shrink-0 text-[hsl(var(--wb-accent))]"
              aria-hidden="true"
            />
            <span className="truncate">{qualifiedName}</span>
            <button
              type="button"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => onRemoveDatabaseMention(mention)}
              disabled={contextLocked}
              aria-label={`Remove table context ${qualifiedName}`}
            >
              <X size={9} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text-muted))]"
          title={`${attachment.fileName} · ${attachment.byteCount.toLocaleString()} bytes`}
        >
          <FileText size={10} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{attachment.fileName}</span>
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
            onClick={() => onRemoveAttachment(attachment.id)}
            disabled={contextLocked}
            aria-label={`Remove ${attachment.fileName}`}
          >
            <X size={9} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}
