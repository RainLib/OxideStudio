import type {
  UiActionContextSnapshot,
  UiActionDefinition,
  UiActionRequest,
  UiActionResult,
} from "./types";

export type UiActionRegistryOptions = {
  captureContext: () => UiActionContextSnapshot;
  documentRevisionForTab?: (tabId: string) => string | null;
};

export class UiActionRegistry {
  private readonly actions = new Map<string, UiActionDefinition>();

  constructor(private readonly options: UiActionRegistryOptions) {}

  register(definition: UiActionDefinition) {
    if (this.actions.has(definition.name)) {
      throw new Error(`UI action already registered: ${definition.name}`);
    }
    this.actions.set(definition.name, definition);
    return this;
  }

  list() {
    return Array.from(this.actions.values()).map(
      ({ execute: _execute, validateTarget: _validateTarget, ...definition }) =>
        definition
    );
  }

  async execute(request: UiActionRequest): Promise<UiActionResult> {
    const requestError = validateRequest(request);
    if (requestError) {
      return result(request?.id || "unknown", "invalid", "INVALID_REQUEST", requestError);
    }

    const definition = this.actions.get(request.action);
    if (!definition) {
      return result(
        request.id,
        "unsupported",
        "UNSUPPORTED_ACTION",
        `UI action is not registered: ${request.action}`
      );
    }

    const current = this.options.captureContext();
    if (request.issuedAgainst.projectId !== current.projectId) {
      return result(
        request.id,
        "stale",
        "PROJECT_CONTEXT_STALE",
        "This attachment belongs to a project that is no longer active.",
        "Return to the original project or ask the assistant to refresh the answer."
      );
    }

    if (
      request.target.projectId !== current.projectId &&
      request.action !== "project.open"
    ) {
      return result(
        request.id,
        "stale",
        "PROJECT_SWITCH_REQUIRED",
        "The target belongs to another project.",
        "Switch projects explicitly before opening this target."
      );
    }

    if (
      definition.stalePolicy === "context" &&
      request.issuedAgainst.contextVersion !== current.contextVersion
    ) {
      return result(
        request.id,
        "stale",
        "CONTEXT_STALE",
        "The workspace changed after this action was created.",
        "Ask the assistant to refresh the action against the current workspace."
      );
    }

    if (definition.stalePolicy === "document") {
      const tabId = request.target.tabId;
      const expectedRevision = request.issuedAgainst.documentRevision;
      const currentRevision = tabId
        ? this.options.documentRevisionForTab?.(tabId) ?? null
        : null;
      if (
        !tabId ||
        !expectedRevision ||
        !currentRevision ||
        expectedRevision !== currentRevision
      ) {
        return result(
          request.id,
          "stale",
          "DOCUMENT_REVISION_STALE",
          "The editor document changed after this action was created.",
          "Refresh the proposed edit before applying it."
        );
      }
    }

    const targetError = definition.validateTarget?.(request.target);
    if (targetError) {
      return result(request.id, "invalid", "INVALID_TARGET", targetError);
    }

    try {
      const actionResult = await definition.execute(request.target, {
        actionId: request.id,
        current,
        issuedAgainst: request.issuedAgainst,
        documentRevisionForTab:
          this.options.documentRevisionForTab ?? (() => null),
      });
      return (
        actionResult ?? result(request.id, "success", "OK")
      );
    } catch (error) {
      return result(
        request.id,
        "error",
        "ACTION_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export function uiActionResult(
  actionId: string,
  status: UiActionResult["status"],
  code: UiActionResult["code"],
  message?: string,
  recovery?: string
) {
  return result(actionId, status, code, message, recovery);
}

function result(
  actionId: string,
  status: UiActionResult["status"],
  code: UiActionResult["code"],
  message?: string,
  recovery?: string
): UiActionResult {
  return {
    actionId,
    status,
    code,
    ...(message ? { message } : {}),
    ...(recovery ? { recovery } : {}),
  };
}

function validateRequest(request: UiActionRequest | null | undefined) {
  if (!request || typeof request !== "object") return "UI action request is required.";
  if (!request.id?.trim()) return "UI action id is required.";
  if (!request.action?.trim()) return "UI action name is required.";
  if (!request.target || typeof request.target !== "object") {
    return "UI action target is required.";
  }
  if (!request.target.projectId?.trim()) return "Target projectId is required.";
  if (!request.issuedAgainst || typeof request.issuedAgainst !== "object") {
    return "issuedAgainst context is required.";
  }
  if (!request.issuedAgainst.projectId?.trim()) {
    return "issuedAgainst.projectId is required.";
  }
  if (!Number.isInteger(request.issuedAgainst.contextVersion)) {
    return "issuedAgainst.contextVersion must be an integer.";
  }
  if (!request.presentation?.label?.trim()) {
    return "UI action presentation label is required.";
  }
  return null;
}
