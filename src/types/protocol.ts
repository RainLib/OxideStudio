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
    default_value?: string;
    comment?: string;
}

export interface IndexInfo {
    name: string;
    columns: string[];
    is_unique: boolean;
    is_primary: boolean;
    index_type?: string;
    definition?: string;
}

export interface ConstraintInfo {
    name: string;
    constraint_type: string;
    columns: string[];
    referenced_schema?: string;
    referenced_table?: string;
    referenced_columns: string[];
    definition?: string;
}

export interface QueryResult {
    columns: ColumnDef[];
    rows: any[][];
    rowsAffected?: number;
    statementType?: string;
    message?: string;
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
