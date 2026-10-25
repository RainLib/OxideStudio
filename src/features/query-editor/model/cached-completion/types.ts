/**
 * Scoped cached metadata relations merged by the editor completion provider.
 * The native LSP remains responsible for complete vendor grammar and typing.
 */
export type CachedSqlLocalSource =
  | { kind: "query"; start: number; end: number; columns?: string[] }
  | { kind: "physical"; table: string; schema?: string; database?: string; server?: string; schemaOmitted?: true; columns: string[] };

export type CachedSqlRelationReference = {
  table: string;
  schema?: string;
  /** Optional catalog/database from a three-part relation identifier. */
  database?: string;
  /** Never discard a linked-server identity or guess an omitted default schema. */
  server?: string;
  schemaOmitted?: true;
  alias?: string;
  /** Exact SQL spelling of the alias, including its original delimiters. */
  aliasSql?: string;
  /** A common table expression shadows a physical relation of the same name. */
  isCte?: boolean;
  /** A closed FROM/JOIN subquery with a visible alias and derived columns. */
  isDerived?: boolean;
  /** Declared names remain available when detailed provenance is unknown. */
  cteColumns?: string[];
  /** Offsets belong to the same prepared statement, never a detached SQL copy. */
  localSource?: CachedSqlLocalSource;
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
