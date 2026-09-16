import {
  CheckboxLabel,
  NumberInput,
  selectClass,
  SettingRow,
  SettingsDivider,
  SettingsPanel,
} from "@/features/settings/ui/SettingsFields";
import { type AppSettings, type WorkbenchSide } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import {
  closeSideToolWindow,
  moveSideToolWindow,
  openSideToolWindow,
} from "@/lib/workbenchLayout";

export function WorkbenchSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const { layout, toolWindows } = settings.workbench;
  const updateLayout = (patch: Partial<AppSettings["workbench"]["layout"]>) =>
    onUpdate({
      workbench: { ...settings.workbench, layout: { ...layout, ...patch } },
    });
  const updateToolWindowEnabled = (
    id: keyof AppSettings["workbench"]["toolWindows"],
    enabled: boolean,
  ) =>
    onUpdate({
      workbench: {
        ...settings.workbench,
        layout: {
          ...layout,
          pinnedTitleTools: enabled
            ? layout.pinnedTitleTools
            : layout.pinnedTitleTools.filter((candidate) => candidate !== id),
        },
        toolWindows: {
          ...toolWindows,
          [id]: { ...toolWindows[id], enabled },
        },
      },
    });
  const updateSideToolOpen = (
    id:
      | "databaseExplorer"
      | "projectFiles"
      | "sqlLibrary"
      | "assistant"
      | "commit"
      | "versionControl",
    visible: boolean,
  ) =>
    onUpdate({
      workbench: visible
        ? openSideToolWindow(settings.workbench, id)
        : closeSideToolWindow(settings.workbench, id),
    });
  const updateVisibility = (
    id: keyof AppSettings["workbench"]["layout"]["visibility"],
    visible: boolean,
  ) =>
    updateLayout({
      visibility: { ...layout.visibility, [id]: visible },
    });
  const updateSide = (
    id:
      | "databaseExplorer"
      | "projectFiles"
      | "sqlLibrary"
      | "assistant"
      | "commit"
      | "versionControl",
    side: WorkbenchSide,
  ) =>
    onUpdate({ workbench: moveSideToolWindow(settings.workbench, id, side) });

  return (
    <SettingsPanel>
      <SettingsDivider title="Tool Windows" first />
      {(
        [
          ["databaseExplorer", "Database Explorer"],
          ["projectFiles", "Project Files"],
          ["sqlLibrary", "SQL Library"],
          ["assistant", "AI Assistant"],
          ["commit", "Commit"],
          ["versionControl", "Version Control"],
        ] as const
      ).map(([id, label]) => (
        <SettingRow key={id} label={`${label}:`}>
          <CheckboxLabel
            label="Enabled"
            checked={toolWindows[id].enabled}
            onChange={() =>
              updateToolWindowEnabled(id, !toolWindows[id].enabled)
            }
          />
          <CheckboxLabel
            label="Open"
            checked={layout.visibility[id]}
            onChange={() => updateSideToolOpen(id, !layout.visibility[id])}
          />
          <select
            className={cn(selectClass, "w-[120px]")}
            value={toolWindows[id].side}
            onChange={(event) =>
              updateSide(id, event.target.value as WorkbenchSide)
            }
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </SettingRow>
      ))}
      <SettingRow label="Query Results:">
        <CheckboxLabel
          label="Enabled"
          checked={toolWindows.results.enabled}
          onChange={() =>
            updateToolWindowEnabled("results", !toolWindows.results.enabled)
          }
        />
        <CheckboxLabel
          label="Open after execution"
          checked={layout.visibility.results}
          onChange={() =>
            updateVisibility("results", !layout.visibility.results)
          }
        />
        <span className="settings-hint">Bottom</span>
      </SettingRow>

      <SettingsDivider title="Sizes" />
      <SettingRow label="Left width:">
        <NumberInput
          value={layout.leftWidth}
          min={240}
          max={760}
          onChange={(leftWidth) => updateLayout({ leftWidth })}
        />
        <span className="settings-hint">Database Explorer</span>
      </SettingRow>
      <SettingRow label="Right width:">
        <NumberInput
          value={layout.rightWidth}
          min={260}
          max={640}
          onChange={(rightWidth) => updateLayout({ rightWidth })}
        />
        <span className="settings-hint">Assistant, SQL Library and Files</span>
      </SettingRow>
      <SettingRow label="Bottom height:">
        <NumberInput
          value={layout.bottomHeight}
          min={140}
          max={720}
          onChange={(bottomHeight) => updateLayout({ bottomHeight })}
        />
        <span className="settings-hint">Query results</span>
      </SettingRow>
    </SettingsPanel>
  );
}
