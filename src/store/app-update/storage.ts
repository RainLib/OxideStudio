const LAST_CHECK_STORAGE_KEY = "oxide-update-last-check";
const IGNORED_VERSION_STORAGE_KEY = "oxide-update-ignored-version";

export function readIgnoredUpdateVersion() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(IGNORED_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeIgnoredUpdateVersion(version: string | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (version) localStorage.setItem(IGNORED_VERSION_STORAGE_KEY, version);
    else localStorage.removeItem(IGNORED_VERSION_STORAGE_KEY);
  } catch {
    // Update preferences remain best-effort when storage is unavailable.
  }
}

export function readLastUpdateCheck() {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = Number(localStorage.getItem(LAST_CHECK_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeLastUpdateCheck(value: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_CHECK_STORAGE_KEY, String(value));
  } catch {
    // A blocked storage backend must not prevent update checks.
  }
}
