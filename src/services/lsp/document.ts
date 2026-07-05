import type { DatabaseDriver } from "@/services/tauri/types";

export function getSqlDocumentUri(tabId: string, driver: DatabaseDriver) {
  return `oxide://query/${encodeURIComponent(tabId)}.${encodeURIComponent(
    String(driver)
  )}.sql`;
}

export function extractSqlDocumentTabId(uri: string) {
  const match = uri.match(/^oxide:\/\/query\/(.+)\.[^./?#]+\.sql(?:[?#].*)?$/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
