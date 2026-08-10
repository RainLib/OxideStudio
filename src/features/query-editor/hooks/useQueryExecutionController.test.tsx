// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useQueryExecutionController,
  type QueryExecutionEditor,
} from "./useQueryExecutionController";

const queryMocks = vi.hoisted(() => ({
  resolveStatement: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  queryService: {
    resolveSqlStatementAtCursor: queryMocks.resolveStatement,
  },
}));

type ControllerOptions = Parameters<typeof useQueryExecutionController>[0];
type Controller = ReturnType<typeof useQueryExecutionController>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useQueryExecutionController(props);
  return null;
}

function editor(
  fullText: string,
  selectionStart = 0,
  selectionEnd = 0,
  cursorOffset = selectionEnd,
): QueryExecutionEditor {
  return {
    getModel: () => ({
      getValue: () => fullText,
      getValueInRange: () =>
        fullText.slice(selectionStart, selectionEnd),
      getOffsetAt: (position) => position.column - 1,
    }),
    getSelection: () => ({
      startLineNumber: 1,
      startColumn: selectionStart + 1,
      endLineNumber: 1,
      endColumn: selectionEnd + 1,
    }),
    getPosition: () => ({ lineNumber: 1, column: cursorOffset + 1 }),
  };
}

const updateTabSql = vi.fn();
const runTabQuery = vi.fn(async () => undefined);
const runExplainPlan = vi.fn(async () => undefined);
const cancelTabQuery = vi.fn(async () => undefined);
const confirmExecution = vi.fn(() => true);
const transactionIdForExecution = vi.fn(() => "transaction-1");

function options(
  overrides: Partial<ControllerOptions> = {},
): ControllerOptions {
  const sql = "SELECT 1; SELECT 2;";
  return {
    activeTab: { id: "tab-1", sql },
    connectionId: "connection-1",
    connectionLabel: "Development",
    canExecute: true,
    driver: "postgres",
    kind: "sql",
    executeAllOnBlankLine: false,
    supportsExplainPlan: true,
    confirmExecution,
    editorRef: { current: editor(sql, 0, 0, 14) },
    transactionIdForExecution,
    updateTabSql,
    runTabQuery,
    runExplainPlan,
    cancelTabQuery,
    ...overrides,
  };
}

async function renderController(next: ControllerOptions) {
  await act(async () => {
    root.render(<Harness {...next} />);
  });
}

describe("useQueryExecutionController", () => {
  beforeEach(() => {
    queryMocks.resolveStatement.mockReset().mockResolvedValue({
      sql: "SELECT 2",
      startOffset: 10,
      endOffset: 18,
      statementIndex: 1,
      statementCount: 2,
    });
    updateTabSql.mockClear();
    runTabQuery.mockReset().mockResolvedValue(undefined);
    runExplainPlan.mockReset().mockResolvedValue(undefined);
    cancelTabQuery.mockReset().mockResolvedValue(undefined);
    confirmExecution.mockReset().mockReturnValue(true);
    transactionIdForExecution.mockReset().mockReturnValue("transaction-1");
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("resolves and executes the current SQL statement", async () => {
    await renderController(options());

    await act(async () => controller.handleRunCurrent());

    expect(queryMocks.resolveStatement).toHaveBeenCalledWith(
      "connection-1",
      "SELECT 1; SELECT 2;",
      14,
    );
    expect(runTabQuery).toHaveBeenCalledWith(
      "tab-1",
      "connection-1",
      "SELECT 2",
      "transaction-1",
      10,
    );
  });

  it("runs the document from a blank line only when the setting is enabled", async () => {
    const sql = "SELECT 1;\n\nSELECT 2;";
    queryMocks.resolveStatement.mockResolvedValueOnce(null);
    await renderController(
      options({
        activeTab: { id: "tab-1", sql },
        editorRef: { current: editor(sql, 0, 0, 10) },
        executeAllOnBlankLine: true,
      }),
    );

    await act(async () => controller.handleRunCurrent());

    expect(runTabQuery).toHaveBeenCalledWith(
      "tab-1",
      "connection-1",
      sql,
      "transaction-1",
      undefined,
    );
  });

  it("reports a blank current target without executing when fallback is disabled", async () => {
    const noTarget = vi.fn();
    queryMocks.resolveStatement.mockResolvedValueOnce(null);
    await renderController(options({ onNoExecutableTarget: noTarget }));

    await act(async () => controller.handleRunCurrent());

    expect(noTarget).toHaveBeenCalledOnce();
    expect(runTabQuery).not.toHaveBeenCalled();
  });

  it("opens parameter input before dispatching a query", async () => {
    const sql = "SELECT * FROM users WHERE id = ${id}";
    await renderController(
      options({
        activeTab: { id: "tab-1", sql },
        editorRef: { current: editor(sql) },
      }),
    );

    await act(async () => controller.handleRun());
    expect(runTabQuery).not.toHaveBeenCalled();
    expect(controller.parameterExecution?.sql).toBe(sql);

    await act(async () => controller.handleRunParameterizedSql(
      "SELECT * FROM users WHERE id = 42",
    ));
    expect(runTabQuery).toHaveBeenCalledWith(
      "tab-1",
      "connection-1",
      "SELECT * FROM users WHERE id = 42",
      "transaction-1",
      undefined,
    );
    expect(controller.parameterExecution).toBeNull();
  });

  it("deduplicates full-document execution before the store rerenders", async () => {
    let finishRun: (() => void) | undefined;
    runTabQuery.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishRun = () => resolve(undefined);
        }),
    );
    await renderController(options());

    await act(async () => {
      controller.handleRun();
      controller.handleRun();
      await Promise.resolve();
    });
    expect(runTabQuery).toHaveBeenCalledOnce();

    await act(async () => {
      finishRun?.();
      await Promise.resolve();
    });
  });

  it("drops a statement resolution that finishes after the tab changes", async () => {
    let finishResolution: ((value: unknown) => void) | undefined;
    queryMocks.resolveStatement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishResolution = resolve;
        }),
    );
    await renderController(options());

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = controller.handleRunCurrent();
      await Promise.resolve();
    });
    await renderController(
      options({ activeTab: { id: "tab-2", sql: "SELECT 3" } }),
    );
    await act(async () => {
      finishResolution?.({
        sql: "SELECT 2",
        startOffset: 10,
        endOffset: 18,
        statementIndex: 1,
        statementCount: 2,
      });
      await pending;
    });

    expect(runTabQuery).not.toHaveBeenCalled();
  });

  it("routes Explain through the same active execution context", async () => {
    await renderController(options());

    await act(async () => controller.handleExplain("estimate"));

    expect(runExplainPlan).toHaveBeenCalledWith(
      "tab-1",
      "connection-1",
      "SELECT 1; SELECT 2;",
      "estimate",
    );
  });
});
