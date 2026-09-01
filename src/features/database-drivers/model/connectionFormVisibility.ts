import type { DatabaseDataModel } from "@/services/tauri/types";

/** Queue packages expose structured broker/bootstrap fields. Their generated
 * transport URL remains a Host detail and should not appear as a second,
 * conflicting source of truth in the connection form. */
export function shouldShowConnectionUrl(dataModel: DatabaseDataModel) {
  return dataModel !== "queue";
}
