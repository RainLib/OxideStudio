let latestHistoryLoad = 0;
let historyMutationQueue: Promise<void> = Promise.resolve();

export function beginHistoryLoad() {
  latestHistoryLoad += 1;
  return latestHistoryLoad;
}

export function isCurrentHistoryLoad(loadId: number) {
  return loadId === latestHistoryLoad;
}

export function enqueueHistoryMutation(operation: () => Promise<void>) {
  const next = historyMutationQueue.then(operation, operation);
  historyMutationQueue = next.catch(() => undefined);
  return next;
}
