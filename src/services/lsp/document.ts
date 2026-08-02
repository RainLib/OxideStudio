import type { DatabaseDriver } from "@/services/tauri/types";

export type LspDocumentIdentity = {
  tabId: string;
  driver: DatabaseDriver;
};

export type LspProjectDocumentIdentity = {
  projectId: string;
  relativePath: string;
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

/**
 * Stable URI for a saved project SQL file. The project id scopes the document
 * without leaking an absolute local path to the language service.
 */
export function getLspProjectDocumentUri(
  projectId: string,
  relativePath: string,
  _languageId = "sql",
) {
  const path = relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `oxide://project/${encodeURIComponent(projectId)}/${path}`;
}

export function parseLspProjectDocumentUri(
  uri: string,
): LspProjectDocumentIdentity | null {
  try {
    const value = new URL(uri);
    if (value.protocol !== "oxide:" || value.hostname !== "project") {
      return null;
    }
    const segments = value.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const projectId = decodeURIComponent(value.pathname.split("/")[1] || "").trim();
    if (!projectId || segments.length < 2) return null;
    const relativePath = segments.slice(1).join("/");
    if (!relativePath || relativePath.split("/").some((segment) => segment === "..")) {
      return null;
    }
    return { projectId, relativePath };
  } catch {
    return null;
  }
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
  if (normalized === "elasticsearch-dsl") return "elasticsearch";
  if (normalized === "elasticsearch-eql") return "eql";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "txt";
}
