// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachAppDialogHost, confirmAction, decideAppDialog, finishAppDialog, getAppDialogSnapshot, promptValue, showMessage } from "./appDialogs";

describe("application dialogs", () => {
  let detach: () => void;
  beforeEach(() => { detach = attachAppDialogHost(); });
  afterEach(() => detach());
  function finish(value: boolean | string | null) {
    const active = getAppDialogSnapshot()!;
    decideAppDialog(active.id, value);
    finishAppDialog(active.id);
  }
  it("waits for the exit before resolving an approval", async () => {
    let approved = false;
    const result = confirmAction("Delete this table?").then((value) => { approved = value; });
    const active = getAppDialogSnapshot()!;
    decideAppDialog(active.id, true);
    await Promise.resolve();
    expect(approved).toBe(false);
    expect(getAppDialogSnapshot()?.closing).toBe(true);
    finishAppDialog(active.id);
    await result;
    expect(approved).toBe(true);
  });
  it("preserves empty input separately from cancel", async () => {
    const clear = promptValue("Filter", "old"); finish("");
    expect(await clear).toBe("");
    const cancel = promptValue("Rename", "old"); finish(null);
    expect(await cancel).toBeNull();
  });
  it("queues requests without replacing an unresolved decision", async () => {
    const first = confirmAction("first");
    const second = confirmAction("second");
    expect(getAppDialogSnapshot()?.message).toBe("first");
    finish(false); expect(await first).toBe(false);
    await Promise.resolve();
    expect(getAppDialogSnapshot()?.message).toBe("second");
    finish(true); expect(await second).toBe(true);
  });
  it("cancels pending and queued requests when the host unmounts", async () => {
    const first = confirmAction("first"); const second = promptValue("second");
    detach(); detach = () => undefined;
    expect(await first).toBe(false); expect(await second).toBeNull();
    expect(getAppDialogSnapshot()).toBeNull();
    expect(await confirmAction("no host")).toBe(false);
  });
  it("supports aborting a queued request and dismissing a message", async () => {
    const first = showMessage("Problem");
    const controller = new AbortController();
    const second = confirmAction("queued", { signal: controller.signal });
    controller.abort(); expect(await second).toBe(false);
    finish(true); await first; await Promise.resolve();
    expect(getAppDialogSnapshot()).toBeNull();
  });
});
