// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  previewSqliteBackupPlan,
  executeSqliteBackupPlan,
  saveFile,
  openFile,
} = vi.hoisted(() => ({
  previewSqliteBackupPlan: vi.fn(),
  executeSqliteBackupPlan: vi.fn(),
  saveFile: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    previewSqliteBackupPlan,
    executeSqliteBackupPlan,
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveFile,
  open: openFile,
}));

import { SqliteBackupDialog } from "./SqliteBackupDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SqliteBackupDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    saveFile.mockReset().mockResolvedValue("C:/backups/app.sqlite");
    openFile.mockReset();
    previewSqliteBackupPlan.mockReset().mockResolvedValue({
      operation: "backup",
      path: "C:/backups/app.sqlite",
      fileName: "app.sqlite",
      summary: "Create a consistent SQLite backup using the live database snapshot",
      risk: "low",
      destinationExists: false,
      byteLen: null,
      sourceSha256: null,
      createsRecoveryPoint: false,
      confirmationText: "CREATE BACKUP app.sqlite",
      confirmationToken: "sha256:reviewed",
      connectedDriver: "sqlite",
      serverVersion: "3.46.1",
    });
    executeSqliteBackupPlan.mockReset().mockResolvedValue({
      operation: "backup",
      path: "C:/backups/app.sqlite",
      byteLen: 4096,
      integrityCheck: "ok",
      recoveryPath: null,
      message: "SQLite backup created and integrity checked",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("reviews the selected file and requires its exact confirmation phrase", async () => {
    await act(async () => {
      root.render(
        <SqliteBackupDialog
          open
          onOpenChange={() => undefined}
          target={{
            connectionId: "sqlite-1",
            connectionName: "Local analytics",
            initialOperation: "backup",
          }}
        />,
      );
    });

    const chooseButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Choose file"),
    );
    expect(chooseButton).toBeTruthy();
    await act(async () => chooseButton?.click());
    await flush();

    expect(previewSqliteBackupPlan).toHaveBeenCalledWith("sqlite-1", {
      operation: "backup",
      path: "C:/backups/app.sqlite",
    });
    const executeButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Create backup"),
    );
    expect(executeButton?.disabled).toBe(true);

    const confirmationInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="SQLite backup confirmation text"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        confirmationInput,
        "CREATE BACKUP app.sqlite",
      );
      confirmationInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(executeButton?.disabled).toBe(false);

    await act(async () => executeButton?.click());
    await flush();
    expect(executeSqliteBackupPlan).toHaveBeenCalledWith("sqlite-1", {
      plan: { operation: "backup", path: "C:/backups/app.sqlite" },
      confirmationToken: "sha256:reviewed",
      confirmationText: "CREATE BACKUP app.sqlite",
    });
    expect(document.body.textContent).toContain(
      "SQLite backup created and integrity checked",
    );
  });
});
