import type {
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
} from "@/services/tauri/types";

export type SchemaDbmlParseResult = {
  relations: SchemaRelationSnapshot[];
  schemaObjects: SchemaObjectSnapshot[];
  warnings: string[];
};
