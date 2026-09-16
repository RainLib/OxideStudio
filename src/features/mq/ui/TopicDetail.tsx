import { ResourceTable } from "@/features/mq/ui/ResourceTable";
import {
  type RocketMqMessagePreview,
  type RocketMqTopicConfig,
  type RocketMqTopicDetail,
  type RocketMqTopicStats,
} from "@/services/tauri/mq.service";
import { Loader2 } from "lucide-react";

export function TopicDetail({
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
