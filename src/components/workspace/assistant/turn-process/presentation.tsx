import type { AssistantProcessItem, AssistantTurn } from "@/ai/assistant/turns";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  FileSearch,
  HelpCircle,
  Loader2,
  Pencil,
  Search,
  ShieldAlert,
  SquareTerminal,
  Trash2,
} from "lucide-react";

export type ProjectFileOperation = "read" | "edit" | "delete";

export function ProcessDisclosureHeadline({
  turn,
  processItems,
}: {
  turn: AssistantTurn;
  processItems: AssistantProcessItem[];
}) {
  const { t } = useI18n();
  const duration = formatProcessDuration(
    Math.max(0, turn.updatedAt - turn.createdAt),
  );
  if (turn.status === "completed") {
    return t("assistant.process.workedFor", { duration });
  }
  return turnProcessHeadline(turn, processItems, t);
}

function formatProcessDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function splitOutputPreview(detail: string): [string, string] {
  const marker = "\nOutput preview\n";
  const markerIndex = detail.indexOf(marker);
  if (markerIndex < 0) return [detail, ""];
  return [
    detail.slice(0, markerIndex).trim(),
    detail.slice(markerIndex + marker.length).trim(),
  ];
}

export function TurnStatusIcon({ turn }: { turn: AssistantTurn }) {
  if (["queued", "planning", "running", "cancelling"].includes(turn.status)) {
    return (
      <Loader2
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (["failed", "paused"].includes(turn.status)) {
    return <CircleAlert size={11} className="shrink-0 text-amber-400" />;
  }
  if (turn.status === "awaiting_input") {
    return (
      <HelpCircle size={11} className="shrink-0 text-[hsl(var(--wb-accent))]" />
    );
  }
  if (turn.status === "awaiting_approval") {
    return <ShieldAlert size={11} className="shrink-0 text-amber-400" />;
  }
  if (turn.status === "cancelled") {
    return <CircleStop size={11} className="shrink-0 wb-muted" />;
  }
  return <CheckCircle2 size={11} className="shrink-0 text-emerald-500" />;
}

export function ProjectFileOperationIcon({
  operation,
  status,
}: {
  operation: ProjectFileOperation;
  status: AssistantProcessItem["status"];
}) {
  const className = cn(
    "mt-0.5 shrink-0",
    status === "running"
      ? "text-[hsl(var(--wb-accent))]"
      : status === "failed"
        ? "text-amber-400"
        : "text-[hsl(var(--wb-text-muted))]",
  );
  if (operation === "read") {
    return (
      <FileSearch
        size={10}
        className={className}
        aria-hidden="true"
        data-project-file-icon="read"
      />
    );
  }
  if (operation === "delete") {
    return (
      <Trash2
        size={10}
        className={className}
        aria-hidden="true"
        data-project-file-icon="delete"
      />
    );
  }
  return (
    <Pencil
      size={10}
      className={className}
      aria-hidden="true"
      data-project-file-icon="edit"
    />
  );
}

export function ProcessKindIcon({ item }: { item: AssistantProcessItem }) {
  const toolName = item.toolName?.toLocaleLowerCase() ?? "";
  const className = cn(
    "mt-0.5 shrink-0",
    item.status === "running"
      ? "text-[hsl(var(--wb-accent))]"
      : item.status === "failed"
        ? "text-amber-400"
        : "text-[hsl(var(--wb-text-muted))]",
  );
  if (
    toolName.includes("command") ||
    toolName.includes("terminal") ||
    toolName.includes("shell") ||
    toolName.startsWith("query.")
  ) {
    return (
      <SquareTerminal size={10} className={className} aria-hidden="true" />
    );
  }
  if (
    toolName.includes("search") ||
    toolName.includes("find") ||
    toolName.endsWith(".list") ||
    toolName.includes("listfiles")
  ) {
    return <Search size={10} className={className} aria-hidden="true" />;
  }
  return <ProcessStatusIcon status={item.status} />;
}

export function ProcessStatusIcon({
  status,
}: {
  status: AssistantProcessItem["status"];
}) {
  if (status === "running") {
    return (
      <Loader2
        size={10}
        className="mt-0.5 shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (status === "failed") {
    return <CircleAlert size={10} className="mt-0.5 shrink-0 text-amber-400" />;
  }
  if (status === "cancelled") {
    return <CircleStop size={10} className="mt-0.5 shrink-0 wb-muted" />;
  }
  return <Check size={10} className="mt-0.5 shrink-0 wb-muted" />;
}

export function turnProcessHeadline(
  turn: AssistantTurn,
  processItems: AssistantProcessItem[],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (turn.status === "awaiting_input")
    return t("assistant.process.waitingAnswer");
  if (turn.status === "awaiting_approval")
    return t("assistant.process.waitingApproval");
  if (turn.status === "paused") return t("assistant.process.paused");
  if (turn.status === "cancelling") return t("assistant.process.stopping");
  if (turn.status === "failed") return t("assistant.process.needsAttention");
  if (turn.status === "cancelled") return t("assistant.process.cancelled");

  const runningItem = [...processItems]
    .reverse()
    .find((item) => item.status === "running");
  if (runningItem) return runningItem.title;
  if (turn.status === "planning") return t("assistant.process.thinking");
  if (turn.status === "running") {
    if (turn.draft.trim()) return t("assistant.process.writing");
    return processItems.length > 0
      ? completedActivityHeadline(processItems, t)
      : t("assistant.process.working");
  }
  return completedActivityHeadline(processItems, t);
}

function completedActivityHeadline(
  processItems: AssistantProcessItem[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const labels: string[] = [];
  const clarificationItems = processItems.filter(
    (item) => item.kind === "clarification",
  );
  for (const item of processItems) {
    if (item.kind === "clarification") {
      const label =
        clarificationItems.length === 1
          ? item.title.trim()
          : t("assistant.process.confirmedAnswers");
      if (label && !labels.includes(label)) labels.push(label);
      continue;
    }
    const label =
      item.kind === "planning"
        ? t("assistant.process.prepared")
        : item.title.trim();
    if (label && !labels.includes(label)) labels.push(label);
  }

  const substantiveLabels =
    labels.length > 1
      ? labels.filter((label) => label !== t("assistant.process.prepared"))
      : labels;
  if (substantiveLabels.length === 0) return t("assistant.process.completed");
  if (substantiveLabels.length <= 2) return substantiveLabels.join(" · ");
  return `${substantiveLabels[0]} · ${substantiveLabels[1]} · ${t(
    "assistant.process.more",
    { count: substantiveLabels.length - 2 },
  )}`;
}
