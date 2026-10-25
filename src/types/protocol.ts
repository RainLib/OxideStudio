export interface TableInfo {
    name: string;
    schema: string;
    type: string;
    comment?: string;
}

export interface ColumnInfo {
    name: string;
    data_type: string;
    is_nullable: boolean;
    is_primary_key: boolean;
    is_unique: boolean;
    is_indexed: boolean;
    is_auto_increment?: boolean;
    identity_generation?: "always" | "byDefault";
    is_generated?: boolean;
    is_hidden?: boolean;
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

export interface QueryResult {
    columns: ColumnDef[];
    rows: any[][];
    rowsAffected?: number;
    statementType?: string;
    message?: string;
    responseMeta?: QueryResponseMeta;
}

export interface QueryResponseMeta {
    requestMethod: string;
    requestPath: string;
    status: number;
    durationMs: number;
    rawResponse: unknown;
}

export interface ColumnDef {
    name: string;
    data_type: string;
}

export interface Response<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}
