export type ProjectSourceMode = "local" | "git" | "github";

export function projectNameFromRootPath(rootPath: string) {
  const trimmed = rootPath.trim();
  const normalized =
    /^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return (
    segments[segments.length - 1] ||
    (normalized.startsWith("/") ? "Root" : "Project")
  );
}

export function projectRootKey(rootPath?: string | null) {
  const trimmed = rootPath?.trim();
  if (!trimmed) return undefined;
  const normalized =
    /^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/[\\/]+$/, "");
  return normalized.replace(/\\/g, "/").toLowerCase();
}
