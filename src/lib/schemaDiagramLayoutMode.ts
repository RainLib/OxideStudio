/**
 * Default diagram rendering and related-table navigation share identical
 * coordinates. Keep this decision separate from React so it stays covered by
 * a cheap, deterministic regression test.
 */
export function reuseFullSchemaDiagramLayout(options: {
  query: string;
  keysOnly: boolean;
  hasRelationScope: boolean;
}) {
  return !options.query && !options.keysOnly && !options.hasRelationScope;
}
