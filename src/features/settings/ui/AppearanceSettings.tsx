import {
  CheckboxLabel,
  NumberInput,
  SettingRow,
  SettingsDivider,
  SettingsPanel,
  selectClass,
} from "@/features/settings/ui/SettingsFields";
import { useI18n } from "@/i18n";
import { type AppLocale, type AppSettings } from "@/lib/appSettings";
import { cn } from "@/lib/utils";

export function AppearanceSettings({
  mode,
  setTheme,
  settings,
  onUpdate,
}: {
  mode: string;
  setTheme: (mode: "light" | "dark" | "system") => void;
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const { t } = useI18n();
  const appearance = settings.appearance;

  return (
    <SettingsPanel>
      <SettingsDivider title={t("settings.appearance.theme")} first />
      <SettingRow label={t("settings.appearance.themeLabel")}>
        <select
          value={mode}
          onChange={(event) =>
            setTheme(event.target.value as "light" | "dark" | "system")
          }
          className={selectClass}
        >
          <option value="dark">{t("settings.appearance.themeDark")}</option>
          <option value="light">{t("settings.appearance.themeLight")}</option>
          <option value="system">{t("settings.appearance.themeSystem")}</option>
        </select>
        <CheckboxLabel
          label={t("settings.appearance.themeSystem")}
          checked={mode === "system"}
          onChange={() => setTheme(mode === "system" ? "dark" : "system")}
        />
      </SettingRow>
      <SettingRow label={t("settings.appearance.editorScheme")}>
        <select
          className={selectClass}
          value={mode === "light" ? "light" : "dark"}
          onChange={(event) =>
            setTheme(event.target.value === "light" ? "light" : "dark")
          }
        >
          <option value="dark">{t("settings.appearance.dark")}</option>
          <option value="light">{t("settings.appearance.light")}</option>
        </select>
      </SettingRow>
      <SettingsDivider title={t("settings.appearance.interface")} />
      <SettingRow label={t("settings.appearance.language")}>
        <select
          className={selectClass}
          value={appearance.locale}
          onChange={(event) =>
            onUpdate({
              appearance: {
                ...appearance,
                locale: event.target.value as AppLocale,
              },
            })
          }
        >
          <option value="system">
            {t("settings.appearance.languageSystem")}
          </option>
          <option value="en-US">
            {t("settings.appearance.languageEnglish")}
          </option>
          <option value="zh-CN">
            {t("settings.appearance.languageChinese")}
          </option>
        </select>
        <span className="settings-hint">
          {t("settings.appearance.languageHint")}
        </span>
      </SettingRow>
      <SettingRow label={t("settings.appearance.uiFontSize")}>
        <NumberInput
          value={appearance.uiFontSize}
          min={10}
          max={20}
          onChange={(uiFontSize) =>
            onUpdate({ appearance: { ...appearance, uiFontSize } })
          }
        />
        <span className="settings-hint">
          {t("settings.appearance.uiFontSizeHint")}
        </span>
      </SettingRow>
      <p className="-mt-1 mb-2 ml-[148px] text-[11px] text-[hsl(var(--wb-text-muted))]">
        {t("settings.appearance.editorFontHint")}
      </p>
    </SettingsPanel>
  );
}

export const appearancePresets = [
  {
    id: "oxide",
    label: "Oxide",
    detail: "Balanced blue chrome for dense database work.",
    accent: "blue",
    fontFamily: "system",
    density: "compact",
    chromeGradient: "immersive",
  },
  {
    id: "graphite",
    label: "Graphite",
    detail: "Quiet neutral chrome with a subtle title background.",
    accent: "blue",
    fontFamily: "system",
    density: "comfortable",
    chromeGradient: "subtle",
  },
  {
    id: "violet",
    label: "Violet",
    detail: "A violet accent that keeps the work surface restrained.",
    accent: "violet",
    fontFamily: "sans",
    density: "compact",
    chromeGradient: "immersive",
  },
  {
    id: "terminal",
    label: "Terminal",
    detail: "Teal emphasis and a monospace interface for keyboard work.",
    accent: "teal",
    fontFamily: "mono",
    density: "compact",
    chromeGradient: "subtle",
  },
] as const;

export function AppearanceStyleSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const appearance = settings.appearance;
  return (
    <SettingsPanel>
      <SettingsDivider title="Built-in styles" first />
      <p className="mb-3 text-[12px] text-[hsl(var(--wb-text-muted))]">
        Start with a cohesive workbench style, then refine its colors, type, and
        behavior below.
      </p>
      <div className="grid max-w-[680px] grid-cols-1 gap-2 sm:grid-cols-2">
        {appearancePresets.map((preset) => {
          const selected = appearance.stylePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                onUpdate({
                  appearance: {
                    ...appearance,
                    stylePreset: preset.id,
                    accent: preset.accent,
                    fontFamily: preset.fontFamily,
                    density: preset.density,
                    chromeGradient: preset.chromeGradient,
                  },
                })
              }
              className={cn(
                "flex min-h-16 items-start gap-3 rounded-[4px] border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-accent)/0.1)]"
                  : "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] hover:bg-[hsl(var(--wb-hover))]",
              )}
            >
              <span
                className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-white/20"
                style={{
                  backgroundColor:
                    preset.accent === "violet"
                      ? "hsl(274 78% 66%)"
                      : preset.accent === "teal"
                        ? "hsl(176 68% 48%)"
                        : "hsl(216 82% 64%)",
                }}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[hsl(var(--wb-text))]">
                  {preset.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  {preset.detail}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

export function AppearanceColorSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const appearance = settings.appearance;
  const accents = [
    ["blue", "Blue", "hsl(216 82% 64%)"],
    ["violet", "Violet", "hsl(274 78% 66%)"],
    ["teal", "Teal", "hsl(176 68% 48%)"],
    ["amber", "Amber", "hsl(38 92% 56%)"],
  ] as const;
  return (
    <SettingsPanel>
      <SettingsDivider title="Accent color" first />
      <SettingRow label="Accent:">
        <div className="flex flex-wrap gap-2">
          {accents.map(([id, label, color]) => {
            const selected = appearance.accent === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onUpdate({
                    appearance: {
                      ...appearance,
                      accent: id,
                      stylePreset: "oxide",
                    },
                  })
                }
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[12px]",
                  selected
                    ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-active))]"
                    : "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] hover:bg-[hsl(var(--wb-hover))]",
                )}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </SettingRow>
      <p className="ml-[148px] max-w-[470px] text-[11px] text-[hsl(var(--wb-text-muted))]">
        Accent color is used for selection, focus, actions, and the workbench
        title treatment.
      </p>
    </SettingsPanel>
  );
}

export function AppearanceTypographySettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const appearance = settings.appearance;
  return (
    <SettingsPanel>
      <SettingsDivider title="Typography" first />
      <SettingRow label="Interface font:">
        <select
          className={selectClass}
          value={appearance.fontFamily}
          onChange={(event) =>
            onUpdate({
              appearance: {
                ...appearance,
                fontFamily: event.target
                  .value as AppSettings["appearance"]["fontFamily"],
                stylePreset: "oxide",
              },
            })
          }
        >
          <option value="system">System UI</option>
          <option value="sans">Sans-serif</option>
          <option value="mono">Monospace</option>
        </select>
        <span className="settings-hint">
          Applied to workbench chrome and panels
        </span>
      </SettingRow>
      <SettingRow label="UI font size:">
        <NumberInput
          value={appearance.uiFontSize}
          min={10}
          max={20}
          onChange={(uiFontSize) =>
            onUpdate({ appearance: { ...appearance, uiFontSize } })
          }
        />
        <span className="settings-hint">
          Editor and data grid sizes stay independent
        </span>
      </SettingRow>
    </SettingsPanel>
  );
}

