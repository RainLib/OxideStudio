export function loadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "Schema metadata could not be loaded");
}
