import { confirmAction } from "@/lib/appDialogs";
import { databaseService } from "@/services/tauri/database.service";

/** null means cancelled; undefined means the Host found no file to delete. */
export async function confirmSqliteBackupFileDeletion(id: string): Promise<string | null | undefined> {
  const preview = await databaseService.previewSqliteBackupFileDelete(id);
  const message = preview.filePath
    ? `${preview.reviewRequired ? "This file has changed or has no verified completion receipt. Review this path before deleting:\n\n" : "Delete this backup file?\n\n"}${preview.filePath}\n${preview.byteLen?.toLocaleString() ?? "Unknown"} bytes\n\nThis also removes its backup record.`
    : "Delete this backup record? No retained file will be deleted.";
  if (!(await confirmAction(message))) return null;
  return preview.confirmationToken ?? undefined;
}
