import { afterEach, describe, expect, it, vi } from "vitest";
import { createLspProviderRefresh } from "./lspProviderRefresh";
function fixture(accept = (_value: {
  version?: number;
}) => true) {
  let publish!: (value: {
    version?: number;
  }) => void;
  const cleanup = vi.fn(),
    invalidate = vi.fn();
  const refresh = createLspProviderRefresh({
    accept,
    invalidate,
    subscribe: notify => {
      publish = notify;
      return {
        dispose: cleanup
      };
    }
  });
  return {
    refresh,
    publish,
    cleanup,
    invalidate
  };
}
afterEach(() => vi.restoreAllMocks());
describe("provider refresh generations", () => {
  it("revokes pending responses before renderer events run", async () => {
    const f = fixture(),
      changed = vi.fn(),
      generation = f.refresh.generation;
    f.refresh.onDidChange(changed);
    f.publish({
      version: 1
    });
    expect(f.refresh.isCurrent(generation)).toBe(false);
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    f.refresh.dispose();
  });
  it("coalesces same-turn repaints while revoking every accepted publication", async () => {
    const f = fixture(),
      changed = vi.fn();
    f.refresh.onDidChange(changed);
    for (let i = 0; i < 20; i++) f.publish({
      version: 2
    });
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    expect(f.refresh.generation).toBe(20);
    f.refresh.dispose();
  });
  it("does not invalidate rejected publications", async () => {
    const f = fixture(value => value.version === 4),
      changed = vi.fn();
    f.refresh.onDidChange(changed);
    f.publish({
      version: 3
    });
    await Promise.resolve();
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(f.refresh.generation).toBe(0);
    f.refresh.dispose();
  });
  it("does not deduplicate later metadata changes by SQL version", async () => {
    const f = fixture(),
      changed = vi.fn();
    f.refresh.onDidChange(changed);
    f.publish({
      version: 4
    });
    await Promise.resolve();
    f.publish({
      version: 4
    });
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    f.refresh.dispose();
  });
  it("supports Monaco event context and disposable collections", async () => {
    const f = fixture(),
      state = {
        count: 0
      },
      bucket: Array<{
        dispose: () => void;
      }> = [];
    f.refresh.onDidChange(function (this: typeof state) {
      this.count++;
    }, state, bucket);
    f.publish({
      version: 1
    });
    await Promise.resolve();
    expect(state.count).toBe(1);
    bucket[0]!.dispose();
    f.publish({
      version: 1
    });
    await Promise.resolve();
    expect(state.count).toBe(1);
    f.refresh.dispose();
  });
  it("suppresses queued repaint after disposal", async () => {
    const f = fixture(),
      changed = vi.fn();
    f.refresh.onDidChange(changed);
    f.publish({
      version: 1
    });
    f.refresh.dispose();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(f.refresh.isCurrent(f.refresh.generation)).toBe(false);
  });
  it("rejects retained publishers and releases its subscription once", async () => {
    const f = fixture(),
      changed = vi.fn();
    f.refresh.dispose();
    f.refresh.dispose();
    f.refresh.onDidChange(changed);
    f.publish({
      version: 1
    });
    await Promise.resolve();
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it("isolates a failing renderer listener", async () => {
    const f = fixture(),
      changed = vi.fn(),
      report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    f.refresh.onDidChange(() => {
      throw new Error("renderer");
    });
    f.refresh.onDidChange(changed);
    f.publish({
      version: 1
    });
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    f.refresh.dispose();
  });
});
