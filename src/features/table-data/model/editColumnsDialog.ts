import type {
  AlterColumnValueMode,
  ColumnInfo,
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";
import {
  defaultLengthForDataType,
  defaultStringDataType,
} from "@/lib/databaseDialect";

export interface EditColumnsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  tableName: string;
}

export interface ColumnDraft {
  name: string;
  type: string;
  length: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment: string;
}

export interface AlterColumnDraft {
  name: string;
  type: string;
  length: string;
  originalType: string;
  originalLength: string;
  isNotNull: boolean;
  originalIsNotNull: boolean;
  defaultMode: AlterColumnValueMode;
  defaultValue: string;
  commentMode: AlterColumnValueMode;
  comment: string;
}

export function createDefaultColumnDraft(
  capabilities: DatabaseCapabilities,
): ColumnDraft {
  const dataType = defaultStringDataType(capabilities);

  return {
    name: "",
    type: dataType,
    length: defaultLengthForDataType(dataType),
    isPrimaryKey: false,
    isNotNull: false,
    isAutoIncrement: false,
    comment: "",
  };
}

export function lengthForColumnType(type: string, currentLength = "") {
  const defaultLength = defaultLengthForDataType(type);
  if (!defaultLength) return "";
  return currentLength || defaultLength;
}

export function parseColumnDataType(
  rawType: string,
  capabilities: DatabaseCapabilities,
): { type: string; length: string } {
  const raw = rawType.trim();
  const normalized = raw.toUpperCase();
  const candidates = [...capabilities.commonDataTypes].sort(
    (left, right) => right.length - left.length,
  );
  const aliases: Record<string, string> = {
    "CHARACTER VARYING": "VARCHAR",
    CHARACTER: "CHAR",
    INTEGER: capabilities.commonDataTypes.includes("INT") ? "INT" : "INTEGER",
  };

  let selected = candidates.find((type) => {
    const upper = type.toUpperCase();
    return (
      normalized === upper ||
      normalized.startsWith(`${upper}(`) ||
      normalized.startsWith(`${upper} `)
    );
  });

  if (!selected) {
    const alias = Object.entries(aliases).find(([from]) =>
      normalized === from ||
      normalized.startsWith(`${from}(`) ||
      normalized.startsWith(`${from} `),
    );
    selected = alias?.[1];
  }

  if (!selected || !capabilities.commonDataTypes.includes(selected)) {
    selected = capabilities.commonDataTypes[0] || capabilities.defaultPrimaryKeyType;
  }

  return {
    type: selected,
    length: raw.match(/\(([^)]*)\)/)?.[1]?.trim() || "",
  };
}

export function createAlterColumnDraft(
  column: ColumnInfo,
  capabilities: DatabaseCapabilities,
): AlterColumnDraft {
  const parsed = parseColumnDataType(column.data_type, capabilities);
  return {
    name: column.name,
    type: parsed.type,
    length: parsed.length,
    originalType: parsed.type,
    originalLength: parsed.length,
    isNotNull: !column.is_nullable,
    originalIsNotNull: !column.is_nullable,
    defaultMode: "keep",
    defaultValue: column.default_value || "",
    commentMode: "keep",
    comment: column.comment || "",
  };
}

export function formatColumnFlags(column: ColumnInfo) {
  const flags = [];
  if (column.is_primary_key) flags.push("PK");
  if (!column.is_nullable) flags.push("NN");
  if (column.is_unique) flags.push("UQ");
  if (column.is_indexed) flags.push("IDX");
  if (column.is_auto_increment) flags.push("AI");
  return flags;
}
