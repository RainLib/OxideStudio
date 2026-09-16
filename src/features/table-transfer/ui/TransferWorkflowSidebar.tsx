import type { TransferDialogSection } from "@/features/table-transfer/model/transferDialogTypes";
import { displayEndpoint } from "@/features/table-transfer/model/transferPolicy";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { type ConnectionConfig } from "@/store/useConnectionStore";
import {
  ArrowRightLeft,
  CheckCircle2,
  Database,
  ListChecks,
} from "lucide-react";

interface TransferWorkflowSidebarProps {
  effectiveSource: {
    schema: string;
    table: string;
    connectionId: string;
    driver: DatabaseDriver;
    database?: string | undefined;
  };
  selectedSourceTables: Set<string>;
  destinationReady: boolean;
  targetConnection: ConnectionConfig | undefined;
  targetSchema: string;
  reviewReady: boolean;
  canExecute: boolean;
  selectSection: (section: TransferDialogSection) => void;
  activeSection: TransferDialogSection;
}

export function TransferWorkflowSidebar({
  effectiveSource,
  selectedSourceTables,
  destinationReady,
  targetConnection,
  targetSchema,
  reviewReady,
  canExecute,
  selectSection,
  activeSection,
}: TransferWorkflowSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
      <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-3">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--wb-text))]">
          <ArrowRightLeft size={13} className="text-[hsl(var(--wb-accent))]" />
          Source
        </div>
        <p
          className="mt-1 truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]"
          title={displayEndpoint(effectiveSource)}
        >
          {displayEndpoint(effectiveSource)}
        </p>
        <p className="mt-1 text-[9px] text-[hsl(var(--wb-text-muted))]">
          {selectedSourceTables.size} selected{" "}
          {selectedSourceTables.size === 1 ? "table" : "tables"}
        </p>
      </div>

      <nav className="space-y-0.5 p-1.5" aria-label="Transfer workflow">
        {[
          {
            id: "setup" as const,
            label: "Transfer setup",
            detail: destinationReady
              ? `${targetConnection?.name || "Target"} · ${targetSchema}`
              : "Choose destination",
            complete: destinationReady,
            Icon: Database,
          },
          {
            id: "review" as const,
            label: "Review & confirm",
            detail: reviewReady
              ? canExecute
                ? "Ready to run"
                : "Review required"
              : "Preview mapping first",
            complete: canExecute,
            Icon: ListChecks,
          },
        ].map(({ id, label, detail, complete, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectSection(id)}
            aria-current={activeSection === id ? "step" : undefined}
            className={`flex w-full items-start gap-2 rounded-[4px] px-2 py-2 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] motion-reduce:transition-none ${activeSection === id ? "bg-[hsl(var(--wb-active-strong))]" : ""}`}
          >
            {complete ? (
              <CheckCircle2
                size={13}
                className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
              />
            ) : (
              <Icon
                size={13}
                className="mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]"
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">
                {label}
              </span>
              <span className="mt-0.5 block truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
                {detail}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Preview is read-only. A reviewed token is required before any target
        rows change.
      </div>
    </aside>
  );
}
