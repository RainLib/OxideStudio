import {
  CheckboxLabel,
  NumberInput,
  selectClass,
  SettingRow,
  SettingsDivider,
  SettingsPanel,
} from "@/features/settings/ui/SettingsFields";
import { type AppSettings } from "@/lib/appSettings";

export function DataEditorSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const dataGrid = settings.dataGrid;
  const updateDataGrid = (patch: Partial<AppSettings["dataGrid"]>) =>
    onUpdate({ dataGrid: { ...dataGrid, ...patch } });

  return (
    <SettingsPanel>
      <SettingsDivider title="Data Grid" first />
      <SettingRow label="Font size:">
        <NumberInput
          value={dataGrid.fontSize}
          min={10}
          max={20}
          onChange={(fontSize) => updateDataGrid({ fontSize })}
        />
      </SettingRow>
      <SettingRow label="Row height:">
        <NumberInput
          value={dataGrid.rowHeight}
          min={22}
          max={48}
          onChange={(rowHeight) => updateDataGrid({ rowHeight })}
        />
      </SettingRow>
      <SettingRow label="Default zoom:">
        <NumberInput
          value={dataGrid.zoomPercent}
          min={70}
          max={160}
          step={10}
          onChange={(zoomPercent) => updateDataGrid({ zoomPercent })}
        />
        <span className="settings-hint">Percent</span>
      </SettingRow>
      <SettingRow label="Default page size:">
        <NumberInput
          value={dataGrid.pageSize}
          min={50}
          max={5000}
          onChange={(pageSize) => updateDataGrid({ pageSize })}
        />
      </SettingRow>
      <SettingRow label="Table tab reuse:">
        <select
          className={selectClass}
          value={dataGrid.tableTabReuseMode}
          onChange={(event) =>
            updateDataGrid({
              tableTabReuseMode: event.target
                .value as AppSettings["dataGrid"]["tableTabReuseMode"],
            })
          }
        >
          <option value="same-table">Reuse the same table</option>
          <option value="always-new">Always open a new tab</option>
          <option value="active-tab">Reuse the active clean table tab</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Open table data read-only by default"
        checked={dataGrid.readOnlyByDefault}
        onChange={() =>
          updateDataGrid({ readOnlyByDefault: !dataGrid.readOnlyByDefault })
        }
      />
      <CheckboxLabel
        label="Copy selected cells with headers"
        checked={dataGrid.copyIncludeHeaders}
        onChange={() =>
          updateDataGrid({ copyIncludeHeaders: !dataGrid.copyIncludeHeaders })
        }
      />
      <CheckboxLabel
        label="Show column type icons"
        checked={dataGrid.showTypeIcons}
        onChange={() =>
          updateDataGrid({ showTypeIcons: !dataGrid.showTypeIcons })
        }
      />
      <CheckboxLabel
        label="Show column types in headers"
        checked={dataGrid.showColumnTypesInHeader}
        onChange={() =>
          updateDataGrid({
            showColumnTypesInHeader: !dataGrid.showColumnTypesInHeader,
          })
        }
      />
      <CheckboxLabel
        label="Show column comments in headers"
        checked={dataGrid.showColumnCommentsInHeader}
        onChange={() =>
          updateDataGrid({
            showColumnCommentsInHeader: !dataGrid.showColumnCommentsInHeader,
          })
        }
      />
    </SettingsPanel>
  );
}
