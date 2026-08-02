import type { LspSemanticCompletionStatus } from "@/store/useLspSemanticStatusStore";

export interface LspSemanticStatusPresentation {
  label: string;
  title: string;
  attention: boolean;
}

/**
 * Describes schema-aware completion separately from the LSP process state.
 * Keeping this text in one place prevents a green "ready" indicator from
 * implying that catalog metadata is already usable.
 */
export function lspSemanticStatusPresentation(
  status: LspSemanticCompletionStatus | undefined,
): LspSemanticStatusPresentation | null {
  if (!status) return null;

  const objectLabel = `${status.totalObjects} schema object${
    status.totalObjects === 1 ? "" : "s"
  }`;

  switch (status.state) {
    case "syncing":
      return {
        label: "schema syncing",
        title: "Schema metadata is syncing. Keyword and already-known object completion remain available.",
        attention: true,
      };
    case "cached":
      return {
        label: "schema cached",
        title: `Schema-aware completion is ready from cache (${objectLabel}).`,
        attention: false,
      };
    case "full":
      return {
        label: "schema ready",
        title: `Schema-aware completion is ready (${objectLabel}).`,
        attention: false,
      };
    case "limited":
      return {
        label: "schema limited",
        title:
          status.message ??
          `Some schema metadata could not be loaded. Keyword and object-name completion remain available (${objectLabel}).`,
        attention: true,
      };
    case "error":
      return {
        label: "schema unavailable",
        title:
          status.message ??
          "Schema metadata could not be sent to the language service. Keyword completion may still be available.",
        attention: true,
      };
  }
}
