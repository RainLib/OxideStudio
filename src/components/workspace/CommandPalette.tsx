import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  APP_EVENT_OPEN_COMMAND_PALETTE,
  workbenchActions,
} from "@/lib/actions";
import { formatKeybinding } from "@/lib/keybindings";
import { useSettingsStore } from "@/store/useSettingsStore";
import { Database, Search, Terminal } from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { tabs, setActiveTab } = useTabStore();
  const { connections, selectConnection } = useConnectionStore();
  const keymap = useSettingsStore((state) => state.settings.keymap);
  const actions = useMemo(() => workbenchActions(), []);

  useEffect(() => {
    const openPalette = () => setOpen(true);
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, openPalette);
    window.addEventListener("oxide:command-palette-open", openPalette);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, openPalette);
      window.removeEventListener("oxide:command-palette-open", openPalette);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[14vh]">
      <button
        type="button"
        className="fixed inset-0 cursor-default"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
      />
      <Command
        className="relative w-full max-w-[680px] overflow-hidden rounded-[7px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[12px] text-[hsl(var(--wb-text))] shadow-[0_22px_70px_rgba(0,0,0,0.48)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <div className="flex h-10 items-center border-b border-[hsl(var(--wb-border-subtle))] px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-[hsl(var(--wb-text-muted))]" />
          <Command.Input
            placeholder="Search actions, tabs, or connections"
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
          />
          <kbd className="ml-2 rounded-[3px] border border-[hsl(var(--wb-border))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
            Esc
          </kbd>
        </div>

        <Command.List className="custom-scrollbar max-h-[420px] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-8 text-center text-[12px] text-[hsl(var(--wb-text-muted))]">
            No matching command.
          </Command.Empty>

          <Command.Group heading={<GroupHeading>Actions</GroupHeading>}>
            {actions.map((action) => (
              <ActionCommandItem
                key={action.id}
                action={action}
                binding={keymap[action.id]?.[0]}
                onSelect={() => setOpen(false)}
              />
            ))}
          </Command.Group>

          {tabs.length > 0 && (
            <Command.Group heading={<GroupHeading>Tabs</GroupHeading>}>
              {tabs.map((tab) => (
                <Command.Item
                  key={tab.id}
                  value={`tab ${tab.title} ${tab.type}`}
                  onSelect={() => {
                    setActiveTab(tab.id);
                    setOpen(false);
                  }}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  <Terminal size={13} className="text-[hsl(var(--wb-text-muted))]" />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {tab.type}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {connections.length > 0 && (
            <Command.Group heading={<GroupHeading>Connections</GroupHeading>}>
              {connections.map((connection) => (
                <Command.Item
                  key={connection.id}
                  value={`connection ${connection.name} ${connection.driver}`}
                  onSelect={() => {
                    selectConnection(connection.id);
                    setOpen(false);
                  }}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  <Database size={13} className="text-[hsl(var(--wb-text-muted))]" />
                  <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                  <span className="text-[10px] uppercase text-[hsl(var(--wb-text-muted))]">
                    {connection.driver}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-normal text-[hsl(var(--wb-text-muted))]">
      {children}
    </div>
  );
}

function ActionCommandItem({
  action,
  binding,
  onSelect,
}: {
  action: ReturnType<typeof workbenchActions>[number];
  binding?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`${action.title} ${action.group} ${action.id}`}
      onSelect={() => {
        void action.run();
        onSelect();
      }}
      className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
    >
      <span className="min-w-0 flex-1 truncate">{action.title}</span>
      <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">
        {action.group}
      </span>
      {binding && (
        <kbd className="rounded-[3px] border border-[hsl(var(--wb-border))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
          {formatKeybinding(binding)}
        </kbd>
      )}
    </Command.Item>
  );
}
