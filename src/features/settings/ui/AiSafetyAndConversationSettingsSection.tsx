import {
  SettingRow,
  SettingsButton,
  SettingsDivider,
} from "@/features/settings/ui/SettingsFields";
import type { AiSettingsProps } from "@/features/settings/ui/aiSettingsTypes";
import { findWorkbenchAction } from "@/lib/actions";
import { cn } from "@/lib/utils";

interface AiSafetyAndConversationSettingsSectionProps {
  settings: AiSettingsProps["settings"];
  activeProjectName: string;
  isClearingAgentState: boolean;
  agentStateMessage: AiSettingsProps["agentStateMessage"];
  onClearAgentState: () => void;
}

/** Shell-command policy visibility and project-scoped conversation cleanup. */
export function AiSafetyAndConversationSettingsSection({
  settings,
  activeProjectName,
  isClearingAgentState,
  agentStateMessage,
  onClearAgentState,
}: AiSafetyAndConversationSettingsSectionProps) {
  return (
    <>
      <SettingsDivider title="Shell Safety" />
      <p className="mb-3 max-w-[68ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Every Agent shell command is inspected before approval and rechecked in
        the Rust host before execution. Destructive commands are blocked or
        require an exact one-time confirmation phrase.
      </p>
      <SettingRow label="Global rules:">
        <div className="flex items-center gap-2">
          <span className="settings-hint">
            {settings.ai.shell.commandPolicy.rules.length} configured
          </span>
          <SettingsButton
            onClick={() => void findWorkbenchAction("settings.openJson")?.run()}
          >
            Open settings JSON
          </SettingsButton>
        </div>
      </SettingRow>
      <p className="-mt-1 mb-3 ml-[148px] max-w-[68ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Project-specific rules may be added at .oxide/command-policy.json. Rules
        may only increase protection with confirm or block actions.
      </p>

      <SettingsDivider title="Conversation Data" />
      <p className="mb-3 max-w-[68ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Encrypted conversations, checkpoints, and bounded artifacts for the
        current project are retained for 7 days. Database credentials and raw
        result sets are never stored in this history.
      </p>
      <div className="flex items-center gap-3">
        <SettingsButton
          onClick={onClearAgentState}
          disabled={isClearingAgentState}
        >
          {isClearingAgentState
            ? "Clearing..."
            : `Clear data for ${activeProjectName}`}
        </SettingsButton>
        {agentStateMessage && (
          <span
            className={cn(
              "text-[12px]",
              agentStateMessage.status === "success"
                ? "text-emerald-400"
                : "text-[hsl(var(--destructive))]",
            )}
          >
            {agentStateMessage.message}
          </span>
        )}
      </div>
    </>
  );
}
