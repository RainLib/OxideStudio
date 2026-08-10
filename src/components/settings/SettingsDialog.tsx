import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aiService } from "@/services/tauri/ai.service";
import { agentHostService } from "@/services/tauri/agent-host.service";
import { databaseService } from "@/services/tauri/database.service";
import type {
  DatabaseDriverCatalogEntry,
  DatabaseDriverInstallation,
  DatabaseDriverRuntimeSummary,
  DatabaseDriverStoreInfo,
  DatabaseDriverProbeResult,
  ManagedJavaRuntimeInstallation,
} from "@/services/tauri/types";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ThemeContext } from "@/theme/ThemeProvider";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { downloadText } from "@/lib/exportUtils";
import { keymapConflicts, normalizeKeybinding } from "@/lib/keybindings";
import {
  findWorkbenchAction,
  type WorkbenchActionId,
  workbenchActions,
} from "@/lib/actions";
import {
  DEFAULT_APP_SETTINGS,
  type SqlSnippetSetting,
  type AppLocale,
  type AppSettings,
  type WorkbenchSide,
} from "@/lib/appSettings";
import {
  closeSideToolWindow,
  moveSideToolWindow,
  openSideToolWindow,
} from "@/lib/workbenchLayout";
import { parseVimMappings, serializeVimMappings } from "@/lib/vimMappings";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  driverCandidateAvailability,
  driverCandidateConformance,
  referenceDriverDeliveryPlan,
} from "@/features/database-drivers";
import {
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  TextCursorInput,
  Trash2,
  Upload,
} from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

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
  | "ai";

type SettingsTreeGroup = {
  id: string;
  label: string;
  icon: typeof Database;
  children: Array<{
    id: SettingsSection;
    label: string;
    section: SettingsSection;
  }>;
};

type Translate = ReturnType<typeof useI18n>["t"];

function createSettingsTree(t: Translate): SettingsTreeGroup[] {
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
    ],
  },
  ];
}

