// LSP Protocol Types

export const LSP_NOTIFICATION_EVENT = "lsp-notification";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange?: Range;
  originSelectionRange?: Range;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface InsertReplaceEdit {
  insert: Range;
  replace: Range;
  newText: string;
}

export interface MarkupContent {
  kind?: "plaintext" | "markdown" | string;
  value: string;
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
}

export interface SignatureParameter {
  label: string | [number, number];
  documentation?: string | { kind?: string; value?: string };
}

export interface SignatureInformation {
  label: string;
  documentation?: string | { kind?: string; value?: string };
  parameters?: SignatureParameter[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface LspCodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  isPreferred?: boolean;
  disabled?: { reason: string };
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: LspDocumentSymbol[];
}

export interface LspFoldingRange {
  startLine: number;
  startCharacter?: number;
  endLine: number;
  endCharacter?: number;
  kind?: string;
}

export interface LspSelectionRange {
  range: Range;
  parent?: LspSelectionRange;
}

export interface LspSemanticTokens {
  resultId?: string;
  data: number[];
}

export interface LspInlayHint {
  position: Position;
  label: string | Array<{ value: string; tooltip?: string }>;
  kind?: number;
  tooltip?: string | { kind?: string; value?: string };
  textEdits?: TextEdit[];
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export interface LspWorkspaceSymbol {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

export interface CompletionItem {
  label: string;
  labelDetails?: {
    detail?: string;
    description?: string;
  };
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
  insertTextFormat?: number;
  insertTextMode?: 1 | 2;
  textEdit?: TextEdit | InsertReplaceEdit;
  additionalTextEdits?: TextEdit[];
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  commitCharacters?: string[];
  deprecated?: boolean;
  /** Opaque server state that must round-trip through completionItem/resolve. */
  data?: unknown;
}

export interface CompletionResponse {
  items: CompletionItem[];
  isIncomplete: boolean;
  resolveProvider: boolean;
}

export interface CompletionContext {
  triggerKind: 1 | 2 | 3;
  triggerCharacter?: string;
}

export interface LspConnectionConfig {
  driver: string;
  dataSourceName: string;
  alias?: string;
}

export interface LspSqlsConfig {
  connections: LspConnectionConfig[];
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  message: string;
  source?: string;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface HoverInfo {
  contents: string;
  range?: Range;
}

export interface LspServerNotification {
  sessionKey?: string;
  method: string;
  params: unknown;
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
  /** LSP document version, when the server can associate diagnostics with one. */
  version?: number;
}

// LSP Completion Kind constants (following LSP spec)
export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}
