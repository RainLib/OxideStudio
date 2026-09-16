import { invokeRawCommand } from "../client";
import type {
  RocketMqConsumerGroupConfig,
  RocketMqConsumerGroupDetail,
  RocketMqConsumerGroups,
  RocketMqConsumerLag,
} from "./contracts";

export const rocketMqConsumerService = {
  listConsumerGroups: (
    connectionId: string,
    options: { keyword?: string; offset?: number; limit?: number } = {},
  ) =>
    invokeRawCommand<RocketMqConsumerGroups>("list_rocketmq_consumer_groups", {
      connectionId,
      ...options,
    }),
  getConsumerGroup: (connectionId: string, groupId: string) =>
    invokeRawCommand<RocketMqConsumerGroupDetail>(
      "get_rocketmq_consumer_group",
      { connectionId, groupId },
    ),
  getConsumerGroupConfig: (connectionId: string, groupId: string) =>
    invokeRawCommand<RocketMqConsumerGroupConfig>(
      "get_rocketmq_consumer_group_config",
      { connectionId, groupId },
    ),
  getConsumerLag: (connectionId: string, groupId: string, topic: string) =>
    invokeRawCommand<RocketMqConsumerLag>("get_rocketmq_consumer_lag", {
      connectionId,
      groupId,
      topic,
    }),
};
