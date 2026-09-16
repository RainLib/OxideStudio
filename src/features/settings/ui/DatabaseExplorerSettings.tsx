import {
  CheckboxLabel,
  SettingRow,
  SettingsDivider,
  SettingsPanel,
  selectClass,
} from "@/features/settings/ui/SettingsFields";
import { type AppSettings } from "@/lib/appSettings";

export function DatabaseExplorerSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const databaseExplorer = settings.databaseExplorer;
  const updateDatabaseExplorer = (
    patch: Partial<AppSettings["databaseExplorer"]>,
  ) => onUpdate({ databaseExplorer: { ...databaseExplorer, ...patch } });

  return (
    <SettingsPanel>
      <SettingsDivider title="Interaction" first />
      <SettingRow label="Open table and collection data:">
        <select
          className={selectClass}
          value={databaseExplorer.activationMode}
          onChange={(event) =>
            updateDatabaseExplorer({
              activationMode: event.target
                .value as AppSettings["databaseExplorer"]["activationMode"],
            })
          }
        >
          <option value="single">Single click</option>
          <option value="double">Double click</option>
        </select>
      </SettingRow>
      <p className="px-0.5 text-[10px] leading-4 wb-muted">
        Selection remains immediate. Enter always opens the focused object.
      </p>
      <SettingsDivider title="Introspection" />
      <SettingRow label="Refresh mode:">
        <select
          className={selectClass}
          value={databaseExplorer.refreshMode}
          onChange={(event) =>
            updateDatabaseExplorer({
              refreshMode: event.target
                .value as AppSettings["databaseExplorer"]["refreshMode"],
            })
          }
        >
          <option value="cache-first">Use local cache first</option>
          <option value="manual">Manual refresh only</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Show only selected schemas"
        checked={databaseExplorer.showOnlySelectedSchemas}
        onChange={() =>
          updateDatabaseExplorer({
            showOnlySelectedSchemas: !databaseExplorer.showOnlySelectedSchemas,
          })
        }
      />
      <CheckboxLabel
        label="Show metadata cache badges"
        checked={databaseExplorer.showCacheBadges}
        onChange={() =>
          updateDatabaseExplorer({
            showCacheBadges: !databaseExplorer.showCacheBadges,
          })
        }
      />
      <CheckboxLabel
        label="Show connection notes"
        detail="Display saved connection notes beside connection names."
        checked={databaseExplorer.showConnectionNotes}
        onChange={() =>
          updateDatabaseExplorer({
            showConnectionNotes: !databaseExplorer.showConnectionNotes,
          })
        }
      />
      <CheckboxLabel
        label="Show object hover tooltips"
        detail="Show connection and database-object details on hover. Turning this off also skips tooltip-only presentation work."
        checked={databaseExplorer.showHoverTooltips}
        onChange={() =>
          updateDatabaseExplorer({
            showHoverTooltips: !databaseExplorer.showHoverTooltips,
          })
        }
      />
      <CheckboxLabel
        label="Allow horizontal tree scrolling"
        detail="Use natural-width object labels and comments instead of truncating them to the panel width."
        checked={databaseExplorer.allowHorizontalScroll}
        onChange={() =>
          updateDatabaseExplorer({
            allowHorizontalScroll: !databaseExplorer.allowHorizontalScroll,
          })
        }
      />
    </SettingsPanel>
  );
}
