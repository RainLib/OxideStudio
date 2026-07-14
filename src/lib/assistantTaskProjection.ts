import type { AssistantTaskRecord } from "@/services/tauri/assistant-task.service";
import type { WorkbenchTask } from "@/store/useTaskStore";

export function assistantTaskToWorkbenchTask(
  task: AssistantTaskRecord,
): WorkbenchTask {
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
  };
}
