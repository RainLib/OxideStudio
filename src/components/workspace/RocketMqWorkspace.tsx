import { useRocketMqSession } from "@/features/mq/hooks/useRocketMqSession";
import { sections } from "@/features/mq/model/consolePresentation";
import { AclList } from "@/features/mq/ui/AclList";
import { ClusterOverview } from "@/features/mq/ui/ClusterOverview";
import { ConsumerGroups } from "@/features/mq/ui/ConsumerGroups";
import { ProducerList } from "@/features/mq/ui/ProducerList";
import { TopicList } from "@/features/mq/ui/TopicList";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { Boxes, CircleAlert, Loader2, RefreshCw } from "lucide-react";

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
  const {
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
  } = useRocketMqSession({
    connection,
  });

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
                  config={consumerGroupConfig}
                  configLoading={consumerGroupConfigLoading}
                  onLoadConfig={loadConsumerGroupConfig}
                />
              )}
              {section === "producers" && (
                <ProducerList
                  producers={producers}
                  loading={producersLoading}
                  onRefresh={loadProducers}
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
