export const MAX_EXPLORER_TABLE_BATCH_SELECTION = 200;

export type TableBatchSelection = {
  names: string[];
  anchor: string | null;
};

function orderedSelection(
  selected: ReadonlySet<string>,
  visibleNames: readonly string[],
  maxSelection: number,
) {
  const visibleNameSet = new Set(visibleNames);
  const visible = visibleNames.filter((name) => selected.has(name));
  const hidden = [...selected].filter((name) => !visibleNameSet.has(name));
  return [...visible, ...hidden].slice(0, maxSelection);
}

export async function settleTableBatchWork<T>(
  names: readonly string[],
  run: (name: string, index: number) => Promise<T>,
  concurrency = 6,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(names.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    names.length,
    Math.max(1, Math.floor(Number.isFinite(concurrency) ? concurrency : 1)),
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < names.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await run(names[index]!, index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function toggleTableBatchSelection(
  current: TableBatchSelection,
  name: string,
  visibleNames: readonly string[],
  options?: { range?: boolean; maxSelection?: number },
): TableBatchSelection {
  const maxSelection =
    options?.maxSelection ?? MAX_EXPLORER_TABLE_BATCH_SELECTION;
  const selected = new Set(current.names);
  if (options?.range && current.anchor) {
    const anchorIndex = visibleNames.indexOf(current.anchor);
    const targetIndex = visibleNames.indexOf(name);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      for (const table of visibleNames.slice(start, end + 1)) {
        if (selected.size >= maxSelection && !selected.has(table)) break;
        selected.add(table);
      }
      return {
        names: orderedSelection(selected, visibleNames, maxSelection),
        anchor: name,
      };
    }
  }

  if (selected.has(name)) selected.delete(name);
  else if (selected.size < maxSelection) selected.add(name);
  return {
    names: orderedSelection(selected, visibleNames, maxSelection),
    anchor: name,
  };
}

export function toggleAllVisibleTableBatchSelection(
  current: TableBatchSelection,
  visibleNames: readonly string[],
  maxSelection = MAX_EXPLORER_TABLE_BATCH_SELECTION,
): TableBatchSelection {
  const selected = new Set(current.names);
  const allVisibleSelected =
    visibleNames.length > 0 && visibleNames.every((name) => selected.has(name));
  if (allVisibleSelected) {
    for (const name of visibleNames) selected.delete(name);
  } else {
    for (const name of visibleNames) {
      if (selected.size >= maxSelection && !selected.has(name)) break;
      selected.add(name);
    }
  }
  return {
    names: orderedSelection(selected, visibleNames, maxSelection),
    anchor: visibleNames[visibleNames.length - 1] || current.anchor,
  };
}

export function pruneTableBatchSelection(
  current: TableBatchSelection,
  availableNames: readonly string[],
): TableBatchSelection {
  const available = new Set(availableNames);
  const names = current.names.filter((name) => available.has(name));
  return {
    names,
    anchor:
      current.anchor && available.has(current.anchor) ? current.anchor : null,
  };
}
