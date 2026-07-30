import { Sparkles, SquarePen } from "lucide-react";
import { useI18n } from "@/i18n";

interface AssistantHeaderProps {
  isRunning: boolean;
  onNewChat: () => void;
}

export function AssistantHeader({
  isRunning,
  onNewChat,
}: AssistantHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Sparkles
          size={14}
          className="shrink-0 text-[hsl(var(--wb-accent))]"
        />
        <span className="truncate text-[11px] font-semibold text-[hsl(var(--wb-text))]">
          {t("assistant.title")}
        </span>
      </div>

      <button
        type="button"
        className="wb-tool-header-actions wb-icon-button h-6 w-6"
        onClick={onNewChat}
        disabled={isRunning}
        title={t("assistant.newChat")}
        aria-label={t("assistant.newChatAria")}
      >
        <SquarePen size={12} />
      </button>
    </header>
  );
}
