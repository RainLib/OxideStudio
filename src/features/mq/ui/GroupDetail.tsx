import { ResourceTable } from "@/features/mq/ui/ResourceTable";
import {
  type RocketMqConsumerGroupConfig,
  type RocketMqConsumerGroupDetail,
  type RocketMqConsumerLag,
} from "@/services/tauri/mq.service";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export function GroupDetail({
  detail,
  lag,
  lagLoading,
  onLoadLag,
  config,
  configLoading,
  onLoadConfig,
}: {
  detail: RocketMqConsumerGroupDetail;
  lag: RocketMqConsumerLag | null;
  lagLoading: boolean;
  onLoadLag: (groupId: string, topic: string) => void;
  config: RocketMqConsumerGroupConfig | null;
  configLoading: boolean;
  onLoadConfig: (groupId: string) => void;
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
          <h3 className="text-xs font-medium">Group configuration</h3>
          <button
            type="button"
            disabled={configLoading}
            onClick={() => void onLoadConfig(detail.groupId)}
            className="flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
          >
            {configLoading && <Loader2 size={12} className="animate-spin" />}
            Load config
          </button>
        </div>
        {config ? (
          <>
            {config.unavailableBrokers.length ? (
              <div className="mb-2 rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Configuration was unavailable from:{" "}
                {config.unavailableBrokers.join(", ")}
              </div>
            ) : null}
            <ResourceTable
              headers={[
                "Broker",
                "Enabled",
                "Retries",
                "Retry max",
                "Broadcast",
              ]}
              rows={config.configs.map((item) => [
                item.brokerName,
                item.consumeEnabled ? "Yes" : "No",
                String(item.retryQueueNums),
                String(item.retryMaxTimes),
                item.consumeBroadcastEnabled ? "Yes" : "No",
              ])}
              empty="No master broker returned this group configuration."
            />
          </>
        ) : (
          <div className="rounded-[5px] border border-dashed border-[hsl(var(--wb-border-subtle))] p-3 text-xs wb-muted">
            Configuration is queried per master broker so drift stays visible.
          </div>
        )}
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
