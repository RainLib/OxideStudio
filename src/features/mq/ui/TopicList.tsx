import { TopicDetail } from "@/features/mq/ui/TopicDetail";
import { cn } from "@/lib/utils";
import {
  type RocketMqMessagePreview,
  type RocketMqTopicConfig,
  type RocketMqTopicDetail,
  type RocketMqTopicStats,
} from "@/services/tauri/mq.service";
import { Boxes, ChevronRight, Loader2 } from "lucide-react";

export function TopicList({
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
