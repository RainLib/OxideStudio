import { afterEach, expect, it, vi } from "vitest";
import { createMetadataRuntime } from "./metadataRequests";

const connection = { id: "db", name: "Database", driver: "postgres", url: "" };
afterEach(() => vi.unstubAllGlobals());

it("isolates request generations and in-flight work between store instances", () => {
  const ports = {
    getConnectionState: () => ({
      activeConnectionId: "db",
      connections: [connection],
    }),
  };
  const first = createMetadataRuntime(ports);
  const second = createMetadataRuntime(ports);
  const firstRequest = first.captureMetadataRequest("db");
  const secondRequest = second.captureMetadataRequest("db");
  first.schemaLoadsInFlight.set("db", {
    force: false,
    promise: Promise.resolve(),
  });
  first.metadataRuntime.generation += 1;
  expect(first.isMetadataRequestCurrent(firstRequest)).toBe(false);
  expect(second.isMetadataRequestCurrent(secondRequest)).toBe(true);
  expect(second.schemaLoadsInFlight.size).toBe(0);
  expect(second.metadataRuntime.namespaceSelectionGeneration).toBe(0);
});

it("reads current connection state through the injected port", () => {
  let activeConnectionId = "db";
  const runtime = createMetadataRuntime({
    getConnectionState: () => ({
      activeConnectionId,
      connections: [connection],
    }),
  });
  const request = runtime.captureMetadataRequest("db");
  expect(runtime.isMetadataRequestCurrent(request)).toBe(true);
  activeConnectionId = "another";
  expect(runtime.isMetadataRequestCurrent(request)).toBe(false);
  expect(runtime.getConnectionDriver("db")).toBe("postgres");
});

it("invalidates a request when the active project changes", () => {
  let project = "first-project";
  vi.stubGlobal("localStorage", { getItem: () => project });
  const runtime = createMetadataRuntime({
    getConnectionState: () => ({
      activeConnectionId: "db",
      connections: [connection],
    }),
  });
  const request = runtime.captureMetadataRequest("db");
  project = "second-project";
  expect(runtime.isMetadataRequestCurrent(request)).toBe(false);
  expect(
    runtime.metadataRequestKey(runtime.captureMetadataRequest("db"), "tables"),
  ).not.toBe(runtime.metadataRequestKey(request, "tables"));
});
