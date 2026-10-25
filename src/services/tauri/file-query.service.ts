import { invokeRawCommand } from "./client";
import { normalizeProjectRelativePath, requireProjectId } from "./project-files/path";
import type { DatabaseCapabilities, QueryResult, SqlStatementSelection } from "./types";

export type FileQueryFormat = "csv" | "json" | "jsonl" | "parquet";
export type CsvHeader = "auto" | "present" | "absent";

export interface FileQuerySession {
  id: string;
  projectId: string;
  fileName: string;
  format: FileQueryFormat;
  sourceBytes: number;
  driverId: string;
  packageVersion: string;
  initialSql: string;
  languageId: string;
  capabilities: DatabaseCapabilities;
  csvHeader: CsvHeader;
}

interface FileQueryDriverSelection {
  driverId: string;
  packageVersion?: string;
  csvHeader?: CsvHeader;
  requestId?: string;
}

export const fileQueryService = {
  // The native picker authorizes the source. Renderer callers cannot submit
  // an arbitrary absolute path through this entry point.
  pick: (options: FileQueryDriverSelection & { projectId: string }) =>
    invokeRawCommand<FileQuerySession | null>("pick_file_query", {
      request: {
      projectId: requireProjectId(options.projectId),
      driverId: options.driverId,
      packageVersion: options.packageVersion ?? null,
      csvHeader: options.csvHeader ?? "auto",
      requestId: options.requestId ?? null,
      },
    }),

  openProject: (options: FileQueryDriverSelection & {
    projectId: string;
    expectedRoot: string;
    relativePath: string;
  }) => {
    if (!options.expectedRoot.trim()) {
      throw new Error("Expected project root is required for file queries");
    }
    return invokeRawCommand<FileQuerySession>("open_project_file_query", {
      request: {
        projectId: requireProjectId(options.projectId),
        expectedRoot: options.expectedRoot,
        relativePath: normalizeProjectRelativePath(options.relativePath),
        driverId: options.driverId,
        packageVersion: options.packageVersion ?? null,
        csvHeader: options.csvHeader ?? "auto",
        requestId: options.requestId ?? null,
      },
    });
  },

  // Query and close use the session's project, including after a project
  // switch; substituting the currently active project would lose its scope.
  query: (session: FileQuerySession, sql: string) =>
    invokeRawCommand<QueryResult[]>("run_file_query", {
      projectId: session.projectId,
      sessionId: session.id,
      sql,
    }),
  close: (session: FileQuerySession) =>
    invokeRawCommand<void>("close_file_query", {
      projectId: session.projectId,
      sessionId: session.id,
    }),
  closeProject: (projectId: string) =>
    invokeRawCommand<void>("close_project_file_queries", {
      projectId: requireProjectId(projectId),
    }),
  cancelOpen: (projectId: string, requestId: string) =>
    invokeRawCommand<void>("cancel_file_query_open", { projectId, requestId }),
  status: (session: FileQuerySession) =>
    invokeRawCommand<FileQuerySession | null>("get_file_query_session", { projectId: session.projectId, sessionId: session.id }),
  statement: (session: FileQuerySession, sql: string, cursorOffset: number) =>
    invokeRawCommand<SqlStatementSelection | null>("resolve_file_query_statement", { projectId: session.projectId, sessionId: session.id, sql, cursorOffset }),
};
