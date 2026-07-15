import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ThemeContext } from "@/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import { keymapConflicts, normalizeKeybinding } from "@/lib/keybindings";
import {
  findWorkbenchAction,
  type WorkbenchActionId,
  workbenchActions,
} from "@/lib/actions";
import type { AppSettings, WorkbenchSide } from "@/lib/appSettings";
import { moveSideToolWindow } from "@/lib/workbenchLayout";
import { parseVimMappings, serializeVimMappings } from "@/lib/vimMappings";
import {
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  Palette,
  Search,
  Settings2,
  TextCursorInput,
} from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection =
  | "appearance"
  | "workbench"
  | "keymap"
  | "editor"
  | "dataEditor"
  | "databaseExplorer"
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

const settingsTree: SettingsTreeGroup[] = [
  {
    id: "appearance-behavior",
    label: "Appearance & Behavior",
    icon: Palette,
    children: [
      { id: "appearance", label: "Appearance", section: "appearance" },
      { id: "workbench", label: "Workbench", section: "workbench" },
      { id: "keymap", label: "Keymap", section: "keymap" },
    ],
  },
  {
    id: "editor",
    label: "Editor",
    icon: TextCursorInput,
    children: [
      { id: "editor", label: "Editor", section: "editor" },
      { id: "dataEditor", label: "Data Editor and Viewer", section: "dataEditor" },
    ],
  },
  {
    id: "database",
    label: "Database",
    icon: Database,
    children: [
      {
        id: "databaseExplorer",
        label: "Database Explorer",
        section: "databaseExplorer",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Bot,
    children: [{ id: "ai", label: "AI Assistant", section: "ai" }],
  },
];

const sectionMeta: Record<SettingsSection, { group: string; title: string }> = {
  appearance: { group: "Appearance & Behavior", title: "Appearance" },
  workbench: { group: "Appearance & Behavior", title: "Workbench" },
  keymap: { group: "Appearance & Behavior", title: "Keymap" },
  editor: { group: "Editor", title: "Editor" },
  dataEditor: { group: "Editor", title: "Data Editor and Viewer" },
  databaseExplorer: { group: "Database", title: "Database Explorer" },
  ai: { group: "Tools", title: "AI Assistant" },
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
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
  const [hasAiProviderSecret, setHasAiProviderSecret] = useState(false);
  const [isClearingAgentState, setIsClearingAgentState] = useState(false);
  const [agentStateMessage, setAgentStateMessage] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);

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

  const visibleTree = useMemo(() => {
    const filter = filterText.trim().toLowerCase();
    if (!filter) return settingsTree;

    return settingsTree
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
  }, [filterText]);

  if (!themeContext) return null;
  const { mode, setTheme } = themeContext;
  const currentMeta = sectionMeta[activeSection];
  const canTestAi = Boolean(aiBaseUrl.trim() && aiModel.trim());

  const updateAppSettings = (updates: Partial<AppSettings>) => {
    void updateSettings(updates);
  };

  const handleTestAiProvider = async () => {
    setAiTestState(null);
    setIsTestingAi(true);
    try {
      const result = await aiService.testProvider({
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
        apiKey: aiApiKey.trim() || undefined,
        timeoutMs: aiTimeoutMs,
      });
      if (aiApiKey.trim()) {
        await aiService.setProviderSecret(aiBaseUrl.trim(), aiApiKey.trim());
        updateAiSettings({ apiKey: "" });
        setHasAiProviderSecret(true);
      }
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

  const persistAiProviderSecret = async () => {
    const secret = aiApiKey.trim();
    if (!secret || !aiBaseUrl.trim()) return;
    try {
      await aiService.setProviderSecret(aiBaseUrl.trim(), secret);
      updateAiSettings({ apiKey: "" });
      setHasAiProviderSecret(true);
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14px] flex h-[calc(100vh-28px)] max-h-none w-[1040px] max-w-[calc(100vw-28px)] translate-y-0 flex-col gap-0 overflow-hidden rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_12px_36px_rgba(0,0,0,0.4)] data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-top-0">
        <DialogHeader className="relative flex h-10 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-frame))] px-4 py-0">
          <DialogTitle className="text-[12px] font-semibold tracking-normal text-[hsl(var(--wb-text-muted))]">
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure workbench layout, keymap, editor, database explorer, data grid, and AI assistant preferences.
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
                  placeholder="Search"
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
                  title="Open settings.json"
                  onClick={() => void findWorkbenchAction("settings.openJson")?.run()}
                >
                  <Braces size={14} />
                </SettingsIconButton>
                <SettingsIconButton title="Reset Settings" onClick={() => void resetSettings()}>
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
          <SettingsButton onClick={() => onOpenChange(false)}>Cancel</SettingsButton>
          <SettingsButton disabled>Apply</SettingsButton>
          <SettingsButton intent="primary" onClick={() => onOpenChange(false)}>
            OK
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
  const appearance = settings.appearance;

  return (
    <SettingsPanel>
      <SettingsDivider title="Theme" first />
      <SettingRow label="Theme:">
        <select
          value={mode}
          onChange={(event) =>
            setTheme(event.target.value as "light" | "dark" | "system")
          }
          className={selectClass}
        >
          <option value="dark">Islands Dark</option>
          <option value="light">Light</option>
          <option value="system">Sync with OS</option>
        </select>
        <CheckboxLabel
          label="Sync with OS"
          checked={mode === "system"}
          onChange={() => setTheme(mode === "system" ? "dark" : "system")}
        />
      </SettingRow>
      <SettingRow label="Editor scheme:">
        <select
          className={selectClass}
          value={mode === "light" ? "light" : "dark"}
          onChange={(event) =>
            setTheme(event.target.value === "light" ? "light" : "dark")
          }
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingRow>
      <SettingsDivider title="Interface" />
      <SettingRow label="UI font size:">
        <NumberInput
          value={appearance.uiFontSize}
          min={10}
          max={20}
          onChange={(uiFontSize) =>
            onUpdate({ appearance: { ...appearance, uiFontSize } })
          }
        />
        <span className="settings-hint">Database Explorer, tabs, toolbars, and AI</span>
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
        toolWindows: {
          ...toolWindows,
          [id]: { ...toolWindows[id], enabled },
        },
      },
    });
  const updateVisibility = (
    id: keyof AppSettings["workbench"]["layout"]["visibility"],
    visible: boolean
  ) =>
    updateLayout({
      visibility: {
        ...layout.visibility,
        [id]: visible,
      },
    });
  const updateSide = (
    id: "databaseExplorer" | "assistant",
    side: WorkbenchSide
  ) => onUpdate({ workbench: moveSideToolWindow(settings.workbench, id, side) });

  return (
    <SettingsPanel>
      <SettingsDivider title="Tool Windows" first />
      <SettingRow label="Database Explorer:">
        <CheckboxLabel
          label="Enabled"
          checked={toolWindows.databaseExplorer.enabled}
          onChange={() =>
            updateToolWindowEnabled(
              "databaseExplorer",
              !toolWindows.databaseExplorer.enabled
            )
          }
        />
        <CheckboxLabel
          label="Open"
          checked={layout.visibility.databaseExplorer}
          onChange={() =>
            updateVisibility(
              "databaseExplorer",
              !layout.visibility.databaseExplorer
            )
          }
        />
        <select
          className={cn(selectClass, "w-[120px]")}
          value={toolWindows.databaseExplorer.side}
          onChange={(event) =>
            updateSide("databaseExplorer", event.target.value as WorkbenchSide)
          }
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </SettingRow>
      <SettingRow label="Secondary Panel:">
        <CheckboxLabel
          label="Enabled"
          checked={toolWindows.assistant.enabled}
          onChange={() =>
            updateToolWindowEnabled("assistant", !toolWindows.assistant.enabled)
          }
        />
        <CheckboxLabel
          label="Open"
          checked={layout.visibility.assistant}
          onChange={() =>
            updateVisibility("assistant", !layout.visibility.assistant)
          }
        />
        <select
          className={cn(selectClass, "w-[120px]")}
          value={toolWindows.assistant.side}
          onChange={(event) =>
            updateSide("assistant", event.target.value as WorkbenchSide)
          }
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </SettingRow>
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
        <SettingsInput
          value={aiBaseUrl}
          onChange={(value) => updateAiSettings({ baseUrl: value })}
          placeholder="https://api.openai.com/v1"
        />
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
                ? "Stored in system credential manager"
                : "sk-..."
            }
          />
          {hasAiProviderSecret && (
            <SettingsButton onClick={onRemoveSecret}>Remove</SettingsButton>
          )}
        </div>
      </SettingRow>
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
