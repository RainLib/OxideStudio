import { captureWorkspaceUiActionContext } from "@/ai/ui-actions/context";
import type {
  UiActionRequest,
  UiActionResult,
  UiActionTarget,
} from "@/ai/ui-actions/types";
import { cn } from "@/lib/utils";
import type { AgentCitation } from "@/services/tauri/agent-host.service";
import {
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Loader2,
} from "lucide-react";
import { useState } from "react";

interface AssistantCitationListProps {
  citations: AgentCitation[];
  onExecute: (request: UiActionRequest) => Promise<UiActionResult>;
}

export function AssistantCitationList({
  citations,
  onExecute,
}: AssistantCitationListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, UiActionResult>>({});
  if (citations.length === 0) return null;

  const execute = async (citation: AgentCitation) => {
    if (pendingId) return;
    const request = citationAction(citation);
    if (!request) return;
    setPendingId(citation.id);
    setResults((current) => {
      const next = { ...current };
      delete next[citation.id];
      return next;
    });
    try {
      const result = await onExecute(request);
      setResults((current) => ({ ...current, [citation.id]: result }));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section
      className="mt-2 border-y border-[hsl(var(--wb-border-subtle))]"
      aria-label="Answer sources"
    >
      <div className="flex min-h-6 items-center justify-between px-1.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
        <span className="font-medium text-[hsl(var(--wb-text))]">Sources</span>
        <span>{citations.length} verified</span>
      </div>
      {citations.map((citation, index) => {
        const result = results[citation.id];
        const Icon = citation.kind === "planNode" ? Braces : Database;
        return (
          <div
            key={citation.id}
            className="border-t border-[hsl(var(--wb-border-subtle))]"
            data-assistant-citation-id={citation.id}
          >
            <button
              type="button"
              className="group flex min-h-8 w-full items-center gap-2 px-1.5 text-left transition-colors hover:bg-[hsl(var(--wb-hover)/0.58)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-wait disabled:opacity-60"
              onClick={() => void execute(citation)}
              disabled={Boolean(pendingId)}
              title={`Open source: ${citation.detail || citation.label}`}
            >
              <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] bg-[hsl(var(--wb-active))] px-1 font-mono text-[8px] text-[hsl(var(--wb-text))]">
                {index + 1}
              </span>
              <Icon
                size={11}
                className="shrink-0 text-[hsl(var(--wb-accent))]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[9px] font-medium text-[hsl(var(--wb-text))]">
                  {citation.label}
                </span>
                <span className="block truncate text-[8px] text-[hsl(var(--wb-text-muted))]">
                  {citation.detail || citation.toolName}
                </span>
              </span>
              {pendingId === citation.id ? (
                <Loader2 size={10} className="shrink-0 animate-spin" />
              ) : result?.status === "success" ? (
                <Check size={10} className="shrink-0 text-emerald-400" />
              ) : (
                <ChevronRight
                  size={10}
                  className="shrink-0 text-[hsl(var(--wb-text-muted))] transition-transform group-hover:translate-x-0.5"
                />
              )}
            </button>
            {result && result.status !== "success" && (
              <div
                className={cn(
                  "flex items-start gap-1.5 px-1.5 pb-1.5 text-[8px] leading-3",
                  result.status === "stale"
                    ? "text-amber-300"
                    : "text-[hsl(var(--destructive))]",
                )}
                role="status"
              >
                <CircleAlert size={9} className="mt-0.5 shrink-0" />
                <span>
                  {result.message || result.code}
                  {result.recovery ? ` ${result.recovery}` : ""}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function citationAction(citation: AgentCitation): UiActionRequest | null {
  const context = captureWorkspaceUiActionContext();
  let action: UiActionRequest["action"];
  let target: UiActionTarget;
  if (
    citation.kind === "databaseSchema" &&
    citation.connectionId &&
    citation.schemaName
  ) {
    action = "database.revealSchema";
    target = {
      projectId: citation.projectId,
      connectionId: citation.connectionId,
      databaseName: citation.databaseName,
      schemaName: citation.schemaName,
    };
  } else if (
    citation.kind === "databaseObject" &&
    citation.connectionId &&
    citation.schemaName &&
    citation.objectName
  ) {
    action = "database.revealObject";
    target = {
      projectId: citation.projectId,
      connectionId: citation.connectionId,
      databaseName: citation.databaseName,
      schemaName: citation.schemaName,
      objectName: citation.objectName,
      objectType: citation.objectType,
    };
  } else if (
    citation.kind === "planNode" &&
    citation.tabId &&
    citation.planId &&
    citation.nodeId
  ) {
    action = "plan.revealNode";
    target = {
      projectId: citation.projectId,
      tabId: citation.tabId,
      planId: citation.planId,
      nodeId: citation.nodeId,
    };
  } else {
    return null;
  }

  return {
    id: `${citation.id}:reveal`,
    action,
    target,
    issuedAgainst: {
      projectId: context.projectId,
      contextVersion: context.contextVersion,
    },
    presentation: {
      label: `Open source ${citation.label}`,
      reveal: true,
      focus: true,
    },
  };
}
