import { SquarePen, X } from "lucide-react";
import { useI18n } from "@/i18n";
import type { ReactNode } from "react";

interface AssistantHeaderProps {
  isRunning: boolean;
  providerControl: ReactNode;
  historyControl?: ReactNode;
  onNewChat: () => void;
  onHide: () => void;
}

export function AssistantHeader({
  isRunning,
  providerControl,
  historyControl,
  onNewChat,
  onHide,
}: AssistantHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
      <div className="flex min-w-0 flex-1 items-center">{providerControl}</div>

      <div className="wb-tool-header-actions flex shrink-0 items-center gap-0.5">
        {historyControl}
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={onNewChat}
          disabled={isRunning}
          title={t("assistant.newChat")}
          aria-label={t("assistant.newChatAria")}
        >
          <SquarePen size={12} />
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={onHide}
          title="Hide Assistant"
          aria-label="Hide Assistant"
        >
          <X size={12} />
        </button>
      </div>
    </header>
  );
}
