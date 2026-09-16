type OperationKind = "preview" | "execute" | "copy";
interface OperationToken {
  readonly kind: OperationKind;
}

/** One owner per operation; invalidation drops UI ownership, not database work. */
export function createCompareRequestScope() {
  let active = true;
  let revision = 0;
  const operations = new Map<OperationKind, OperationToken>();
  const isCurrent = (token: OperationToken) =>
    active && operations.get(token.kind) === token;
  return {
    activate() {
      active = true;
    },
    reset() {
      revision += 1;
      operations.clear();
    },
    dispose() {
      revision += 1;
      active = false;
      operations.clear();
    },
    isActive: () => active,
    revision: () => revision,
    isCurrentRevision: (value: number) => active && value === revision,
    isPending: (kind: OperationKind) => active && operations.has(kind),
    invalidatePreview() {
      revision += 1;
      operations.delete("preview");
      operations.delete("copy");
    },
    begin(kind: OperationKind): OperationToken | null {
      if (
        !active ||
        (kind !== "copy" && operations.has("execute")) ||
        (kind === "execute" && operations.has("preview"))
      )
        return null;
      const token = { kind };
      operations.set(kind, token);
      return token;
    },
    isCurrent,
    finish(token: OperationToken) {
      if (isCurrent(token)) operations.delete(token.kind);
    },
  };
}
export type CompareRequestScope = ReturnType<typeof createCompareRequestScope>;
