import { useContext, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aiService } from "@/services/tauri/ai.service";
import {
  type AiPlannerKind,
  useAiSettingsStore,
} from "@/store/useAiSettingsStore";
import { ThemeContext } from "@/theme/ThemeProvider";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Palette,
  Plug,
  Search,
  Settings2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  lspLanguageId,
  supportedDatabaseDriverProfiles,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection = "appearance" | "ai" | "intelligence" | "plugins";

const settingsTree: Array<{
  id: string;
  label: string;
  icon?: typeof Database;
  children?: Array<{
    id: SettingsSection | string;
    label: string;
    section?: SettingsSection;
  }>;
  section?: SettingsSection;
}> = [
  {
    id: "database",
    label: "Database",
    icon: Database,
    children: [
      { id: "database-general", label: "General" },
      { id: "database-intelligence", label: "Intelligence", section: "intelligence" },
    ],
  },
  {
    id: "appearance-behavior",
    label: "Appearance & Behavior",
    icon: Palette,
    children: [
      { id: "appearance", label: "Appearance", section: "appearance" },
      { id: "menus", label: "Menus and Toolbars" },
      { id: "system-settings", label: "System Settings" },
      { id: "file-colors", label: "File Colors" },
      { id: "notifications", label: "Notifications" },
    ],
  },
  { id: "keymap", label: "Keymap" },
  { id: "editor", label: "Editor" },
  { id: "plugins", label: "Plugins", icon: Plug, section: "plugins" },
  { id: "version-control", label: "Version Control" },
  { id: "languages", label: "Languages" },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    children: [{ id: "ai", label: "AI Assistant", section: "ai" }],
  },
  { id: "backup-sync", label: "Backup and Sync" },
  { id: "advanced", label: "Advanced Settings" },
];

