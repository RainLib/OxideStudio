import { ResourceTable } from "@/features/mq/ui/ResourceTable";
import { type RocketMqCluster } from "@/services/tauri/mq.service";

export function ClusterOverview({
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
