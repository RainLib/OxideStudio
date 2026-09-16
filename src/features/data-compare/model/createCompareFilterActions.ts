interface CreateCompareFilterActionsContext {
  invalidateComparison: () => void;
  setKeyColumns: React.Dispatch<React.SetStateAction<string[]>>;
  setIgnoredColumns: React.Dispatch<React.SetStateAction<Set<string>>>;
}
export function createCompareFilterActions({
  invalidateComparison,
  setKeyColumns,
  setIgnoredColumns,
}: CreateCompareFilterActionsContext) {
  const toggleKey = (column: string) => {
    invalidateComparison();
    setKeyColumns((current) =>
      current.includes(column)
        ? current.filter((candidate) => candidate !== column)
        : [...current, column],
    );
  };
  const toggleComparedColumn = (column: string) => {
    invalidateComparison();
    setIgnoredColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  };
  return { toggleKey, toggleComparedColumn };
}
