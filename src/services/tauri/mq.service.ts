import type { RocketMqConnectionConfig } from "@/features/mq/model/rocketmq";
import { invokeCommand, invokeRawCommand } from "./client";

export type RocketMqCluster = {
  ok: boolean;
  brokers: Array<{
    brokerName: string;
    brokerId: string;
    address: string;
    role: "MASTER" | "SLAVE";
  }>;
  nodeCount: number;
};

export type RocketMqTopics = {
  topics: string[];
  total: number;
  offset: number;
  limit: number;
};

export type RocketMqConsumerGroups = {
  groups: Array<{
    groupId: string;
    state: string;
    simpleGroup: boolean;
    messageModel: string;
  }>;
  total: number;
  offset: number;
  limit: number;
};

export const rocketMqService = {
  probeNameServers: (namesrvAddr: string) =>
    invokeCommand<{ endpoints: string[] }>("probe_rocketmq_nameservers", { namesrvAddr }),
  connect: (connectionId: string, config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("connect_rocketmq_workspace", { connectionId, config }),
  testConnection: (config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("test_rocketmq_workspace", { config }),
  getCluster: (connectionId: string) =>
    invokeRawCommand<RocketMqCluster>("get_rocketmq_cluster", { connectionId }),
  listTopics: (connectionId: string, keyword?: string) =>
    invokeRawCommand<RocketMqTopics>("list_rocketmq_topics", { connectionId, keyword }),
  listConsumerGroups: (connectionId: string, options: { keyword?: string; offset?: number; limit?: number } = {}) =>
    invokeRawCommand<RocketMqConsumerGroups>("list_rocketmq_consumer_groups", {
      connectionId,
      ...options,
    }),
  disconnect: (connectionId: string) =>
    invokeRawCommand<void>("disconnect_rocketmq_workspace", { connectionId }),
};
