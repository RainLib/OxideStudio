// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useScopedAsyncResource } from "./useScopedAsyncResource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("scoped read lifecycle", () => {
  it("discards old scopes and superseded requests, retains same-scope content on refresh", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let resource!: ReturnType<typeof useScopedAsyncResource<string>>;
    function Probe({ scope }: { scope: string | null }) {
      resource = useScopedAsyncResource<string>(scope);
      return <div>{resource.state.value}</div>;
    }
    const commit = vi.fn();
    let finishOld!: (value: string) => void;
    try {
      await act(async () => { root.render(<Probe scope="table-a" />); });
      await act(async () => { void resource.run(() => new Promise((resolve) => { finishOld = resolve; }), commit); });
      await act(async () => { root.render(<Probe scope="table-b" />); });
      expect(resource.state.value).toBeNull();
      await act(async () => { await resource.run(async () => "B", commit); finishOld("A"); });
      expect(resource.state.value).toBe("B");
      expect(commit.mock.calls).toEqual([["B"]]);
      await act(async () => { void resource.run(() => new Promise((resolve) => { finishOld = resolve; }), commit); });
      expect(resource.state.phase).toBe("loading");
      expect(resource.state.value).toBe("B");
      await act(async () => { await resource.run(async () => "B-new", commit); finishOld("B-old"); });
      expect(resource.state.value).toBe("B-new");
      await act(async () => { root.render(<Probe scope={null} />); });
      expect(resource.state.value).toBeNull();
      await act(async () => { root.render(<Probe scope="table-c" />); });
      await act(async () => { void resource.run(() => new Promise((resolve) => { finishOld = resolve; }), commit); });
      await act(async () => { root.unmount(); finishOld("C"); });
      expect(commit.mock.calls).toEqual([["B"], ["B-new"]]);
    } finally { root.unmount(); }
  });

  it("recovers from errors and cancelled readiness without staying busy", async () => {
    const root = createRoot(document.createElement("div"));
    let resource!: ReturnType<typeof useScopedAsyncResource<string>>;
    function Probe() { resource = useScopedAsyncResource<string>("a"); return null; }
    try {
      await act(async () => { root.render(<Probe />); });
      await act(async () => { await resource.run(async () => { throw new Error("offline"); }); });
      expect(resource.state).toMatchObject({ phase: "error", error: "offline" });
      await act(async () => { await resource.run(async () => null); });
      expect(resource.state).toMatchObject({ phase: "idle", error: null });
      await act(async () => { await resource.run(async () => "ready"); });
      expect(resource.state).toMatchObject({ phase: "ready", value: "ready" });
    } finally { root.unmount(); }
  });
});
