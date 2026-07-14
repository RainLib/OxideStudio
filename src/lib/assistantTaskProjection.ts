import type { AssistantTaskRecord } from "@/services/tauri/assistant-task.service";
import type { WorkbenchTask } from "@/store/useTaskStore";

export function assistantTaskToWorkbenchTask(
  task: AssistantTaskRecord,
): WorkbenchTask {
  const completedById = new Map(
    task.checkpoint.completedSteps.map((step) => [step.id, step.status]),
  );
  const receiptByStepId = new Map(
    (task.checkpoint.executionReceipts ?? []).map((receipt) => [
      receipt.stepId,
      receipt.status,
    ]),
  );
  return {
    id: task.id,
    kind: "agent",
    title: task.title,
    detail: task.detail,
    status:
      task.status === "awaiting_approval"
        ? "waiting"
        : task.status === "completed"
          ? "success"
          : task.status === "failed"
            ? "error"
            : task.status,
    progress: task.progress,
    startedAt: task.createdAt,
    finishedAt: task.finishedAt,
    error: task.status === "failed" ? task.detail : null,
    projectId: task.projectId,
    persistent: true,
    currentStepId: task.currentStepId,
    steps: task.checkpoint.plan.map((step) => ({
      ...step,
      status:
        completedById.get(step.id) ??
        (receiptByStepId.get(step.id) === "started" &&
        task.status !== "running" &&
        task.status !== "awaiting_approval"
          ? "uncertain"
          : receiptByStepId.get(step.id) === "started"
            ? "running"
            : undefined) ??
        (step.id === task.currentStepId
          ? "running"
          : task.status === "awaiting_approval" && step.requiresApproval
            ? "requiresApproval"
            : "pending"),
    })),
  };
}
