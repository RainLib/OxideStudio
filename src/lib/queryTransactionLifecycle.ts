export type QueryTransactionSession = {
  connectionId: string;
  transactionId: string;
};

export type QueryTransactionTabContext = {
  tabId: string;
  connectionId?: string | null;
  supportsTransactions: boolean;
};

export function collectStaleTransactionTabIds(
  sessions: Iterable<[string, QueryTransactionSession]>,
  contexts: QueryTransactionTabContext[]
) {
  const contextByTab = new Map(contexts.map((context) => [context.tabId, context]));
  const staleTabIds: string[] = [];

  for (const [tabId, session] of sessions) {
    const context = contextByTab.get(tabId);
    if (
      !context ||
      !context.supportsTransactions ||
      context.connectionId !== session.connectionId
    ) {
      staleTabIds.push(tabId);
    }
  }

  return staleTabIds;
}

export function removeTransactionStates<T>(
  state: Record<string, T>,
  staleTabIds: string[]
) {
  if (staleTabIds.length === 0) return state;

  const next = { ...state };
  for (const tabId of staleTabIds) {
    delete next[tabId];
  }
  return next;
}
