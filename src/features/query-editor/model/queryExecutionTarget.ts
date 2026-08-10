import {
  elasticsearchRequestAtOffset,
  elasticsearchRequestsForSelection,
} from "@/lib/elasticsearchConsole";
import type { SqlStatementSelection } from "@/services/tauri/types";
import { mongodbCommandRangeAtCursor } from "./mongodbCommandRanges";

export type QueryExecutionKind = "sql" | "elasticsearch" | "mongodb";
export type QueryExecutionMode = "all" | "current";

export type QueryExecutionSnapshot = {
  fullText: string;
  selectedText: string;
  selectionStart: number;
  selectionEnd: number;
  cursorOffset: number;
};

export type QueryExecutionTarget = {
  sql: string;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
  scope: "document" | "selection" | "current";
};

type ResolveQueryExecutionTargetOptions = {
  kind: QueryExecutionKind;
  mode: QueryExecutionMode;
  snapshot: QueryExecutionSnapshot;
  executeAllOnBlankLine?: boolean;
  resolveSqlStatementAtCursor?: (
    sql: string,
    cursorOffset: number,
  ) => Promise<SqlStatementSelection | null>;
};

/**
 * Resolves the exact editor range that will be executed before safety and
 * parameter checks run. Selection always wins. Console and Mongo documents
 * use their native request/command boundaries; SQL delegates statement
 * boundaries to the backend parser so every supported dialect shares one
 * source of truth.
 */
export async function resolveQueryExecutionTarget({
  kind,
  mode,
  snapshot,
  executeAllOnBlankLine = false,
  resolveSqlStatementAtCursor,
}: ResolveQueryExecutionTargetOptions): Promise<QueryExecutionTarget | null> {
  if (mode === "all") {
    return snapshot.fullText.trim()
      ? { sql: snapshot.fullText, scope: "document" }
      : null;
  }

  if (snapshot.selectedText.trim()) {
    if (kind === "elasticsearch") {
      const requests = elasticsearchRequestsForSelection(
        snapshot.fullText,
        snapshot.selectionStart,
        snapshot.selectionEnd,
      );
      if (requests.length === 0) return null;
      return {
        sql: requests.map((request) => request.text).join("\n\n"),
        sourceStartOffset: requests[0]?.startOffset,
        sourceEndOffset: requests[requests.length - 1]?.endOffset,
        scope: "selection",
      };
    }
    return {
      sql: snapshot.selectedText,
      sourceStartOffset: snapshot.selectionStart,
      sourceEndOffset: snapshot.selectionEnd,
      scope: "selection",
    };
  }

  if (kind === "elasticsearch") {
    const request = elasticsearchRequestAtOffset(
      snapshot.fullText,
      snapshot.cursorOffset,
    );
    return request
      ? {
          sql: request.text,
          sourceStartOffset: request.startOffset,
          sourceEndOffset: request.endOffset,
          scope: "current",
        }
      : null;
  }

  if (kind === "mongodb") {
    const command = mongodbCommandRangeAtCursor(
      snapshot.fullText,
      snapshot.cursorOffset,
    );
    return command
      ? {
          sql: command.text,
          sourceStartOffset: command.from,
          sourceEndOffset: command.to,
          scope: "current",
        }
      : null;
  }

  if (!resolveSqlStatementAtCursor) return null;
  const statement = await resolveSqlStatementAtCursor(
    snapshot.fullText,
    snapshot.cursorOffset,
  );
  if (!statement?.sql.trim()) {
    return executeAllOnBlankLine && snapshot.fullText.trim()
      ? { sql: snapshot.fullText, scope: "document" }
      : null;
  }
  return {
    sql: statement.sql,
    sourceStartOffset: statement.startOffset,
    sourceEndOffset: statement.endOffset,
    scope: "current",
  };
}
