export const APP_EVENT_OPEN_PROJECT_FILES = "oxide:open-project-files";

export function requestProjectFilesPanel() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_PROJECT_FILES));
}
