import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  rocketMqService,
  type RocketMqCluster,
  type RocketMqAcls,
  type RocketMqConsumerGroupDetail,
  type RocketMqConsumerGroups,
  type RocketMqConsumerLag,
  type RocketMqMessagePreview,
  type RocketMqTopicConfig,
  type RocketMqTopicDetail,
  type RocketMqTopicStats,
  type RocketMqTopics,
} from "@/services/tauri/mq.service";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";

type ConsoleSection = "overview" | "topics" | "groups" | "acl";

const sections: Array<{ id: ConsoleSection; label: string }> = [
  { id: "overview", label: "Cluster" },
  { id: "topics", label: "Topics" },
  { id: "groups", label: "Consumer groups" },
  { id: "acl", label: "Access control" },
];

function failureMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The first native RocketMQ work surface.  It intentionally uses the dedicated
 * Agent API instead of pretending RocketMQ objects are relational schemas.
 */
export function RocketMqWorkspace() {
  const activeTab = useTabStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const connection = useConnectionStore((state) =>
    state.connections.find(
      (candidate) => candidate.id === activeTab?.connectionId,
    ),
  );
  const [section, setSection] = useState<ConsoleSection>("overview");
  const [cluster, setCluster] = useState<RocketMqCluster | null>(null);
  const [topics, setTopics] = useState<RocketMqTopics | null>(null);
  const [groups, setGroups] = useState<RocketMqConsumerGroups | null>(null);
  const [acls, setAcls] = useState<RocketMqAcls | null>(null);
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
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [consumerLagLoading, setConsumerLagLoading] = useState(false);
  const [topicDetailLoading, setTopicDetailLoading] = useState(false);
  const [messagePreviewLoading, setMessagePreviewLoading] = useState(false);
  const [topicConfigLoading, setTopicConfigLoading] = useState(false);
  const [topicStatsLoading, setTopicStatsLoading] = useState(false);
  const [aclLoading, setAclLoading] = useState(false);
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
    setSelectedTopic(null);
    setTopicDetail(null);
    setMessagePreview(null);
    setTopicConfig(null);
    setTopicStats(null);
    setAcls(null);
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

  const loadGroup = useCallback(
    async (groupId: string) => {
      if (!connection) return;
      setSelectedGroup(groupId);
      setConsumerLag(null);
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

  if (!connection || connection.driver.toLowerCase() !== "rocketmq") {
    return (
      <div className="flex h-full items-center justify-center text-xs wb-muted">
        RocketMQ connection is no longer available.
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
        <Boxes size={16} className="text-orange-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{connection.name}</div>
          <div className="truncate text-[10px] wb-muted">
            RocketMQ Console · native Agent session
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
          title="Refresh RocketMQ resources"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />{" "}
          Refresh
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "flex h-8 w-full items-center rounded-[4px] px-2 text-left text-xs",
                section === item.id
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "wb-muted hover:bg-[hsl(var(--wb-hover))]",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              <CircleAlert size={15} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">
                  RocketMQ session is unavailable
                </div>
                <div className="mt-1 opacity-80">{error}</div>
              </div>
            </div>
          )}
          {loading && !error ? (
            <div className="flex h-32 items-center justify-center gap-2 text-xs wb-muted">
              <Loader2 size={15} className="animate-spin" /> Loading cluster
              resources…
            </div>
          ) : (
            <>
              {section === "overview" && (
                <ClusterOverview cluster={cluster} summary={summary} />
              )}
              {section === "topics" && (
                <TopicList
                  topics={topics?.topics || []}
                  selectedTopic={selectedTopic}
                  detail={topicDetail}
                  loading={topicDetailLoading}
                  onSelect={loadTopic}
                  messagePreview={messagePreview}
                  messagePreviewLoading={messagePreviewLoading}
                  onPeekMessages={peekTopicMessages}
                  topicConfig={topicConfig}
                  topicConfigLoading={topicConfigLoading}
                  onLoadTopicConfig={loadTopicConfig}
                  topicStats={topicStats}
                  topicStatsLoading={topicStatsLoading}
                  onLoadTopicStats={loadTopicStats}
                />
              )}
              {section === "groups" && (
                <ConsumerGroups
                  groups={groups?.groups || []}
                  selectedGroup={selectedGroup}
                  detail={groupDetail}
                  loading={detailLoading}
                  onSelect={loadGroup}
                  lag={consumerLag}
                  lagLoading={consumerLagLoading}
                  onLoadLag={loadConsumerLag}
                />
              )}
              {section === "acl" && (
                <AclList
                  acls={acls}
                  loading={aclLoading}
                  onRefresh={loadAcls}
                />
              )}
            </>
          )}
        </main>
      </div>
    </section>
  );
}

function AclList({
  acls,
  loading,
  onRefresh,
}: {
  acls: RocketMqAcls | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const policies = (acls?.acls || []).flatMap((acl) =>
    acl.policies.map((policy) => ({ ...policy, principal: acl.principal })),
  );
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Access control</h2>
          <p className="mt-1 max-w-2xl text-xs wb-muted">
            ACLs are read from every reachable master broker. Source brokers
            remain visible so inconsistent policies are not hidden.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="flex h-7 shrink-0 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          Refresh ACLs
        </button>
      </div>
      {loading && !acls ? (
        <div className="flex h-24 items-center justify-center gap-2 text-xs wb-muted">
          <Loader2 size={14} className="animate-spin" /> Loading ACLs…
        </div>
      ) : (
        <>
          {acls?.unavailableBrokers.length ? (
            <div className="rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              ACL data was unavailable from:{" "}
              {acls.unavailableBrokers.join(", ")}
            </div>
          ) : null}
          <ResourceTable
            headers={[
              "Principal",
              "Broker",
              "Resource",
              "Actions",
              "Effect",
              "Source IPs",
            ]}
            rows={policies.map((policy) => [
              policy.principal,
              policy.brokerName,
              policy.resource,
              policy.actions.join(", "),
              policy.effect,
              policy.sourceIps.join(", "),
            ])}
            empty="No ACL policies were reported by reachable master brokers."
          />
          <p className="text-[11px] wb-muted">
            ACL mutations remain unavailable until a dedicated desktop approval
            boundary is implemented.
          </p>
        </>
      )}
    </div>
  );
}

function ClusterOverview({
  cluster,
  summary,
}: {
  cluster: RocketMqCluster | null;
  summary: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Cluster overview</h2>
        <p className="mt-1 text-xs wb-muted">
          Live resources reported by the connected RocketMQ NameServer.
        </p>
      </div>
      <div className="grid max-w-2xl grid-cols-3 gap-3">
        {summary.map((item) => (
          <div
            key={item.label}
            className="rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-3"
          >
            <div className="text-[11px] wb-muted">{item.label}</div>
            <div className="mt-1 text-lg font-semibold">{item.value}</div>
          </div>
        ))}
      </div>
      <ResourceTable
        headers={["Broker", "ID", "Address", "Role"]}
        rows={(cluster?.brokers || []).map((broker) => [
          broker.brokerName,
          broker.brokerId,
          broker.address,
          broker.role,
        ])}
        empty="No brokers reported by the cluster."
      />
    </div>
  );
}

function TopicList({
  topics,
  selectedTopic,
  detail,
  loading,
  onSelect,
  messagePreview,
  messagePreviewLoading,
  onPeekMessages,
  topicConfig,
  topicConfigLoading,
  onLoadTopicConfig,
  topicStats,
  topicStatsLoading,
  onLoadTopicStats,
}: {
  topics: string[];
  selectedTopic: string | null;
  detail: RocketMqTopicDetail | null;
  loading: boolean;
  onSelect: (topic: string) => void;
  messagePreview: RocketMqMessagePreview | null;
  messagePreviewLoading: boolean;
  onPeekMessages: (topic: string) => void;
  topicConfig: RocketMqTopicConfig | null;
  topicConfigLoading: boolean;
  onLoadTopicConfig: (topic: string) => void;
  topicStats: RocketMqTopicStats | null;
  topicStatsLoading: boolean;
  onLoadTopicStats: (topic: string) => void;
}) {
  return (
    <div className="grid min-h-[300px] grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.2fr)] gap-4">
      <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))]">
        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-xs font-medium">
          Topics
        </div>
        {topics.length ? (
          topics.map((topic) => (
            <button
              type="button"
              key={topic}
              onClick={() => void onSelect(topic)}
              className={cn(
                "flex w-full items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left text-xs last:border-0 hover:bg-[hsl(var(--wb-hover))]",
                selectedTopic === topic && "bg-[hsl(var(--wb-active-strong))]",
              )}
            >
              <span className="truncate font-medium">{topic}</span>
              <ChevronRight size={13} className="shrink-0 wb-muted" />
            </button>
          ))
        ) : (
          <div className="p-3 text-xs wb-muted">No topics reported.</div>
        )}
      </div>
      <div className="rounded-[5px] border border-[hsl(var(--wb-border-subtle))] p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs wb-muted">
            <Loader2 size={14} className="animate-spin" /> Loading topic route…
          </div>
        ) : detail ? (
          <TopicDetail
            detail={detail}
            messagePreview={messagePreview}
            messagePreviewLoading={messagePreviewLoading}
            onPeekMessages={onPeekMessages}
            topicConfig={topicConfig}
            topicConfigLoading={topicConfigLoading}
            onLoadTopicConfig={onLoadTopicConfig}
            topicStats={topicStats}
            topicStatsLoading={topicStatsLoading}
            onLoadTopicStats={onLoadTopicStats}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs wb-muted">
            <Boxes size={14} className="mr-2" /> Select a topic for live route
            and partition details.
          </div>
        )}
      </div>
    </div>
  );
}

