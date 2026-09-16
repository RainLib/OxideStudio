import { invokeRawCommand } from "../client";
import type { RocketMqMessagePreview } from "./contracts";

export const rocketMqMessageService = {
  peekMessages: (
    connectionId: string,
    topic: string,
    options: { partition?: number; offset?: number; limit?: number } = {},
  ) =>
    invokeRawCommand<RocketMqMessagePreview>("peek_rocketmq_messages", {
      connectionId,
      topic,
      ...options,
    }),
  queryMessagesByKey: (
    connectionId: string,
    topic: string,
    key: string,
    limit = 32,
  ) =>
    invokeRawCommand<{
      topic: string;
      key: string;
      messages: RocketMqMessagePreview["messages"];
    }>("query_rocketmq_messages_by_key", { connectionId, topic, key, limit }),
  queryMessagesByTime: (
    connectionId: string,
    topic: string,
    options: { beginTimestamp?: number; endTimestamp?: number; limit?: number } = {},
  ) =>
    invokeRawCommand<{
      topic: string;
      beginTimestamp: number;
      endTimestamp: number;
      messages: RocketMqMessagePreview["messages"];
    }>("query_rocketmq_messages_by_time", { connectionId, topic, ...options }),
};
