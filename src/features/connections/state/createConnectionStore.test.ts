import { expect, it, vi } from "vitest";
import { createConnectionRuntime } from "../runtime/connectionRequests";
import { createConnectionStore } from "./createConnectionStore";

it("calls injected snapshot operations before selecting an already connected source", async () => {
  const calls: string[] = [];
  const store: ReturnType<typeof createConnectionStore> = createConnectionStore(
    {
      getSchemaState: () => ({
        snapshotActiveMetadata: () =>
          calls.push(`snapshot:${store.getState().activeConnectionId}`),
        restoreConnectionSnapshot: (id) => {
          calls.push(`restore:${id}`);
          return true;
        },
        clearActiveMetadata: () => {
          calls.push("clear");
        },
      }),
    },
    createConnectionRuntime(),
  );
  store.setState({
    connections: ["first", "second"].map((id) => ({
      id,
      name: id,
      driver: "postgres",
      url: "",
    })),
    activeConnectionId: "first",
    connectedConnectionIds: ["first", "second"],
    isConnected: true,
  });
  await expect(
    store.getState().setActiveConnection("second"),
  ).resolves.toBeNull();
  expect(calls).toEqual(["snapshot:first", "restore:second"]);
  expect(store.getState().activeConnectionId).toBe("second");
});

it("keeps request queues and state independent across constructed stores", () => {
  const ports = {
    getSchemaState: () => ({
      snapshotActiveMetadata: vi.fn(),
      restoreConnectionSnapshot: vi.fn(() => false),
      clearActiveMetadata: vi.fn(),
    }),
  };
  const firstRuntime = createConnectionRuntime();
  const secondRuntime = createConnectionRuntime();
  const first = createConnectionStore(ports, firstRuntime);
  const second = createConnectionStore(ports, secondRuntime);
  firstRuntime.latestConnectAttempt += 1;
  firstRuntime.pendingConnects.set("db", {
    attemptId: 1,
    promise: Promise.resolve(null),
  });
  first.setState({ activeConnectionId: "db" });
  expect(secondRuntime.latestConnectAttempt).toBe(0);
  expect(secondRuntime.pendingConnects.size).toBe(0);
  expect(second.getState().activeConnectionId).toBeNull();
});
