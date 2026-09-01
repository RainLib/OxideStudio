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

export type RocketMqMessagePreview = {
  topic: string;
  messages: Array<{
    messageId: string;
    offsetMessageId: string;
    brokerName: string;
    topic: string;
    partition: number;
    offset: number;
    timestamp: number;
    key: string;
    tag: string;
    headers: Record<string, string>;
    payloadBase64: string;
    payloadText?: string;
    payloadTruncated: boolean;
  }>;
  nextOffset: number;
};

export type RocketMqTopicConfig = {
  topic: string;
  configs: Array<{
    brokerName: string;
    topicName: string;
    readQueueNums: number;
    writeQueueNums: number;
    perm: number;
    topicFilterType: string;
    topicSysFlag: number;
    order: boolean;
  }>;
  unavailableBrokers: string[];
};

export type RocketMqTopicStats = {
  topic: string;
  partitions: Array<{
    brokerName: string;
    partition: number;
    beginOffset: number;
    endOffset: number;
    messageCount: number;
  }>;
  totalMessages: number;
};

export type RocketMqAcls = {
  acls: Array<{
    principal: string;
    description: string;
    policies: Array<{
      brokerName: string;
      resource: string;
      actions: string[];
      effect: string;
      sourceIps: string[];
      decision: string;
    }>;
  }>;
  unavailableBrokers: string[];
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
  getTopicConfig: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicConfig>("get_rocketmq_topic_config", {
      connectionId,
      topic,
    }),
  getTopicStats: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicStats>("get_rocketmq_topic_stats", {
      connectionId,
      topic,
    }),
  listAcls: (connectionId: string) =>
    invokeRawCommand<RocketMqAcls>("list_rocketmq_acls", { connectionId }),
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
    options: {
      beginTimestamp?: number;
      endTimestamp?: number;
      limit?: number;
    } = {},
  ) =>
    invokeRawCommand<{
      topic: string;
      beginTimestamp: number;
      endTimestamp: number;
      messages: RocketMqMessagePreview["messages"];
    }>("query_rocketmq_messages_by_time", { connectionId, topic, ...options }),
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
