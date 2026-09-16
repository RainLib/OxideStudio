export function shortObjectType(value?: string | null) {
  const normalized = value?.toUpperCase() || "TABLE";
  if (normalized.includes("MATERIALIZED")) return "MVIEW";
  if (normalized.includes("VIEW")) return "VIEW";
  if (normalized.includes("FOREIGN")) return "FOREIGN";
  return "TABLE";
}

export function isDiagramRelationshipTable(value?: string | null) {
  const normalized = value?.toUpperCase() || "BASE TABLE";
  return (
    normalized.includes("TABLE") &&
    !normalized.includes("VIEW") &&
    !normalized.includes("FOREIGN")
  );
}

export function canvasPersistenceLabel(
  state: "loading" | "ready" | "saving" | "error",
) {
  if (state === "loading") return "loading canvas";
  if (state === "saving") return "saving canvas";
  if (state === "error") return "canvas save failed";
  return "canvas saved";
}

export function createDiagramNoteId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `note-${crypto.randomUUID()}`;
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      ),
    )
  );
}

export function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
