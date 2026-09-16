import { Switch } from "@/components/ui/switch";
import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/useSettingsStore";

interface ConnectionNotesFieldProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  showConnectionNotes: boolean;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

/** Connection-local notes and the Explorer presentation preference. */
export function ConnectionNotesField({
  selectedConnection,
  updateField,
  showConnectionNotes,
  updateSettings,
}: ConnectionNotesFieldProps) {
  return (
    <>
      <label className={labelClass} htmlFor="connection-note">
        Note
      </label>
      <div className="min-w-0 space-y-1.5">
        <textarea
          id="connection-note"
          value={selectedConnection.note || ""}
          onChange={(event) => updateField("note", event.target.value)}
          className={cn(fieldClass, "min-h-[56px] resize-y py-1.5 leading-4")}
          rows={2}
          maxLength={2_000}
          placeholder="Purpose, owner, runbook, or other context for this data source"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] leading-4 wb-muted">
            Notes are searchable and can be shown beside the connection in Explorer.
          </span>
          <label className="flex shrink-0 items-center gap-2 text-[10px] wb-muted">
            Show in Explorer
            <Switch
              checked={showConnectionNotes}
              onCheckedChange={(checked) =>
                void updateSettings({
                  databaseExplorer: {
                    ...useSettingsStore.getState().settings.databaseExplorer,
                    showConnectionNotes: checked,
                  },
                })
              }
              className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
              aria-label="Show connection notes in Database Explorer"
            />
          </label>
        </div>
      </div>
    </>
  );
}
