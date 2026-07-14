/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSidebar } from "@/components/workspace/AssistantSidebar";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useAiAuditStore } from "@/store/useAiAuditStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTaskStore } from "@/store/useTaskStore";

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({
    content: "The active query reads all rows from users.",
    model: "gpt-test",
  })),
  executeQuery: vi.fn(async () => [
    {
      columns: [{ name: "id", data_type: "integer" }],
      rows: [[1]],
      statementType: "SELECT",
    },
  ]),
  executeReadOnlyQuery: vi.fn(async () => [
    {
      columns: [{ name: "id", data_type: "integer" }],
      rows: [[1]],
      statementType: "SELECT",
    },
  ]),
  cancelQuery: vi.fn(async () => "cancelled"),
  getDatabaseCapabilities: vi.fn(async (driver: string) =>
    defaultDatabaseCapabilities(driver)
  ),
  getCollections: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getTables: vi.fn(async () => []),
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
  saveAssistantTask: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/ai.service", () => ({
  aiService: {
    chatCompletion: mocks.chatCompletion,
  },
}));

vi.mock("@/services/tauri/assistant-task.service", () => ({
  ASSISTANT_TASK_SESSION_ID: "assistant-session:test",
  assistantTaskService: {
    save: mocks.saveAssistantTask,
  },
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  queryService: {
    executeQuery: mocks.executeQuery,
    executeReadOnlyQuery: mocks.executeReadOnlyQuery,
    cancelQuery: mocks.cancelQuery,
  },
  schemaService: {
    getCollections: mocks.getCollections,
    getColumns: mocks.getColumns,
    getConstraints: mocks.getConstraints,
    getFunctions: mocks.getFunctions,
    getIndexes: mocks.getIndexes,
    getTables: mocks.getTables,
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
  },
}));

const initialAiSettings = useAiSettingsStore.getState();
const initialAiAuditState = useAiAuditStore.getState();
const initialConnectionState = useConnectionStore.getState();
const initialSchemaState = useSchemaStore.getState();
const initialTabState = useTabStore.getState();
const initialProjectState = useProjectStore.getState();
const initialTaskState = useTaskStore.getState();

