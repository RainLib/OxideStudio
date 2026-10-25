import { expect, it, vi } from "vitest";
const {
  invokeWithInterceptors
} = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn()
}));
vi.mock("../client", () => ({
  invokeWithInterceptors
}));
import { getSqlLookupContext } from "./catalog";
it("uses the read-only metadata command with explicit/current database scope", async () => {
  invokeWithInterceptors.mockResolvedValue(null);
  await getSqlLookupContext("connection", "db");
  await getSqlLookupContext("connection");
  expect(invokeWithInterceptors.mock.calls).toEqual([["get_sql_lookup_context", {
    connectionId: "connection",
    database: "db"
  }], ["get_sql_lookup_context", {
    connectionId: "connection",
    database: null
  }]]);
});
