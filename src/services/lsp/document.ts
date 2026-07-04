import type { DatabaseDriver } from "@/services/tauri/types";

export function getSqlDocumentUri(tabId: string, driver: DatabaseDriver) {
  return `oxide://query/${encodeURIComponent(tabId)}.${encodeURIComponent(
    String(driver)
  )}.sql`;
}
