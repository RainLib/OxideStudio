import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeCommand, invokeRawCommand } = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  invokeRawCommand: vi.fn(),
}));
vi.mock("./client", () => ({ invokeCommand, invokeRawCommand }));

import { rocketMqService } from "./mq.service";

describe("RocketMQ workspace service", () => {
  beforeEach(() => {
    invokeCommand.mockReset();
    invokeRawCommand.mockReset();
  });

  it("keeps the probe on the response-envelope command", async () => {
    await rocketMqService.probeNameServers("localhost:9876");
    expect(invokeCommand).toHaveBeenCalledWith("probe_rocketmq_nameservers", {
      namesrvAddr: "localhost:9876",
    });
  });

  it("forwards workspace calls only through desktop raw commands", async () => {
    await rocketMqService.connect("rocket-1", {
      namesrvAddr: "localhost:9876",
    });
    await rocketMqService.listTopics("rocket-1", "orders");
    await rocketMqService.listConsumerGroups("rocket-1", {
      offset: 200,
      limit: 100,
    });
    await rocketMqService.getConsumerGroup("rocket-1", "order-workers");
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      1,
      "connect_rocketmq_workspace",
      {
        connectionId: "rocket-1",
        config: { namesrvAddr: "localhost:9876" },
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      2,
      "list_rocketmq_topics",
      {
        connectionId: "rocket-1",
        keyword: "orders",
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      3,
      "list_rocketmq_consumer_groups",
      {
        connectionId: "rocket-1",
        offset: 200,
        limit: 100,
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      4,
      "get_rocketmq_consumer_group",
      {
        connectionId: "rocket-1",
        groupId: "order-workers",
      },
    );
  });
});
