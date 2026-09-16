import { EditorSettingsPreview } from "@/components/settings/EditorSettingsPreview";
import { McpHttpSettings } from "@/components/settings/McpHttpSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DriverManagementSettings } from "@/features/database-drivers/settings/DriverManagementSettings";
import { useAiSettingsController } from "@/features/settings/hooks/useAiSettingsController";
import {
  createSectionMeta,
  createSettingsTree,
  type SettingsSection,
  type SettingsTreeGroup,
} from "@/features/settings/model/settingsNavigation";
import { AiSettings } from "@/features/settings/ui/AiSettings";
import {
  AppearanceAdvancedSettings,
  AppearanceColorSettings,
  AppearanceSettings,
  AppearanceStyleSettings,
  AppearanceTypographySettings,
} from "@/features/settings/ui/AppearanceSettings";
import { DataEditorSettings } from "@/features/settings/ui/DataEditorSettings";
import { DatabaseExplorerSettings } from "@/features/settings/ui/DatabaseExplorerSettings";
import { EditorSettings } from "@/features/settings/ui/EditorSettings";
import { KeymapSettings } from "@/features/settings/ui/KeymapSettings";
import {
  SettingsButton,
  SettingsIconButton,
} from "@/features/settings/ui/SettingsFields";
import { SettingsTreeItem } from "@/features/settings/ui/SettingsTreeItem";
import { WorkbenchSettings } from "@/features/settings/ui/WorkbenchSettings";
import { useI18n } from "@/i18n";
import { findWorkbenchAction } from "@/lib/actions";
import { type AppSettings } from "@/lib/appSettings";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ThemeContext } from "@/theme/ThemeProvider";
import { Braces, ChevronRight, Search, Settings2 } from "lucide-react";
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

const SqliteBackupSettings = lazy(() =>
  import("@/features/database-admin/ui/SqliteBackupSettings").then(
    (module) => ({
      default: module.SqliteBackupSettings,
    }),
  ),
);

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection,
}: SettingsDialogProps) {
  const ai = useAiSettingsController(open, onOpenChange);
  const { t } = useI18n();
  const themeContext = useContext(ThemeContext);
  const appSettings = useSettingsStore((state) => state.settings);
  const settingsError = useSettingsStore((state) => state.error);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [filterText, setFilterText] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([
    "appearance-behavior",
    "editor",
    "database",
    "tools",
  ]);

  const localizedSettingsTree = useMemo(() => createSettingsTree(t), [t]);
  const localizedSectionMeta = useMemo(() => createSectionMeta(t), [t]);

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
          child.label.toLowerCase().includes(filter),
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

  const updateAppSettings = (updates: Partial<AppSettings>) => {
    void updateSettings(updates);
  };

  return (
    <Dialog open={open} onOpenChange={ai.handleOpenChange}>
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
                  expanded={
                    expandedGroups.includes(item.id) || Boolean(filterText)
                  }
                  onToggle={() =>
                    setExpandedGroups((current) =>
                      current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id],
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
                <ChevronRight
                  size={13}
                  className="text-[hsl(var(--wb-text-muted))]"
                />
                <span className="truncate">{currentMeta.title}</span>
              </div>
              <div className="flex items-center gap-1 text-[hsl(var(--wb-text-muted))]">
                <SettingsIconButton
                  title={t("common.openSettingsJson")}
                  onClick={() =>
                    void findWorkbenchAction("settings.openJson")?.run()
                  }
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

            {activeSection === "editor" && filterText.trim().length === 0 && (
              <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-5 py-3">
                <EditorSettingsPreview editor={appSettings.editor} />
              </div>
            )}

            <div
              className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4"
              data-settings-scroll-body
            >
              {activeSection === "appearance" && (
                <AppearanceSettings
                  mode={mode}
                  setTheme={setTheme}
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "appearanceStyles" && (
                <AppearanceStyleSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "appearanceColors" && (
                <AppearanceColorSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "appearanceTypography" && (
                <AppearanceTypographySettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "appearanceAdvanced" && (
                <AppearanceAdvancedSettings
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
                <KeymapSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "editor" && (
                <EditorSettings
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
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
              {activeSection === "backups" && (
                <Suspense
                  fallback={
                    <div className="py-8 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
                      Loading backup schedules…
                    </div>
                  }
                >
                  <SqliteBackupSettings />
                </Suspense>
              )}
              {activeSection === "ai" && (
                <AiSettings
                  {...ai.panelProps}
                  settings={appSettings}
                  onUpdate={updateAppSettings}
                />
              )}
              {activeSection === "mcp" && <McpHttpSettings />}
            </div>
          </main>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 sm:space-x-0">
          <SettingsButton onClick={() => ai.handleOpenChange(false)}>
            {t("common.cancel")}
          </SettingsButton>
          <SettingsButton disabled>{t("common.apply")}</SettingsButton>
          <SettingsButton
            intent="primary"
            onClick={() => ai.handleOpenChange(false)}
          >
            {t("common.ok")}
          </SettingsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { SettingsSection } from "@/features/settings/model/settingsNavigation";
