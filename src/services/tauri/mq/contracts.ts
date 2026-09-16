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

export type RocketMqProducers = {
  producers: Array<{
    brokerName: string;
    groupId: string;
    clientId: string;
    host: string;
    language: string;
    version: number;
  }>;
  unavailableBrokers: string[];
  truncated: boolean;
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

export type RocketMqConsumerLag = {
  groupId: string;
  topic: string;
  partitions: Array<{
    brokerName: string;
    partition: number;
    currentOffset: number;
    endOffset: number;
    lag: number;
    lastTimestamp: number;
  }>;
  totalLag: number;
};

export type RocketMqConsumerGroupConfig = {
  groupId: string;
  configs: Array<{
    brokerName: string;
    groupId: string;
    consumeEnabled: boolean;
    consumeFromMinEnabled: boolean;
    consumeBroadcastEnabled: boolean;
    retryQueueNums: number;
    retryMaxTimes: number;
    brokerId: number;
    whichBrokerWhenConsumeSlowly: number;
    notifyConsumerIdsChangedEnabled: boolean;
  }>;
  unavailableBrokers: string[];
};
