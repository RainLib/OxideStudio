import { useI18n } from "@/i18n";
import { Bot, Database, Palette, TextCursorInput } from "lucide-react";

export type SettingsSection =
  | "appearance"
  | "appearanceStyles"
  | "appearanceColors"
  | "appearanceTypography"
  | "appearanceAdvanced"
  | "workbench"
  | "keymap"
  | "editor"
  | "dataEditor"
  | "databaseExplorer"
  | "drivers"
  | "backups"
  | "ai"
  | "mcp";

export type SettingsTreeGroup = {
  id: string;
  label: string;
  icon: typeof Database;
  children: Array<{
    id: SettingsSection;
    label: string;
    section: SettingsSection;
  }>;
};

export type Translate = ReturnType<typeof useI18n>["t"];

export function createSettingsTree(t: Translate): SettingsTreeGroup[] {
  return [
    {
      id: "appearance-behavior",
      label: t("settings.group.appearanceBehavior"),
      icon: Palette,
      children: [
        {
          id: "appearance",
          label: t("settings.section.appearance"),
          section: "appearance",
        },
        {
          id: "appearanceStyles",
          label: t("settings.section.appearanceStyles"),
          section: "appearanceStyles",
        },
        {
          id: "appearanceColors",
          label: t("settings.section.appearanceColors"),
          section: "appearanceColors",
        },
        {
          id: "appearanceTypography",
          label: t("settings.section.appearanceTypography"),
          section: "appearanceTypography",
        },
        {
          id: "appearanceAdvanced",
          label: t("settings.section.appearanceAdvanced"),
          section: "appearanceAdvanced",
        },
        {
          id: "workbench",
          label: t("settings.section.workbench"),
          section: "workbench",
        },
        {
          id: "keymap",
          label: t("settings.section.keymap"),
          section: "keymap",
        },
      ],
    },
    {
      id: "editor",
      label: t("settings.group.editor"),
      icon: TextCursorInput,
      children: [
        {
          id: "editor",
          label: t("settings.section.editor"),
          section: "editor",
        },
        {
          id: "dataEditor",
          label: t("settings.section.dataEditor"),
          section: "dataEditor",
        },
      ],
    },
    {
      id: "database",
      label: t("settings.group.database"),
      icon: Database,
      children: [
        {
          id: "databaseExplorer",
          label: t("settings.section.databaseExplorer"),
          section: "databaseExplorer",
        },
        {
          id: "drivers",
          label: t("settings.section.drivers"),
          section: "drivers",
        },
        {
          id: "backups",
          label: t("settings.section.backups"),
          section: "backups",
        },
      ],
    },
    {
      id: "tools",
      label: t("settings.group.tools"),
      icon: Bot,
      children: [
        {
          id: "ai",
          label: t("settings.section.ai"),
          section: "ai",
        },
        {
          id: "mcp",
          label: t("settings.section.mcp"),
          section: "mcp",
        },
      ],
    },
  ];
}

export function createSectionMeta(
  t: Translate,
): Record<SettingsSection, { group: string; title: string }> {
  return {
    appearance: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.appearance"),
    },
    appearanceStyles: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.appearanceStyles"),
    },
    appearanceColors: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.appearanceColors"),
    },
    appearanceTypography: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.appearanceTypography"),
    },
    appearanceAdvanced: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.appearanceAdvanced"),
    },
    workbench: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.workbench"),
    },
    keymap: {
      group: t("settings.group.appearanceBehavior"),
      title: t("settings.section.keymap"),
    },
    editor: {
      group: t("settings.group.editor"),
      title: t("settings.section.editor"),
    },
    dataEditor: {
      group: t("settings.group.editor"),
      title: t("settings.section.dataEditor"),
    },
    databaseExplorer: {
      group: t("settings.group.database"),
      title: t("settings.section.databaseExplorer"),
    },
    drivers: {
      group: t("settings.group.database"),
      title: t("settings.section.drivers"),
    },
    backups: {
      group: t("settings.group.database"),
      title: t("settings.section.backups"),
    },
    ai: {
      group: t("settings.group.tools"),
      title: t("settings.section.ai"),
    },
    mcp: {
      group: t("settings.group.tools"),
      title: t("settings.section.mcp"),
    },
  };
}