function TopicDetail({
  detail,
  messagePreview,
  messagePreviewLoading,
  onPeekMessages,
  topicConfig,
  topicConfigLoading,
  onLoadTopicConfig,
  topicStats,
  topicStatsLoading,
  onLoadTopicStats,
}: {
  detail: RocketMqTopicDetail;
  messagePreview: RocketMqMessagePreview | null;
  messagePreviewLoading: boolean;
  onPeekMessages: (topic: string) => void;
  topicConfig: RocketMqTopicConfig | null;
  topicConfigLoading: boolean;
  onLoadTopicConfig: (topic: string) => void;
  topicStats: RocketMqTopicStats | null;
  topicStatsLoading: boolean;
  onLoadTopicStats: (topic: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{detail.topic}</h2>
        <p className="mt-1 text-[11px] wb-muted">
          Route, configuration, offsets, and bounded message preview are live.
          Topic mutations remain unavailable until their confirmation boundary
          is implemented.
        </p>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">Topic statistics</h3>
          <button
            type="button"
            disabled={topicStatsLoading}
            onClick={() => void onLoadTopicStats(detail.topic)}
            className="flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
          >
            {topicStatsLoading && (
              <Loader2 size={12} className="animate-spin" />
            )}{" "}
            Load offsets
          </button>
        </div>
        {topicStats ? (
          <>
            <div className="mb-2 text-[11px] wb-muted">
              {topicStats.totalMessages.toLocaleString()} messages across{" "}
              {topicStats.partitions.length} partitions
            </div>
            <ResourceTable
              headers={["Broker", "Partition", "Begin", "End", "Messages"]}
              rows={topicStats.partitions.map((partition) => [
                partition.brokerName,
                String(partition.partition),
                String(partition.beginOffset),
                String(partition.endOffset),
                String(partition.messageCount),
              ])}
              empty="No readable partitions were reported."
            />
          </>
        ) : (
          <div className="rounded-[5px] border border-dashed border-[hsl(var(--wb-border-subtle))] p-3 text-xs wb-muted">
            Reads bounded per-partition offsets only; it does not create a
            consumer or commit offsets.
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">Queues by broker</h3>
        <ResourceTable
          headers={["Broker", "Read queues", "Write queues", "Permission"]}
          rows={detail.queueDatas.map((queue) => [
            queue.brokerName,
            String(queue.readQueueNums),
            String(queue.writeQueueNums),
            String(queue.perm),
          ])}
          empty="No queue routes reported."
        />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">Broker route</h3>
        <ResourceTable
          headers={["Broker", "Cluster", "Addresses"]}
          rows={detail.brokerDatas.map((broker) => [
            broker.brokerName,
            broker.cluster,
            Object.entries(broker.brokerAddrs)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([id, address]) => `${id}: ${address}`)
              .join(", "),
          ])}
          empty="No broker routes reported."
        />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">Topic configuration</h3>
          <button
            type="button"
            disabled={topicConfigLoading}
            onClick={() => void onLoadTopicConfig(detail.topic)}
            className="flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
          >
            {topicConfigLoading && (
              <Loader2 size={12} className="animate-spin" />
            )}{" "}
            Load config
          </button>
        </div>
        {topicConfig ? (
          <ResourceTable
            headers={["Broker", "Read", "Write", "Permission"]}
            rows={topicConfig.configs.map((config) => [
              config.brokerName,
              String(config.readQueueNums),
              String(config.writeQueueNums),
              String(config.perm),
            ])}
            empty="No master broker returned a topic configuration."
          />
        ) : (
          <div className="rounded-[5px] border border-dashed border-[hsl(var(--wb-border-subtle))] p-3 text-xs wb-muted">
            Configuration is queried per master broker so drift stays visible.
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">Message preview</h3>
          <button
            type="button"
            disabled={messagePreviewLoading}
            onClick={() => void onPeekMessages(detail.topic)}
            className="flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
          >
            {messagePreviewLoading && (
              <Loader2 size={12} className="animate-spin" />
            )}
            Preview earliest 20
          </button>
        </div>
        {messagePreview ? (
          <ResourceTable
            headers={["Partition", "Offset", "Key", "Payload"]}
            rows={messagePreview.messages.map((message) => [
              String(message.partition),
              String(message.offset),
              message.key || "—",
              message.payloadText || "Binary payload",
            ])}
            empty="No messages available at the selected queue offsets."
          />
        ) : (
          <div className="rounded-[5px] border border-dashed border-[hsl(var(--wb-border-subtle))] p-3 text-xs wb-muted">
            Reads are bounded to 20 messages and 64 KiB per message; no consumer
            group is created and no offset is committed.
          </div>
        )}
      </div>
    </div>
  );
}

function ConsumerGroups({
  groups,
  selectedGroup,
  detail,
  loading,
  onSelect,
  lag,
  lagLoading,
  onLoadLag,
}: {
  groups: RocketMqConsumerGroups["groups"];
  selectedGroup: string | null;
  detail: RocketMqConsumerGroupDetail | null;
  loading: boolean;
  onSelect: (groupId: string) => void;
  lag: RocketMqConsumerLag | null;
  lagLoading: boolean;
  onLoadLag: (groupId: string, topic: string) => void;
}) {
  return (
    <div className="grid min-h-[300px] grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.2fr)] gap-4">
      <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))]">
        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-xs font-medium">
          Consumer groups
        </div>
        {groups.length ? (
          groups.map((group) => (
            <button
              type="button"
              key={group.groupId}
              onClick={() => void onSelect(group.groupId)}
              className={cn(
                "flex w-full items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left text-xs last:border-0 hover:bg-[hsl(var(--wb-hover))]",
                selectedGroup === group.groupId &&
                  "bg-[hsl(var(--wb-active-strong))]",
              )}
            >
              <span className="truncate font-medium">{group.groupId}</span>
              <ChevronRight size={13} className="shrink-0 wb-muted" />
            </button>
          ))
        ) : (
          <div className="p-3 text-xs wb-muted">
            No consumer groups reported.
          </div>
        )}
      </div>
      <div className="rounded-[5px] border border-[hsl(var(--wb-border-subtle))] p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs wb-muted">
            <Loader2 size={14} className="animate-spin" /> Loading group
            details…
          </div>
        ) : detail ? (
          <GroupDetail
            detail={detail}
            lag={lag}
            lagLoading={lagLoading}
            onLoadLag={onLoadLag}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs wb-muted">
            <Users size={14} className="mr-2" /> Select a consumer group for
            live members and subscriptions.
          </div>
        )}
      </div>
    </div>
  );
}

