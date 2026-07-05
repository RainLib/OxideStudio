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

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: TextEdit;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
}

export interface CompletionResponse {
  items: CompletionItem[];
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
  method: string;
  params: unknown;
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
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
