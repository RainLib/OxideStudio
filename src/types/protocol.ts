export interface TableInfo {
    name: string;
    schema: string;
    type: string;
}

export interface ColumnInfo {
    name: string;
    data_type: string;
    is_nullable: string;
}

export interface QueryResult {
    columns: ColumnDef[];
    rows: any[][];
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