export function AppearanceAdvancedSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const appearance = settings.appearance;
  return (
    <SettingsPanel>
      <SettingsDivider title="Advanced appearance" first />
      <SettingRow label="Panel density:">
        <select
          className={selectClass}
          value={appearance.density}
          onChange={(event) =>
            onUpdate({
              appearance: {
                ...appearance,
                density: event.target
                  .value as AppSettings["appearance"]["density"],
                stylePreset: "oxide",
              },
            })
          }
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
        <span className="settings-hint">Toolbar and panel header spacing</span>
      </SettingRow>
      <SettingRow label="Title gradient:">
        <select
          className={selectClass}
          value={appearance.chromeGradient}
          onChange={(event) =>
            onUpdate({
              appearance: {
                ...appearance,
                chromeGradient: event.target
                  .value as AppSettings["appearance"]["chromeGradient"],
                stylePreset: "oxide",
              },
            })
          }
        >
          <option value="immersive">Immersive</option>
          <option value="subtle">Subtle</option>
          <option value="off">Off</option>
        </select>
        <span className="settings-hint">
          Controls the upper-left workbench treatment
        </span>
      </SettingRow>
      <SettingRow label="Motion:">
        <CheckboxLabel
          label="Reduce interface motion"
          checked={appearance.reduceMotion}
          onChange={() =>
            onUpdate({
              appearance: {
                ...appearance,
                reduceMotion: !appearance.reduceMotion,
              },
            })
          }
        />
      </SettingRow>
    </SettingsPanel>
  );
}
