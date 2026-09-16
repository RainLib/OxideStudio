import { invokeRawCommand } from "../client";
import type { RocketMqTopicConfig, RocketMqTopicDetail, RocketMqTopics, RocketMqTopicStats } from "./contracts";

export const rocketMqTopicService = {
  listTopics: (connectionId: string, keyword?: string) =>
    invokeRawCommand<RocketMqTopics>("list_rocketmq_topics", { connectionId, keyword }),
  getTopic: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicDetail>("get_rocketmq_topic", { connectionId, topic }),
  getTopicConfig: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicConfig>("get_rocketmq_topic_config", { connectionId, topic }),
  getTopicStats: (connectionId: string, topic: string) =>
    invokeRawCommand<RocketMqTopicStats>("get_rocketmq_topic_stats", { connectionId, topic }),
};
