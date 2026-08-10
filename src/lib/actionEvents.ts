export const APP_EVENT_RUN_QUERY = "oxide:run-query";
export const APP_EVENT_RUN_CURRENT = "oxide:run-current";
export const APP_EVENT_FORMAT_SQL = "oxide:format-sql";
export const APP_EVENT_INSERT_LINE_BELOW = "oxide:insert-line-below";
export const APP_EVENT_SAVE_FILE = "oxide:save-file";
export const APP_EVENT_OPEN_COMMAND_PALETTE = "oxide:open-command-palette";
export const APP_EVENT_OPEN_SETTINGS = "oxide:open-settings";
export const APP_EVENT_OPEN_COMMIT = "oxide:open-commit";
export const APP_EVENT_OPEN_VERSION_CONTROL = "oxide:open-version-control";
export const APP_EVENT_REQUEST_TABLE_CSV_IMPORT =
  "oxide:request-table-csv-import";
export const APP_EVENT_REQUEST_TABLE_JSON_IMPORT =
  "oxide:request-table-json-import";
export const APP_EVENT_REQUEST_TABLE_XLSX_IMPORT =
  "oxide:request-table-xlsx-import";

export type TableCsvImportRequest = {
  connectionId: string;
  schema: string;
  table: string;
  database?: string;
};
export type TableJsonImportRequest = TableCsvImportRequest;
export type TableXlsxImportRequest = TableCsvImportRequest;
export const APP_EVENT_INLINE_COMPLETION_TRIGGER =
  "oxide:inline-completion-trigger";
export const APP_EVENT_INLINE_COMPLETION_ACCEPT =
  "oxide:inline-completion-accept";
export const APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD =
  "oxide:inline-completion-accept-next-word";
export const APP_EVENT_INLINE_COMPLETION_HIDE = "oxide:inline-completion-hide";
