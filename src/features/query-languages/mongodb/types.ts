/**
 * MongoDB completion supports both the native JSON contract and the bounded,
 * structurally parsed shell syntax in `src-tauri/src/drivers/mongodb_shell.rs`.
 * Never suggest a shell method that the Host cannot structurally parse.
 */
export type MongoDbCompletionArea =
  | "root"
  | "key"
  | "collection"
  | "field"
  | "stage-option"
  | "query-operator"
  | "update-operator"
  | "push-modifier"
  | "pipeline-stage"
  | "accumulator"
  | "expression"
  | "field-reference"
  | "value"
  | "shell-root"
  | "shell-qualified"
  | "shell-method"
  | "shell-chain"
  | "shell-option"
  | "unknown";

export type MongoDbConsoleCompletion = {
  label: string;
  detail: string;
  documentation?: string;
  insertText: string;
  /** Text Monaco filters against when one completion replaces a qualified prefix. */
  filterText?: string;
  kind: "property" | "field" | "operator" | "snippet" | "value";
  sortText?: string;
};

export type MongoDbCompletionContext = {
  area: MongoDbCompletionArea;
  typed: string;
  activeKey?: string;
  parentKey?: string;
  collection?: string;
  /** True when the cursor is inside a JSON string value. */
  quoted?: boolean;
  syntax?: "json" | "shell";
  /** Number of UTF-16 code units before the caret replaced by shell completion. */
  replacementLength?: number;
};

export type MongoDbCompletionInput = {
  collections?: readonly string[];
  fields?: readonly { name: string; dataType?: string }[];
};
