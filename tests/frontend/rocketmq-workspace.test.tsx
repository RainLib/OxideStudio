// @vitest-environment happy-dom
import { RocketMqWorkspace } from "@/components/workspace/RocketMqWorkspace";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { id: "mq", name: "Message cluster", driver: "rocketmq" } as Pick<
    ConnectionConfig,
    "id" | "name" | "driver"
  >,
  getCluster: vi.fn(),
  listTopics: vi.fn(),
  listConsumerGroups: vi.fn(),
  getTopic: vi.fn(),
  getTopicStats: vi.fn(),
  listAcls: vi.fn(),
  listProducers: vi.fn(),
}));
vi.mock("@/services/tauri/mq.service", () => ({ rocketMqService: mocks }));
vi.mock("@/store/useTabStore", () => ({
  useTabStore: (select: (state: unknown) => unknown) =>
    select({ tabs: [{ id: "tab", connectionId: "mq" }], activeTabId: "tab" }),
}));
vi.mock("@/store/useConnectionStore", () => ({
  useConnectionStore: (select: (state: unknown) => unknown) =>
    select({ connections: [mocks.connection] }),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCluster.mockResolvedValue({ ok: true, brokers: [], nodeCount: 0 });
  mocks.listTopics.mockResolvedValue({
    topics: ["orders"],
    total: 1,
    offset: 0,
    limit: 100,
  });
  mocks.listConsumerGroups.mockResolvedValue({
    groups: [],
    total: 0,
    offset: 0,
    limit: 100,
  });
  mocks.getTopic.mockResolvedValue({
    topic: "orders",
    queueDatas: [],
    brokerDatas: [],
  });
  mocks.getTopicStats.mockResolvedValue({
    topic: "orders",
    partitions: [],
    totalMessages: 7,
  });
  mocks.listAcls.mockResolvedValue({ acls: [], unavailableBrokers: [] });
  mocks.listProducers.mockResolvedValue({
    producers: [],
    unavailableBrokers: [],
    truncated: false,
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
it("routes topic selection and offset inspection through the active native session", async () => {
  await act(async () => root.render(<RocketMqWorkspace />));
  expect(mocks.getCluster).toHaveBeenCalledWith("mq");
  await click("Topics");
  await click("orders");
  expect(mocks.getTopic).toHaveBeenCalledWith("mq", "orders");
  await click("Load offsets");
  expect(mocks.getTopicStats).toHaveBeenCalledWith("mq", "orders");
  expect(container.textContent).toContain("7 messages across 0 partitions");
});
it("loads access and producer resources on demand and preserves their refresh actions", async () => {
  await act(async () => root.render(<RocketMqWorkspace />));
  expect(mocks.listAcls).not.toHaveBeenCalled();
  expect(mocks.listProducers).not.toHaveBeenCalled();
  await click("Access control");
  expect(mocks.listAcls).toHaveBeenCalledTimes(1);
  const aclRefresh = [...container.querySelectorAll("main button")].find(
    (button) => button.textContent?.includes("Refresh"),
  );
  expect(aclRefresh).toBeDefined();
  await act(async () => (aclRefresh as HTMLButtonElement).click());
  expect(mocks.listAcls).toHaveBeenCalledTimes(2);
  await click("Producers");
  expect(mocks.listProducers).toHaveBeenCalledWith("mq");
});
it("shows a failed cluster load and recovers on explicit refresh", async () => {
  mocks.getCluster.mockRejectedValueOnce(new Error("Agent disconnected"));
  await act(async () => root.render(<RocketMqWorkspace />));
  expect(container.textContent).toContain("Agent disconnected");
  await click("Refresh");
  expect(container.textContent).not.toContain("Agent disconnected");
  expect(mocks.getCluster).toHaveBeenCalledTimes(2);
});
