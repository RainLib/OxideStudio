import type { DatabaseDriver } from "@/services/tauri/types";

export type LspDocumentIdentity = {
  tabId: string;
  driver: DatabaseDriver;
};

export function getLspDocumentUri(
  tabId: string,
  driver: DatabaseDriver,
  languageId = "sql"
) {
  const extension = lspDocumentExtension(languageId);
  return `oxide://query/${encodeURIComponent(tabId)}.${encodeURIComponent(
    String(driver)
  )}.${extension}`;
}

export function getSqlDocumentUri(tabId: string, driver: DatabaseDriver) {
  return getLspDocumentUri(tabId, driver, "sql");
}

export function extractLspDocumentIdentity(
  uri: string
): LspDocumentIdentity | null {
  const match = uri.match(/^oxide:\/\/query\/(.+)\.([^./?#]+)\.[^./?#]+(?:[?#].*)?$/);
  if (!match?.[1] || !match[2]) return null;

  try {
    return {
      tabId: decodeURIComponent(match[1]),
      driver: decodeURIComponent(match[2]) as DatabaseDriver,
    };
  } catch {
    return null;
  }
}

export function extractSqlDocumentTabId(uri: string) {
  return extractLspDocumentIdentity(uri)?.tabId ?? null;
}

function lspDocumentExtension(languageId: string) {
  const normalized = languageId.trim().toLowerCase();
  if (!normalized || normalized === "sql") return "sql";
  if (normalized === "json") return "json";
  if (normalized === "redis") return "redis";
  if (normalized === "elasticsearch-dsl") return "esdsl";
  if (normalized === "elasticsearch-eql") return "eseql";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "txt";
}
