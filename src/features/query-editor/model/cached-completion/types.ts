/**
 * Conservative relation extraction used only while SQL LSP is unavailable.
 * It deliberately recognizes a narrow, top-level SQL surface so the editor
 * can reuse one table's cached metadata without pretending to parse a full
 * vendor grammar in the renderer.
 */
export type CachedSqlRelationReference = {
  table: string;
  schema?: string;
  /** Optional catalog/database from a three-part relation identifier. */
  database?: string;
  alias?: string;
  /** Exact SQL spelling of the alias, including its original delimiters. */
  aliasSql?: string;
  /** A common table expression shadows a physical relation of the same name. */
  isCte?: boolean;
  /** A closed FROM/JOIN subquery with a visible alias and derived columns. */
  isDerived?: boolean;
  /** Only explicit CTE column lists are trusted by this lightweight fallback. */
  cteColumns?: string[];
};

export type CachedSqlJoinTargetContext = {
  /** Relations that are already complete before the JOIN target being typed. */
  sourceRelations: CachedSqlRelationReference[];
  /** The possibly-qualified target fragment after the active JOIN keyword. */
  targetFragment: string;
};

export type CachedSqlProjectionSource = {
  database?: string;
  schema?: string;
  tableName: string;
  sourceColumn: string;
};
