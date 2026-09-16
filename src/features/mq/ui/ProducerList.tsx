import { ResourceTable } from "@/features/mq/ui/ResourceTable";
import { cn } from "@/lib/utils";
import { type RocketMqProducers } from "@/services/tauri/mq.service";
import { Loader2, RefreshCw } from "lucide-react";

export function ProducerList({
  producers,
  loading,
  onRefresh,
}: {
  producers: RocketMqProducers | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Producers</h2>
          <p className="mt-1 max-w-2xl text-xs wb-muted">
            Live producer connections reported by reachable master brokers.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="flex h-7 shrink-0 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-50"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          Refresh producers
        </button>
      </div>
      {loading && !producers ? (
        <div className="flex h-24 items-center justify-center gap-2 text-xs wb-muted">
          <Loader2 size={14} className="animate-spin" /> Loading producers…
        </div>
      ) : (
        <>
          {producers?.unavailableBrokers.length ? (
            <div className="rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              Producer data was unavailable from:{" "}
              {producers.unavailableBrokers.join(", ")}
            </div>
          ) : null}
          {producers?.truncated ? (
            <div className="rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              Producer rows were capped at 2,000 to keep the Console responsive.
            </div>
          ) : null}
          <ResourceTable
            headers={["Group", "Client", "Host", "Broker", "Language"]}
            rows={(producers?.producers || []).map((producer) => [
              producer.groupId,
              producer.clientId,
              producer.host,
              producer.brokerName,
              producer.language || "—",
            ])}
            empty="No producer connections were reported by reachable masters."
          />
        </>
      )}
    </div>
  );
}
