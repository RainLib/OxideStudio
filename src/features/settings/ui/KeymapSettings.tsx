import {
  SettingsDivider,
  SettingsPanel,
  inputClass,
} from "@/features/settings/ui/SettingsFields";
import { workbenchActions, type WorkbenchActionId } from "@/lib/actions";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/appSettings";
import { keymapConflicts, normalizeKeybinding } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { useMemo } from "react";

export function KeymapSettings({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}) {
  const actions = useMemo(() => workbenchActions(), []);
  const conflicts = keymapConflicts(settings.keymap);
  const conflictBindings = new Set(
    conflicts.map((conflict) => conflict.binding),
  );

  const updateBinding = (actionId: WorkbenchActionId, value: string) => {
    const bindings = value
      .split("|")
      .map((binding) => binding.trim())
      .filter(Boolean);
    onUpdate({
      keymap: {
        ...settings.keymap,
        [actionId]: bindings,
      },
    });
  };

  return (
    <SettingsPanel>
      <SettingsDivider title="Keymap" first />
      <div className="mb-3 flex items-center justify-between gap-4 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2">
        <div className="min-w-0 text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
          DataGrip-compatible tool-window and query shortcuts are enabled by
          default. Separate alternative bindings with{" "}
          <span className="font-mono text-[hsl(var(--wb-text))]">|</span>.
        </div>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))]"
          onClick={() =>
            onUpdate({ keymap: { ...DEFAULT_APP_SETTINGS.keymap } })
          }
        >
          <RotateCcw size={12} /> Restore defaults
        </button>
      </div>
      {conflicts.length > 0 && (
        <div className="mb-3 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          {conflicts.length} shortcut conflict{conflicts.length > 1 ? "s" : ""}{" "}
          found.
        </div>
      )}
      <div className="overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border))]">
        {actions.map((action) => {
          const bindings = settings.keymap[action.id] ?? [];
          const value = bindings.join(" | ");
          const hasConflict = bindings.some((binding) =>
            conflictBindings.has(normalizeKeybinding(binding)),
          );
          return (
            <div
              key={action.id}
              className="grid grid-cols-[minmax(180px,1fr)_110px_minmax(220px,280px)] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1.5 last:border-b-0"
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
                className={cn(
                  inputClass,
                  "w-full font-mono text-[11px]",
                  hasConflict && "border-amber-500/70",
                )}
                spellCheck={false}
              />
            </div>
          );
        })}
      </div>
    </SettingsPanel>
  );
}
