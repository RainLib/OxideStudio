/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionSelect,
  filterConnectionOptions,
} from "@/components/connection/ConnectionSelect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConnectionSelect", () => {
  const connections = [
    { id: "warehouse", name: "Warehouse 10", driver: "postgres", tags: ["production"] },
    { id: "local", name: "Local cache", driver: "sqlite", tags: ["development"] },
  ] as never;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("searches by connection name, driver, and tags with stable display order", () => {
    expect(filterConnectionOptions(connections, "prod").map((item) => item.id)).toEqual(["warehouse"]);
    expect(filterConnectionOptions(connections, "sql").map((item) => item.id)).toEqual(["local"]);
    expect(filterConnectionOptions(connections, "").map((item) => item.id)).toEqual(["local", "warehouse"]);
  });

  it("filters the live picker and returns the exact selected connection id", async () => {
    const onValueChange = vi.fn();
    await act(async () => {
      root.render(<ConnectionSelect connections={connections} value="local" onValueChange={onValueChange} />);
    });
    const trigger = document.body.querySelector<HTMLButtonElement>("button[aria-label='Choose connection']");
    await act(async () => trigger?.click());
    const search = document.body.querySelector<HTMLInputElement>("input[aria-label='Search connections']");
    expect(search).not.toBeNull();
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "prod");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[data-picker-connection='local']")).toBeNull();
    const warehouse = document.body.querySelector<HTMLButtonElement>("[data-picker-connection='warehouse']");
    expect(warehouse).not.toBeNull();
    await act(async () => warehouse?.click());
    expect(onValueChange).toHaveBeenCalledWith("warehouse");
  });
});
