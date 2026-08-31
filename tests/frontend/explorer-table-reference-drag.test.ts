/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginExplorerTableReferenceDrag } from "@/features/query-editor/model/explorerTableReferenceDrag";
import {
  OXIDE_TABLE_REFERENCE_DROP_EVENT,
  OXIDE_TABLE_REFERENCE_HOVER_EVENT,
  type ExplorerTableReferenceDropDetail,
} from "@/features/query-editor/model/explorerTableReferenceDrop";

describe("Explorer table reference pointer drag", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.style.cursor = "";
    vi.restoreAllMocks();
  });

  it("starts after the movement threshold, reports hover, and drops once", () => {
    const target = document.createElement("div");
    target.dataset.sqlTableDropTarget = "true";
    document.body.appendChild(target);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    const dropped: ExplorerTableReferenceDropDetail[] = [];
    let hovered = 0;
    let finished: boolean | null = null;
    const onDrop = (event: Event) => {
      dropped.push(
        (event as CustomEvent<ExplorerTableReferenceDropDetail>).detail,
      );
    };
    const onHover = () => {
      hovered += 1;
    };
    window.addEventListener(OXIDE_TABLE_REFERENCE_DROP_EVENT, onDrop);
    window.addEventListener(OXIDE_TABLE_REFERENCE_HOVER_EVENT, onHover);

    beginExplorerTableReferenceDrag(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
      {
        payload: {
          kind: "oxide-table-reference",
          version: 1,
          connectionId: "connection-1",
          identifierQuote: '"',
          tables: [{ schema: "public", table: "users" }],
        },
        label: '"public"."users"',
        onFinish: (dragged) => {
          finished = dragged;
        },
      },
    );

    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 12, clientY: 12 }),
    );
    expect(document.querySelector("[data-oxide-table-reference-drag]")).toBeNull();
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 30, clientY: 30 }),
    );
    expect(document.querySelector("[data-oxide-table-reference-drag]")).not.toBeNull();
    expect(hovered).toBe(1);
    document.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 30, clientY: 30 }),
    );

    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.payload.tables[0]?.table).toBe("users");
    expect(finished).toBe(true);
    expect(document.querySelector("[data-oxide-table-reference-drag]")).toBeNull();
    expect(document.body.style.cursor).toBe("");
    window.removeEventListener(OXIDE_TABLE_REFERENCE_DROP_EVENT, onDrop);
    window.removeEventListener(OXIDE_TABLE_REFERENCE_HOVER_EVENT, onHover);
  });

  it("finishes a click without creating a drag or drop", () => {
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    let finished: boolean | null = null;
    beginExplorerTableReferenceDrag(
      new MouseEvent("mousedown", { button: 0, clientX: 5, clientY: 5 }),
      {
        payload: {
          kind: "oxide-table-reference",
          version: 1,
          connectionId: "connection-1",
          identifierQuote: '"',
          tables: [{ table: "users" }],
        },
        label: "users",
        onFinish: (dragged) => {
          finished = dragged;
        },
      },
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 5, clientY: 5 }),
    );
    expect(finished).toBe(false);
  });
});
