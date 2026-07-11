import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataSourceList } from "./DataSourceList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildConnectionUrl,
  parseConnectionUrl,
} from "@/lib/connectionUrlParser";
import {
  databaseDriverProfile,
  defaultConnectionIcon,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
  supportedDatabaseDriverProfiles,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  databaseService,
  type DatabaseCapabilities,
  type DatabaseDriver,
} from "@/services/tauri";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";

const CONNECTION_COLORS = [
  "#d9904f",
  "#d95b5b",
  "#9b72cf",
  "#5b8dd6",
  "#5fb878",
  "#49a9a2",
  "#7b8798",
  "#b0b5bd",
];

type FormSection = "general" | "ssl" | "advanced";
type ConnectionStatus = {
  type: "success" | "error" | "loading";
  message: string;
} | null;

interface ConnectionFormProps {
  onConnected?: () => void;
  onCancel?: () => void;
}

const fieldClass =
  "h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none transition-colors placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";
const labelClass =
  "flex h-7 items-center justify-end pr-3 text-[11px] text-[hsl(var(--wb-text-muted))]";

function fallbackDriverCapabilities() {
  return supportedDatabaseDriverProfiles().map((profile) =>
    defaultDatabaseCapabilities(profile.driver)
  );
}

function uniqueConnections(
  connections: ConnectionConfig[],
  selectedConnection: ConnectionConfig | null
) {
  if (!selectedConnection) return connections;
  if (connections.some((item) => item.id === selectedConnection.id)) {
    return connections.map((item) =>
      item.id === selectedConnection.id ? selectedConnection : item
    );
  }
  return [selectedConnection, ...connections];
}

