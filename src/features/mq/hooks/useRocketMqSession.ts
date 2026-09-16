import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  failureMessage,
  type ConsoleSection,
} from "@/features/mq/model/consolePresentation";
import {
  rocketMqService,
  type RocketMqAcls,
  type RocketMqCluster,
  type RocketMqConsumerGroupConfig,
  type RocketMqConsumerGroupDetail,
  type RocketMqConsumerGroups,
  type RocketMqConsumerLag,
  type RocketMqMessagePreview,
  type RocketMqProducers,
  type RocketMqTopicConfig,
  type RocketMqTopicDetail,
  type RocketMqTopicStats,
  type RocketMqTopics,
} from "@/services/tauri/mq.service";
import { useCallback, useEffect, useMemo, useState } from "react";

interface UseRocketMqSessionContext {
  connection: ConnectionConfig | undefined;
}

export function useRocketMqSession({ connection }: UseRocketMqSessionContext) {
  const [section, setSection] = useState<ConsoleSection>("overview");
  const [cluster, setCluster] = useState<RocketMqCluster | null>(null);
  const [topics, setTopics] = useState<RocketMqTopics | null>(null);
  const [groups, setGroups] = useState<RocketMqConsumerGroups | null>(null);
  const [acls, setAcls] = useState<RocketMqAcls | null>(null);
  const [producers, setProducers] = useState<RocketMqProducers | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [topicDetail, setTopicDetail] = useState<RocketMqTopicDetail | null>(
    null,
  );
  const [messagePreview, setMessagePreview] =
    useState<RocketMqMessagePreview | null>(null);
  const [topicConfig, setTopicConfig] = useState<RocketMqTopicConfig | null>(
    null,
  );
  const [topicStats, setTopicStats] = useState<RocketMqTopicStats | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] =
    useState<RocketMqConsumerGroupDetail | null>(null);
  const [consumerLag, setConsumerLag] = useState<RocketMqConsumerLag | null>(
    null,
  );
  const [consumerGroupConfig, setConsumerGroupConfig] =
    useState<RocketMqConsumerGroupConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [consumerLagLoading, setConsumerLagLoading] = useState(false);
  const [consumerGroupConfigLoading, setConsumerGroupConfigLoading] =
    useState(false);
  const [topicDetailLoading, setTopicDetailLoading] = useState(false);
  const [messagePreviewLoading, setMessagePreviewLoading] = useState(false);
  const [topicConfigLoading, setTopicConfigLoading] = useState(false);
  const [topicStatsLoading, setTopicStatsLoading] = useState(false);
  const [aclLoading, setAclLoading] = useState(false);
  const [producersLoading, setProducersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const [nextCluster, nextTopics, nextGroups] = await Promise.all([
        rocketMqService.getCluster(connection.id),
        rocketMqService.listTopics(connection.id),
        rocketMqService.listConsumerGroups(connection.id),
      ]);
      setCluster(nextCluster);
      setTopics(nextTopics);
      setGroups(nextGroups);
    } catch (cause) {
      setCluster(null);
      setTopics(null);
      setGroups(null);
      setError(failureMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    setSelectedGroup(null);
    setGroupDetail(null);
    setConsumerLag(null);
    setConsumerGroupConfig(null);
    setSelectedTopic(null);
    setTopicDetail(null);
    setMessagePreview(null);
    setTopicConfig(null);
    setTopicStats(null);
    setAcls(null);
    setProducers(null);
    void refresh();
  }, [connection?.id, refresh]);

  const loadAcls = useCallback(async () => {
    if (!connection) return;
    setAclLoading(true);
    try {
      setAcls(await rocketMqService.listAcls(connection.id));
    } catch (cause) {
      setAcls(null);
      setError(failureMessage(cause));
    } finally {
      setAclLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    if (section === "acl" && !acls && !aclLoading) {
      void loadAcls();
    }
  }, [aclLoading, acls, loadAcls, section]);

  const loadProducers = useCallback(async () => {
    if (!connection) return;
    setProducersLoading(true);
    try {
      setProducers(await rocketMqService.listProducers(connection.id));
    } catch (cause) {
      setProducers(null);
      setError(failureMessage(cause));
    } finally {
      setProducersLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    if (section === "producers" && !producers && !producersLoading) {
      void loadProducers();
    }
  }, [loadProducers, producers, producersLoading, section]);

  const loadGroup = useCallback(
    async (groupId: string) => {
      if (!connection) return;
      setSelectedGroup(groupId);
      setConsumerLag(null);
      setConsumerGroupConfig(null);
      setDetailLoading(true);
      try {
        setGroupDetail(
          await rocketMqService.getConsumerGroup(connection.id, groupId),
        );
      } catch (cause) {
        setGroupDetail(null);
        setError(failureMessage(cause));
      } finally {
        setDetailLoading(false);
      }
    },
    [connection],
  );

  const loadConsumerLag = useCallback(
    async (groupId: string, topic: string) => {
      if (!connection) return;
      setConsumerLagLoading(true);
      try {
        setConsumerLag(
          await rocketMqService.getConsumerLag(connection.id, groupId, topic),
        );
      } catch (cause) {
        setConsumerLag(null);
        setError(failureMessage(cause));
      } finally {
        setConsumerLagLoading(false);
      }
    },
    [connection],
  );

  const loadConsumerGroupConfig = useCallback(
    async (groupId: string) => {
      if (!connection) return;
      setConsumerGroupConfigLoading(true);
      try {
        setConsumerGroupConfig(
          await rocketMqService.getConsumerGroupConfig(connection.id, groupId),
        );
      } catch (cause) {
        setConsumerGroupConfig(null);
        setError(failureMessage(cause));
      } finally {
        setConsumerGroupConfigLoading(false);
      }
    },
    [connection],
  );

  const loadTopic = useCallback(
    async (topic: string) => {
      if (!connection) return;
      setSelectedTopic(topic);
      setMessagePreview(null);
      setTopicConfig(null);
      setTopicStats(null);
      setTopicDetailLoading(true);
      try {
        setTopicDetail(await rocketMqService.getTopic(connection.id, topic));
      } catch (cause) {
        setTopicDetail(null);
        setError(failureMessage(cause));
      } finally {
        setTopicDetailLoading(false);
      }
    },
    [connection],
  );

  const peekTopicMessages = useCallback(
    async (topic: string) => {
      if (!connection) return;
      setMessagePreviewLoading(true);
      try {
        setMessagePreview(
          await rocketMqService.peekMessages(connection.id, topic, {
            limit: 20,
          }),
        );
      } catch (cause) {
        setMessagePreview(null);
        setError(failureMessage(cause));
      } finally {
        setMessagePreviewLoading(false);
      }
    },
    [connection],
  );

  const loadTopicConfig = useCallback(
    async (topic: string) => {
      if (!connection) return;
      setTopicConfigLoading(true);
      try {
        setTopicConfig(
          await rocketMqService.getTopicConfig(connection.id, topic),
        );
      } catch (cause) {
        setTopicConfig(null);
        setError(failureMessage(cause));
      } finally {
        setTopicConfigLoading(false);
      }
    },
    [connection],
  );

  const loadTopicStats = useCallback(
    async (topic: string) => {
      if (!connection) return;
      setTopicStatsLoading(true);
      try {
        setTopicStats(
          await rocketMqService.getTopicStats(connection.id, topic),
        );
      } catch (cause) {
        setTopicStats(null);
        setError(failureMessage(cause));
      } finally {
        setTopicStatsLoading(false);
      }
    },
    [connection],
  );

  const summary = useMemo(
    () => [
      { label: "Brokers", value: cluster?.nodeCount ?? "—" },
      { label: "Topics", value: topics?.total ?? "—" },
      { label: "Consumer groups", value: groups?.total ?? "—" },
    ],
    [cluster?.nodeCount, groups?.total, topics?.total],
  );

  return {
    section,
    setSection,
    cluster,
    topics,
    groups,
    acls,
    producers,
    selectedTopic,
    topicDetail,
    messagePreview,
    topicConfig,
    topicStats,
    selectedGroup,
    groupDetail,
    consumerLag,
    consumerGroupConfig,
    loading,
    detailLoading,
    consumerLagLoading,
    consumerGroupConfigLoading,
    topicDetailLoading,
    messagePreviewLoading,
    topicConfigLoading,
    topicStatsLoading,
    aclLoading,
    producersLoading,
    error,
    refresh,
    loadAcls,
    loadProducers,
    loadGroup,
    loadConsumerLag,
    loadConsumerGroupConfig,
    loadTopic,
    peekTopicMessages,
    loadTopicConfig,
    loadTopicStats,
    summary,
  };
}
