import type { Project } from "@/services/tauri/store.service";

export const DEFAULT_PROJECT: Project = {
  id: "sqls",
  name: "sqls",
  created_at: 0,
  updated_at: 0,
};

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";

export function readActiveProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT.id;
  } catch {
    return DEFAULT_PROJECT.id;
  }
}

export function writeActiveProjectId(projectId: string) {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
  } catch {
    // Ignore storage failures; the active project remains in memory.
  }
}

export function projectIdFromName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${slug || "project"}-${suffix}`;
}

export function normalizedProjectRootPath(rootPath?: string | null) {
  const trimmed = rootPath?.trim();
  if (!trimmed) return null;
  if (/^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/[\\/]+$/, "");
  return normalized || null;
}

export function projectRootKey(rootPath?: string | null) {
  return normalizedProjectRootPath(rootPath)?.replace(/\\/g, "/").toLowerCase();
}
