export type DirectedNameEdge = readonly [parent: string, child: string];

export type LexicalTopologicalResult = {
  order: string[];
  ranks: Map<string, number>;
};

/**
 * Produces a deterministic dependency order in O((V + E) log V). Unresolved
 * cyclic names are appended lexically without recursively traversing the
 * cycle, matching the diagram's previous fail-safe behavior without repeatedly
 * sorting and shifting a large array.
 */
export function lexicalTopologicalOrder(
  names: readonly string[],
  edges: Iterable<DirectedNameEdge>,
): LexicalTopologicalResult {
  const included = new Set(names);
  const children = new Map<string, Set<string>>();
  const indegree = new Map(names.map((name) => [name, 0]));
  const ranks = new Map(names.map((name) => [name, 0]));

  for (const [parent, child] of edges) {
    if (!included.has(parent) || !included.has(child)) continue;
    const next = children.get(parent) || new Set<string>();
    if (next.has(child)) continue;
    next.add(child);
    children.set(parent, next);
    indegree.set(child, (indegree.get(child) || 0) + 1);
  }

  const roots = new LexicalMinHeap();
  for (const name of names) {
    if (indegree.get(name) === 0) roots.push(name);
  }

  const order: string[] = [];
  const visited = new Set<string>();
  while (roots.size > 0) {
    const parent = roots.pop();
    if (!parent || visited.has(parent)) continue;
    visited.add(parent);
    order.push(parent);
    const parentRank = ranks.get(parent) || 0;
    for (const child of children.get(parent) || []) {
      ranks.set(child, Math.max(ranks.get(child) || 0, parentRank + 1));
      const nextIndegree = (indegree.get(child) || 0) - 1;
      indegree.set(child, nextIndegree);
      if (nextIndegree === 0) roots.push(child);
    }
  }

  const cyclic = names
    .filter((name) => !visited.has(name))
    .sort((left, right) => left.localeCompare(right));
  return { order: [...order, ...cyclic], ranks };
}

class LexicalMinHeap {
  private readonly values: string[] = [];

  get size() {
    return this.values.length;
  }

  push(value: string) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent]!, value) <= 0) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): string | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length === 0 || last === undefined) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const smaller =
        right < this.values.length &&
        this.compare(this.values[right]!, this.values[left]!) < 0
          ? right
          : left;
      if (this.compare(this.values[smaller]!, last) >= 0) break;
      this.values[index] = this.values[smaller]!;
      index = smaller;
    }
    this.values[index] = last;
    return first;
  }

  private compare(left: string, right: string) {
    return left.localeCompare(right);
  }
}
