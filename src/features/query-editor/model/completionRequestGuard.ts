export type CompletionRequestCancellationToken = {
  isCancellationRequested?: boolean;
};

/** A list merging LSP and metadata results must describe one model revision. */
export function isCompletionRequestCurrent(options: {
  model: { getVersionId: () => number };
  modelVersion: number;
  token?: CompletionRequestCancellationToken;
  currentGeneration?: number;
  requestGeneration?: number;
}): boolean {
  return (
    !options.token?.isCancellationRequested &&
    options.model.getVersionId() === options.modelVersion &&
    (options.requestGeneration === undefined ||
      options.currentGeneration === options.requestGeneration)
  );
}