function createSectionMeta(
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
    ai: {
      group: t("settings.group.tools"),
      title: t("settings.section.ai"),
    },
  };
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection,
}: SettingsDialogProps) {
  const { t } = useI18n();
  const themeContext = useContext(ThemeContext);
  const appSettings = useSettingsStore((state) => state.settings);
  const settingsError = useSettingsStore((state) => state.error);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const aiStreaming = useAiSettingsStore((state) => state.streaming);
  const aiToolCalling = useAiSettingsStore((state) => state.toolCalling);
  const aiStructuredOutput = useAiSettingsStore(
    (state) => state.structuredOutput
  );
  const aiMaxInputTokens = useAiSettingsStore(
    (state) => state.maxInputTokens
  );
  const aiMaxOutputTokens = useAiSettingsStore(
    (state) => state.maxOutputTokens
  );
  const aiInlineCompletionProtocol = useAiSettingsStore(
    (state) => state.inlineCompletionProtocol
  );
  const aiInlineCompletionModel = useAiSettingsStore(
    (state) => state.inlineCompletionModel
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProjectName = useProjectStore((state) => state.activeProjectName);
  const setAiEnabled = useAiSettingsStore((state) => state.setEnabled);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [filterText, setFilterText] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([
    "appearance-behavior",
    "editor",
    "database",
    "tools",
  ]);
  const [aiTestState, setAiTestState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [isSavingAiSecret, setIsSavingAiSecret] = useState(false);
  const [hasAiProviderSecret, setHasAiProviderSecret] = useState(false);
  const aiSecretSaveRef = useRef<Promise<boolean> | null>(null);
  const [isClearingAgentState, setIsClearingAgentState] = useState(false);
  const [agentStateMessage, setAgentStateMessage] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const localizedSettingsTree = useMemo(() => createSettingsTree(t), [t]);
  const localizedSectionMeta = useMemo(() => createSectionMeta(t), [t]);

  useEffect(() => {
    const baseUrl = aiBaseUrl.trim();
    if (!open || !baseUrl) {
      setHasAiProviderSecret(false);
      return;
    }
    let active = true;
    void aiService
      .hasProviderSecret(baseUrl)
      .then((available) => {
        if (active) setHasAiProviderSecret(available);
      })
      .catch(() => {
        if (active) setHasAiProviderSecret(false);
      });
    return () => {
      active = false;
    };
  }, [aiBaseUrl, open]);

  useEffect(() => {
    if (open && initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection, open]);

  const visibleTree = useMemo(() => {
    const filter = filterText.trim().toLowerCase();
    if (!filter) return localizedSettingsTree;

    return localizedSettingsTree
      .map((item) => {
        const itemMatches = item.label.toLowerCase().includes(filter);
        const children = item.children.filter((child) =>
          child.label.toLowerCase().includes(filter)
        );
        if (!itemMatches && children.length === 0) return null;
        return {
          ...item,
          children: itemMatches ? item.children : children,
        };
      })
      .filter((item): item is SettingsTreeGroup => Boolean(item));
  }, [filterText, localizedSettingsTree]);

  if (!themeContext) return null;
  const { mode, setTheme } = themeContext;
  const currentMeta = localizedSectionMeta[activeSection];
  const canTestAi = Boolean(aiBaseUrl.trim() && aiModel.trim());

  const updateAppSettings = (updates: Partial<AppSettings>) => {
    void updateSettings(updates);
  };

  const persistAiProviderSecret = (): Promise<boolean> => {
    if (aiSecretSaveRef.current) return aiSecretSaveRef.current;
    const secret = aiApiKey.trim();
    const baseUrl = aiBaseUrl.trim();
    if (!secret) return Promise.resolve(hasAiProviderSecret);
    if (!baseUrl) {
      setAiTestState({
        status: "error",
        message: "Enter the provider base URL before saving the API key.",
      });
      return Promise.resolve(false);
    }

    setIsSavingAiSecret(true);
    const operation = aiService
      .setProviderSecret(baseUrl, secret)
      .then((saved) => {
        if (!saved) {
          throw new Error("The local credential file did not retain the API key.");
        }
        updateAiSettings({ apiKey: "" });
        setHasAiProviderSecret(true);
        setAiTestState({
          status: "success",
          message: "API key saved and verified in the local credential file.",
        });
        return true;
      })
      .catch((error: any) => {
        setAiTestState({
          status: "error",
          message: error?.message || String(error),
        });
        return false;
      })
      .finally(() => {
        setIsSavingAiSecret(false);
        aiSecretSaveRef.current = null;
      });
    aiSecretSaveRef.current = operation;
    return operation;
  };

  const handleTestAiProvider = async () => {
    setAiTestState(null);
    setIsTestingAi(true);
    try {
      if (aiApiKey.trim() && !(await persistAiProviderSecret())) return;
      const result = await aiService.testProvider({
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
        // Test the persisted credential path used by the Agent Host. Passing
        // the draft directly would hide a failed credential-file save.
        apiKey: undefined,
        timeoutMs: aiTimeoutMs,
      });
      setAiTestState({
        status: "success",
        message: `${result.message}: ${result.model}`,
      });
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsTestingAi(false);
    }
  };

  const removeAiProviderSecret = async () => {
    if (!aiBaseUrl.trim()) return;
    try {
      await aiService.setProviderSecret(aiBaseUrl.trim());
      updateAiSettings({ apiKey: "" });
      setHasAiProviderSecret(false);
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    }
  };

  const clearCurrentProjectAgentState = async () => {
    const confirmed = window.confirm(
      `Clear saved AI conversations and checkpoints for “${activeProjectName}”? This cannot be undone.`
    );
    if (!confirmed) return;
    setIsClearingAgentState(true);
    setAgentStateMessage(null);
    try {
      const result = await agentHostService.clearProjectState(activeProjectId);
      setAgentStateMessage({
        status: "success",
        message: `Cleared ${result.clearedRecords} saved record${result.clearedRecords === 1 ? "" : "s"}.`,
      });
    } catch (error: any) {
      setAgentStateMessage({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsClearingAgentState(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !aiApiKey.trim()) {
      onOpenChange(nextOpen);
      return;
    }
    void persistAiProviderSecret().then((saved) => {
      if (saved) onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="settings-dialog top-[14px] flex h-[calc(100vh-28px)] max-h-none w-[1040px] max-w-[calc(100vw-28px)] translate-y-0 flex-col gap-0 overflow-hidden rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_12px_36px_rgba(0,0,0,0.4)] data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-top-0">
        <DialogHeader className="relative flex h-10 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-frame))] px-4 py-0">
          <DialogTitle className="text-[12px] font-semibold tracking-normal text-[hsl(var(--wb-text-muted))]">
            {t("common.settings")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("settings.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[206px_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="border-b border-[hsl(var(--wb-border-subtle))] p-2">
              <div className="flex h-7 items-center gap-1.5 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[hsl(var(--wb-text-muted))]">
                <Search size={13} />
                <input
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
                  placeholder={t("common.search")}
                />
              </div>
            </div>

            <nav className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1 py-1">
              {visibleTree.map((item) => (
                <SettingsTreeItem
                  key={item.id}
                  item={item}
                  activeSection={activeSection}
                  expanded={expandedGroups.includes(item.id) || Boolean(filterText)}
                  onToggle={() =>
                    setExpandedGroups((current) =>
                      current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id]
                    )
                  }
                  onSelect={setActiveSection}
                />
              ))}
            </nav>
          </aside>

          <main className="flex min-h-0 flex-col bg-[hsl(var(--wb-editor))]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-4">
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                <span className="truncate">{currentMeta.group}</span>
                <ChevronRight size={13} className="text-[hsl(var(--wb-text-muted))]" />
                <span className="truncate">{currentMeta.title}</span>
              </div>
              <div className="flex items-center gap-1 text-[hsl(var(--wb-text-muted))]">
                <SettingsIconButton
                  title={t("common.openSettingsJson")}
                  onClick={() => void findWorkbenchAction("settings.openJson")?.run()}
                >
                  <Braces size={14} />
                </SettingsIconButton>
                <SettingsIconButton
                  title={t("common.reset")}
                  onClick={() => void resetSettings()}
                >
                  <Settings2 size={14} />
                </SettingsIconButton>
              </div>
            </div>

            {settingsError && (
              <div
                role="alert"
                className="border-b border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-4 py-2 text-[11px] text-[hsl(var(--destructive))]"
              >
                {settingsError}
              </div>
            )}

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {activeSection === "appearance" && (
                <AppearanceSettings
                  mode={mode}
                  setTheme={setTheme}
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "appearanceStyles" && (
                <AppearanceStyleSettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "appearanceColors" && (
                <AppearanceColorSettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "appearanceTypography" && (
                <AppearanceTypographySettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "appearanceAdvanced" && (
                <AppearanceAdvancedSettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "workbench" && (
                <WorkbenchSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "keymap" && (
                <KeymapSettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "editor" && (
                <EditorSettings settings={appSettings} onUpdate={updateAppSettings} />
              )}
              {activeSection === "dataEditor" && (
                <DataEditorSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "databaseExplorer" && (
                <DatabaseExplorerSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "drivers" && <DriverManagementSettings />}
              {activeSection === "ai" && (
                <AiSettings
                  aiEnabled={aiEnabled}
                  aiBaseUrl={aiBaseUrl}
                  aiModel={aiModel}
                  aiApiKey={aiApiKey}
                  hasAiProviderSecret={hasAiProviderSecret}
                  aiTimeoutMs={aiTimeoutMs}
                  aiStreaming={aiStreaming}
                  aiToolCalling={aiToolCalling}
                  aiStructuredOutput={aiStructuredOutput}
                  aiMaxInputTokens={aiMaxInputTokens}
                  aiMaxOutputTokens={aiMaxOutputTokens}
                  aiInlineCompletionProtocol={aiInlineCompletionProtocol}
                  aiInlineCompletionModel={aiInlineCompletionModel}
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                  setAiEnabled={setAiEnabled}
                  updateAiSettings={updateAiSettings}
                  canTestAi={canTestAi}
                  isTestingAi={isTestingAi}
                  isSavingAiSecret={isSavingAiSecret}
                  aiTestState={aiTestState}
                  onTest={handleTestAiProvider}
                  onPersistSecret={() => void persistAiProviderSecret()}
                  onRemoveSecret={() => void removeAiProviderSecret()}
                  activeProjectName={activeProjectName}
                  isClearingAgentState={isClearingAgentState}
                  agentStateMessage={agentStateMessage}
                  onClearAgentState={() => void clearCurrentProjectAgentState()}
                />
              )}
            </div>
          </main>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 sm:space-x-0">
          <SettingsButton onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </SettingsButton>
          <SettingsButton disabled>{t("common.apply")}</SettingsButton>
          <SettingsButton intent="primary" onClick={() => handleOpenChange(false)}>
            {t("common.ok")}
          </SettingsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTreeItem({
  item,
  activeSection,
  expanded,
  onToggle,
  onSelect,
}: {
  item: SettingsTreeGroup;
  activeSection: SettingsSection;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
  const Icon = item.icon;
  return (
    <div>
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1 rounded-[3px] px-1.5 text-left text-[12px] font-semibold text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
        )}
        <Icon size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
        <span className="truncate">{item.label}</span>
      </button>

      {expanded && (
        <div>
          {item.children.map((child) => (
            <button
              key={child.id}
              type="button"
              className={cn(
                "flex h-6 w-full items-center rounded-[3px] pl-12 pr-2 text-left text-[12px]",
                child.section === activeSection
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
              )}
              onClick={() => onSelect(child.section)}
            >
              <span className="truncate">{child.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AppearanceSettings({
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

const appearancePresets = [
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

function AppearanceStyleSettings({
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
        Start with a cohesive workbench style, then refine its colors, type, and behavior below.
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
                <span className="block text-[12px] font-medium text-[hsl(var(--wb-text))]">{preset.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">{preset.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

function AppearanceColorSettings({
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
                  onUpdate({ appearance: { ...appearance, accent: id, stylePreset: "oxide" } })
                }
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[12px]",
                  selected
                    ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-active))]"
                    : "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] hover:bg-[hsl(var(--wb-hover))]",
                )}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </button>
            );
          })}
        </div>
      </SettingRow>
      <p className="ml-[148px] max-w-[470px] text-[11px] text-[hsl(var(--wb-text-muted))]">
        Accent color is used for selection, focus, actions, and the workbench title treatment.
      </p>
    </SettingsPanel>
  );
}

function AppearanceTypographySettings({
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
                fontFamily: event.target.value as AppSettings["appearance"]["fontFamily"],
                stylePreset: "oxide",
              },
            })
          }
        >
          <option value="system">System UI</option>
          <option value="sans">Sans-serif</option>
          <option value="mono">Monospace</option>
        </select>
        <span className="settings-hint">Applied to workbench chrome and panels</span>
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
        <span className="settings-hint">Editor and data grid sizes stay independent</span>
      </SettingRow>
    </SettingsPanel>
  );
}

function AppearanceAdvancedSettings({
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
                density: event.target.value as AppSettings["appearance"]["density"],
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
                chromeGradient: event.target.value as AppSettings["appearance"]["chromeGradient"],
                stylePreset: "oxide",
              },
            })
          }
        >
          <option value="immersive">Immersive</option>
          <option value="subtle">Subtle</option>
          <option value="off">Off</option>
        </select>
        <span className="settings-hint">Controls the upper-left workbench treatment</span>
      </SettingRow>
      <SettingRow label="Motion:">
        <CheckboxLabel
          label="Reduce interface motion"
          checked={appearance.reduceMotion}
          onChange={() => onUpdate({ appearance: { ...appearance, reduceMotion: !appearance.reduceMotion } })}
        />
      </SettingRow>
    </SettingsPanel>
  );
}

function WorkbenchSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const { layout, toolWindows } = settings.workbench;
  const updateLayout = (patch: Partial<AppSettings["workbench"]["layout"]>) =>
    onUpdate({ workbench: { ...settings.workbench, layout: { ...layout, ...patch } } });
  const updateToolWindowEnabled = (
    id: keyof AppSettings["workbench"]["toolWindows"],
    enabled: boolean
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
    id: "databaseExplorer" | "projectFiles" | "assistant" | "commit" | "versionControl",
    visible: boolean,
  ) => onUpdate({
    workbench: visible
      ? openSideToolWindow(settings.workbench, id)
      : closeSideToolWindow(settings.workbench, id),
  });
  const updateVisibility = (
    id: keyof AppSettings["workbench"]["layout"]["visibility"],
    visible: boolean,
  ) => updateLayout({
    visibility: { ...layout.visibility, [id]: visible },
  });
  const updateSide = (
    id: "databaseExplorer" | "projectFiles" | "assistant" | "commit" | "versionControl",
    side: WorkbenchSide
  ) => onUpdate({ workbench: moveSideToolWindow(settings.workbench, id, side) });

  return (
      <SettingsPanel>
      <SettingsDivider title="Tool Windows" first />
      {(
        [
          ["databaseExplorer", "Database Explorer"],
          ["projectFiles", "Project Files"],
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
        <span className="settings-hint">Assistant and Files</span>
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

function KeymapSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const actions = useMemo(() => workbenchActions(), []);
  const conflicts = keymapConflicts(settings.keymap);
  const conflictBindings = new Set(conflicts.map((conflict) => conflict.binding));

  const updateBinding = (actionId: WorkbenchActionId, value: string) => {
    onUpdate({
      keymap: {
        ...settings.keymap,
        [actionId]: value.trim() ? [value.trim()] : [],
      },
    });
  };

  return (
    <SettingsPanel>
      <SettingsDivider title="Keymap" first />
      {conflicts.length > 0 && (
        <div className="mb-3 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          {conflicts.length} shortcut conflict{conflicts.length > 1 ? "s" : ""} found.
        </div>
      )}
      <div className="overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border))]">
        {actions.map((action) => {
          const value = settings.keymap[action.id]?.[0] ?? "";
          const hasConflict = value && conflictBindings.has(normalizeKeybinding(value));
          return (
            <div
              key={action.id}
              className="grid grid-cols-[1fr_130px_180px] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{action.title}</div>
                <div className="text-[11px] text-[hsl(var(--wb-text-muted))]">
                  {action.id}
                </div>
              </div>
              <div className="text-[11px] text-[hsl(var(--wb-text-muted))]">
                {action.group}
              </div>
              <input
                value={value}
                onChange={(event) =>
                  updateBinding(action.id, event.target.value)
                }
                className={cn(inputClass, "w-full font-mono text-[11px]", hasConflict && "border-amber-500/70")}
                spellCheck={false}
              />
            </div>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

function EditorSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const editor = settings.editor;
  const updateEditor = (patch: Partial<AppSettings["editor"]>) =>
    onUpdate({ editor: { ...editor, ...patch } });
  const serializedMappings = useMemo(
    () => serializeVimMappings(editor.vim.mappings),
    [editor.vim.mappings]
  );
  const [vimMappingDraft, setVimMappingDraft] = useState(serializedMappings);
  const [vimMappingErrors, setVimMappingErrors] = useState<string[]>([]);

  useEffect(() => {
    setVimMappingDraft(serializedMappings);
  }, [serializedMappings]);

  const updateVim = (patch: Partial<AppSettings["editor"]["vim"]>) =>
    updateEditor({ vim: { ...editor.vim, ...patch } });

  return (
    <SettingsPanel>
      <SettingsDivider title="SQL Editor" first />
      <SettingRow label="Font size:">
        <NumberInput
          value={editor.fontSize}
          min={10}
          max={24}
          onChange={(fontSize) => updateEditor({ fontSize })}
        />
      </SettingRow>
      <SettingRow label="Tab size:">
        <NumberInput
          value={editor.tabSize}
          min={2}
          max={8}
          onChange={(tabSize) => updateEditor({ tabSize })}
        />
      </SettingRow>
      <SettingRow label="Word wrap:">
        <select
          className={selectClass}
          value={editor.wordWrap}
          onChange={(event) =>
            updateEditor({
              wordWrap: event.target.value as AppSettings["editor"]["wordWrap"],
            })
          }
        >
          <option value="off">Off</option>
          <option value="on">On</option>
          <option value="wordWrapColumn">At column</option>
          <option value="bounded">Bounded</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Show minimap"
        checked={editor.minimap}
        onChange={() => updateEditor({ minimap: !editor.minimap })}
      />
      <CheckboxLabel
        label="Confirm destructive SQL before execution"
        checked={editor.confirmDestructiveSql}
        onChange={() =>
          updateEditor({ confirmDestructiveSql: !editor.confirmDestructiveSql })
        }
      />
      <CheckboxLabel
        label="Run all SQL from a blank line"
        detail="When Run current statement has no statement at the cursor. Disabled by default."
        checked={editor.executeAllOnBlankLine}
        onChange={() =>
          updateEditor({
            executeAllOnBlankLine: !editor.executeAllOnBlankLine,
          })
        }
      />
      <SettingsDivider title="SQL formatting" />
      <SettingRow label="Keyword case:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.keywordCase}
          onChange={(event) => {
            const keywordCase = event.target
              .value as AppSettings["editor"]["sqlFormatting"]["keywordCase"];
            updateEditor({
              sqlFormatting: { ...editor.sqlFormatting, keywordCase },
              sqlCompletion: { ...editor.sqlCompletion, keywordCase },
            });
          }}
          title="Uses the same keyword casing for formatting and SQL suggestions"
        >
          <option value="upper">UPPER CASE</option>
          <option value="lower">lower case</option>
          <option value="preserve">Preserve source</option>
        </select>
      </SettingRow>
      <SettingRow label="Function case:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.functionCase}
          onChange={(event) => {
            const functionCase = event.target
              .value as AppSettings["editor"]["sqlFormatting"]["functionCase"];
            updateEditor({
              sqlFormatting: { ...editor.sqlFormatting, functionCase },
              sqlCompletion: { ...editor.sqlCompletion, functionCase },
            });
          }}
          title="Cases function calls while preserving quoted function names and database object identifiers"
        >
          <option value="preserve">Preserve source</option>
          <option value="upper">UPPER CASE</option>
          <option value="lower">lower case</option>
        </select>
      </SettingRow>
      <SettingRow label="Logical operators:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.logicalOperatorNewline}
          onChange={(event) =>
            updateEditor({
              sqlFormatting: {
                ...editor.sqlFormatting,
                logicalOperatorNewline: event.target
                  .value as AppSettings["editor"]["sqlFormatting"]["logicalOperatorNewline"],
              },
            })
          }
        >
          <option value="before">New line before AND / OR</option>
          <option value="after">New line after AND / OR</option>
          <option value="none">Keep on the same line</option>
        </select>
      </SettingRow>
      <SettingRow label="FROM clause:">
        <select
          className={selectClass}
          value={editor.sqlFormatting.fromClauseLayout}
          onChange={(event) =>
            updateEditor({
              sqlFormatting: {
                ...editor.sqlFormatting,
                fromClauseLayout: event.target
                  .value as AppSettings["editor"]["sqlFormatting"]["fromClauseLayout"],
              },
            })
          }
        >
          <option value="newLine">First source on a new line</option>
          <option value="sameLine">First source on the FROM line</option>
        </select>
      </SettingRow>
      <SettingsDivider title="SQL completion" />
      <SettingRow label="Automatic suggestions:">
        <select
          className={selectClass}
          value={editor.sqlCompletion.triggerMode}
          onChange={(event) =>
            updateEditor({
              sqlCompletion: {
                ...editor.sqlCompletion,
                triggerMode: event.target.value as AppSettings["editor"]["sqlCompletion"]["triggerMode"],
              },
            })
          }
          title="Manual keeps Ctrl+Space available; Prefix waits for an identifier; Smart positions also opens after SQL clauses"
        >
          <option value="positional">Smart SQL positions</option>
          <option value="require-prefix">After typing a name</option>
          <option value="manual">Manual (Ctrl+Space)</option>
        </select>
      </SettingRow>
      <SettingRow label="Table alias:">
        <select
          className={selectClass}
          value={editor.sqlCompletion.tableAlias}
          onChange={(event) =>
            updateEditor({
              sqlCompletion: {
                ...editor.sqlCompletion,
                tableAlias: event.target.value as AppSettings["editor"]["sqlCompletion"]["tableAlias"],
              },
            })
          }
        >
          <option value="none">Do not generate</option>
          <option value="initials">Generate initials</option>
        </select>
      </SettingRow>
      <CheckboxLabel
        label="Rank suggestions by recent usage"
        detail="Completion choices are stored locally and never sent to the database"
        checked={editor.sqlCompletion.rankByUsage}
        onChange={() =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              rankByUsage: !editor.sqlCompletion.rankByUsage,
            },
          })
        }
      />
      <CheckboxLabel
        label="Insert a space after completed SQL names and keywords"
        detail="Skips functions, snippets, properties, schemas, and punctuation boundaries"
        checked={editor.sqlCompletion.appendSpace}
        onChange={() =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              appendSpace: !editor.sqlCompletion.appendSpace,
            },
          })
        }
      />
      <SettingsDivider title="SQL snippets" />
      <SqlSnippetSettingsEditor
        snippets={editor.sqlCompletion.snippets}
        onCommit={(snippets) =>
          updateEditor({
            sqlCompletion: {
              ...editor.sqlCompletion,
              snippets,
            },
          })
        }
      />
      <SettingsDivider title="Vim" />
      <CheckboxLabel
        label="Enable Vim keybindings"
        detail="Normal, Insert, Visual, command, search, and macro workflows"
        checked={editor.keybindingMode === "vim"}
        onChange={() =>
          updateEditor({
            keybindingMode:
              editor.keybindingMode === "vim" ? "standard" : "vim",
          })
        }
      />
      {editor.keybindingMode === "vim" && (
        <>
          <SettingRow label="Leader key:">
            <SettingsInput
              value={editor.vim.leader}
              onChange={(leader) => {
                const normalized = leader.trim();
                if (normalized && normalized.length <= 16) {
                  updateVim({ leader: normalized });
                }
              }}
              placeholder="\\ or <Space>"
            />
          </SettingRow>
          <CheckboxLabel
            label="Use relative line numbers"
            checked={editor.vim.relativeLineNumbers}
            onChange={() =>
              updateVim({
                relativeLineNumbers: !editor.vim.relativeLineNumbers,
              })
            }
          />
          <SettingRow label="Custom mappings:">
            <div className="min-w-0">
              <textarea
                value={vimMappingDraft}
                onChange={(event) => {
                  const source = event.target.value;
                  const parsed = parseVimMappings(source);
                  setVimMappingDraft(source);
                  setVimMappingErrors(parsed.errors);
                  if (parsed.errors.length === 0) {
                    updateVim({ mappings: parsed.mappings });
                  }
                }}
                placeholder={
                  "nnoremap <leader>f /FROM<Enter>\nimap jj <Esc>"
                }
                spellCheck={false}
                className={cn(
                  "custom-scrollbar min-h-28 w-[420px] resize-y rounded-[4px] border bg-[hsl(var(--wb-panel-raised))] px-2 py-1.5 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]",
                  vimMappingErrors.length > 0
                    ? "border-[hsl(var(--destructive))]"
                    : "border-[hsl(var(--wb-border))]"
                )}
              />
              <p className="mt-1 max-w-[58ch] text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                Supports map, nmap, imap, vmap and their non-recursive forms.
                Use &lt;leader&gt; in either side of a mapping.
              </p>
              {vimMappingErrors.length > 0 && (
                <div className="mt-1 text-[10px] leading-4 text-[hsl(var(--destructive))]">
                  {vimMappingErrors.join(" ")}
                </div>
              )}
            </div>
          </SettingRow>
        </>
      )}
    </SettingsPanel>
  );
}

function SqlSnippetSettingsEditor({
  snippets,
  onCommit,
}: {
  snippets: SqlSnippetSetting[];
  onCommit: (snippets: SqlSnippetSetting[]) => void;
}) {
  const serializedSnippets = useMemo(() => JSON.stringify(snippets), [snippets]);
  const [drafts, setDrafts] = useState<SqlSnippetSetting[]>(() =>
    snippets.map((snippet) => ({ ...snippet })),
  );
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDrafts(snippets.map((snippet) => ({ ...snippet })));
    setError(null);
    // A serialized dependency avoids resetting an in-progress local draft
    // when the parent recreates an equivalent settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedSnippets]);

  const validate = (next: SqlSnippetSetting[]) => {
    if (next.length > 100) return "At most 100 snippets are supported.";
    const prefixes = new Set<string>();
    const ids = new Set<string>();
    for (const snippet of next) {
      const id = snippet.id.trim();
      if (!id || ids.has(id)) {
        return "Every snippet must have a unique non-empty id.";
      }
      const prefix = snippet.prefix.trim().toLowerCase();
      if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(prefix)) {
        return `Trigger “${snippet.prefix || "(empty)"}” must start with a letter or underscore and contain only letters, numbers, _ or -.`;
      }
      if (prefixes.has(prefix)) {
        return `Trigger “${prefix}” is already used by another snippet.`;
      }
      if (!snippet.label.trim()) return `Snippet “${prefix}” needs a label.`;
      if (!snippet.body.trim()) return `Snippet “${prefix}” needs SQL content.`;
      if (snippet.label.length > 120) {
        return `Snippet “${prefix}” label is longer than 120 characters.`;
      }
      if (snippet.body.length > 65_536) {
        return `Snippet “${prefix}” SQL content is larger than 65,536 characters.`;
      }
      prefixes.add(prefix);
      ids.add(id);
    }
    return null;
  };

  const commit = (next: SqlSnippetSetting[]) => {
    const validationError = validate(next);
    setError(validationError);
    if (validationError) return false;
    const normalized = next.map((snippet) => ({
      ...snippet,
      prefix: snippet.prefix.trim().toLowerCase(),
      label: snippet.label.trim(),
      detail: snippet.detail.trim() || "Custom SQL snippet",
    }));
    onCommit(normalized);
    return true;
  };

  const updateDraft = (
    index: number,
    patch: Partial<SqlSnippetSetting>,
    commitImmediately = false,
  ) => {
    const next = drafts.map((snippet, snippetIndex) =>
      snippetIndex === index ? { ...snippet, ...patch } : snippet,
    );
    setDrafts(next);
    if (commitImmediately) commit(next);
  };

  const addSnippet = () => {
    const used = new Set(drafts.map((snippet) => snippet.prefix.toLowerCase()));
    let suffix = 1;
    let prefix = "snippet";
    while (used.has(prefix)) {
      prefix = `snippet${suffix}`;
      suffix += 1;
    }
    const next = [
      ...drafts,
      {
        id: `custom-${Date.now().toString(36)}-${suffix}`,
        prefix,
        label: "custom query",
        detail: "Custom SQL snippet",
        body: "SELECT ${1:*}\nFROM ${2:table};",
        enabled: true,
      },
    ];
    setDrafts(next);
    commit(next);
  };

  const exportSnippets = () => {
    const validationError = validate(drafts);
    setError(validationError);
    if (validationError) return;
    downloadText(
      `${JSON.stringify({ version: 1, snippets: drafts }, null, 2)}\n`,
      "oxide-sql-snippets.json",
      "application/json;charset=utf-8",
    );
  };

  const importSnippets = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const values = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { snippets?: unknown }).snippets)
          ? (parsed as { snippets: unknown[] }).snippets
          : null;
      if (!values) throw new Error("The file does not contain a snippets array.");
      const imported = values.map((value, index): SqlSnippetSetting => {
        if (!value || typeof value !== "object") {
          throw new Error(`Snippet ${index + 1} is not an object.`);
        }
        const candidate = value as Partial<SqlSnippetSetting>;
        if (
          typeof candidate.prefix !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.body !== "string"
        ) {
          throw new Error(
            `Snippet ${index + 1} requires string prefix, label and body fields.`,
          );
        }
        return {
          id:
            typeof candidate.id === "string" && candidate.id.trim()
              ? candidate.id.trim()
              : `imported-${Date.now().toString(36)}-${index}`,
          prefix: candidate.prefix,
          label: candidate.label,
          detail:
            typeof candidate.detail === "string"
              ? candidate.detail
              : "Imported SQL snippet",
          body: candidate.body,
          enabled: candidate.enabled !== false,
        };
      });
      if (commit(imported)) setDrafts(imported);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import SQL snippets.",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Type a trigger in the SQL editor to insert a cursor-navigable template.
          Use Monaco placeholders such as {"${1:table}"} and {"${2:column}"}.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) =>
              void importSnippets(event.currentTarget.files?.[0])
            }
          />
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={12} /> Import
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={exportSnippets}
            disabled={drafts.length === 0}
          >
            <Download size={12} /> Export
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={addSnippet}
          >
            <Plus size={12} /> Add
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
            onClick={() => {
              const defaults = DEFAULT_APP_SETTINGS.editor.sqlCompletion.snippets.map(
                (snippet) => ({ ...snippet }),
              );
              setDrafts(defaults);
              commit(defaults);
            }}
          >
            <RotateCcw size={12} /> Defaults
          </button>
        </div>
      </div>
      <div className="custom-scrollbar max-h-[430px] space-y-1.5 overflow-y-auto pr-1">
        {drafts.map((snippet, index) => (
          <div
            key={snippet.id}
            className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] p-2"
          >
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={snippet.enabled}
                aria-label={`${snippet.label} enabled`}
                onChange={(event) =>
                  updateDraft(index, { enabled: event.target.checked }, true)
                }
              />
              <input
                className={cn(inputClass, "w-24 font-mono text-[11px]")}
                value={snippet.prefix}
                maxLength={32}
                aria-label="Snippet trigger"
                title="Completion trigger"
                onChange={(event) =>
                  updateDraft(index, {
                    prefix: event.target.value.toLowerCase().replace(/\s+/g, ""),
                  })
                }
                onBlur={() => commit(drafts)}
              />
              <input
                className={cn(inputClass, "min-w-0 flex-1 text-[11px]")}
                value={snippet.label}
                maxLength={120}
                aria-label="Snippet label"
                title="Completion label"
                onChange={(event) =>
                  updateDraft(index, { label: event.target.value })
                }
                onBlur={() => commit(drafts)}
              />
              <button
                type="button"
                className="wb-icon-button h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--destructive))]"
                title={`Delete ${snippet.label}`}
                aria-label={`Delete ${snippet.label}`}
                onClick={() => {
                  const next = drafts.filter((_, snippetIndex) => snippetIndex !== index);
                  setDrafts(next);
                  commit(next);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              className="custom-scrollbar mt-1.5 min-h-20 w-full resize-y rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[11px] leading-4 text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]"
              value={snippet.body}
              maxLength={65_536}
              spellCheck={false}
              aria-label={`${snippet.label} SQL template`}
              onChange={(event) => updateDraft(index, { body: event.target.value })}
              onBlur={() => commit(drafts)}
            />
          </div>
        ))}
      </div>
      {drafts.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[hsl(var(--wb-border))] px-3 py-4 text-center text-[10px] text-[hsl(var(--wb-text-muted))]">
          No SQL snippets are enabled. Add one or restore the defaults.
        </p>
      )}
      {error && (
        <p className="text-[10px] leading-4 text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DataEditorSettings({
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
              tableTabReuseMode:
                event.target.value as AppSettings["dataGrid"]["tableTabReuseMode"],
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
        onChange={() => updateDataGrid({ showTypeIcons: !dataGrid.showTypeIcons })}
      />
    </SettingsPanel>
  );
}

function DatabaseExplorerSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const databaseExplorer = settings.databaseExplorer;
  const updateDatabaseExplorer = (
    patch: Partial<AppSettings["databaseExplorer"]>
  ) =>
    onUpdate({ databaseExplorer: { ...databaseExplorer, ...patch } });

  return (
    <SettingsPanel>
      <SettingsDivider title="Introspection" first />
      <SettingRow label="Refresh mode:">
        <select
          className={selectClass}
          value={databaseExplorer.refreshMode}
          onChange={(event) =>
            updateDatabaseExplorer({
              refreshMode: event.target.value as AppSettings["databaseExplorer"]["refreshMode"],
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
    </SettingsPanel>
  );
}

function formatDriverCacheBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function DriverManagementSettings() {
  const catalogUrl = useSettingsStore((state) => state.settings.drivers.catalogUrl);
  const driverStorePath = useSettingsStore((state) => state.settings.drivers.storePath);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [installations, setInstallations] = useState<
    DatabaseDriverInstallation[] | null
  >(null);
  const [javaRuntimes, setJavaRuntimes] = useState<
    ManagedJavaRuntimeInstallation[] | null
  >(null);
  const [driverStore, setDriverStore] = useState<
    DatabaseDriverStoreInfo | null
  >(null);
  const [driverRuntimes, setDriverRuntimes] = useState<
    DatabaseDriverRuntimeSummary[] | null
  >(null);
  const [catalogUrlInput, setCatalogUrlInput] = useState(catalogUrl);
  const [catalogEntries, setCatalogEntries] = useState<
    DatabaseDriverCatalogEntry[] | null
  >(null);
  const [catalogStatus, setCatalogStatus] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probeStates, setProbeStates] = useState<
    Record<
      string,
      | { status: "loading" }
      | { status: "success"; result: DatabaseDriverProbeResult }
      | { status: "error"; message: string }
    >
  >({});
  const [packageAction, setPackageAction] = useState<
    | { status: "idle" }
    | { status: "loading"; key: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const candidateAvailability = useMemo(() => {
    const installed = installations || [];
    const catalog = catalogEntries || [];
    return REFERENCE_DATABASE_DRIVER_CANDIDATES.map((candidate) => ({
      candidate,
      availability: driverCandidateAvailability(candidate, installed),
      conformance: driverCandidateConformance(candidate, installed, catalog),
      delivery: referenceDriverDeliveryPlan(candidate),
    }));
  }, [catalogEntries, installations]);
  const candidateCoverage = useMemo(
    () => ({
      bundled: candidateAvailability.filter(
        ({ availability }) => availability === "bundled",
      ).length,
      activePackage: candidateAvailability.filter(
        ({ availability }) => availability === "activePackage",
      ).length,
      requiresPackage: candidateAvailability.filter(
        ({ availability }) => availability === "requiresPackage",
      ).length,
      activeRecorded: candidateAvailability.filter(
        ({ conformance }) => conformance.state === "activeRecorded",
      ).length,
      activeUnrecorded: candidateAvailability.filter(
        ({ conformance }) => conformance.state === "activeUnrecorded",
      ).length,
    }),
    [candidateAvailability],
  );

  const refreshInstallations = async () => {
    const [drivers, runtimes, store] = await Promise.all([
      databaseService.listDatabaseDriverInstallations(),
      databaseService.listManagedJavaRuntimes(),
      databaseService.getDatabaseDriverStoreInfo(),
    ]);
    setInstallations(drivers);
    setJavaRuntimes(runtimes);
    setDriverStore(store);
    setLoadError(null);
  };

  const refreshDriverRuntimes = async () => {
    // Older embedded/test hosts can omit this newly added read-only command.
    // Driver installation management must remain usable in that case.
    const loadRuntimes = databaseService.listExternalDatabaseDriverRuntimes;
    if (!loadRuntimes) {
      setDriverRuntimes([]);
      return;
    }
    try {
      setDriverRuntimes(await loadRuntimes());
    } catch {
      setDriverRuntimes([]);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      databaseService.listDatabaseDriverInstallations(),
      databaseService.listManagedJavaRuntimes(),
      databaseService.getDatabaseDriverStoreInfo(),
    ])
      .then(([drivers, runtimes, store]) => {
        if (active) {
          setInstallations(drivers);
          setJavaRuntimes(runtimes);
          setDriverStore(store);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to inspect drivers.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refreshDriverRuntimes();
  }, []);

  useEffect(() => {
    // Runtime health is connection-owned and can change after a sidecar exits;
    // keep the Driver Manager truthful without requiring the user to reopen it.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshDriverRuntimes();
      }
    }, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setCatalogUrlInput(catalogUrl);
  }, [catalogUrl]);

  const checkCatalog = async () => {
    const nextUrl = catalogUrlInput.trim();
    if (!nextUrl) {
      setCatalogEntries(null);
      setCatalogStatus({
        status: "error",
        message: "Enter an HTTPS catalog URL before checking for driver packages.",
      });
      return;
    }
    setCatalogStatus({ status: "loading" });
    try {
      const result = await databaseService.getExternalDatabaseDriverCatalog(nextUrl);
      await updateSettings({
        drivers: { catalogUrl: result.sourceUrl, storePath: driverStorePath },
      });
      setCatalogEntries(result.catalog.packages);
      setCatalogStatus({
        status: "success",
        message: `${result.catalog.packages.length} signed package${result.catalog.packages.length === 1 ? "" : "s"} available for review.`,
      });
    } catch (error) {
      setCatalogEntries(null);
      setCatalogStatus({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to verify driver catalog.",
      });
    }
  };

  const importPackage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Database Driver Package",
      });
      if (typeof selected !== "string") return;
      setPackageAction({ status: "loading", key: "import" });
      const installed = await databaseService.installExternalDatabaseDriver(
        selected,
        true,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installed.displayName} ${installed.packageVersion || ""} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to install driver package.",
      });
    }
  };

  const installCatalogPackage = async (entry: DatabaseDriverCatalogEntry) => {
    const nextUrl = catalogUrlInput.trim();
    if (!nextUrl || !entry.archiveSha256) return;
    const key = `catalog-install:${entry.driverId}:${entry.packageVersion}`;
    try {
      setPackageAction({ status: "loading", key });
      const installed = await databaseService.installExternalDatabaseDriverFromCatalog(
        nextUrl,
        entry.driverId,
        entry.packageVersion,
        true,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installed.displayName} ${installed.packageVersion || ""} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to install driver package.",
      });
    }
  };

  const importJavaRuntime = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Signed Java 21 Runtime",
      });
      if (typeof selected !== "string") return;
      setPackageAction({ status: "loading", key: "import-java" });
      const runtime = await databaseService.installManagedJavaRuntime(selected, true);
      await refreshInstallations();
      setPackageAction({
        status: "success",
        message: `Java ${runtime.javaMajor} runtime ${runtime.runtimeVersion} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to install Java runtime.",
      });
    }
  };

  const migrateDriverStore = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const parentDirectory = await open({
        directory: true,
        multiple: false,
        title: "Choose a parent directory for the migrated Driver Store",
      });
      if (typeof parentDirectory !== "string") return;
      const separator = parentDirectory.includes("\\") ? "\\" : "/";
      const destination = `${parentDirectory.replace(/[\\/]+$/u, "")}${separator}oxide-database-drivers`;
      setPackageAction({ status: "loading", key: "migrate-store" });
      const store = await databaseService.migrateDatabaseDriverStore(destination);
      setDriverStore(store);
      await updateSettings({
        drivers: { catalogUrl, storePath: store.activePath },
      });
      setPackageAction({
        status: "success",
        message: "Driver Store copied and verified. Restart OxideStudio to use the new location; the old store was kept unchanged.",
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to migrate Driver Store.",
      });
    }
  };

  const cleanDriverCache = async () => {
    try {
      setPackageAction({ status: "loading", key: "prune-cache" });
      const result = await databaseService.pruneDatabaseDriverCache();
      const skipped = result.skippedEntries
        ? ` ${result.skippedEntries} unknown or unsafe cache ${result.skippedEntries === 1 ? "entry was" : "entries were"} left unchanged.`
        : "";
      setPackageAction({
        status: "success",
        message: `Freed ${formatDriverCacheBytes(result.bytesRemoved)} from ${result.filesRemoved} cached file${result.filesRemoved === 1 ? "" : "s"}; ${result.retainedVersions} protected version${result.retainedVersions === 1 ? " was" : "s were"} retained.${skipped}`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to clean Driver Store cache.",
      });
    }
  };

  const activatePackage = async (installation: DatabaseDriverInstallation) => {
    const packageVersion = installation.packageVersion;
    if (!packageVersion) return;
    const key = `activate:${installation.driver}:${packageVersion}`;
    setPackageAction({ status: "loading", key });
    try {
      await databaseService.activateExternalDatabaseDriver(
        installation.driver,
        packageVersion,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installation.displayName} ${packageVersion} activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to activate package.",
      });
    }
  };

  const rollbackPackage = async (installation: DatabaseDriverInstallation) => {
    const key = `rollback:${installation.driver}`;
    setPackageAction({ status: "loading", key });
    try {
      const state = await databaseService.rollbackExternalDatabaseDriver(
        installation.driver,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installation.displayName} rolled back to ${state.current}.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to roll back package.",
      });
    }
  };

  const probePackage = async (installation: DatabaseDriverInstallation) => {
    const key = `${installation.driver}:${installation.packageVersion || "active"}`;
    setProbeStates((state) => ({ ...state, [key]: { status: "loading" } }));
    try {
      const result = await databaseService.probeExternalDatabaseDriver(
        installation.driver,
      );
      setProbeStates((state) => ({
        ...state,
        [key]: { status: "success", result },
      }));
    } catch (error) {
      setProbeStates((state) => ({
        ...state,
        [key]: {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to start this driver package.",
        },
      }));
    }
  };

  return (
    <SettingsPanel>
      <SettingsDivider title="Installed database clients" first />
      <p className="mb-3 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        This inventory combines bundled recovery drivers with discovered external
        packages. An external package is enabled only after its signature, target,
        protocol, and executable digest are verified.
      </p>
      {driverStore && (
        <div className="mb-3 flex items-center gap-2 border-y border-[hsl(var(--wb-border-subtle))] py-2 text-[11px]">
          <div className="min-w-0 flex-1">
            <div className="text-[hsl(var(--wb-text-muted))]">Driver Store</div>
            <div className="truncate font-mono text-[hsl(var(--wb-text))]" title={driverStore.activePath}>
              {driverStore.activePath}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="h-6 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
              disabled={packageAction.status === "loading"}
              onClick={() => void cleanDriverCache()}
              title="Remove disposable catalog downloads while keeping active, rollback, connection-pinned, and running package versions"
            >
              {packageAction.status === "loading" && packageAction.key === "prune-cache"
                ? "Cleaning..."
                : "Clean cache"}
            </button>
            <button
              type="button"
              className="h-6 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
              disabled={packageAction.status === "loading"}
              onClick={() => void migrateDriverStore()}
            >
              {packageAction.status === "loading" && packageAction.key === "migrate-store"
                ? "Migrating…"
                : "Move…"}
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-3">
        <span
          role={packageAction.status === "error" ? "alert" : "status"}
          className={cn(
            "min-w-0 truncate text-[11px]",
            packageAction.status === "error"
              ? "text-[hsl(var(--destructive))]"
              : "text-[hsl(var(--wb-text-muted))]",
          )}
          title={"message" in packageAction ? packageAction.message : undefined}
        >
          {"message" in packageAction ? packageAction.message : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
            disabled={packageAction.status === "loading"}
            onClick={() => void importJavaRuntime()}
          >
            {packageAction.status === "loading" && packageAction.key === "import-java"
              ? "Installing…"
              : "Import Java runtime…"}
          </button>
          <button
            type="button"
            className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
            disabled={packageAction.status === "loading"}
            onClick={() => void importPackage()}
          >
            {packageAction.status === "loading" && packageAction.key === "import"
              ? "Installing…"
              : "Import package…"}
          </button>
        </div>
      </div>
      {loadError && (
        <p role="alert" className="py-2 text-[12px] text-[hsl(var(--destructive))]">
          {loadError}
        </p>
      )}
      {!installations && !loadError && (
        <div aria-label="Loading database drivers" className="border-y border-[hsl(var(--wb-border-subtle))]">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="flex h-14 animate-pulse items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] last:border-b-0 motion-reduce:animate-none"
            >
              <span className="h-3 w-28 rounded-[3px] bg-[hsl(var(--wb-hover))]" />
              <span className="h-3 w-40 rounded-[3px] bg-[hsl(var(--wb-hover))]" />
            </div>
          ))}
        </div>
      )}
      {installations && (
        <div className="border-y border-[hsl(var(--wb-border-subtle))]">
          {installations.map((installation) => {
            const packageKey = `${installation.driver}:${installation.packageVersion || "active"}`;
            const probeState = probeStates[packageKey];
            return (
            <div
              key={`${installation.driver}:${installation.distribution}:${installation.packageVersion || installation.clientVersion}`}
              className="grid min-h-14 grid-cols-[minmax(120px,0.8fr)_minmax(170px,1fr)_minmax(150px,1fr)] items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[hsl(var(--wb-text))]">
                  {installation.displayName}
                </div>
                <div className="truncate text-[11px] text-[hsl(var(--wb-text-muted))]">
                  {installation.driver}
                </div>
              </div>
              <div className="min-w-0 font-mono text-[11px] text-[hsl(var(--wb-text))]">
                <span className="break-all">{installation.clientLibrary}</span>{" "}
                <span className="text-[hsl(var(--wb-text-muted))]">
                  {installation.clientVersion}
                </span>
              </div>
              <div className="min-w-0 text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                <div>{installation.implementation}</div>
                <div>
                  {installation.distribution === "external"
                    ? `${installation.active ? "Active" : "Installed"} · package ${installation.packageVersion || "unknown"}`
                    : "Bundled · updates with OxideStudio"}
                </div>
                {installation.runtime && <div>{installation.runtime}</div>}
                {installation.runtimeReady === false && (
                  <div className="text-[hsl(var(--destructive))]">
                    Import a signed Java runtime before connecting.
                  </div>
                )}
                {installation.status && installation.status !== "ready" && (
                  <div
                    className="text-[hsl(var(--destructive))]"
                    title={installation.statusMessage || undefined}
                  >
                    {installation.status === "invalid"
                      ? "Package verification failed"
                      : installation.status === "untrusted"
                        ? "Package signature is not trusted"
                        : "Package is incompatible"}
                  </div>
                )}
                {installation.distribution === "external" &&
                  installation.status === "ready" && (
                    <div className="mt-1.5 flex min-w-0 items-center gap-2">
                      {!installation.active && installation.packageVersion && (
                        <button
                          type="button"
                          className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                          disabled={packageAction.status === "loading"}
                          onClick={() => void activatePackage(installation)}
                        >
                          {packageAction.status === "loading" &&
                          packageAction.key ===
                            `activate:${installation.driver}:${installation.packageVersion}`
                            ? "Activating…"
                            : "Activate"}
                        </button>
                      )}
                      {installation.active && (
                        <button
                          type="button"
                          className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                          disabled={
                            probeState?.status === "loading" ||
                            packageAction.status === "loading"
                          }
                          onClick={() => void probePackage(installation)}
                        >
                          {probeState?.status === "loading"
                            ? "Verifying…"
                            : "Verify package"}
                        </button>
                      )}
                      {installation.active && installation.canRollback && (
                        <button
                          type="button"
                          className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                          disabled={packageAction.status === "loading"}
                          onClick={() => void rollbackPackage(installation)}
                        >
                          {packageAction.status === "loading" &&
                          packageAction.key === `rollback:${installation.driver}`
                            ? "Rolling back…"
                            : "Rollback"}
                        </button>
                      )}
                      {probeState?.status === "success" && (
                        <span className="truncate text-[10px] text-[hsl(var(--wb-accent))]">
                          Started · query
                          {probeState.result.supportsMetadata
                            ? " + metadata"
                            : ""}
                          {probeState.result.supportsTransactions
                            ? " + transactions"
                            : ""}
                          {probeState.result.supportsTableRowMutation
                            ? " + grid edits"
                            : ""}
                          {probeState.result.supportsTableDataTransfer
                            ? " + table transfer"
                            : ""}
                          {probeState.result.tableExportFormats.length > 0
                            ? ` + exports ${probeState.result.tableExportFormats
                                .map((format) => format.toUpperCase())
                                .join("/")}`
                            : ""}
                          {probeState.result.supportsSemanticSchemaMigration
                            ? " + semantic migration"
                            : ""}
                          {probeState.result.supportsAgentReadOnlyEnforcement
                            ? " + Agent read-only"
                            : ""}
                        </span>
                      )}
                      {probeState?.status === "error" && (
                        <span
                          role="alert"
                          className="truncate text-[10px] text-[hsl(var(--destructive))]"
                          title={probeState.message}
                        >
                          Verification failed
                        </span>
                      )}
                    </div>
                  )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {driverRuntimes && driverRuntimes.length > 0 && (
        <>
          <SettingsDivider title="Active external driver runtimes" />
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-[hsl(var(--wb-text-muted))]">
            <span>Connection-owned sidecars. Process controls and driver output stay outside this view.</span>
            <button
              type="button"
              className="shrink-0 text-[10px] text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => void refreshDriverRuntimes()}
              title="Refresh active external driver runtimes"
            >
              Refresh
            </button>
          </div>
          <div className="border-y border-[hsl(var(--wb-border-subtle))]">
            {driverRuntimes.map((runtime) => (
              <div
                key={`${runtime.driver}:${runtime.packageVersion}`}
                className="grid min-h-10 grid-cols-[minmax(110px,0.8fr)_minmax(110px,0.8fr)_minmax(0,1fr)] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-[10px] last:border-b-0"
              >
                <span className="min-w-0 truncate font-medium text-[hsl(var(--wb-text))]">
                  {runtime.driver}
                </span>
                <span className="truncate font-mono text-[hsl(var(--wb-text-muted))]">
                  package {runtime.packageVersion}
                </span>
                <span className="min-w-0 text-right text-[hsl(var(--wb-text-muted))]">
                  {runtime.connectionCount} connection{runtime.connectionCount === 1 ? "" : "s"}
                  {runtime.processIds.length > 0 && (
                    <span title={`Sidecar PID: ${runtime.processIds.join(", ")}`}>
                      {" "}· {runtime.processIds.length} process{runtime.processIds.length === 1 ? "" : "es"}
                    </span>
                  )}
                  {runtime.launchCount > 0 && (
                    <span
                      title={`Observed since this desktop process started${runtime.lastStartedAtMillis ? `. Latest launch: ${new Date(runtime.lastStartedAtMillis).toLocaleString()}` : ""}.`}
                    >
                      {" "}({runtime.launchCount} launch{runtime.launchCount === 1 ? "" : "es"})
                    </span>
                  )}
                  {runtime.unavailableProcessCount > 0 && (
                    <span
                      className="text-amber-400"
                      title="A connected driver entry has no observable sidecar process id. Reconnect it if work fails."
                    >
                      {" "}· {runtime.unavailableProcessCount} unavailable
                    </span>
                  )}
                  {runtime.unhealthyConnectionCount > 0 && (
                    <span
                      className="text-red-400"
                      title="A registered external connection owns a sidecar that has exited. Reconnect the affected data source before continuing."
                    >
                      {" "}· {runtime.unhealthyConnectionCount} exited
                    </span>
                  )}
                  {runtime.observedExitCount > 0 && (
                    <span
                      className="text-amber-400"
                      title={`Observed since this desktop process started${runtime.lastExitObservedAtMillis ? `. Latest observed exit: ${new Date(runtime.lastExitObservedAtMillis).toLocaleString()}` : ""}. Driver output is not retained.`}
                    >
                      {" "}({runtime.observedExitCount} observed exit{runtime.observedExitCount === 1 ? "" : "s"})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SettingsDivider title="Reference package coverage" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        {REFERENCE_DATABASE_DRIVER_CANDIDATES.length} database products are tracked:
        {" "}{candidateCoverage.bundled} bundled, {candidateCoverage.activePackage} active
        package{candidateCoverage.activePackage === 1 ? "" : "s"} ({candidateCoverage.activeRecorded}
        {" "}with recorded version evidence{candidateCoverage.activeUnrecorded
          ? `, ${candidateCoverage.activeUnrecorded} unrecorded`
          : ""}), and {" "}
        {candidateCoverage.requiresPackage} awaiting a signed package. These rows are
        planning and package-discovery metadata, never connection choices by themselves.
      </p>
      <details className="group border-y border-[hsl(var(--wb-border-subtle))]" data-testid="reference-driver-coverage">
        <summary className="flex h-8 cursor-pointer list-none items-center justify-between gap-3 px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]">
          <span>Show tracked driver products</span>
          <span className="font-mono text-[10px] group-open:hidden">{REFERENCE_DATABASE_DRIVER_CANDIDATES.length} products</span>
          <span className="hidden font-mono text-[10px] group-open:inline">Hide list</span>
        </summary>
        <div className="max-h-64 overflow-y-auto border-t border-[hsl(var(--wb-border-subtle))]">
          {candidateAvailability.map(({ candidate, availability, conformance, delivery }) => {
            const catalogRelease = catalogEntries?.find(
              (entry) => entry.driverId === candidate.driver,
            );
            const availabilityLabel =
              conformance.state === "bundled"
                ? "Bundled"
                : conformance.state === "activeRecorded"
                  ? `Verified: ${conformance.verifiedVersions.join(", ")}`
                  : conformance.state === "activeUnrecorded"
                    ? "Active · no version evidence"
                  : catalogRelease
                    ? `Release ${catalogRelease.packageVersion}`
                    : "Package required";
            const availabilityClassName =
              conformance.state === "notInstalled"
                ? "text-[hsl(var(--wb-text-muted))]"
                : conformance.state === "activeUnrecorded"
                  ? "text-amber-400"
                : "text-[hsl(var(--wb-accent))]";
            return (
              <div
                key={candidate.driver}
                className="grid min-h-8 grid-cols-[minmax(140px,1fr)_minmax(88px,0.5fr)_minmax(124px,0.65fr)_minmax(110px,0.55fr)_auto] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[hsl(var(--wb-text))]" title={candidate.driver}>
                  <DatabaseBrandIcon
                    driver={candidate.driver}
                    size={12}
                    className="shrink-0"
                  />
                  <span className="truncate">{candidate.displayName}</span>
                </span>
                <span className="truncate font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                  {candidate.dataModel} · {candidate.preferredRuntime}
                </span>
                <span
                  className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]"
                  title={
                    delivery.lspRoute === "notApplicable"
                      ? "This product needs its own workspace and language provider; it is never routed into the SQL Grid."
                      : `After the matching signed runtime is active: ${delivery.lspLabel}.`
                  }
                >
                  {delivery.lspLabel}
                </span>
                <span
                  className={cn("truncate text-right text-[10px]", availabilityClassName)}
                  title={
                    conformance.state === "activeUnrecorded"
                      ? "The active signed package has no matching signed-catalog server-version conformance record."
                      : conformance.state === "activeRecorded"
                        ? `Matching signed release verified against: ${conformance.verifiedVersions.join(", ")}`
                        : undefined
                  }
                >
                  {availabilityLabel}
                </span>
                {availability === "requiresPackage" &&
                  catalogRelease?.archiveSha256 && (
                    <button
                      type="button"
                      className="col-start-5 justify-self-end text-[10px] text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={packageAction.status === "loading"}
                      onClick={() => void installCatalogPackage(catalogRelease)}
                      title="Install this signed package release after archive and manifest verification"
                    >
                      {packageAction.status === "loading" &&
                      packageAction.key ===
                        `catalog-install:${catalogRelease.driverId}:${catalogRelease.packageVersion}`
                        ? "Installing…"
                        : "Install"}
                    </button>
                  )}
              </div>
            );
          })}
        </div>
      </details>

      <SettingsDivider title="Managed Java runtimes" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        JDBC packages use only an imported, signed Java 21 runtime. The system Java
        installation and PATH are never used to launch a driver.
      </p>
      {javaRuntimes && javaRuntimes.length > 0 ? (
        <div className="border-y border-[hsl(var(--wb-border-subtle))]">
          {javaRuntimes.map((runtime) => (
            <div
              key={`${runtime.javaMajor}:${runtime.target}:${runtime.runtimeVersion}`}
              className="grid min-h-12 grid-cols-[minmax(120px,0.8fr)_minmax(170px,1fr)_minmax(150px,1fr)] items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] py-2 last:border-b-0"
            >
              <div className="text-[12px] font-medium text-[hsl(var(--wb-text))]">
                Java {runtime.javaMajor}
              </div>
              <div className="font-mono text-[11px] text-[hsl(var(--wb-text))]">
                {runtime.runtimeVersion}
              </div>
              <div className="text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                <div>{runtime.active ? "Active" : "Installed"} · {runtime.target}</div>
                {runtime.status !== "ready" && (
                  <div className="text-[hsl(var(--destructive))]" title={runtime.statusMessage || undefined}>
                    Runtime verification failed
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[hsl(var(--wb-text-muted))]">No managed Java runtime installed.</p>
      )}

      <SettingsDivider title="Signed package catalog" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Check a signed HTTPS catalog for independently released packages. A release
        can be installed only when its signed entry includes an archive SHA-256;
        download, digest verification, package verification, and activation checks
        still run locally. Verified release archives are reused from the Driver Store
        only after their digest is checked again. Entries without a digest remain
        review-and-import only.
      </p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Signed driver catalog URL"
          className="h-7 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
          placeholder="https://drivers.example.com/catalog.json"
          value={catalogUrlInput}
          onChange={(event) => setCatalogUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void checkCatalog();
          }}
        />
        <button
          type="button"
          className="h-7 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
          disabled={catalogStatus.status === "loading"}
          onClick={() => void checkCatalog()}
        >
          {catalogStatus.status === "loading" ? "Checking…" : "Check catalog"}
        </button>
      </div>
      {"message" in catalogStatus && (
        <p
          role={catalogStatus.status === "error" ? "alert" : "status"}
          className={cn(
            "mt-1.5 text-[11px]",
            catalogStatus.status === "error"
              ? "text-[hsl(var(--destructive))]"
              : "text-[hsl(var(--wb-text-muted))]",
          )}
        >
          {catalogStatus.message}
        </p>
      )}
      {catalogEntries && catalogEntries.length > 0 && (
        <div className="mt-2 border-y border-[hsl(var(--wb-border-subtle))]">
          {catalogEntries.map((entry) => {
            const matchingInstallations = (installations || []).filter(
              (installation) =>
                installation.distribution === "external" &&
                installation.driver === entry.driverId,
            );
            const exactInstall = matchingInstallations.find(
              (installation) => installation.packageVersion === entry.packageVersion,
            );
            const installedLabel = exactInstall
              ? exactInstall.active
                ? "Active"
                : "Installed"
              : matchingInstallations[0]?.packageVersion
                ? `Installed ${matchingInstallations[0].packageVersion}`
                : null;
            const capabilityLabel = entry.capabilities
              ? `${entry.capabilities.dataModel} · ${entry.capabilities.lspLanguageId} intelligence`
              : null;
            const serverVersionLabel = entry.serverVersionRange?.trim()
              ? `Server compatibility: ${entry.serverVersionRange.trim()}`
              : null;
            const connectVersions = entry.conformance?.connect || [];
            const metadataVersions = entry.conformance?.metadata || [];
            const queryVersions = entry.conformance?.query || [];
            const mutationVersions = entry.conformance?.mutations || [];
            const migrationVersions = entry.conformance?.migration || [];
            const transferVersions = entry.conformance?.dataTransfer || [];
            const conformanceLabel = [
              connectVersions.length
                ? `Connect verified: ${connectVersions.join(", ")}`
                : null,
              metadataVersions.length
                ? `Metadata verified: ${metadataVersions.join(", ")}`
                : null,
              queryVersions.length
                ? `Query verified: ${queryVersions.join(", ")}`
                : null,
              mutationVersions.length
                ? `Grid edits verified: ${mutationVersions.join(", ")}`
                : null,
              migrationVersions.length
                ? `Migration verified: ${migrationVersions.join(", ")}`
                : null,
              transferVersions.length
                ? `Transfer verified: ${transferVersions.join(", ")}`
                : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || null;
            return (
              <div
                key={`${entry.driverId}:${entry.packageVersion}`}
                className="grid grid-cols-[minmax(120px,0.8fr)_minmax(130px,1fr)_minmax(160px,1fr)] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] py-1.5 text-[11px] last:border-b-0"
              >
                <span className="min-w-0" title={entry.driverId}>
                  <span className="block truncate text-[hsl(var(--wb-text))]">
                    {entry.displayName}
                  </span>
                  {capabilityLabel && (
                    <span className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]" title={capabilityLabel}>
                      {capabilityLabel}
                    </span>
                  )}
                  {serverVersionLabel && (
                    <span className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]" title={serverVersionLabel}>
                      {serverVersionLabel}
                    </span>
                  )}
                  {conformanceLabel && (
                    <span className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]" title={conformanceLabel}>
                      {conformanceLabel}
                    </span>
                  )}
                </span>
                <span className="min-w-0 truncate font-mono text-[hsl(var(--wb-text-muted))]">
                  {entry.packageVersion} · protocol {entry.protocolVersion}
                </span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  {installedLabel && (
                    <span className="truncate text-[hsl(var(--wb-text-muted))]" title={installedLabel}>
                      {installedLabel}
                    </span>
                  )}
                  {entry.archiveSha256 && !exactInstall && (
                    <button
                      type="button"
                      className="shrink-0 text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={packageAction.status === "loading"}
                      onClick={() => void installCatalogPackage(entry)}
                      title="Download this signed release, verify its archive digest and package signature, then activate it if no live connection uses another version"
                    >
                      {packageAction.status === "loading" && packageAction.key === `catalog-install:${entry.driverId}:${entry.packageVersion}`
                        ? "Installing…"
                        : "Install"}
                    </button>
                  )}
                  <a
                    className="min-w-0 truncate text-[hsl(var(--wb-accent))] hover:underline"
                    href={entry.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the package download location"
                  >
                    Review download
                  </a>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <SettingsDivider title="Update boundary" />
      <SettingRow label="Independent updates:">
        <span className="text-[12px] text-[hsl(var(--wb-text))]">
          External sidecar packages use an independent update boundary
        </span>
      </SettingRow>
      <p className="max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Bundled clients remain linked into the application as a recovery channel.
        Offline packages are copied through a bounded staging area, reject symbolic
        links, and are committed only when the manifest signature, target, protocol
        major, and entrypoint digest pass validation. Activation keeps one previous
        version for atomic rollback; bundled clients remain the recovery channel.
      </p>
    </SettingsPanel>
  );
}

function AiSettings({
  aiEnabled,
  aiBaseUrl,
  aiModel,
  aiApiKey,
  hasAiProviderSecret,
  aiTimeoutMs,
  aiStreaming,
  aiToolCalling,
  aiStructuredOutput,
  aiMaxInputTokens,
  aiMaxOutputTokens,
  aiInlineCompletionProtocol,
  aiInlineCompletionModel,
  settings,
  onUpdate,
  setAiEnabled,
  updateAiSettings,
  canTestAi,
  isTestingAi,
  isSavingAiSecret,
  aiTestState,
  onTest,
  onPersistSecret,
  onRemoveSecret,
  activeProjectName,
  isClearingAgentState,
  agentStateMessage,
  onClearAgentState,
}: {
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  hasAiProviderSecret: boolean;
  aiTimeoutMs: number;
  aiStreaming: boolean;
  aiToolCalling: boolean;
  aiStructuredOutput: boolean;
  aiMaxInputTokens: number;
  aiMaxOutputTokens: number;
  aiInlineCompletionProtocol: "chat-completions" | "text-completions-fim";
  aiInlineCompletionModel: string;
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
  setAiEnabled: (enabled: boolean) => void;
  updateAiSettings: (settings: Partial<{
    baseUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    streaming: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    maxInputTokens: number;
    maxOutputTokens: number;
    inlineCompletionProtocol: "chat-completions" | "text-completions-fim";
    inlineCompletionModel: string;
  }>) => void;
  canTestAi: boolean;
  isTestingAi: boolean;
  isSavingAiSecret: boolean;
  aiTestState: { status: "success" | "error"; message: string } | null;
  onTest: () => void;
  onPersistSecret: () => void;
  onRemoveSecret: () => void;
  activeProjectName: string;
  isClearingAgentState: boolean;
  agentStateMessage: { status: "success" | "error"; message: string } | null;
  onClearAgentState: () => void;
}) {
  const inlineCompletion = settings.editor.inlineCompletion;
  const updateInlineCompletion = (
    patch: Partial<AppSettings["editor"]["inlineCompletion"]>
  ) =>
    onUpdate({
      editor: {
        ...settings.editor,
        inlineCompletion: { ...inlineCompletion, ...patch },
      },
    });

  return (
    <SettingsPanel>
      <SettingsDivider title="Provider" first />
      <CheckboxLabel
        label="Enable AI assistant"
        checked={aiEnabled}
        onChange={() => setAiEnabled(!aiEnabled)}
        detail="Disabled mode skips the AI runtime and keeps the database workbench available."
      />
      <p className="mb-3 max-w-[68ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Choose O2, Plan, Agent, or Chat from the assistant composer. Planning and
        tool orchestration are selected automatically for the active mode.
      </p>
      <SettingRow label="Base URL:">
        <div>
          <SettingsInput
            value={aiBaseUrl}
            onChange={(value) => updateAiSettings({ baseUrl: value })}
            placeholder="https://api.openai.com/v1"
          />
          <p className="mt-1 text-[11px] text-[hsl(var(--wb-text-muted))]">
            Include the API version path required by your provider, usually /v1.
          </p>
        </div>
      </SettingRow>
      <SettingRow label="Model:">
        <SettingsInput
          value={aiModel}
          onChange={(value) => updateAiSettings({ model: value })}
          placeholder="gpt-4.1-mini"
        />
      </SettingRow>
      <SettingRow label="API Key:">
        <div className="flex items-center gap-2">
          <SettingsInput
            type="password"
            value={aiApiKey}
            onChange={(value) => updateAiSettings({ apiKey: value })}
            onBlur={onPersistSecret}
            placeholder={
              hasAiProviderSecret
                ? "Stored in local credential file"
                : "sk-..."
            }
          />
          {aiApiKey.trim() && (
            <SettingsButton onClick={onPersistSecret} disabled={isSavingAiSecret}>
              {isSavingAiSecret ? "Saving..." : "Save"}
            </SettingsButton>
          )}
          {hasAiProviderSecret && (
            <SettingsButton onClick={onRemoveSecret}>Remove</SettingsButton>
          )}
        </div>
      </SettingRow>
      <p className="-mt-1 mb-3 ml-[148px] max-w-[68ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Stored only in OxideStudio's per-user configuration directory, never in
        the project or browser storage. The credential file is restricted to the
        current OS user.
      </p>
      <SettingRow label="Timeout ms:">
        <NumberInput
          value={aiTimeoutMs}
          min={1000}
          max={120000}
          step={1000}
          onChange={(timeoutMs) => updateAiSettings({ timeoutMs })}
        />
      </SettingRow>
      <SettingRow label="Input tokens:">
        <NumberInput
          value={aiMaxInputTokens}
          min={8_192}
          max={2_000_000}
          step={4_096}
          onChange={(maxInputTokens) => updateAiSettings({ maxInputTokens })}
        />
      </SettingRow>
      <SettingRow label="Output tokens:">
        <NumberInput
          value={aiMaxOutputTokens}
          min={256}
          max={128_000}
          step={256}
          onChange={(maxOutputTokens) => updateAiSettings({ maxOutputTokens })}
        />
      </SettingRow>
      <CheckboxLabel
        label="Model supports streaming"
        checked={aiStreaming}
        onChange={() => updateAiSettings({ streaming: !aiStreaming })}
      />
      <CheckboxLabel
        label="Model supports tool calling"
        checked={aiToolCalling}
        onChange={() => updateAiSettings({ toolCalling: !aiToolCalling })}
      />
      <CheckboxLabel
        label="Model supports structured output"
        checked={aiStructuredOutput}
        onChange={() =>
          updateAiSettings({ structuredOutput: !aiStructuredOutput })
        }
      />

      <div className="mt-4 flex items-center gap-3">
        <SettingsButton onClick={onTest} disabled={!canTestAi || isTestingAi}>
          {isTestingAi ? "Testing..." : "Test Provider"}
        </SettingsButton>
        {aiTestState && (
          <span
            className={cn(
              "text-[12px]",
              aiTestState.status === "success"
                ? "text-emerald-400"
                : "text-[hsl(var(--destructive))]"
            )}
          >
            {aiTestState.message}
          </span>
        )}
      </div>

      <SettingsDivider title="Inline Completion" />
      <CheckboxLabel
        label="Enable inline completion"
        detail="Show database-aware ghost text without executing generated SQL"
        checked={inlineCompletion.enabled}
        onChange={() =>
          updateInlineCompletion({ enabled: !inlineCompletion.enabled })
        }
      />
      <CheckboxLabel
        label="Automatic suggestions"
        checked={inlineCompletion.automaticSuggestions}
        onChange={() =>
          updateInlineCompletion({
            automaticSuggestions: !inlineCompletion.automaticSuggestions,
          })
        }
      />
      <CheckboxLabel
        label="Include schema metadata"
        checked={inlineCompletion.includeSchemaMetadata}
        onChange={() =>
          updateInlineCompletion({
            includeSchemaMetadata: !inlineCompletion.includeSchemaMetadata,
          })
        }
      />
      <CheckboxLabel
        label="Include project context"
        detail="Opt in to sending relevant database-file snippets from the associated project"
        checked={inlineCompletion.includeProjectContext}
        onChange={() =>
          updateInlineCompletion({
            includeProjectContext: !inlineCompletion.includeProjectContext,
          })
        }
      />
      <SettingRow label="Protocol:">
        <select
          className={selectClass}
          value={aiInlineCompletionProtocol}
          onChange={(event) =>
            updateAiSettings({
              inlineCompletionProtocol: event.target.value as
                | "chat-completions"
                | "text-completions-fim",
            })
          }
        >
          <option value="chat-completions">Chat completions</option>
          <option value="text-completions-fim">Text completions (FIM)</option>
        </select>
      </SettingRow>
      <SettingRow label="Completion model:">
        <SettingsInput
          value={aiInlineCompletionModel}
          onChange={(inlineCompletionModel) =>
            updateAiSettings({ inlineCompletionModel })
          }
          placeholder={`Use assistant model (${aiModel || "not configured"})`}
        />
      </SettingRow>
      <p className="mt-2 max-w-[68ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Automatic requests use a 4 second timeout and never include connection
        strings, API keys, query results, or database row data.
      </p>

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
                : "text-[hsl(var(--destructive))]"
            )}
          >
            {agentStateMessage.message}
          </span>
        )}
      </div>
    </SettingsPanel>
  );
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[820px] pb-8">{children}</div>;
}

function SettingsDivider({
  title,
  first = false,
}: {
  title: string;
  first?: boolean;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-2", !first && "mt-6")}>
      <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">{title}</span>
      <span className="h-px flex-1 bg-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 grid grid-cols-[150px_1fr] items-center gap-3">
      <label className="text-right text-[12px] text-[hsl(var(--wb-text))]">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-3">{children}</div>
    </div>
  );
}

function CheckboxLabel({
  label,
  checked,
  detail,
  onChange,
  readOnly,
}: {
  label: string;
  checked?: boolean;
  detail?: string;
  onChange?: () => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex min-h-7 items-center gap-2 text-[12px] text-[hsl(var(--wb-text))]">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={onChange}
        readOnly={readOnly || !onChange}
        className="h-4 w-4 rounded-[3px] border border-[hsl(var(--wb-border))] accent-[hsl(var(--wb-accent))]"
      />
      <span>{label}</span>
      {detail && (
        <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">
          {detail}
        </span>
      )}
    </label>
  );
}

function SettingsInput({
  value,
  onChange,
  placeholder,
  type = "text",
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={inputClass}
    />
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value) || min)}
      className={cn(inputClass, "w-[120px]")}
    />
  );
}

function SettingsIconButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
    >
      {children}
    </button>
  );
}

function SettingsButton({
  children,
  intent = "secondary",
  disabled,
  onClick,
}: {
  children: ReactNode;
  intent?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 min-w-[72px] items-center justify-center rounded-[4px] border px-3 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        intent === "primary"
          ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:brightness-110"
          : "border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
      )}
    >
      {children}
    </button>
  );
}

const inputClass =
  "h-7 w-[360px] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";

const selectClass =
  "h-7 w-[194px] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";