function buttonWithText(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text)
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("AssistantSidebar", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    useAiAuditStore.setState({ entries: [] });
    mocks.cancelQuery.mockResolvedValue("cancelled");
    useProjectStore.setState({
      activeProjectId: "project-a",
      activeProjectName: "Project A",
    });
    useTaskStore.setState({ tasks: [] });
    useAiSettingsStore.setState(
      {
        ...initialAiSettings,
        enabled: false,
        assistantMode: "o2",
        baseUrl: "",
        model: "",
        apiKey: "",
      },
      true
    );
    useConnectionStore.setState({
      ...initialConnectionState,
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      ...initialSchemaState,
      schemas: ["public"],
      currentSchema: "public",
      tables: [],
      collections: [],
      functions: [],
    });
    useTabStore.setState({
      ...initialTabState,
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "SELECT * FROM users",
          connectionId: "postgres-1",
          schemaName: "public",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      activeTabId: "query-1",
      closedTabsStack: [],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useAiSettingsStore.setState(initialAiSettings, true);
    useAiAuditStore.setState(initialAiAuditState, true);
    useConnectionStore.setState(initialConnectionState, true);
    useSchemaStore.setState(initialSchemaState, true);
    useTabStore.setState(initialTabState, true);
    useProjectStore.setState(initialProjectState, true);
    useTaskStore.setState(initialTaskState, true);
  });

  it("runs safe workspace tools automatically in Agent mode", async () => {
    useAiSettingsStore.setState({ assistantMode: "agent" });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      await flushAsyncWork();
    });

    await act(async () => {
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("query.runReadOnly");
    expect(container.textContent).toContain("run current query");
    expect(textarea?.value).toBe("");

    expect(mocks.executeReadOnlyQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT * FROM users",
      "public",
      expect.any(String)
    );
    expect(container.textContent).toContain("tool calls succeeded");
    expect(container.textContent).toContain("Activity");
    expect(container.textContent).toContain("query.runReadOnly");
    expect(useAiAuditStore.getState().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "query.runReadOnly",
          status: "success",
        }),
      ])
    );
    await vi.waitFor(() =>
      expect(mocks.saveAssistantTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-a",
          status: "completed",
          progress: 1,
        }),
      ),
    );
    const persisted = JSON.stringify(mocks.saveAssistantTask.mock.calls.at(-1)?.[0]);
    expect(persisted).not.toContain("SELECT * FROM users");
    expect(persisted).not.toContain('"rows"');
  });

  it("shows mutation inputs and consumes approval for exactly one execution", async () => {
    useAiSettingsStore.setState({ assistantMode: "agent" });
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === "query-1"
          ? { ...tab, sql: "UPDATE users SET active = false WHERE id = 1" }
          : tab
      ),
    }));
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      await flushAsyncWork();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Review planned input");
    expect(container.textContent).toContain(
      "UPDATE users SET active = false WHERE id = 1"
    );
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.saveAssistantTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "awaiting_approval" }),
      ),
    );

    await act(async () => {
      buttonWithText(container, "Approve")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });
    const runApproved = buttonWithText(container, "Run approved");
    expect(runApproved).toBeTruthy();

    await act(async () => {
      runApproved?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      runApproved?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "UPDATE users SET active = false WHERE id = 1",
      "public",
      undefined,
      expect.any(String)
    );
    expect(buttonWithText(container, "Approve")).toBeTruthy();
    expect(buttonWithText(container, "Run approved")).toBeUndefined();
    await vi.waitFor(() =>
      expect(mocks.saveAssistantTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed" }),
      ),
    );
  });

  it("starts a new chat without remounting the assistant panel", async () => {
    useAiSettingsStore.setState({ assistantMode: "plan" });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "inspect current table");
      await flushAsyncWork();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Create plan"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("inspect current table");
    expect(container.textContent).toContain("Review only");
    expect(buttonWithText(container, "Run read-only")).toBeUndefined();
    expect(mocks.executeQuery).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector('button[aria-label="Start a new assistant chat"]')
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      await flushAsyncWork();
    });

    expect(container.textContent).not.toContain("inspect current table");
    expect(container.textContent).toContain("Work with your database");
  });

  it("stops an active assistant tool run and cancels the backend query", async () => {
    useAiSettingsStore.setState({ assistantMode: "agent" });
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      await flushAsyncWork();
    });

    let resolveQuery: (value: any[]) => void = () => undefined;
    mocks.executeReadOnlyQuery.mockImplementationOnce(
      () =>
        new Promise<any[]>((resolve) => {
          resolveQuery = resolve;
        })
    );

    await act(async () => {
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    const queryId = mocks.executeReadOnlyQuery.mock.calls[0]?.[3];
    expect(queryId).toEqual(expect.any(String));
    expect(buttonWithText(container, "Stop")).toBeTruthy();

    await act(async () => {
      buttonWithText(container, "Stop")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.cancelQuery).toHaveBeenCalledWith(queryId);

    await act(async () => {
      resolveQuery([]);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Assistant run cancelled");
  });

  it("cancels and isolates an agent task when the active project changes", async () => {
    useAiSettingsStore.setState({ assistantMode: "agent" });
    let resolveQuery: (value: any[]) => void = () => undefined;
    mocks.executeReadOnlyQuery.mockImplementationOnce(
      () =>
        new Promise<any[]>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });
    const queryId = mocks.executeReadOnlyQuery.mock.calls[0]?.[3];

    await act(async () => {
      useProjectStore.setState({
        activeProjectId: "project-b",
        activeProjectName: "Project B",
      });
      await flushAsyncWork();
    });
    expect(mocks.cancelQuery).toHaveBeenCalledWith(queryId);
    expect(container.textContent).not.toContain("run current query");

    await act(async () => {
      resolveQuery([]);
      await flushAsyncWork();
    });
    await vi.waitFor(() =>
      expect(mocks.saveAssistantTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-a",
          status: "cancelled",
        }),
      ),
    );
  });

  it("sends Chat mode requests with bounded workspace context and history", async () => {
    useAiSettingsStore.setState({
      enabled: true,
      assistantMode: "chat",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "test-key",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "Explain the active query");
      await flushAsyncWork();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Send"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          model: "gpt-test",
          apiKey: "test-key",
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("SELECT * FROM users"),
          }),
          { role: "user", content: "Explain the active query" },
        ]),
      }),
      expect.any(AbortSignal)
    );
    expect(container.textContent).toContain(
      "The active query reads all rows from users."
    );
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it("explains how to recover when Chat has no configured model", async () => {
    useAiSettingsStore.setState({
      enabled: false,
      assistantMode: "chat",
      baseUrl: "",
      model: "",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "Explain the active query");
      await flushAsyncWork();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Send"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Chat needs an AI provider");
    expect(container.textContent).toContain("Settings > AI Assistant");
    expect(buttonWithText(container, "Stop")).toBeUndefined();
    expect(mocks.chatCompletion).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it("cancels Chat mode locally and ignores a late provider response", async () => {
    let resolveChat: (value: { content: string; model: string }) => void =
      () => undefined;
    mocks.chatCompletion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve;
        })
    );
    useAiSettingsStore.setState({
      enabled: true,
      assistantMode: "chat",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "Explain this query");
      container.querySelector('button[aria-label="Send"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(buttonWithText(container, "Stop")).toBeTruthy();
    await act(async () => {
      buttonWithText(container, "Stop")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("Assistant request cancelled");

    await act(async () => {
      resolveChat({ content: "late response", model: "gpt-test" });
      await flushAsyncWork();
    });
    expect(container.textContent).not.toContain("late response");
  });

  it("continues safe model-suggested tool calls across bounded Agent rounds", async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce({
        content: JSON.stringify({
          intent: "query",
          steps: [
            {
              id: "read-users",
              title: "Read users",
              toolName: "query.runReadOnly",
              input: { query: "SELECT * FROM users" },
            },
          ],
        }),
        model: "gpt-test",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          message: "Users loaded; inspect roles next.",
          suggestedCalls: [
            {
              id: "read-roles",
              toolName: "query.runReadOnly",
              input: { query: "SELECT * FROM roles" },
            },
            {
              id: "update-role",
              toolName: "query.runMutation",
              input: { query: "UPDATE roles SET active = true WHERE id = 1" },
            },
          ],
        }),
        model: "gpt-test",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ message: "Roles loaded." }),
        model: "gpt-test",
      });
    useAiSettingsStore.setState({
      enabled: true,
      assistantMode: "agent",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "inspect users and continue as needed");
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await vi.waitFor(() =>
        expect(mocks.executeReadOnlyQuery).toHaveBeenCalledTimes(2)
      );
      await flushAsyncWork();
    });

    expect(mocks.executeReadOnlyQuery.mock.calls.map((call) => call[1])).toEqual([
      "SELECT * FROM users",
      "SELECT * FROM roles",
    ]);
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(
      "postgres-1",
      expect.stringContaining("UPDATE roles"),
      expect.anything()
    );
    expect(container.textContent).toContain("query.runMutation");
    expect(container.textContent).toContain("needs explicit approval");
    expect(container.textContent).toContain("Roles loaded");
    expect(mocks.chatCompletion).toHaveBeenCalledTimes(3);
  });

  it("ignores a late model summary after an Agent run is stopped", async () => {
    let resolveSummary: (value: { content: string; model: string }) => void =
      () => undefined;
    mocks.chatCompletion
      .mockResolvedValueOnce({
        content: JSON.stringify({
          intent: "query",
          steps: [
            {
              id: "read-current-query",
              title: "Read the current query",
              toolName: "query.runReadOnly",
              input: { query: "SELECT * FROM users" },
            },
          ],
        }),
        model: "gpt-test",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSummary = resolve;
          })
      );
    useAiSettingsStore.setState({
      enabled: true,
      assistantMode: "agent",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });
    const textarea = container.querySelector("textarea");
    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      await flushAsyncWork();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Run agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.chatCompletion).toHaveBeenCalledTimes(2);
    expect(buttonWithText(container, "Stop")).toBeTruthy();
    await act(async () => {
      buttonWithText(container, "Stop")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      resolveSummary({
        content: JSON.stringify({ message: "late summary" }),
        model: "gpt-test",
      });
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Assistant run cancelled");
    expect(container.textContent).not.toContain("late summary");
  });
});
