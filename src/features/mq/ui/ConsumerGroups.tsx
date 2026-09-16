import { GroupDetail } from "@/features/mq/ui/GroupDetail";
import { cn } from "@/lib/utils";
import {
  type RocketMqConsumerGroupConfig,
  type RocketMqConsumerGroupDetail,
  type RocketMqConsumerGroups,
  type RocketMqConsumerLag,
} from "@/services/tauri/mq.service";
import { ChevronRight, Loader2, Users } from "lucide-react";

export function ConsumerGroups({
  groups,
  selectedGroup,
  detail,
  loading,
  onSelect,
  lag,
  lagLoading,
  onLoadLag,
  config,
  configLoading,
  onLoadConfig,
}: {
  groups: RocketMqConsumerGroups["groups"];
  selectedGroup: string | null;
  detail: RocketMqConsumerGroupDetail | null;
  loading: boolean;
  onSelect: (groupId: string) => void;
  lag: RocketMqConsumerLag | null;
  lagLoading: boolean;
  onLoadLag: (groupId: string, topic: string) => void;
  config: RocketMqConsumerGroupConfig | null;
  configLoading: boolean;
  onLoadConfig: (groupId: string) => void;
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
            config={config}
            configLoading={configLoading}
            onLoadConfig={onLoadConfig}
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
