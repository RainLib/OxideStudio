export const UI_ACTION_NAMES = [
  "project.open",
  "project.revealFile",
  "workspace.openTab",
  "workspace.focusPanel",
  "database.selectConnection",
  "database.revealSchema",
  "database.revealObject",
  "database.openObjectData",
  "database.openObjectDdl",
  "editor.revealRange",
  "editor.previewPatch",
  "editor.createQueryTab",
  "results.reveal",
  "plan.revealNode",
  "schemaDiff.revealChange",
  "settings.open",
  "task.reveal",
] as const;

export type UiActionName = (typeof UI_ACTION_NAMES)[number];

export type UiActionRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type UiActionTarget = {
  projectId: string;
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
  objectType?: string;
  objectName?: string;
  relativePath?: string;
  tabId?: string;
  resultId?: string;
  resultIndex?: number;
  rowIndex?: number;
  columnName?: string;
  planId?: string;
  nodeId?: string;
  schemaDiffId?: string;
  schemaChangeId?: string;
  patchId?: string;
  originalText?: string;
  rationale?: string;
  taskId?: string;
  panelId?: "databaseExplorer" | "assistant" | "results" | "editor" | "files" | "tasks";
  settingsSection?: string;
  range?: UiActionRange;
  sql?: string;
  title?: string;
};

export type UiActionContextSnapshot = {
  projectId: string;
  contextVersion: number;
  activeConnectionId: string | null;
  activeDriver: string | null;
  activeDatabaseName: string | null;
  activeNamespace: string | null;
  activeTabId: string | null;
  documentRevision: string | null;
  selectionRevision: string | null;
};

export type UiActionContextReference = Pick<
  UiActionContextSnapshot,
  "projectId" | "contextVersion"
> & {
  documentRevision?: string | null;
};

export type UiActionPresentation = {
  label: string;
  detail?: string;
  reveal?: boolean;
  focus?: boolean;
};

export type UiActionRequest = {
  id: string;
  action: UiActionName;
  target: UiActionTarget;
  issuedAgainst: UiActionContextReference;
  presentation: UiActionPresentation;
};

export type UiActionResultStatus =
  | "success"
  | "stale"
  | "notFound"
  | "unsupported"
  | "invalid"
  | "error";

export type UiActionResultCode =
  | "OK"
  | "REVEALED_STALE_DOCUMENT"
  | "INVALID_REQUEST"
  | "INVALID_TARGET"
  | "TARGET_NOT_FOUND"
  | "PROJECT_CONTEXT_STALE"
  | "CONTEXT_STALE"
  | "PROJECT_SWITCH_REQUIRED"
  | "DOCUMENT_REVISION_STALE"
  | "UNSUPPORTED_ACTION"
  | "ACTION_FAILED";

export type UiActionResult = {
  actionId: string;
  status: UiActionResultStatus;
  code: UiActionResultCode;
  message?: string;
  recovery?: string;
};

export type UiActionStalePolicy = "project" | "context" | "document";

export type UiActionExecutionContext = {
  actionId: string;
  current: UiActionContextSnapshot;
  issuedAgainst: UiActionContextReference;
  documentRevisionForTab: (tabId: string) => string | null;
};

export type UiActionDefinition = {
  name: UiActionName;
  description: string;
  stalePolicy?: UiActionStalePolicy;
  validateTarget?: (target: UiActionTarget) => string | null;
  execute: (
    target: UiActionTarget,
    context: UiActionExecutionContext
  ) => Promise<UiActionResult | void> | UiActionResult | void;
};

export type AssistantAttachmentKind =
  | "databaseObject"
  | "editorRange"
  | "file"
  | "result"
  | "tab"
  | "plan"
  | "schemaDiff"
  | "patch"
  | "task";

export type AssistantAttachment = {
  id: string;
  kind: AssistantAttachmentKind;
  label: string;
  detail?: string;
  action: UiActionRequest;
  secondaryActions?: UiActionRequest[];
};
