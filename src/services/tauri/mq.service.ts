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

export type RocketMqTopicDetail = {
  topic: string;
  queueDatas: Array<{
    brokerName: string;
    readQueueNums: number;
    writeQueueNums: number;
    perm: number;
  }>;
  brokerDatas: Array<{
    brokerName: string;
    cluster: string;
    brokerAddrs: Record<string, string>;
  }>;
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

export type RocketMqConsumerGroupDetail = {
  groupId: string;
  state: string;
  messageModel: string | null;
  consumeFromWhere: string | null;
  assignments: Array<{
    topic: string;
    subExpression: string;
    expressionType: string;
  }>;
  members: Array<{
    memberId: string;
    clientId: string;
    host: string;
    language: string;
    version: number;
    assignments: RocketMqConsumerGroupDetail["assignments"];
  }>;
};

export const rocketMqService = {
  probeNameServers: (namesrvAddr: string) =>
    invokeCommand<{ endpoints: string[] }>("probe_rocketmq_nameservers", {
      namesrvAddr,
    }),
  connect: (connectionId: string, config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("connect_rocketmq_workspace", {
      connectionId,
      config,
    }),
  testConnection: (config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("test_rocketmq_workspace", { config }),
  getCluster: (connectionId: string) =>
    invokeRawCommand<RocketMqCluster>("get_rocketmq_cluster", { connectionId }),
  listTopics: (connectionId: string, keyword?: string) =>
    invokeRawCommand<RocketMqTopics>("list_rocketmq_topics", {
      connectionId,
      keyword,
    }),
  getTopic: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicDetail>("get_rocketmq_topic", {
      connectionId,
      topic,
    }),
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
      {
        connectionId,
        groupId,
      },
    ),
  disconnect: (connectionId: string) =>
    invokeRawCommand<void>("disconnect_rocketmq_workspace", { connectionId }),
};
