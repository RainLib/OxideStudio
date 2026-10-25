/**
 * 表信息
 */
export interface TableInfo {
  name: string;
  schema?: string;
  type?: string;
  comment?: string;
}

/** Read-only descriptor for a schema object that is not a relation. */
export interface SchemaObjectInfo {
  name: string;
  schema?: string | null;
  objectType: string;
  parentName?: string | null;
  comment?: string | null;
  /** Explicit sidecar capability; never infer expansion from object type. */
  membersExpandable?: boolean;
}

/**
 * 文档/搜索集合信息
 */
export interface CollectionInfo {
  name: string;
  namespace?: string | null;
  type?: string | null;
  documentCount?: number | null;
}

export interface CollectionPage {
  items: CollectionInfo[];
  nextCursor?: string | null;
  total?: number | null;
}

/**
 * 列信息
 */
export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_unique?: boolean;
  is_indexed?: boolean;
  is_auto_increment?: boolean;
  /** PostgreSQL identity mode proven by the bundled driver. */
  identity_generation?: "always" | "byDefault";
  /** Absent when the driver cannot prove generated/computed-column status. */
  is_generated?: boolean;
  /** Absent when the driver cannot prove hidden/invisible-column status. */
  is_hidden?: boolean;
  /** Database-reported character metadata; absence does not request a reset. */
  character_set?: string | null;
  collation?: string | null;
  default_value?: string;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  filter?: string;
  index_type?: string;
  included_columns?: string[];
  definition?: string;
  comment?: string;
  key_is_expression?: boolean[];
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  referenced_schema?: string;
  referenced_table?: string;
  referenced_columns: string[];
  definition?: string;
  on_update?: string;
  on_delete?: string;
}

export interface ForeignKeyReferenceInfo {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  referenced_schema: string;
  referenced_table: string;
  referenced_columns: string[];
}

export interface FunctionParameterInfo {
  mode?: string | null;
  name: string;
  data_type: string;
  optional?: boolean;
}

export interface FunctionInfo {
  name: string;
  routine_type?: string | null;
  parameters: FunctionParameterInfo[];
  return_type: string;
  description?: string | null;
}
