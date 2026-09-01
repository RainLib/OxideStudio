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
    await rocketMqService.getTopic("rocket-1", "orders");
    await rocketMqService.getTopicConfig("rocket-1", "orders");
    await rocketMqService.getTopicStats("rocket-1", "orders");
    await rocketMqService.listAcls("rocket-1");
    await rocketMqService.listProducers("rocket-1");
    await rocketMqService.peekMessages("rocket-1", "orders", {
      partition: 2,
      offset: 8,
      limit: 20,
    });
    await rocketMqService.queryMessagesByKey(
      "rocket-1",
      "orders",
      "order-1",
      50,
    );
    await rocketMqService.queryMessagesByTime("rocket-1", "orders", {
      limit: 30,
    });
    await rocketMqService.listConsumerGroups("rocket-1", {
      offset: 200,
      limit: 100,
    });
    await rocketMqService.getConsumerGroup("rocket-1", "order-workers");
    await rocketMqService.getConsumerGroupConfig("rocket-1", "order-workers");
    await rocketMqService.getConsumerLag("rocket-1", "order-workers", "orders");
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
    expect(invokeRawCommand).toHaveBeenNthCalledWith(3, "get_rocketmq_topic", {
      connectionId: "rocket-1",
      topic: "orders",
    });
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      4,
      "get_rocketmq_topic_config",
      { connectionId: "rocket-1", topic: "orders" },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      5,
      "get_rocketmq_topic_stats",
      { connectionId: "rocket-1", topic: "orders" },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(6, "list_rocketmq_acls", {
      connectionId: "rocket-1",
    });
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      7,
      "list_rocketmq_producers",
      { connectionId: "rocket-1" },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      8,
      "peek_rocketmq_messages",
      {
        connectionId: "rocket-1",
        topic: "orders",
        partition: 2,
        offset: 8,
        limit: 20,
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      9,
      "query_rocketmq_messages_by_key",
      { connectionId: "rocket-1", topic: "orders", key: "order-1", limit: 50 },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      10,
      "query_rocketmq_messages_by_time",
      { connectionId: "rocket-1", topic: "orders", limit: 30 },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      11,
      "list_rocketmq_consumer_groups",
      {
        connectionId: "rocket-1",
        offset: 200,
        limit: 100,
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      12,
      "get_rocketmq_consumer_group",
      {
        connectionId: "rocket-1",
        groupId: "order-workers",
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      13,
      "get_rocketmq_consumer_group_config",
      {
        connectionId: "rocket-1",
        groupId: "order-workers",
      },
    );
    expect(invokeRawCommand).toHaveBeenNthCalledWith(
      14,
      "get_rocketmq_consumer_lag",
      {
        connectionId: "rocket-1",
        groupId: "order-workers",
        topic: "orders",
      },
    );
  });
});
