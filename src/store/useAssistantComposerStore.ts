import { create } from "zustand";
import type { QueryExecutionErrorDetail } from "@/lib/queryErrorPresentation";
import {
  mergeAssistantDatabaseTableMentions,
  normalizeAssistantDatabaseTableMentions,
  type AssistantDatabaseTableMention,
} from "@/ai/assistant/databaseTableContext";

export const APP_EVENT_OPEN_ASSISTANT = "oxide:open-assistant";

export interface AssistantQueryErrorComposeRequest {
  id: string;
  tabId: string;
  prompt: string;
  source: "query-error";
}

export interface AssistantDatabaseTablesComposeRequest {
  id: string;
  source: "database-tables";
  tableMentions: AssistantDatabaseTableMention[];
  replaceExisting: boolean;
}

export type AssistantComposeRequest =
  | AssistantQueryErrorComposeRequest
  | AssistantDatabaseTablesComposeRequest;

interface AssistantComposerState {
  request: AssistantComposeRequest | null;
  queueQueryErrorFix: (
    tabId: string,
    detail: QueryExecutionErrorDetail,
  ) => AssistantQueryErrorComposeRequest;
  queueDatabaseTables: (
    mentions: readonly AssistantDatabaseTableMention[],
    options?: { replaceExisting?: boolean },
  ) => AssistantDatabaseTablesComposeRequest | null;
  consumeRequest: (requestId: string) => void;
}

function diagnosticSummary(detail: QueryExecutionErrorDetail) {
  const databaseError = detail.database;
  if (!databaseError) return "No vendor-specific fields were reported.";
  const fields = [
    databaseError.sqlState ? `SQLSTATE ${databaseError.sqlState}` : null,
    databaseError.vendorCode !== undefined
      ? `${databaseError.driver} error ${databaseError.vendorCode}`
      : null,
    databaseError.documentLine !== undefined &&
    databaseError.documentColumn !== undefined
      ? `line ${databaseError.documentLine}, column ${databaseError.documentColumn}`
      : null,
    databaseError.table ? `table ${databaseError.table}` : null,
    databaseError.column ? `column ${databaseError.column}` : null,
    databaseError.constraint
      ? `constraint ${databaseError.constraint}`
      : null,
  ].filter(Boolean);
  return fields.length > 0 ? fields.join("; ") : "No additional fields.";
}

export function queryErrorFixPrompt(detail: QueryExecutionErrorDetail) {
  return [
    "Explain the current database query error and propose the smallest safe correction for the active SQL editor.",
    `Database diagnostic: ${diagnosticSummary(detail)}`,
    "Return the corrected statement in a fenced sql code block.",
    "Do not run the SQL and do not apply any editor change. I will review it with Preview in editor.",
  ].join("\n");
}

export const useAssistantComposerStore = create<AssistantComposerState>(
  (set) => ({
    request: null,
    queueQueryErrorFix: (tabId, detail) => {
      const request: AssistantQueryErrorComposeRequest = {
        id: `assistant-compose:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
        tabId,
        prompt: queryErrorFixPrompt(detail),
        source: "query-error",
      };
      set({ request });
      return request;
    },
    queueDatabaseTables: (mentions, options) => {
      let queued: AssistantDatabaseTablesComposeRequest | null = null;
      set((state) => {
        const normalized = normalizeAssistantDatabaseTableMentions(mentions);
        if (normalized.length === 0) return state;
        const tableMentions =
          state.request?.source === "database-tables" &&
          !options?.replaceExisting
            ? mergeAssistantDatabaseTableMentions(
                state.request.tableMentions,
                normalized,
              )
            : normalized;
        queued = {
          id: `assistant-compose:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
          source: "database-tables",
          tableMentions,
          replaceExisting: options?.replaceExisting === true,
        };
        return { request: queued };
      });
      return queued;
    },
    consumeRequest: (requestId) =>
      set((state) =>
        state.request?.id === requestId ? { request: null } : state,
      ),
  }),
);
