/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { workbenchActions } from "@/lib/actions";
import { APP_EVENT_INSERT_LINE_BELOW } from "@/lib/actionEvents";
import { insertLineBelow } from "@/features/query-editor";

describe("editor line actions", () => {
  it("delegates indentation and undo behavior to Monaco's native command", () => {
    const trigger = vi.fn();

    insertLineBelow({ trigger });

    expect(trigger).toHaveBeenCalledWith(
      "oxide.insertLineBelow",
      "editor.action.insertLineAfter",
      null,
    );
  });

  it("exposes Insert Line Below through the shared action/event contract", () => {
    const listener = vi.fn();
    window.addEventListener(APP_EVENT_INSERT_LINE_BELOW, listener);

    const action = workbenchActions().find(
      (candidate) => candidate.id === "editor.insertLineBelow",
    );
    expect(action).toMatchObject({
      title: "Insert Line Below",
      group: "Editor",
    });

    action?.run();
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(APP_EVENT_INSERT_LINE_BELOW, listener);
  });
});