export function ConnectionForm({
  onConnected,
  onCancel,
}: ConnectionFormProps = {}) {
  const {
    connections,
    selectedConnection,
    selectConnection,
    createNewConnection,
    updateConnectionConfig,
    saveConnection,
    connect,
    testConnection,
  } = useConnectionStore();
  const [section, setSection] = useState<FormSection>("general");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [driverCapabilities, setDriverCapabilities] =
    useState<DatabaseCapabilities[]>(fallbackDriverCapabilities);

  useEffect(() => {
    let cancelled = false;
    databaseService
      .listDatabaseCapabilities()
      .then((capabilities) => {
        if (!cancelled && capabilities.length > 0) {
          setDriverCapabilities(capabilities);
        }
      })
      .catch(() => {
        if (!cancelled) setDriverCapabilities(fallbackDriverCapabilities());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setStatus(null);
    setSection("general");
  }, [selectedConnection?.id]);

  const driverProfiles = useMemo(() => {
    const profiles = new Map(
      supportedDatabaseDriverProfiles().map((profile) => [
        String(profile.driver),
        profile,
      ])
    );
    driverCapabilities.forEach((capabilities) => {
      profiles.set(
        String(capabilities.driver),
        databaseDriverProfile(capabilities.driver)
      );
    });
    return Array.from(profiles.values());
  }, [driverCapabilities]);

  const dataSources = useMemo(
    () => uniqueConnections(connections, selectedConnection),
    [connections, selectedConnection]
  );

  if (!selectedConnection) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] wb-muted">
        Select or create a data source
      </div>
    );
  }

  const profile = databaseDriverProfile(selectedConnection.driver);
  const capabilities = defaultDatabaseCapabilities(selectedConnection.driver);
  const generatedUrl = buildConnectionUrl({
    driver: selectedConnection.driver,
    host: selectedConnection.host,
    port: selectedConnection.port,
    user: selectedConnection.user,
    password: selectedConnection.password,
    database: selectedConnection.database,
    sslMode: selectedConnection.sslMode || "disable",
  });
  const displayedUrl = selectedConnection.connectionUrl?.trim() || generatedUrl;

  const updateField = (
    field: keyof ConnectionConfig,
    value: ConnectionConfig[keyof ConnectionConfig],
    invalidateUrl = false
  ) => {
    updateConnectionConfig({
      [field]: value,
      ...(invalidateUrl ? { connectionUrl: "" } : {}),
    });
    setStatus(null);
  };

  const changeDriver = (driver: DatabaseDriver) => {
    const previousDriver = selectedConnection.driver;
    const previousDefaultPort = defaultDatabasePort(previousDriver);
    const previousDefaultDatabase = defaultDatabaseName(previousDriver);
    const previousDefaultIcon = defaultConnectionIcon(previousDriver);
    const nextProfile = databaseDriverProfile(driver);

    updateConnectionConfig({
      driver,
      port:
        !selectedConnection.port || selectedConnection.port === previousDefaultPort
          ? defaultDatabasePort(driver) || undefined
          : selectedConnection.port,
      database:
        selectedConnection.database === undefined ||
        selectedConnection.database === previousDefaultDatabase
          ? defaultDatabaseName(driver)
          : selectedConnection.database,
      icon:
        !selectedConnection.icon || selectedConnection.icon === previousDefaultIcon
          ? nextProfile.defaultIcon
          : selectedConnection.icon,
      connectionUrl: "",
    });
    setStatus(null);
  };

  const createDataSource = (driver: DatabaseDriver) => {
    createNewConnection();
    const nextProfile = databaseDriverProfile(driver);
    updateConnectionConfig({
      driver,
      name: `New ${nextProfile.menuLabel} Connection`,
      port: defaultDatabasePort(driver) || undefined,
      database: defaultDatabaseName(driver),
      icon: nextProfile.defaultIcon,
      connectionUrl: "",
    });
  };

  const updateConnectionUrl = (value: string) => {
    const parsed = parseConnectionUrl(value);
    updateConnectionConfig(
      parsed
        ? {
            connectionUrl: value,
            driver: parsed.driver,
            host: parsed.host,
            port: parsed.port,
            user: parsed.user || "",
            password: parsed.password || "",
            database: parsed.database || "",
            sslMode: parsed.sslMode,
          }
        : { connectionUrl: value }
    );
    setStatus(null);
  };

  const handleTest = async () => {
    setStatus({ type: "loading", message: "Testing connection..." });
    try {
      const error = await testConnection(selectedConnection);
      setStatus(
        error
          ? { type: "error", message: error }
          : { type: "success", message: "Connection successful" }
      );
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleApply = async () => {
    setIsSaving(true);
    try {
      await saveConnection(selectedConnection);
      setStatus({ type: "success", message: "Settings saved" });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await saveConnection(selectedConnection);
      const error = await connect(selectedConnection);
      if (error) {
        setStatus({ type: "error", message: error });
      } else {
        onConnected?.();
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-[hsl(var(--wb-editor))]">
      <DataSourceList
        dataSources={dataSources}
        selectedConnectionId={selectedConnection.id}
        driverProfiles={driverProfiles}
        onSelect={selectConnection}
        onCreate={createDataSource}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
          <Database size={15} className={profile.iconClassName} />
          <input
            value={selectedConnection.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-transparent bg-transparent px-2 text-[13px] font-semibold text-[hsl(var(--wb-text))] outline-none hover:border-[hsl(var(--wb-border-subtle))] focus:border-[hsl(var(--wb-accent))] focus:bg-[hsl(var(--wb-editor))]"
            aria-label="Data source name"
          />
          <span className="shrink-0 text-[10px] uppercase wb-muted">
            {capabilities.displayName}
          </span>
        </header>

        <nav className="flex h-9 shrink-0 items-end gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-3">
          {(
            [
              ["general", "General"],
              ["ssl", "SSH/SSL"],
              ["advanced", "Advanced"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={cn(
                "relative flex h-8 items-center px-3 text-[12px]",
                section === value
                  ? "text-[hsl(var(--wb-text))] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-[hsl(var(--wb-accent))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]"
              )}
              onClick={() => setSection(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {section === "general" && (
            <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-2 px-6 py-5">
              <label className={labelClass} htmlFor="connection-host">Host</label>
              <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                <input
                  id="connection-host"
                  value={selectedConnection.host || ""}
                  onChange={(event) =>
                    updateField("host", event.target.value, true)
                  }
                  className={fieldClass}
                  placeholder="localhost"
                />
                <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-right text-[11px] wb-muted">Port</span>
                  <input
                    type="number"
                    value={selectedConnection.port || ""}
                    onChange={(event) =>
                      updateField(
                        "port",
                        event.target.value ? Number(event.target.value) : undefined,
                        true
                      )
                    }
                    className={fieldClass}
                    placeholder={String(defaultDatabasePort(selectedConnection.driver) || "")}
                    aria-label="Port"
                  />
                </div>
              </div>

              <label className={labelClass} htmlFor="connection-user">User</label>
              <input
                id="connection-user"
                value={selectedConnection.user || ""}
                onChange={(event) =>
                  updateField("user", event.target.value, true)
                }
                className={fieldClass}
                autoComplete="off"
              />

              <label className={labelClass} htmlFor="connection-password">Password</label>
              <div className="relative">
                <input
                  id="connection-password"
                  type={showPassword ? "text" : "password"}
                  value={selectedConnection.password || ""}
                  onChange={(event) =>
                    updateField("password", event.target.value, true)
                  }
                  className={cn(fieldClass, "pr-8")}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="wb-icon-button absolute right-0.5 top-0.5"
                  onClick={() => setShowPassword((visible) => !visible)}
                  title={showPassword ? "Hide Password" : "Show Password"}
                >
                  {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>

              <label className={labelClass} htmlFor="connection-database">
                Database
              </label>
              <input
                id="connection-database"
                value={selectedConnection.database || ""}
                onChange={(event) =>
                  updateField("database", event.target.value, true)
                }
                className={fieldClass}
                placeholder={defaultDatabaseName(selectedConnection.driver) || "database"}
              />

              <label className={labelClass} htmlFor="connection-url">URL</label>
              <div className="relative">
                <input
                  id="connection-url"
                  value={displayedUrl}
                  onChange={(event) => updateConnectionUrl(event.target.value)}
                  className={cn(fieldClass, "pr-8 font-mono text-[11px]")}
                />
                {selectedConnection.connectionUrl && (
                  <button
                    type="button"
                    className="wb-icon-button absolute right-0.5 top-0.5"
                    onClick={() => updateField("connectionUrl", "")}
                    title="Rebuild URL from fields"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {section === "ssl" && (
            <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-2 px-6 py-5">
              <span className={labelClass}>SSL mode</span>
              <Select
                value={selectedConnection.sslMode || "disable"}
                onValueChange={(value) => updateField("sslMode", value, true)}
              >
                <SelectTrigger className={fieldClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                  <SelectItem value="disable">Disable</SelectItem>
                  <SelectItem value="prefer">Prefer</SelectItem>
                  <SelectItem value="require">Require</SelectItem>
                  <SelectItem value="verify-ca">Verify CA</SelectItem>
                  <SelectItem value="verify-full">Verify full</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {section === "advanced" && (
            <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-3 px-6 py-5">
              <span className={labelClass}>Driver</span>
              <Select
                value={selectedConnection.driver}
                onValueChange={(value) => changeDriver(value as DatabaseDriver)}
              >
                <SelectTrigger className={fieldClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                  {driverProfiles.map((item) => (
                    <SelectItem key={item.driver} value={item.driver}>
                      {item.menuLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className={labelClass}>Color</span>
              <div className="flex h-7 items-center gap-2">
                {CONNECTION_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={cn(
                      "h-4 w-4 rounded-full border border-white/10 transition-transform hover:scale-110",
                      selectedConnection.color === color &&
                        "ring-2 ring-[hsl(var(--wb-accent))] ring-offset-2 ring-offset-[hsl(var(--wb-editor))]"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => updateField("color", color)}
                    aria-label={`Connection color ${color}`}
                  />
                ))}
              </div>

              <label className={labelClass} htmlFor="connection-tags">Tags</label>
              <input
                id="connection-tags"
                value={(selectedConnection.tags || []).join(", ")}
                onChange={(event) =>
                  updateField(
                    "tags",
                    event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                  )
                }
                className={fieldClass}
                placeholder="development, local"
              />
            </div>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="wb-text-button h-7 border border-[hsl(var(--wb-border))] px-3 text-[12px] text-[hsl(var(--wb-text))]"
              onClick={() => void handleTest()}
              disabled={status?.type === "loading"}
            >
              {status?.type === "loading" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Test Connection
            </button>
            {status && (
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1.5 truncate text-[11px]",
                  status.type === "success"
                    ? "text-emerald-400"
                    : status.type === "error"
                      ? "text-red-400"
                      : "wb-muted"
                )}
              >
                {status.type === "success" && <Check size={12} />}
                {status.type === "error" && <AlertCircle size={12} />}
                <span className="truncate">{status.message}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="wb-text-button h-7 px-3 text-[12px]"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="wb-text-button h-7 border border-[hsl(var(--wb-border))] px-3 text-[12px] text-[hsl(var(--wb-text))]"
              onClick={() => void handleApply()}
              disabled={isSaving}
            >
              Apply
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[64px] justify-center text-[12px]"
              onClick={() => void handleConfirm()}
              disabled={isSaving || !selectedConnection.name.trim()}
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : "OK"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