const sectionMeta: Record<SettingsSection, { group: string; title: string }> = {
  appearance: {
    group: "Appearance & Behavior",
    title: "Appearance",
  },
  ai: {
    group: "Tools",
    title: "AI Assistant",
  },
  intelligence: {
    group: "Database",
    title: "Intelligence",
  },
  plugins: {
    group: "Plugins",
    title: "Plugins",
  },
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const themeContext = useContext(ThemeContext);
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);
  const aiPlannerKind = useAiSettingsStore((state) => state.plannerKind);
  const setAiEnabled = useAiSettingsStore((state) => state.setEnabled);
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [filterText, setFilterText] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([
    "database",
    "appearance-behavior",
    "tools",
  ]);
  const [aiTestState, setAiTestState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);

  const visibleTree = useMemo(() => {
    const filter = filterText.trim().toLowerCase();
    if (!filter) return settingsTree;

    const matches: typeof settingsTree = [];
    settingsTree.forEach((item) => {
      const itemMatches = item.label.toLowerCase().includes(filter);
      const children = item.children?.filter((child) =>
        child.label.toLowerCase().includes(filter)
      );

      if (itemMatches || (children && children.length > 0)) {
        matches.push({
          ...item,
          children: itemMatches ? item.children : children,
        });
      }
    });
    return matches;
  }, [filterText]);

  if (!themeContext) return null;
  const { mode, setTheme } = themeContext;
  const canTestAi = Boolean(aiBaseUrl.trim() && aiModel.trim());
  const currentMeta = sectionMeta[activeSection];

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

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    );
  };

  const selectSection = (section?: SettingsSection) => {
    if (section) setActiveSection(section);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[720px] max-h-[calc(100vh-28px)] w-[980px] max-w-[calc(100vw-28px)] gap-0 overflow-hidden rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_24px_70px_rgba(0,0,0,0.46)]">
        <DialogHeader className="relative flex h-10 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-frame))] px-4 py-0">
          <DialogTitle className="text-[12px] font-semibold tracking-normal text-[hsl(var(--wb-text-muted))]">
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure appearance, database intelligence, plugins, and AI assistant preferences.
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

            <nav className="min-h-0 flex-1 overflow-y-auto px-1 py-1 custom-scrollbar">
              {visibleTree.map((item) => (
                <SettingsTreeItem
                  key={item.id}
                  item={item}
                  activeSection={activeSection}
                  expanded={expandedGroups.includes(item.id) || Boolean(filterText)}
                  onToggle={() => toggleGroup(item.id)}
                  onSelect={selectSection}
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
              <div className="flex items-center gap-2 text-[16px] text-[hsl(var(--wb-text-muted))]">
                <span className="opacity-45">←</span>
                <span className="opacity-35">→</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
              {activeSection === "appearance" && (
                <AppearanceSettings mode={mode} setTheme={setTheme} />
              )}
              {activeSection === "ai" && (
                <AiSettings
                  aiEnabled={aiEnabled}
                  aiBaseUrl={aiBaseUrl}
                  aiModel={aiModel}
                  aiApiKey={aiApiKey}
                  aiTimeoutMs={aiTimeoutMs}
                  aiPlannerKind={aiPlannerKind}
                  setAiEnabled={setAiEnabled}
                  updateAiSettings={updateAiSettings}
                  canTestAi={canTestAi}
                  isTestingAi={isTestingAi}
                  aiTestState={aiTestState}
                  onTest={handleTestAiProvider}
                />
              )}
              {activeSection === "intelligence" && <IntelligenceSettings />}
              {activeSection === "plugins" && <PluginSettings />}
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
  item: (typeof settingsTree)[number];
  activeSection: SettingsSection;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (section?: SettingsSection) => void;
}) {
  const Icon = item.icon;
  const hasChildren = Boolean(item.children?.length);
  const itemActive = Boolean(item.section && item.section === activeSection);

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex h-6 w-full items-center gap-1 rounded-[3px] px-1.5 text-left text-[12px] font-semibold",
          itemActive
            ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
            : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
        )}
        onClick={() => (hasChildren ? onToggle() : onSelect(item.section))}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
          )
        ) : (
          <span className="w-[13px]" />
        )}
        {Icon && <Icon size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />}
        <span className="truncate">{item.label}</span>
      </button>

      {hasChildren && expanded && (
        <div>
          {item.children?.map((child) => {
            const childActive = child.section === activeSection;
            return (
              <button
                key={child.id}
                type="button"
                className={cn(
                  "flex h-6 w-full items-center rounded-[3px] pl-12 pr-2 text-left text-[12px]",
                  childActive
                    ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                    : child.section
                      ? "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
                      : "text-[hsl(var(--wb-text-muted))]"
                )}
                onClick={() => onSelect(child.section)}
                disabled={!child.section}
              >
                <span className="truncate">{child.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppearanceSettings({
  mode,
  setTheme,
}: {
  mode: string;
  setTheme: (mode: "light" | "dark" | "system") => void;
}) {
  return (
    <SettingsPanel>
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
        <CheckboxLabel label="Sync with OS" checked={mode === "system"} onChange={() => setTheme(mode === "system" ? "dark" : "system")} />
        <Settings2 size={14} className="text-[hsl(var(--wb-text-muted))]" />
      </SettingRow>

      <SettingRow label="Editor color scheme:">
        <select className={cn(selectClass, "w-[194px]")} value={mode === "light" ? "light" : "dark"} onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <Settings2 size={14} className="text-[hsl(var(--wb-text-muted))]" />
      </SettingRow>

      <div className="mt-4">
        <CheckboxLabel label="Different tool window background" />
        <p className="ml-6 mt-1 text-[12px] text-[hsl(var(--wb-text-muted))]">
          Use lighter color in the dark theme and darker color in the light theme as a background.
        </p>
      </div>

      <SettingsDivider title="Accessibility" />
      <SettingRow label="Zoom:">
        <select className="h-7 w-[80px] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] outline-none">
          <option>100%</option>
          <option>125%</option>
          <option>150%</option>
        </select>
        <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">
          Change with ^` or ^`-. Set to 100% with ^`0
        </span>
      </SettingRow>
      <CheckboxLabel label="Use custom font:" detail="Inter" />
      <CheckboxLabel label="Support screen readers" detail="Requires restart" />
      <CheckboxLabel label="Use contrast scrollbars" />
      <CheckboxLabel label="Adjust colors for red-green vision deficiency" detail="How it works" />

      <SettingsDivider title="UI Options" />
      <div className="grid grid-cols-2 gap-x-10 gap-y-2">
        <CheckboxLabel label="Compact mode" />
        <CheckboxLabel label="Drag-and-drop with Alt pressed only" />
        <CheckboxLabel label="Always show full path in window header" />
        <CheckboxLabel label="Smooth scrolling" checked />
        <CheckboxLabel label="Use project colors in main toolbar" checked />
        <CheckboxLabel label="Enable mnemonics in controls" checked />
      </div>
    </SettingsPanel>
  );
}

function AiSettings({
  aiEnabled,
  aiBaseUrl,
  aiModel,
  aiApiKey,
  aiTimeoutMs,
  aiPlannerKind,
  setAiEnabled,
  updateAiSettings,
  canTestAi,
  isTestingAi,
  aiTestState,
  onTest,
}: {
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  aiTimeoutMs: number;
  aiPlannerKind: AiPlannerKind;
  setAiEnabled: (enabled: boolean) => void;
  updateAiSettings: (settings: Partial<{
    plannerKind: AiPlannerKind;
    baseUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
  }>) => void;
  canTestAi: boolean;
  isTestingAi: boolean;
  aiTestState: { status: "success" | "error"; message: string } | null;
  onTest: () => void;
}) {
  return (
    <SettingsPanel>
      <SettingsDivider title="Provider" first />
      <CheckboxLabel
        label="Enable AI assistant"
        checked={aiEnabled}
        onChange={() => setAiEnabled(!aiEnabled)}
        detail="Off keeps local deterministic planning."
      />
      <SettingRow label="Planner:">
        <select
          className={cn(selectClass, "w-[260px]")}
          value={aiPlannerKind}
          onChange={(event) =>
            updateAiSettings({
              plannerKind: event.target.value as AiPlannerKind,
            })
          }
        >
          <option value="model">Model planner</option>
          <option value="langgraph">LangGraph planner plugin</option>
          <option value="local">Local deterministic planner</option>
        </select>
        <span className="text-[12px] text-[hsl(var(--wb-text-muted))]">
          LangGraph uses @langchain/langgraph and falls back locally.
        </span>
      </SettingRow>
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
        <SettingsInput
          type="password"
          value={aiApiKey}
          onChange={(value) => updateAiSettings({ apiKey: value })}
          placeholder="sk-..."
        />
      </SettingRow>
      <SettingRow label="Timeout ms:">
        <input
          type="number"
          min={1000}
          step={1000}
          value={aiTimeoutMs}
          onChange={(event) =>
            updateAiSettings({ timeoutMs: Number(event.target.value) || 30_000 })
          }
          className={cn(inputClass, "w-[120px]")}
        />
      </SettingRow>

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
    </SettingsPanel>
  );
}

function IntelligenceSettings() {
  return (
    <SettingsPanel>
      <SettingsDivider title="Built-in database intelligence" first />
      <p className="mb-3 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        LSP sessions are loaded for the active supported database type. External providers can be attached later through the plugin interface.
      </p>
      <div className="overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border))]">
        {supportedDatabaseDriverProfiles().map((profile) => {
          const supported = supportsLspLanguageId(profile.driver);
          return (
            <div
              key={profile.driver}
              className="grid grid-cols-[1fr_120px_90px] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium">
                  {profile.menuLabel}
                </div>
                <div className="text-[11px] text-[hsl(var(--wb-text-muted))]">
                  {supported ? `Language: ${lspLanguageId(profile.driver)}` : "No built-in profile"}
                </div>
              </div>
              <div className="text-[11px] text-[hsl(var(--wb-text-muted))]">
                Bundled
              </div>
              <div
                className={cn(
                  "text-[11px] font-medium",
                  supported ? "text-emerald-400" : "text-[hsl(var(--wb-text-muted))]"
                )}
              >
                {supported ? "Auto" : "Off"}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

function PluginSettings() {
  return (
    <SettingsPanel>
      <SettingsDivider title="Plugins" first />
      <div className="flex h-24 items-center rounded-[4px] border border-dashed border-[hsl(var(--wb-border))] px-3 text-[12px] text-[hsl(var(--wb-text-muted))]">
        Plugin management will appear here when extension packaging is enabled.
      </div>
    </SettingsPanel>
  );
}

function SettingsPanel({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[760px] pb-10">{children}</div>;
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
  children: React.ReactNode;
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
}: {
  label: string;
  checked?: boolean;
  detail?: string;
  onChange?: () => void;
}) {
  return (
    <label className="flex min-h-7 items-center gap-2 text-[12px] text-[hsl(var(--wb-text))]">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={onChange}
        readOnly={!onChange}
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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={inputClass}
    />
  );
}

function SettingsButton({
  children,
  intent = "secondary",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
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
