import { isProjectFileRevisionConflict } from "@/services/tauri/project-files.service";

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Agent Host command failed.";
}

export function fileReviewError(error: unknown) {
  if (isProjectFileRevisionConflict(error)) {
    return "This file changed after the Agent edit, so OxideStudio did not undo it. Review the current file and retry from a fresh diff.";
  }
  return errorMessage(error);
}
