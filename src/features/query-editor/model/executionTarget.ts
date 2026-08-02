export type QueryEditorTextModel = {
  getValue: () => string;
  getValueInRange: (selection: unknown) => string;
};

export function selectedOrFullEditorText(
  model: QueryEditorTextModel | null | undefined,
  selection: unknown,
  fallbackText: string,
) {
  if (!model || !selection) return fallbackText;
  const selectedText = model.getValueInRange(selection);
  return selectedText.trim() ? selectedText : model.getValue();
}

export function queryTransactionExecutionId(options: {
  supportsTransactions: boolean;
  transactionMode: "auto" | "manual";
  transactionState: "idle" | "active";
  connectionId?: string | null;
  tabId?: string | null;
}) {
  if (
    !options.supportsTransactions ||
    options.transactionMode !== "manual" ||
    options.transactionState !== "active" ||
    !options.connectionId ||
    !options.tabId
  ) {
    return undefined;
  }
  return `${options.connectionId}:${options.tabId}`;
}