function GroupDetail({
  detail,
  lag,
  lagLoading,
  onLoadLag,
}: {
  detail: RocketMqConsumerGroupDetail;
  lag: RocketMqConsumerLag | null;
  lagLoading: boolean;
  onLoadLag: (groupId: string, topic: string) => void;
}) {
  const [lagTopic, setLagTopic] = useState("");
  useEffect(() => {
    setLagTopic(detail.assignments[0]?.topic || "");
  }, [detail.assignments, detail.groupId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{detail.groupId}</h2>
        <div className="mt-1 flex gap-3 text-[11px] wb-muted">
          <span>{detail.state}</span>
          <span>{detail.messageModel || "model unavailable"}</span>
          <span>{detail.members.length} active members</span>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">Consumer lag</h3>
          <div className="flex items-center gap-2">
            <select
              value={lagTopic}
              onChange={(event) => setLagTopic(event.target.value)}
              disabled={detail.assignments.length === 0 || lagLoading}
              className="h-7 max-w-48 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 text-[11px] disabled:opacity-50"
              aria-label="RocketMQ lag topic"
            >
              {detail.assignments.length === 0 ? (
                <option value="">No subscribed topic</option>
              ) : (
                detail.assignments.map((assignment) => (
                  <option key={assignment.topic} value={assignment.topic}>
                    {assignment.topic}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              disabled={!lagTopic || lagLoading}
              onClick={() => void onLoadLag(detail.groupId, lagTopic)}
              className="flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
            >
              {lagLoading && <Loader2 size={12} className="animate-spin" />}
              Load lag
            </button>
          </div>
        </div>
        {lag ? (
          <>
            <div className="mb-2 text-[11px] wb-muted">
              {lag.totalLag.toLocaleString()} messages behind on {lag.topic}
            </div>
            <ResourceTable
              headers={["Broker", "Partition", "Current", "End", "Lag"]}
              rows={lag.partitions.map((partition) => [
                partition.brokerName,
                String(partition.partition),
                String(partition.currentOffset),
                String(partition.endOffset),
                String(partition.lag),
              ])}
              empty="No consumer offsets were reported for this topic."
            />
          </>
        ) : (
          <div className="rounded-[5px] border border-dashed border-[hsl(var(--wb-border-subtle))] p-3 text-xs wb-muted">
            Read-only offset snapshot. Resetting offsets remains unavailable
            until a dedicated approval boundary is implemented.
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">Subscriptions</h3>
        <ResourceTable
          headers={["Topic", "Expression", "Type"]}
          rows={detail.assignments.map((item) => [
            item.topic,
            item.subExpression || "*",
            item.expressionType || "TAG",
          ])}
          empty="No live subscriptions reported."
        />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">Members</h3>
        <ResourceTable
          headers={["Client", "Host", "Language"]}
          rows={detail.members.map((member) => [
            member.clientId,
            member.host,
            member.language || "—",
          ])}
          empty="No active consumers are connected."
        />
      </div>
    </div>
  );
}

function ResourceTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))]">
      <div
        className="grid bg-[hsl(var(--wb-toolbar))] text-[10px] font-medium uppercase tracking-wide wb-muted"
        style={{
          gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))`,
        }}
      >
        {headers.map((header) => (
          <div key={header} className="px-3 py-2">
            {header}
          </div>
        ))}
      </div>
      {rows.length ? (
        rows.map((row, index) => (
          <div
            key={`${row.join("-")}-${index}`}
            className="grid border-t border-[hsl(var(--wb-border-subtle))] text-xs"
            style={{
              gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))`,
            }}
          >
            {row.map((cell, cellIndex) => (
              <div
                key={`${cell}-${cellIndex}`}
                className="truncate px-3 py-2"
                title={cell}
              >
                {cell || "—"}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="p-3 text-xs wb-muted">{empty}</div>
      )}
    </div>
  );
}
