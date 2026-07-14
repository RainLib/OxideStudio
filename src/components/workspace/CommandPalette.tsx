import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Command } from "cmdk";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import {
  APP_EVENT_OPEN_COMMAND_PALETTE,
  workbenchActions,
} from "@/lib/actions";
import { formatKeybinding } from "@/lib/keybindings";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  Database,
  FileCode2,
  Layers3,
  Search,
  Table2,
  Terminal,
} from "lucide-react";
import {
  searchableDatabaseObjects,
  searchableProjectFilePaths,
  rankSearchEverywhereItems,
  type SearchableDatabaseObject,
} from "@/lib/searchEverywhere";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const { tabs, setActiveTab } = useTabStore();
  const { connections, activeConnectionId, setActiveConnection } =
    useConnectionStore();
  const schemas = useSchemaStore((state) => state.schemas);
  const tables = useSchemaStore((state) => state.tables);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const setCurrentSchema = useSchemaStore((state) => state.setCurrentSchema);
  const selectTable = useSchemaStore((state) => state.selectTable);
  const entriesByDirectory = useProjectFilesStore(
    (state) => state.entriesByDirectory
  );
  const projectRootPath = useProjectFilesStore((state) => state.rootPath);
  const keymap = useSettingsStore((state) => state.settings.keymap);
  const actions = useMemo(() => workbenchActions(), []);
  const databaseObjects = useMemo(
    () => searchableDatabaseObjects(schemas, tables, currentSchema),
    [currentSchema, schemas, tables]
  );
  const projectFilePaths = useMemo(
    () => searchableProjectFilePaths(entriesByDirectory),
    [entriesByDirectory]
  );
  const visibleActions = useMemo(
    () =>
      rankSearchEverywhereItems(
        actions,
        deferredSearchQuery,
        (action) => `${action.title} ${action.group} ${action.id}`,
        { limit: 30, emptyLimit: 12 }
      ),
    [actions, deferredSearchQuery]
  );
  const visibleDatabaseObjects = useMemo(
    () =>
      rankSearchEverywhereItems(
        databaseObjects,
        deferredSearchQuery,
        (object) =>
          `${object.name} ${object.schema} ${
            object.kind === "relation" ? object.objectType || "table" : "schema"
          }`,
        { limit: 40, emptyLimit: 12 }
      ),
    [databaseObjects, deferredSearchQuery]
  );
  const visibleProjectFilePaths = useMemo(
    () =>
      rankSearchEverywhereItems(
        projectFilePaths,
        deferredSearchQuery,
        (relativePath) => relativePath,
        { limit: 40, emptyLimit: 12 }
      ),
    [deferredSearchQuery, projectFilePaths]
  );
  const visibleTabs = useMemo(
    () =>
      rankSearchEverywhereItems(
        tabs,
        deferredSearchQuery,
        (tab) => `${tab.title} ${tab.type}`,
        { limit: 40, emptyLimit: 12 }
      ),
    [deferredSearchQuery, tabs]
  );
  const visibleConnections = useMemo(
    () =>
      rankSearchEverywhereItems(
        connections,
        deferredSearchQuery,
        (connection) => `${connection.name} ${connection.driver}`,
        { limit: 40, emptyLimit: 12 }
      ),
    [connections, deferredSearchQuery]
  );

  useEffect(() => {
    const openPalette = () => {
      setCommandError(null);
      setSearchQuery("");
      setOpen(true);
    };
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, openPalette);
    window.addEventListener("oxide:command-palette-open", openPalette);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, openPalette);
      window.removeEventListener("oxide:command-palette-open", openPalette);
    };
  }, []);

  const openDatabaseObject = async (object: SearchableDatabaseObject) => {
    setCommandError(null);
    try {
      if (object.kind === "schema") {
        await setCurrentSchema(object.schema);
      } else {
        if (!activeConnectionId) {
          throw new Error("Activate a data source before opening an object.");
        }
        if (object.schema !== currentSchema) {
          await setCurrentSchema(object.schema);
        }
        selectTable(object.name);
        const tabStore = useTabStore.getState();
        const tabId = tabStore.findOrCreateTableTab(
          activeConnectionId,
          object.schema,
          object.name,
          object.objectType
        );
        await tabStore.loadTablePage(tabId, 0);
      }
      setOpen(false);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  };

  const openProjectFile = async (relativePath: string) => {
    setCommandError(null);
    try {
      await openProjectFileInEditor(relativePath);
      setOpen(false);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  };

  const activateConnection = async (connectionId: string) => {
    setCommandError(null);
    const error = await setActiveConnection(connectionId);
    if (error) {
      setCommandError(error);
      return;
    }
    setOpen(false);
  };

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
        shouldFilter={false}
        className="relative w-full max-w-[680px] overflow-hidden rounded-[7px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[12px] text-[hsl(var(--wb-text))] shadow-[0_22px_70px_rgba(0,0,0,0.48)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <div className="flex h-10 items-center border-b border-[hsl(var(--wb-border-subtle))] px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-[hsl(var(--wb-text-muted))]" />
          <Command.Input
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Search actions, objects, files, tabs, or data sources"
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
          />
          <kbd className="ml-2 rounded-[3px] border border-[hsl(var(--wb-border))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
            Esc
          </kbd>
        </div>

        {commandError && (
          <div
            className="border-b border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
            role="alert"
          >
            {commandError}
          </div>
        )}

        <Command.List className="custom-scrollbar max-h-[420px] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-8 text-center text-[12px] text-[hsl(var(--wb-text-muted))]">
            No matching item.
          </Command.Empty>

          {visibleActions.length > 0 && (
            <Command.Group heading={<GroupHeading>Actions</GroupHeading>}>
              {visibleActions.map((action) => (
                <ActionCommandItem
                  key={action.id}
                  action={action}
                  binding={keymap[action.id]?.[0]}
                  onSelect={() => setOpen(false)}
                />
              ))}
            </Command.Group>
          )}

          {visibleDatabaseObjects.length > 0 && (
            <Command.Group
              heading={<GroupHeading>Active data source</GroupHeading>}
            >
              {visibleDatabaseObjects.map((object) => (
                <Command.Item
                  key={`${object.kind}:${object.schema}:${object.name}`}
                  value={`database object ${object.kind} ${object.schema} ${
                    object.name
                  } ${
                    object.kind === "relation"
                      ? object.objectType || "table"
                      : ""
                  }`}
                  onSelect={() => void openDatabaseObject(object)}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  {object.kind === "schema" ? (
                    <Layers3 size={13} className="shrink-0 text-amber-400" />
                  ) : (
                    <Table2 size={13} className="shrink-0 text-sky-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{object.name}</span>
                  <span className="max-w-40 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {object.kind === "schema"
                      ? "schema"
                      : `${object.schema} · ${object.objectType || "table"}`}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {projectRootPath && visibleProjectFilePaths.length > 0 && (
            <Command.Group heading={<GroupHeading>Project files</GroupHeading>}>
              {visibleProjectFilePaths.map((relativePath) => (
                <Command.Item
                  key={relativePath}
                  value={`project file ${relativePath}`}
                  onSelect={() => void openProjectFile(relativePath)}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  <FileCode2 size={13} className="shrink-0 text-violet-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {relativePath.split("/").pop() || relativePath}
                  </span>
                  <span className="max-w-56 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {relativePath}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {visibleTabs.length > 0 && (
            <Command.Group heading={<GroupHeading>Tabs</GroupHeading>}>
              {visibleTabs.map((tab) => (
                <Command.Item
                  key={tab.id}
                  value={`tab ${tab.title} ${tab.type}`}
                  onSelect={() => {
                    setActiveTab(tab.id);
                    setOpen(false);
                  }}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  <Terminal
                    size={13}
                    className="text-[hsl(var(--wb-text-muted))]"
                  />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {tab.type}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {visibleConnections.length > 0 && (
            <Command.Group heading={<GroupHeading>Connections</GroupHeading>}>
              {visibleConnections.map((connection) => (
                <Command.Item
                  key={connection.id}
                  value={`connection ${connection.name} ${connection.driver}`}
                  onSelect={() => void activateConnection(connection.id)}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 aria-selected:bg-[hsl(var(--wb-active-strong))]"
                >
                  <Database
                    size={13}
                    className="text-[hsl(var(--wb-text-muted))]"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {connection.name}
                  </span>
                  <span className="text-[10px] uppercase text-[hsl(var(--wb-text-muted))]">
                    {connection.id === activeConnectionId
                      ? `${connection.driver} · active`
                      : connection.driver}
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
