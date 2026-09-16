export type LspSourceLocation = [uri: string, line: number] | null;

export type LspTableDefinition = {
  name: string;
  object_type: string | null;
  comment: string | null;
  source_location: LspSourceLocation;
  indexes: Array<{
    name: string;
    columns: string[];
    is_unique: boolean;
    is_primary: boolean;
    index_type: string | null;
    definition: string | null;
  }>;
  constraints: Array<{
    name: string;
    constraint_type: string;
    columns: string[];
    referenced_schema: string | null;
    referenced_table: string | null;
    referenced_columns: string[];
    definition: string | null;
  }>;
  columns: Array<{
    name: string;
    data_type: string;
    nullable: boolean;
    primary_key: boolean;
    unique: boolean;
    indexed: boolean;
    default_value?: string | null;
    auto_increment?: boolean;
    generated?: boolean;
    hidden?: boolean;
    comment: string | null;
    source_location: LspSourceLocation;
  }>;
};

export type LspFunctionDefinition = {
  name: string;
  routine_type: string | null;
  parameters: Array<{
    name: string;
    data_type: string;
    optional: boolean;
    mode?: string | null;
  }>;
  return_type: string;
  description: string | null;
};

export type LspSchemaDefinition = {
  id: string;
  catalog?: string | null;
  database: string;
  driver?: string | null;
  server_version?: string | null;
  snapshot_revision?: number | null;
  source_uri: string | null;
  tables: LspTableDefinition[];
  functions: LspFunctionDefinition[];
};
