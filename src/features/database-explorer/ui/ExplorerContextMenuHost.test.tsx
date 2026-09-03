// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerContextMenuRow,
  ExplorerSharedContextMenu,
} from "./ExplorerContextMenuHost";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ExplorerContextMenuHost", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("uses one menu root and switches content to the right-clicked row", async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <ExplorerContextMenuHost>
          <div>
            {Array.from({ length: 20 }, (_, index) => (
              <ExplorerContextMenuRow
                key={index}
                nodeId={`table:${index}`}
                menu={<ContextMenuItem>Open table {index}</ContextMenuItem>}
                onOpenChange={index === 17 ? onOpenChange : undefined}
              >
                <button type="button">Table {index}</button>
              </ExplorerContextMenuRow>
            ))}
          </div>
        </ExplorerContextMenuHost>,
      );
    });

    const row = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Table 17",
    );
    await act(async () => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    expect(document.body.textContent).toContain("Open table 17");
    expect(
      document.querySelectorAll("[data-explorer-context-menu-node-id]"),
    ).toHaveLength(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lets the nearest nested host own a member-row menu", async () => {
    await act(async () => {
      root.render(
        <ExplorerContextMenuHost>
          <ExplorerContextMenuRow
            nodeId="table:orders"
            menu={<ContextMenuItem>Table action</ContextMenuItem>}
          >
            <div>
              Orders
              <ExplorerContextMenuHost>
                <ExplorerContextMenuRow
                  nodeId="column:id"
                  menu={<ContextMenuItem>Column action</ContextMenuItem>}
                >
                  <button type="button">id column</button>
                </ExplorerContextMenuRow>
              </ExplorerContextMenuHost>
            </div>
          </ExplorerContextMenuRow>
        </ExplorerContextMenuHost>,
      );
    });

    const member = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "id column",
    );
    await act(async () => {
      member?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    expect(document.body.textContent).toContain("Column action");
    expect(document.body.textContent).not.toContain("Table action");
  });

  it("adapts existing trigger and content markup to the shared host", async () => {
    await act(async () => {
      root.render(
        <ExplorerContextMenuHost>
          <div>
            <ExplorerSharedContextMenu nodeId="schema:public">
              <ContextMenuTrigger asChild>
                <button type="button">public</button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Refresh schema</ContextMenuItem>
              </ContextMenuContent>
            </ExplorerSharedContextMenu>
          </div>
        </ExplorerContextMenuHost>,
      );
    });

    const trigger = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "public",
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    expect(document.body.textContent).toContain("Refresh schema");
    expect(
      document.querySelector(
        '[data-explorer-context-menu-node-id="schema:public"]',
      ),
    ).not.toBeNull();
  });
});
