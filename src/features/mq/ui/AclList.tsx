import { ResourceTable } from "@/features/mq/ui/ResourceTable";
import { cn } from "@/lib/utils";
import { type RocketMqAcls } from "@/services/tauri/mq.service";
import { Loader2, RefreshCw } from "lucide-react";

export function AclList({
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
