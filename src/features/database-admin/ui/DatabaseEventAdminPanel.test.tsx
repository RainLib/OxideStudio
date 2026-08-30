// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listDatabaseAdminEvents,
  previewDatabaseAdminEventMutation,
  executeDatabaseAdminEventMutation,
} = vi.hoisted(() => ({
  listDatabaseAdminEvents: vi.fn(),
  previewDatabaseAdminEventMutation: vi.fn(),
  executeDatabaseAdminEventMutation: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    listDatabaseAdminEvents,
    previewDatabaseAdminEventMutation,
    executeDatabaseAdminEventMutation,
  },
}));

import { DatabaseEventAdminPanel } from "./DatabaseEventAdminPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DatabaseEventAdminPanel", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    listDatabaseAdminEvents.mockReset().mockResolvedValue({
      schedulerStatus: "OFF",
      events: [
        {
          schema: "shop",
          name: "daily_sync",
          eventType: "RECURRING",
          intervalValue: "1",
          intervalField: "DAY",
          status: "ENABLED",
        },
      ],
    });
    previewDatabaseAdminEventMutation.mockReset().mockResolvedValue({
      action: "disable",
      target: "shop.daily_sync",
      summary: "Disable future executions of this database event",
      risk: "medium",
      sqlPreview: "ALTER EVENT `shop`.`daily_sync` DISABLE;",
      confirmationText: "DISABLE EVENT shop.daily_sync",
      confirmationToken: "sha256:event",
      serverVersion: "8.0.36",
    });
    executeDatabaseAdminEventMutation
      .mockReset()
      .mockResolvedValue("Event disable completed for shop.daily_sync");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("reviews current metadata before disabling a scheduled event", async () => {
    await act(async () => {
      root.render(
        <DatabaseEventAdminPanel
          connectionId="mysql-1"
          driver="mysql"
          schema="shop"
        />,
      );
    });
    await flush();

    expect(listDatabaseAdminEvents).toHaveBeenCalledWith(
      "mysql-1",
      "mysql",
      "shop",
    );
    expect(document.body.textContent).toContain(
      "event scheduler is OFF",
    );
    const disableButton = document.body.querySelector<HTMLButtonElement>(
      'button[title="Disable event"]',
    );
    expect(disableButton).toBeTruthy();
    await act(async () => disableButton?.click());
    await flush();

    const mutation = {
      action: "setEnabled" as const,
      schema: "shop",
      name: "daily_sync",
      enabled: false,
    };
    expect(previewDatabaseAdminEventMutation).toHaveBeenCalledWith(
      "mysql-1",
      "mysql",
      mutation,
    );
    const applyButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Apply event change"),
    );
    expect(applyButton?.disabled).toBe(true);

    const confirmationInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Scheduled event confirmation text"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        confirmationInput,
        "DISABLE EVENT shop.daily_sync",
      );
      confirmationInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(applyButton?.disabled).toBe(false);

    await act(async () => applyButton?.click());
    await flush();
    expect(executeDatabaseAdminEventMutation).toHaveBeenCalledWith(
      "mysql-1",
      "mysql",
      {
        mutation,
        confirmationToken: "sha256:event",
        confirmationText: "DISABLE EVENT shop.daily_sync",
      },
    );
    expect(document.body.textContent).toContain(
      "Event disable completed for shop.daily_sync",
    );
  });
});
