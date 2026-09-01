import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  CONNECTION_ICON_OPTIONS,
  ConnectionGlyph,
} from "@/components/icons/ConnectionGlyph";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import { useEffect, useMemo, useState } from "react";
import { DataSourceList } from "./DataSourceList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  applyElasticsearchConnectionOptions,
  buildConnectionUrl,
  elasticsearchConnectionOptionsFromQueryParams,
  parseConnectionUrl,
} from "@/lib/connectionUrlParser";
import {
  databaseDriverProfile,
  connectionUrlTemplateForDriver,
  defaultConnectionIcon,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  dataSourceDriverChoices,
  type DataSourceDriverAvailability,
} from "@/features/database-drivers";
import {
  connectionService,
  databaseService,
  type DatabaseCapabilities,
  type DatabaseDriverCatalogEntry,
  type DatabaseDriver,
  type DatabaseDriverInstallation,
} from "@/services/tauri";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { shouldShowConnectionUrl } from "@/features/database-drivers/model/connectionFormVisibility";

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
  scope?: "connection" | "ssh";
} | null;

interface ConnectionFormProps {
  onConnected?: () => void;
  onCancel?: () => void;
}

const fieldClass =
  "h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none transition-colors placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";
const labelClass =
  "flex h-7 items-center justify-end pr-3 text-[11px] text-[hsl(var(--wb-text-muted))]";
const ACTIVE_DRIVER_PACKAGE_VALUE = "__oxide_active_driver_package__";

function signedCatalogReleaseForDriver(
  entries: DatabaseDriverCatalogEntry[],
  driver: DatabaseDriver,
) {
  return (
    entries.find(
      (entry) =>
        entry.driverId.toLowerCase() === driver.toLowerCase() &&
        Boolean(entry.archiveSha256),
    ) || null
  );
}

function normalizeSignedCatalogUrl(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function uniqueConnections(
  connections: ConnectionConfig[],
  selectedConnection: ConnectionConfig | null,
) {
  if (!selectedConnection) return connections;
  if (connections.some((item) => item.id === selectedConnection.id)) {
    return connections.map((item) =>
      item.id === selectedConnection.id ? selectedConnection : item,
    );
  }
  return [selectedConnection, ...connections];
}

function ConnectionAppearancePicker({
  connection,
  defaultIcon,
  onUpdate,
}: {
  connection: ConnectionConfig;
  defaultIcon: string;
  onUpdate: (
    field: keyof ConnectionConfig,
    value: ConnectionConfig[keyof ConnectionConfig],
    invalidateUrl?: boolean,
  ) => void;
}) {
  const usesDatabaseIcon =
    !connection.icon || connection.icon === defaultIcon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 border border-transparent px-2 hover:border-[hsl(var(--wb-border-subtle))]"
          aria-label="Customize connection appearance"
          title="Connection color and icon"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-[3px]"
            style={{
              color: connection.color || undefined,
              backgroundColor: connection.color
                ? `${connection.color}18`
                : undefined,
            }}
          >
            <ConnectionGlyph
              driver={connection.driver}
              icon={connection.icon}
              size={12}
              style={{ color: connection.color || undefined }}
            />
          </span>
          <span>Appearance</span>
          <Palette size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={5}
        className="w-[316px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
      >
        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2">
          <div className="text-[11px] font-semibold">Connection appearance</div>
          <div className="mt-0.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
            The database icon is used until you choose a custom one.
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div>
            <div className="mb-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]">
              Icon
            </div>
            <div
              className="flex min-h-7 flex-wrap items-center gap-1"
              role="radiogroup"
              aria-label="Connection icon"
            >
              <button
                type="button"
                role="radio"
                aria-checked={usesDatabaseIcon}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                  usesDatabaseIcon &&
                    "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
                )}
                onClick={() => onUpdate("icon", undefined)}
                title="Database default"
              >
                <DatabaseBrandIcon driver={connection.driver} size={14} />
              </button>
              {CONNECTION_ICON_OPTIONS.map((icon) => {
                const isSelected = !usesDatabaseIcon && connection.icon === icon;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    key={icon}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                      isSelected &&
                        "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
                    )}
                    onClick={() => onUpdate("icon", icon)}
                    title={icon}
                  >
                    <ConnectionGlyph
                      driver={connection.driver}
                      icon={icon}
                      size={14}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]">
              Color
            </div>
            <div
              className="flex h-7 items-center gap-2"
              role="radiogroup"
              aria-label="Connection background color"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!connection.color}
                className={cn(
                  "relative h-4 w-4 rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))]",
                  !connection.color &&
                    "ring-2 ring-[hsl(var(--wb-accent))] ring-offset-2 ring-offset-[hsl(var(--wb-panel-raised))]",
                )}
                onClick={() => onUpdate("color", undefined)}
                aria-label="No connection background color"
                title="No background color"
              >
                <span className="absolute left-[2px] top-[7px] h-px w-[10px] -rotate-45 bg-[hsl(var(--wb-text-muted))]" />
              </button>
              {CONNECTION_COLORS.map((color) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={connection.color === color}
                  key={color}
                  className={cn(
                    "h-4 w-4 rounded-full border border-white/10",
                    connection.color === color &&
                      "ring-2 ring-[hsl(var(--wb-accent))] ring-offset-2 ring-offset-[hsl(var(--wb-panel-raised))]",
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => onUpdate("color", color)}
                  aria-label={`Connection color ${color}`}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showSshPassphrase, setShowSshPassphrase] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingDriverStatus, setIsRefreshingDriverStatus] =
    useState(false);
  const [isInstallingDriver, setIsInstallingDriver] = useState(false);
  const [catalogRelease, setCatalogRelease] =
    useState<DatabaseDriverCatalogEntry | null>(null);
  const [isCatalogInstallSetupOpen, setIsCatalogInstallSetupOpen] =
    useState(false);
  const [catalogUrlInput, setCatalogUrlInput] = useState("");
  const [sqliteWorkerBaseUrlInput, setSqliteWorkerBaseUrlInput] = useState("");
  const [isPreparingSqliteWorker, setIsPreparingSqliteWorker] = useState(false);
  const [driverPackages, setDriverPackages] = useState<
    DatabaseDriverInstallation[]
  >([]);
  const [resolvedCapabilities, setResolvedCapabilities] =
    useState<DatabaseCapabilities | null>(null);
  const driverProfiles = useDatabaseDriverCatalogStore(
    (state) => state.profiles,
  );
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const loadDatabaseDriverCatalog = useDatabaseDriverCatalogStore(
    (state) => state.load,
  );
  const refreshDatabaseDriverCatalog = useDatabaseDriverCatalogStore(
    (state) => state.refresh,
  );
  const driverCatalogUrl = useSettingsStore(
    (state) => state.settings.drivers.catalogUrl,
  );
  const driverStorePath = useSettingsStore(
    (state) => state.settings.drivers.storePath,
  );
  const sqliteWorkerBaseUrl = useSettingsStore(
    (state) => state.settings.drivers.sqliteWorkerBaseUrl,
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const showConnectionNotes = useSettingsStore(
    (state) => state.settings.databaseExplorer.showConnectionNotes,
  );

  useEffect(() => {
    void loadDatabaseDriverCatalog();
  }, [loadDatabaseDriverCatalog]);

  useEffect(() => {
    if (driverCatalogStatus !== "ready") {
      return;
    }
    let active = true;
    void databaseService
      .listDatabaseDriverInstallations()
      .then((installations) => {
        if (active) setDriverPackages(installations);
      })
      .catch(() => {
        if (active) setDriverPackages([]);
      });
    return () => {
      active = false;
    };
  }, [driverCatalogStatus]);

  useEffect(() => {
    setStatus(null);
    setSection("general");
  }, [selectedConnection?.id, selectedConnection?.driver]);

  useEffect(() => {
    if (!selectedConnection) {
      setResolvedCapabilities(null);
      return;
    }
    let active = true;
    setResolvedCapabilities(null);
    void databaseService
      .getDatabaseCapabilities(
        selectedConnection.driver,
        selectedConnection.driverPackageVersion,
      )
      .then((nextCapabilities) => {
        if (active) setResolvedCapabilities(nextCapabilities);
      })
      .catch((error) => {
        console.warn(
          "Failed to load the selected driver package capabilities",
          error,
        );
        if (active) {
          setResolvedCapabilities(
            defaultDatabaseCapabilities(selectedConnection.driver),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedConnection?.driver, selectedConnection?.driverPackageVersion, selectedConnection?.id]);

  useEffect(() => {
    const driver = selectedConnection?.driver;
    const catalogUrl = driverCatalogUrl.trim();
    if (!driver || !catalogUrl) {
      setCatalogRelease(null);
      return;
    }
    let active = true;
    void databaseService
      .getExternalDatabaseDriverCatalog(catalogUrl)
      .then((result) => {
        if (!active) return;
        setCatalogRelease(signedCatalogReleaseForDriver(result.catalog.packages, driver));
      })
      .catch(() => {
        if (active) setCatalogRelease(null);
      });
    return () => {
      active = false;
    };
  }, [driverCatalogUrl, selectedConnection?.driver]);

  useEffect(() => {
    setCatalogUrlInput(driverCatalogUrl);
  }, [driverCatalogUrl]);

  useEffect(() => {
    setSqliteWorkerBaseUrlInput(sqliteWorkerBaseUrl);
  }, [sqliteWorkerBaseUrl]);

  const dataSources = useMemo(
    () => uniqueConnections(connections, selectedConnection),
    [connections, selectedConnection],
  );
  const driverChoices = useMemo(
    () => dataSourceDriverChoices(driverProfiles, driverPackages),
    [driverPackages, driverProfiles],
  );

  if (!selectedConnection) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] wb-muted">
        Select or create a data source
      </div>
    );
  }

  const profile = databaseDriverProfile(selectedConnection.driver);
  const selectedDriverChoice = driverChoices.find(
    (choice) => choice.driver === selectedConnection.driver,
  );
  const selectedDriverAvailability: DataSourceDriverAvailability =
    selectedDriverChoice?.availability || "available";
  const selectedDriverLabel = selectedDriverChoice?.label || profile.menuLabel;
  const canUseSelectedDriver = selectedDriverAvailability === "available";
  const capabilities =
    resolvedCapabilities || defaultDatabaseCapabilities(selectedConnection.driver);
  const isFileBased = capabilities.connectionMode === "file";
  const supportsConnectionDatabase =
    capabilities.supportsConnectionDatabase !== false;
  const showConnectionUrl = shouldShowConnectionUrl(capabilities.dataModel);
  const fileDriver = selectedConnection.driver.toLowerCase();
  const isRemoteSqlite = fileDriver === "sqlite";
  const fileExtension =
    fileDriver === "duckdb" ? "duckdb" : fileDriver === "sqlite" ? "sqlite" : "db";
  const formSections: ReadonlyArray<readonly [FormSection, string]> =
    isFileBased
      ? isRemoteSqlite
        ? [["general", "General"], ["ssl", "Remote"], ["advanced", "Advanced"]]
        : [["general", "General"], ["advanced", "Advanced"]]
      : [
          ["general", "General"],
          ["ssl", "SSH/SSL"],
          ["advanced", "Advanced"],
        ];
  const installedDriverPackages = driverPackages.filter(
    (installation) =>
      installation.distribution === "external" &&
      installation.driver.toLowerCase() ===
        selectedConnection.driver.toLowerCase() &&
      installation.status === "ready" &&
      Boolean(installation.packageVersion),
  );
  // A Java package without an activated, verified managed runtime is installed
  // but not connectable. Do not offer it as a pin: selecting it would save a
  // connection that can only fail before the sidecar handshake.
  const availableDriverPackages = installedDriverPackages.filter(
    (installation) => installation.runtimeReady !== false,
  );
  const unavailableDriverPackages = installedDriverPackages.filter(
    (installation) => installation.runtimeReady === false,
  );
  const selectedDriverPackage = availableDriverPackages.find((installation) =>
    selectedConnection.driverPackageVersion
      ? installation.packageVersion === selectedConnection.driverPackageVersion
      : installation.active,
  );
  const connectionUrlTemplate =
    selectedDriverPackage?.connectionUrlTemplate ||
    connectionUrlTemplateForDriver(selectedConnection.driver);
  const baseGeneratedUrl = buildConnectionUrl({
    driver: selectedConnection.driver,
    host: selectedConnection.host,
    port: selectedConnection.port,
    user: selectedConnection.user,
    password: selectedConnection.password,
    database: supportsConnectionDatabase ? selectedConnection.database : "",
    sslMode: selectedConnection.sslMode || "disable",
    connectionUrlTemplate,
  });
  const generatedUrl =
    selectedConnection.driver === "elasticsearch"
      ? applyElasticsearchConnectionOptions(baseGeneratedUrl, {
          mode: selectedConnection.elasticsearchMode,
          kibanaBasePath: selectedConnection.elasticsearchKibanaBasePath,
          connectivityCheckPath:
            selectedConnection.elasticsearchConnectivityCheckPath,
          connectivityCheckDisabled:
            selectedConnection.elasticsearchConnectivityCheckDisabled,
          indexGroupingPattern: selectedConnection.indexGroupingPattern,
        })
      : baseGeneratedUrl;
  const displayedUrl = selectedConnection.connectionUrl?.trim() || generatedUrl;
  const sshTunnel = {
    enabled: false,
    host: "",
    port: 22,
    username: "",
    authMethod: "password" as const,
    password: "",
    privateKeyPath: "",
    privateKeyPassphrase: "",
    strictHostKeyChecking: true,
    jumpHosts: [],
    ...selectedConnection.sshTunnel,
  };
  const remoteSqlite = {
    placement: "session" as const,
    workerPath: "",
    allowWorkerUpload: false,
    approvedWorkerDigest: undefined,
    ...sshTunnel.remoteSqlite,
  };

  const updateField = (
    field: keyof ConnectionConfig,
    value: ConnectionConfig[keyof ConnectionConfig],
    invalidateUrl = false,
  ) => {
    updateConnectionConfig({
      [field]: value,
      ...(invalidateUrl ? { connectionUrl: "" } : {}),
    });
    setStatus(null);
  };

  const updateSshTunnel = (
    updates: Partial<NonNullable<ConnectionConfig["sshTunnel"]>>,
  ) => {
    const targetChanged = ["host", "port", "username"].some((field) =>
      Object.prototype.hasOwnProperty.call(updates, field),
    );
    updateConnectionConfig({
      sshTunnel: {
        ...sshTunnel,
        ...updates,
        ...(targetChanged && sshTunnel.remoteSqlite
          ? {
              remoteSqlite: {
                ...sshTunnel.remoteSqlite,
                allowWorkerUpload: false,
                approvedWorkerDigest: undefined,
              },
            }
          : {}),
      },
    });
    setStatus(null);
  };

  const updateRemoteSqlite = (
    updates: Partial<NonNullable<typeof sshTunnel.remoteSqlite>>,
  ) => {
    const destinationChanged = ["placement", "workerPath"].some((field) =>
      Object.prototype.hasOwnProperty.call(updates, field),
    );
    updateSshTunnel({
      remoteSqlite: {
        ...remoteSqlite,
        ...updates,
        ...(destinationChanged
          ? { allowWorkerUpload: false, approvedWorkerDigest: undefined }
          : {}),
      },
    });
  };

  const addSshJumpHost = () => {
    const hops = sshTunnel.jumpHosts || [];
    if (hops.length >= 3) {
      setStatus({
        type: "error",
        message: "An SSH route supports at most four hops including the primary host.",
      });
      return;
    }
    updateSshTunnel({
      jumpHosts: [
        ...hops,
        {
          host: "",
          port: 22,
          username: "",
          authMethod: "password",
          password: "",
          privateKeyPath: "",
          privateKeyPassphrase: "",
          strictHostKeyChecking: true,
        },
      ],
    });
  };

  const updateSshJumpHost = (
    index: number,
    updates: Partial<NonNullable<typeof sshTunnel.jumpHosts>[number]>,
  ) => {
    const hops = (sshTunnel.jumpHosts || []).map((hop, hopIndex) =>
      hopIndex === index ? { ...hop, ...updates } : hop,
    );
    // A multi-hop route is one security boundary. Any modification requires a
    // fresh signed-worker preparation on the final SSH host.
    updateSshTunnel({
      jumpHosts: hops,
      ...(sshTunnel.remoteSqlite
        ? {
            remoteSqlite: {
              ...sshTunnel.remoteSqlite,
              allowWorkerUpload: false,
              approvedWorkerDigest: undefined,
            },
          }
        : {}),
    });
  };

  const removeSshJumpHost = (index: number) => {
    updateSshTunnel({
      jumpHosts: (sshTunnel.jumpHosts || []).filter(
        (_, hopIndex) => hopIndex !== index,
      ),
      ...(sshTunnel.remoteSqlite
        ? {
            remoteSqlite: {
              ...sshTunnel.remoteSqlite,
              allowWorkerUpload: false,
              approvedWorkerDigest: undefined,
            },
          }
        : {}),
    });
  };

  const changeDriver = (driver: DatabaseDriver) => {
    const previousDriver = selectedConnection.driver;
    const previousDefaultPort = defaultDatabasePort(previousDriver);
    const previousDefaultDatabase = defaultDatabaseName(previousDriver);
    const previousDefaultIcon = defaultConnectionIcon(previousDriver);
    updateConnectionConfig({
      driver,
      port:
        !selectedConnection.port ||
        selectedConnection.port === previousDefaultPort
          ? defaultDatabasePort(driver) || undefined
          : selectedConnection.port,
      database:
        selectedConnection.database === undefined ||
        selectedConnection.database === previousDefaultDatabase
          ? defaultDatabaseName(driver)
          : selectedConnection.database,
      icon:
        !selectedConnection.icon ||
        selectedConnection.icon === previousDefaultIcon
          ? undefined
          : selectedConnection.icon,
      driverPackageVersion: undefined,
      connectionUrl: "",
    });
    setStatus(null);
  };

  const createDataSource = (driver: DatabaseDriver) => {
    createNewConnection();
    const nextChoice = driverChoices.find((choice) => choice.driver === driver);
    const nextProfile = databaseDriverProfile(driver);
    updateConnectionConfig({
      driver,
      name: `New ${nextChoice?.label || nextProfile.menuLabel} Connection`,
      port: defaultDatabasePort(driver) || undefined,
      database: defaultDatabaseName(driver),
      icon: undefined,
      connectionUrl: "",
    });
  };

  const updateConnectionUrl = (value: string) => {
    const parsed = parseConnectionUrl(value, selectedConnection.driver);
    const elasticsearchOptions =
      parsed?.driver === "elasticsearch"
        ? elasticsearchConnectionOptionsFromQueryParams(parsed.queryParams)
        : null;
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
            ...(elasticsearchOptions
              ? {
                  elasticsearchMode: elasticsearchOptions.mode,
                  elasticsearchKibanaBasePath:
                    elasticsearchOptions.kibanaBasePath,
                  elasticsearchConnectivityCheckPath:
                    elasticsearchOptions.connectivityCheckPath,
                  elasticsearchConnectivityCheckDisabled:
                    elasticsearchOptions.connectivityCheckDisabled,
                  indexGroupingPattern:
                    elasticsearchOptions.indexGroupingPattern,
                }
              : {}),
          }
        : { connectionUrl: value },
    );
    setStatus(null);
  };

  const refreshDriverStatus = async () => {
    setIsRefreshingDriverStatus(true);
    try {
      await refreshDatabaseDriverCatalog();
      const installations = await databaseService.listDatabaseDriverInstallations();
      setDriverPackages(installations);
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not refresh driver status.",
      });
    } finally {
      setIsRefreshingDriverStatus(false);
    }
  };

  const installSelectedDriver = async () => {
    if (!selectedConnection) return;
    setIsInstallingDriver(true);
    setStatus({ type: "loading", message: "Installing signed driver package..." });
    try {
      if (selectedDriverAvailability === "activationRequired") {
        const inactivePackage = driverPackages.find(
          (installation) =>
            installation.driver.toLowerCase() ===
              selectedConnection.driver.toLowerCase() &&
            installation.distribution === "external" &&
            installation.status === "ready" &&
            installation.runtimeReady !== false &&
            installation.packageVersion,
        );
        if (!inactivePackage?.packageVersion) {
          throw new Error("No verified installed package is available to activate.");
        }
        await databaseService.activateExternalDatabaseDriver(
          selectedConnection.driver,
          inactivePackage.packageVersion,
        );
      } else if (catalogRelease && driverCatalogUrl.trim()) {
        await databaseService.installExternalDatabaseDriverFromCatalog(
          driverCatalogUrl.trim(),
          catalogRelease.driverId,
          catalogRelease.packageVersion,
          true,
        );
      } else {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const packageDirectory = await open({
          directory: true,
          multiple: false,
          title: `Choose Signed ${selectedDriverLabel} Driver Package`,
        });
        if (typeof packageDirectory !== "string") {
          setStatus(null);
          return;
        }
        await databaseService.installExternalDatabaseDriver(packageDirectory, true);
      }
      await refreshDriverStatus();
      setStatus({
        type: "success",
        message: `${selectedDriverLabel} is installed and ready to use.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not install the driver package.",
      });
    } finally {
      setIsInstallingDriver(false);
    }
  };

  const installSelectedDriverFromCatalogUrl = async () => {
    if (!selectedConnection) return;
    const catalogUrl = normalizeSignedCatalogUrl(catalogUrlInput);
    if (!catalogUrl) {
      setStatus({
        type: "error",
        message: "Enter a signed HTTPS catalog URL without credentials, query parameters, or fragments.",
      });
      return;
    }
    setIsInstallingDriver(true);
    setStatus({ type: "loading", message: "Checking the signed driver catalog..." });
    try {
      const result = await databaseService.getExternalDatabaseDriverCatalog(
        catalogUrl,
      );
      const release = signedCatalogReleaseForDriver(
        result.catalog.packages,
        selectedConnection.driver,
      );
      if (!release) {
        throw new Error(
          `The signed catalog has no downloadable ${selectedDriverLabel} package.`,
        );
      }
      await updateSettings({
        drivers: {
          catalogUrl: result.sourceUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl,
        },
      });
      setCatalogRelease(release);
      setStatus({ type: "loading", message: "Downloading and verifying signed driver package..." });
      await databaseService.installExternalDatabaseDriverFromCatalog(
        result.sourceUrl,
        release.driverId,
        release.packageVersion,
        true,
      );
      await refreshDriverStatus();
      setIsCatalogInstallSetupOpen(false);
      setStatus({
        type: "success",
        message: `${selectedDriverLabel} is installed and ready to use.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not install the driver package.",
      });
    } finally {
      setIsInstallingDriver(false);
    }
  };

  const selectDriverPackage = (value: string) => {
    const packageVersion =
      value === ACTIVE_DRIVER_PACKAGE_VALUE ? undefined : value;
    const nextPackage = availableDriverPackages.find((installation) =>
      packageVersion
        ? installation.packageVersion === packageVersion
        : installation.active,
    );
    const nextTemplate = nextPackage?.connectionUrlTemplate;
    updateConnectionConfig({
      driverPackageVersion: packageVersion,
      // Persist a template-generated value at the moment a version is picked.
      // That makes a connection pin independent from a later active-package
      // change which may use a different JDBC grammar.
      ...(nextTemplate && !selectedConnection.connectionUrl?.trim()
        ? {
            connectionUrl: buildConnectionUrl({
              driver: selectedConnection.driver,
              host: selectedConnection.host,
              port: selectedConnection.port,
              user: selectedConnection.user,
              password: selectedConnection.password,
              database: supportsConnectionDatabase
                ? selectedConnection.database
                : "",
              sslMode: selectedConnection.sslMode || "disable",
              connectionUrlTemplate: nextTemplate,
            }),
          }
        : {}),
    });
    setStatus(null);
  };

  const handleTest = async () => {
    if (!canUseSelectedDriver) {
      setStatus({
        type: "error",
        message: "Install and activate this driver before testing the connection.",
      });
      return;
    }
    setStatus({
      type: "loading",
      message: "Testing connection...",
      scope: "connection",
    });
    try {
      const error = await testConnection(selectedConnection);
      setStatus(
        error
          ? { type: "error", message: error }
          : {
              type: "success",
              message: "Connection successful",
              scope: "connection",
            },
      );
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handlePrepareSqliteWorker = async () => {
    if (!sshTunnel.enabled || !sshTunnel.remoteSqlite) {
      setStatus({
        type: "error",
        message: "Enable the remote SQLite connection before preparing its worker.",
      });
      return;
    }
    setIsPreparingSqliteWorker(true);
    setStatus({
      type: "loading",
      message: "Checking the SSH host and signed SQLite worker…",
    });
    try {
      const rawSource = sqliteWorkerBaseUrlInput.trim();
      const normalizedSource = rawSource
        ? normalizeSignedCatalogUrl(rawSource)
        : "";
      if (rawSource && !normalizedSource) {
        throw new Error(
          "Worker source must be a credential-free HTTPS URL without query parameters or fragments.",
        );
      }
      if (normalizedSource !== sqliteWorkerBaseUrl) {
        await updateSettings({
          drivers: {
            catalogUrl: driverCatalogUrl,
            storePath: driverStorePath,
            sqliteWorkerBaseUrl: normalizedSource || "",
          },
        });
      }
      const result = await connectionService.prepareRemoteSqliteWorker(
        sshTunnel,
        normalizedSource || "",
      );
      if (
        remoteSqlite.placement !== "preplaced" &&
        remoteSqlite.allowWorkerUpload &&
        result.digest
      ) {
        updateRemoteSqlite({ approvedWorkerDigest: result.digest });
      }
      setStatus({
        type: "success",
        message:
          remoteSqlite.placement !== "preplaced" && remoteSqlite.allowWorkerUpload
            ? `SQLite worker ${result.version} is ready for ${result.platform} and approved for this SSH target.`
            : `SQLite worker ${result.version} is ready for ${result.platform}.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsPreparingSqliteWorker(false);
    }
  };

  const handleTestSshTunnel = async () => {
    if (!sshTunnel.enabled) {
      setStatus({
        type: "error",
        message: "Enable the SSH tunnel before testing it.",
        scope: "ssh",
      });
      return;
    }
    setStatus({
      type: "loading",
      message: "Authenticating SSH tunnel…",
      scope: "ssh",
    });
    try {
      const message = await connectionService.testSshTunnel(sshTunnel);
      setStatus({ type: "success", message, scope: "ssh" });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        scope: "ssh",
      });
    }
  };

  const saveSqliteWorkerBaseUrl = async () => {
    const raw = sqliteWorkerBaseUrlInput.trim();
    const normalized = raw ? normalizeSignedCatalogUrl(raw) : "";
    if (raw && !normalized) {
      setStatus({
        type: "error",
        message:
          "Worker source must be a credential-free HTTPS URL without query parameters or fragments.",
      });
      return;
    }
    try {
      await updateSettings({
        drivers: {
          catalogUrl: driverCatalogUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl: normalized || "",
        },
      });
      setSqliteWorkerBaseUrlInput(normalized || "");
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleApply = async () => {
    if (!canUseSelectedDriver) {
      setStatus({
        type: "error",
        message: "Install and activate this driver before saving the connection.",
      });
      return;
    }
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
    if (!canUseSelectedDriver) {
      setStatus({
        type: "error",
        message: "Install and activate this driver before connecting.",
      });
      return;
    }
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
        driverChoices={driverChoices}
        onSelect={selectConnection}
        onCreate={createDataSource}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]"
            style={{
              color: selectedConnection.color || undefined,
              backgroundColor: selectedConnection.color
                ? `${selectedConnection.color}18`
                : undefined,
            }}
          >
            <ConnectionGlyph
              driver={selectedConnection.driver}
              icon={selectedConnection.icon}
              size={15}
              style={{ color: selectedConnection.color || undefined }}
              className={
                !selectedConnection.color ? profile.iconClassName : undefined
              }
            />
          </span>
          <input
            value={selectedConnection.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-transparent bg-transparent px-2 text-[13px] font-semibold text-[hsl(var(--wb-text))] outline-none hover:border-[hsl(var(--wb-border-subtle))] focus:border-[hsl(var(--wb-accent))] focus:bg-[hsl(var(--wb-editor))]"
            aria-label="Data source name"
          />
          <span className="shrink-0 text-[10px] uppercase wb-muted">
            {selectedDriverLabel}
          </span>
        </header>

        <nav className="flex h-9 shrink-0 items-end gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-3">
          {formSections.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={cn(
                "relative flex h-8 items-center px-3 text-[12px]",
                section === value
                  ? "text-[hsl(var(--wb-text))] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-[hsl(var(--wb-accent))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]",
              )}
              onClick={() => setSection(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        {!canUseSelectedDriver && (
          <div
            role="status"
            className="shrink-0 border-b border-amber-400/25 bg-amber-400/10 text-[10px] text-amber-100"
          >
            <div className="flex min-h-9 items-center gap-2 px-3">
              <AlertCircle size={13} className="shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1">
                {selectedDriverAvailability === "activationRequired"
                  ? `${selectedDriverLabel} is installed but not active. Activate its signed package before testing or saving this data source.`
                  : `${selectedDriverLabel} needs a signed driver package before this data source can be tested or saved.`}
              </span>
              <button
                type="button"
                className="wb-text-button flex h-6 shrink-0 items-center gap-1 px-1 text-[10px] text-amber-200 hover:text-amber-50"
                disabled={isInstallingDriver}
                onClick={() => void installSelectedDriver()}
              >
                {isInstallingDriver ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : selectedDriverAvailability === "activationRequired" ? (
                  <Check size={11} />
                ) : catalogRelease ? (
                  <Download size={11} />
                ) : (
                  <FolderOpen size={11} />
                )}
                {selectedDriverAvailability === "activationRequired"
                  ? "Activate driver"
                  : catalogRelease
                    ? "Download & install"
                    : "Install package…"}
              </button>
              {selectedDriverAvailability === "installationRequired" &&
                !catalogRelease && (
                  <button
                    type="button"
                    className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-200 hover:text-amber-50"
                    disabled={isInstallingDriver}
                    onClick={() => setIsCatalogInstallSetupOpen((open) => !open)}
                  >
                    Download from catalog…
                  </button>
                )}
              <button
                type="button"
                className="wb-icon-button h-6 w-6 shrink-0 text-amber-200 hover:text-amber-50"
                title="Refresh driver status"
                aria-label="Refresh driver status"
                disabled={isRefreshingDriverStatus}
                onClick={() => void refreshDriverStatus()}
              >
                <RefreshCw
                  size={12}
                  className={cn(isRefreshingDriverStatus && "animate-spin")}
                />
              </button>
            </div>
            {isCatalogInstallSetupOpen &&
              selectedDriverAvailability === "installationRequired" &&
              !catalogRelease && (
                <div className="flex min-h-9 items-center gap-2 border-t border-amber-400/20 px-3">
                  <label
                    className="shrink-0 text-[10px] text-amber-100"
                    htmlFor="connection-driver-catalog-url"
                  >
                    Signed catalog
                  </label>
                  <input
                    id="connection-driver-catalog-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    className="h-6 min-w-0 flex-1 rounded-[3px] border border-amber-300/35 bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
                    placeholder="https://drivers.example.com/catalog.json"
                    value={catalogUrlInput}
                    onChange={(event) => setCatalogUrlInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void installSelectedDriverFromCatalogUrl();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-100 hover:text-amber-50 disabled:opacity-50"
                    disabled={isInstallingDriver}
                    onClick={() => void installSelectedDriverFromCatalogUrl()}
                  >
                    {isInstallingDriver ? "Downloading…" : "Download & install"}
                  </button>
                  <button
                    type="button"
                    className="wb-text-button h-6 shrink-0 px-1 text-[10px] text-amber-200 hover:text-amber-50"
                    disabled={isInstallingDriver}
                    onClick={() => setIsCatalogInstallSetupOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {section === "general" && (
            <div className="mx-auto w-full max-w-[720px] px-6 py-4">
              <div className="mb-3 flex h-7 items-center justify-end">
                <ConnectionAppearancePicker
                  connection={selectedConnection}
                  defaultIcon={profile.defaultIcon}
                  onUpdate={updateField}
                />
              </div>
              <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-y-2">
              <label className={labelClass} htmlFor="connection-host">
                {isFileBased ? "File" : "Host"}
              </label>
              <div
                className={cn(
                  !isFileBased && "grid grid-cols-[minmax(0,1fr)_116px] gap-2",
                )}
              >
                <input
                  id="connection-host"
                  value={
                    isFileBased
                      ? selectedConnection.database || ""
                      : selectedConnection.host || ""
                  }
                  onChange={(event) =>
                    updateField(
                      isFileBased ? "database" : "host",
                      event.target.value,
                      true,
                    )
                  }
                  className={fieldClass}
                  placeholder={
                    isFileBased
                      ? `:memory: or /path/to/database.${fileExtension}`
                      : "localhost"
                  }
                />
                {isFileBased && (
                  <button
                    type="button"
                    className="wb-text-button mt-1 h-6 px-1 text-[11px]"
                    onClick={async () => {
                      const { open } = await import("@tauri-apps/plugin-dialog");
                      const file = await open({
                        multiple: false,
                        directory: false,
                        filters: [
                          {
                            name: `${capabilities.displayName} databases`,
                            extensions:
                              fileDriver === "duckdb"
                                ? ["duckdb", "ddb", "db"]
                                : fileDriver === "sqlite"
                                  ? ["db", "sqlite", "sqlite3", "db3"]
                                  : ["db"],
                          },
                        ],
                      });
                      if (typeof file === "string") {
                        updateField("database", file, true);
                      }
                    }}
                  >
                    Choose database file…
                  </button>
                )}
                {!isFileBased && (
                <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-right text-[11px] wb-muted">Port</span>
                  <input
                    type="number"
                    value={selectedConnection.port || ""}
                    onChange={(event) =>
                      updateField(
                        "port",
                        event.target.value
                          ? Number(event.target.value)
                          : undefined,
                        true,
                      )
                    }
                    className={fieldClass}
                    placeholder={String(
                      defaultDatabasePort(selectedConnection.driver) || "",
                    )}
                    aria-label="Port"
                  />
                </div>
                )}
              </div>

              {!isFileBased && (
              <>
              <label className={labelClass} htmlFor="connection-user">
                User
              </label>
              <input
                id="connection-user"
                value={selectedConnection.user || ""}
                onChange={(event) =>
                  updateField("user", event.target.value, true)
                }
                className={fieldClass}
                autoComplete="off"
              />

              <label className={labelClass} htmlFor="connection-password">
                Password
              </label>
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
              </>
              )}

              {!isFileBased && supportsConnectionDatabase && (
              <>
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
                placeholder={
                  defaultDatabaseName(selectedConnection.driver) || "database"
                }
              />
              </>
              )}

              {selectedConnection.driver === "elasticsearch" && (
                <>
                  <label
                    className={labelClass}
                    htmlFor="connection-elasticsearch-mode"
                  >
                    Transport
                  </label>
                  <div className="space-y-1.5">
                    <Select
                      value={selectedConnection.elasticsearchMode || "direct"}
                      onValueChange={(value: "direct" | "kibana") =>
                        updateField("elasticsearchMode", value)
                      }
                    >
                      <SelectTrigger
                        id="connection-elasticsearch-mode"
                        className={fieldClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                        <SelectItem value="direct">Direct HTTP</SelectItem>
                        <SelectItem value="kibana">
                          Kibana / OpenSearch Console proxy
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex min-h-6 items-center gap-1.5 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 font-mono text-[10px] wb-muted">
                      <span className="text-[hsl(var(--wb-text))]">OxideStudio</span>
                      <span aria-hidden="true">→</span>
                      {selectedConnection.elasticsearchMode === "kibana" && (
                        <>
                          <span className="text-[hsl(var(--wb-accent))]">
                            Kibana / Dashboards
                          </span>
                          <span aria-hidden="true">→</span>
                        </>
                      )}
                      <span>Elasticsearch cluster</span>
                    </div>
                  </div>

                  {selectedConnection.elasticsearchMode === "kibana" && (
                    <>
                      <label
                        className={labelClass}
                        htmlFor="connection-elasticsearch-kibana-base-path"
                      >
                        Console base path
                      </label>
                      <div>
                        <input
                          id="connection-elasticsearch-kibana-base-path"
                          value={
                            selectedConnection.elasticsearchKibanaBasePath || ""
                          }
                          onChange={(event) =>
                            updateField(
                              "elasticsearchKibanaBasePath",
                              event.target.value,
                            )
                          }
                          className={fieldClass}
                          placeholder="Optional, e.g. /kibana/s/analytics"
                          spellCheck={false}
                        />
                        <p className="mt-1 text-[10px] wb-muted">
                          Requests use the Console proxy and include Kibana and
                          OpenSearch anti-CSRF headers.
                        </p>
                      </div>
                    </>
                  )}

                  <label
                    className={labelClass}
                    htmlFor="connection-elasticsearch-check-path"
                  >
                    Connection check
                  </label>
                  <div className="space-y-1.5">
                    <input
                      id="connection-elasticsearch-check-path"
                      value={
                        selectedConnection.elasticsearchConnectivityCheckPath ||
                        ""
                      }
                      onChange={(event) =>
                        updateField(
                          "elasticsearchConnectivityCheckPath",
                          event.target.value,
                        )
                      }
                      className={fieldClass}
                      placeholder="GET / (or a permitted index path)"
                      spellCheck={false}
                      disabled={
                        selectedConnection.elasticsearchConnectivityCheckDisabled
                      }
                    />
                    <label className="flex items-center justify-between gap-3 text-[10px] wb-muted">
                      <span>
                        Skip the probe only when this account has no stable
                        read-only health path.
                      </span>
                      <Switch
                        checked={
                          selectedConnection.elasticsearchConnectivityCheckDisabled ||
                          false
                        }
                        onCheckedChange={(checked) =>
                          updateField(
                            "elasticsearchConnectivityCheckDisabled",
                            checked,
                          )
                        }
                        className="h-5 w-9 shrink-0 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                        aria-label="Skip Elasticsearch connectivity check"
                      />
                    </label>
                  </div>

                  <label
                    className={labelClass}
                    htmlFor="connection-elasticsearch-index-grouping"
                  >
                    Index grouping
                  </label>
                  <div>
                    <input
                      id="connection-elasticsearch-index-grouping"
                      value={selectedConnection.indexGroupingPattern || ""}
                      onChange={(event) =>
                        updateField(
                          "indexGroupingPattern",
                          event.target.value,
                        )
                      }
                      className={fieldClass}
                      placeholder="Optional regex, e.g. [-_.@]\\d{4}[-_.]?\\d{2}.*$"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[10px] wb-muted">
                      Collapses matching rolling-index suffixes into <code>*</code>.
                      Leave blank to show every index.
                    </p>
                  </div>
                </>
              )}

              {availableDriverPackages.length > 0 && (
                <>
                  <label className={labelClass} htmlFor="connection-driver-package">
                    Driver package
                  </label>
                  <Select
                    value={
                      selectedConnection.driverPackageVersion ||
                      ACTIVE_DRIVER_PACKAGE_VALUE
                    }
                    onValueChange={selectDriverPackage}
                  >
                    <SelectTrigger id="connection-driver-package" className={fieldClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                      <SelectItem value={ACTIVE_DRIVER_PACKAGE_VALUE}>
                        Active package (recommended)
                      </SelectItem>
                      {availableDriverPackages.map((installation) => (
                        <SelectItem
                          key={installation.packageVersion}
                          value={installation.packageVersion || "active"}
                        >
                          Pin {installation.packageVersion}
                          {installation.active ? " · active" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              {unavailableDriverPackages.length > 0 && (
                <p
                  className="col-start-2 text-[10px] text-[hsl(var(--wb-warning))]"
                  role="status"
                >
                  {unavailableDriverPackages.length === 1
                    ? "An installed JDBC driver package needs a signed Java runtime before it can be selected."
                    : "Some installed JDBC driver packages need a signed Java runtime before they can be selected."}
                </p>
              )}

              {showConnectionUrl && (
                <>
                  <label className={labelClass} htmlFor="connection-url">
                    URL
                  </label>
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
                  {selectedConnection.driver === "elasticsearch" && (
                    <p className="col-start-2 text-[10px] wb-muted">
                      Elasticsearch 6.x, 7.x, and 8.x are detected automatically.
                      Choose an SSL mode to use HTTPS.
                    </p>
                  )}
                  {connectionUrlTemplate && (
                    <p className="col-start-2 text-[10px] wb-muted">
                      This signed driver package supplies the URL grammar. You can
                      edit the generated value; it is sent to the package unchanged.
                    </p>
                  )}
                  {isFileBased && (
                    <p className="col-start-2 text-[10px] wb-muted">
                      {isRemoteSqlite
                        ? "Use a local SQLite path by default, or open the Remote tab for a file hosted on Linux over SSH."
                        : `Use a local ${capabilities.displayName} file path or :memory:. SSH and SSL are not used for local files.`}
                    </p>
                  )}
                </>
              )}

              <label className={labelClass} htmlFor="connection-note">
                Note
              </label>
              <div className="min-w-0 space-y-1.5">
                <textarea
                  id="connection-note"
                  value={selectedConnection.note || ""}
                  onChange={(event) => updateField("note", event.target.value)}
                  className={cn(
                    fieldClass,
                    "min-h-[56px] resize-y py-1.5 leading-4",
                  )}
                  rows={2}
                  maxLength={2_000}
                  placeholder="Purpose, owner, runbook, or other context for this data source"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] leading-4 wb-muted">
                    Notes are searchable and can be shown beside the connection in Explorer.
                  </span>
                  <label className="flex shrink-0 items-center gap-2 text-[10px] wb-muted">
                    Show in Explorer
                    <Switch
                      checked={showConnectionNotes}
                      onCheckedChange={(checked) =>
                        void updateSettings({
                          databaseExplorer: {
                            ...useSettingsStore.getState().settings.databaseExplorer,
                            showConnectionNotes: checked,
                          },
                        })
                      }
                      className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                      aria-label="Show connection notes in Database Explorer"
                    />
                  </label>
                </div>
              </div>
              </div>
            </div>
          )}

          {section === "ssl" && (
            <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-2 px-6 py-5">
              {!isRemoteSqlite && (
                <>
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

                  <div className="col-span-2 my-2 border-t border-[hsl(var(--wb-border-subtle))]" />
                </>
              )}

              <span className={labelClass}>
                {isRemoteSqlite ? "Remote file" : "SSH tunnel"}
              </span>
              <div className="flex h-7 items-center gap-2">
                <Switch
                  checked={sshTunnel.enabled}
                  onCheckedChange={(enabled) =>
                    updateSshTunnel({
                      enabled,
                      ...(isRemoteSqlite && enabled
                        ? {
                            strictHostKeyChecking: true,
                            remoteSqlite,
                          }
                        : {}),
                    })
                  }
                  className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                  aria-label={
                    isRemoteSqlite
                      ? "Open SQLite through SSH"
                      : "Enable SSH tunnel"
                  }
                />
                <span className="text-[11px] wb-muted">
                  {isRemoteSqlite
                    ? "Open a SQLite file on a verified Linux SSH host"
                    : "Forward the database connection through an SSH server"}
                </span>
              </div>

              {sshTunnel.enabled && (
                <>
                  <label className={labelClass} htmlFor="ssh-host">
                    SSH host
                  </label>
                  <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                    <input
                      id="ssh-host"
                      value={sshTunnel.host}
                      onChange={(event) =>
                        updateSshTunnel({ host: event.target.value })
                      }
                      className={fieldClass}
                      placeholder="bastion.example.com"
                      autoComplete="off"
                    />
                    <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2">
                      <span className="text-right text-[11px] wb-muted">
                        Port
                      </span>
                      <input
                        type="number"
                        value={sshTunnel.port || ""}
                        onChange={(event) =>
                          updateSshTunnel({
                            port: event.target.value
                              ? Number(event.target.value)
                              : 22,
                          })
                        }
                        className={fieldClass}
                        min={1}
                        max={65535}
                        aria-label="SSH port"
                      />
                    </div>
                  </div>

                  <label className={labelClass} htmlFor="ssh-username">
                    Username
                  </label>
                  <input
                    id="ssh-username"
                    value={sshTunnel.username}
                    onChange={(event) =>
                      updateSshTunnel({ username: event.target.value })
                    }
                    className={fieldClass}
                    autoComplete="off"
                  />

                  <span className={labelClass}>Authentication</span>
                  <Select
                    value={sshTunnel.authMethod}
                    onValueChange={(value) =>
                      updateSshTunnel({
                        authMethod: value as "password" | "privateKey",
                      })
                    }
                  >
                    <SelectTrigger
                      className={fieldClass}
                      aria-label="SSH authentication method"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="privateKey">Private key</SelectItem>
                    </SelectContent>
                  </Select>

                  {sshTunnel.authMethod === "password" ? (
                    <>
                      <label className={labelClass} htmlFor="ssh-password">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="ssh-password"
                          type={showSshPassword ? "text" : "password"}
                          value={sshTunnel.password || ""}
                          onChange={(event) =>
                            updateSshTunnel({ password: event.target.value })
                          }
                          className={cn(fieldClass, "pr-8")}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="wb-icon-button absolute right-0.5 top-0.5"
                          onClick={() =>
                            setShowSshPassword((visible) => !visible)
                          }
                          title={
                            showSshPassword
                              ? "Hide SSH password"
                              : "Show SSH password"
                          }
                        >
                          {showSshPassword ? (
                            <EyeOff size={12} />
                          ) : (
                            <Eye size={12} />
                          )}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className={labelClass} htmlFor="ssh-private-key">
                        Private key
                      </label>
                      <input
                        id="ssh-private-key"
                        value={sshTunnel.privateKeyPath || ""}
                        onChange={(event) =>
                          updateSshTunnel({
                            privateKeyPath: event.target.value,
                          })
                        }
                        className={cn(fieldClass, "font-mono text-[11px]")}
                        placeholder="~/.ssh/id_ed25519"
                        autoComplete="off"
                      />

                      <label className={labelClass} htmlFor="ssh-passphrase">
                        Passphrase
                      </label>
                      <div className="relative">
                        <input
                          id="ssh-passphrase"
                          type={showSshPassphrase ? "text" : "password"}
                          value={sshTunnel.privateKeyPassphrase || ""}
                          onChange={(event) =>
                            updateSshTunnel({
                              privateKeyPassphrase: event.target.value,
                            })
                          }
                          className={cn(fieldClass, "pr-8")}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="wb-icon-button absolute right-0.5 top-0.5"
                          onClick={() =>
                            setShowSshPassphrase((visible) => !visible)
                          }
                          title={
                            showSshPassphrase
                              ? "Hide key passphrase"
                              : "Show key passphrase"
                          }
                        >
                          {showSshPassphrase ? (
                            <EyeOff size={12} />
                          ) : (
                            <Eye size={12} />
                          )}
                        </button>
                      </div>
                    </>
                  )}

                  <span className={labelClass}>Host key</span>
                  <div className="flex min-h-7 items-center gap-2">
                    <Switch
                      checked={sshTunnel.strictHostKeyChecking}
                      onCheckedChange={(strictHostKeyChecking) =>
                        updateSshTunnel({ strictHostKeyChecking })
                      }
                      disabled={isRemoteSqlite}
                      className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                      aria-label="Verify SSH host key"
                    />
                    <span
                      className={cn(
                        "text-[11px]",
                        sshTunnel.strictHostKeyChecking
                          ? "wb-muted"
                          : "text-amber-400",
                      )}
                    >
                      {sshTunnel.strictHostKeyChecking
                        ? isRemoteSqlite
                          ? "Required · verify against ~/.ssh/known_hosts"
                          : "Verify against ~/.ssh/known_hosts"
                        : "Warning: SSH host identity will not be verified"}
                    </span>
                  </div>

                  <span className={labelClass}>Route</span>
                  <div className="min-w-0 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[11px] wb-muted">
                        {sshTunnel.jumpHosts?.length
                          ? `Primary SSH host + ${sshTunnel.jumpHosts.length} jump ${sshTunnel.jumpHosts.length === 1 ? "host" : "hosts"}`
                          : "Directly through the primary SSH host"}
                      </span>
                      <button
                        type="button"
                        className="wb-text-button h-6 px-2 text-[10px]"
                        onClick={addSshJumpHost}
                        disabled={(sshTunnel.jumpHosts?.length || 0) >= 3}
                      >
                        Add jump host
                      </button>
                    </div>
                    {sshTunnel.jumpHosts && sshTunnel.jumpHosts.length > 0 && (
                      <div className="mt-2 space-y-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                        {sshTunnel.jumpHosts.map((hop, index) => (
                          <details
                            key={`${index}-${hop.host}`}
                            className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]"
                            open
                          >
                            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] text-[hsl(var(--wb-text))]">
                              <span className="min-w-0 flex-1 truncate">
                                Hop {index + 2} · {hop.username || "user"}@{hop.host || "host"}:{hop.port || 22}
                              </span>
                            </summary>
                            <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-2">
                              <label className="text-right text-[10px] wb-muted" htmlFor={`ssh-hop-host-${index}`}>Host</label>
                              <div className="grid grid-cols-[minmax(0,1fr)_74px] gap-1">
                                <input
                                  id={`ssh-hop-host-${index}`}
                                  value={hop.host}
                                  onChange={(event) => updateSshJumpHost(index, { host: event.target.value })}
                                  className={fieldClass}
                                  placeholder="bastion.internal"
                                  autoComplete="off"
                                />
                                <input
                                  type="number"
                                  value={hop.port || ""}
                                  onChange={(event) => updateSshJumpHost(index, { port: event.target.value ? Number(event.target.value) : 22 })}
                                  className={fieldClass}
                                  min={1}
                                  max={65535}
                                  aria-label={`SSH hop ${index + 2} port`}
                                />
                              </div>
                              <label className="text-right text-[10px] wb-muted" htmlFor={`ssh-hop-user-${index}`}>Username</label>
                              <input
                                id={`ssh-hop-user-${index}`}
                                value={hop.username}
                                onChange={(event) => updateSshJumpHost(index, { username: event.target.value })}
                                className={fieldClass}
                                autoComplete="off"
                              />
                              <label className="text-right text-[10px] wb-muted">Authentication</label>
                              <Select
                                value={hop.authMethod}
                                onValueChange={(value) => updateSshJumpHost(index, { authMethod: value as "password" | "privateKey" })}
                              >
                                <SelectTrigger className={fieldClass} aria-label={`SSH hop ${index + 2} authentication method`}><SelectValue /></SelectTrigger>
                                <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                                  <SelectItem value="password">Password</SelectItem>
                                  <SelectItem value="privateKey">Private key</SelectItem>
                                </SelectContent>
                              </Select>
                              {hop.authMethod === "password" ? (
                                <>
                                  <label className="text-right text-[10px] wb-muted" htmlFor={`ssh-hop-password-${index}`}>Password</label>
                                  <input
                                    id={`ssh-hop-password-${index}`}
                                    type="password"
                                    value={hop.password || ""}
                                    onChange={(event) => updateSshJumpHost(index, { password: event.target.value })}
                                    className={fieldClass}
                                    autoComplete="off"
                                  />
                                </>
                              ) : (
                                <>
                                  <label className="text-right text-[10px] wb-muted" htmlFor={`ssh-hop-key-${index}`}>Private key</label>
                                  <input
                                    id={`ssh-hop-key-${index}`}
                                    value={hop.privateKeyPath || ""}
                                    onChange={(event) => updateSshJumpHost(index, { privateKeyPath: event.target.value })}
                                    className={cn(fieldClass, "font-mono text-[11px]")}
                                    placeholder="~/.ssh/id_ed25519"
                                    autoComplete="off"
                                  />
                                  <label className="text-right text-[10px] wb-muted" htmlFor={`ssh-hop-passphrase-${index}`}>Passphrase</label>
                                  <input
                                    id={`ssh-hop-passphrase-${index}`}
                                    type="password"
                                    value={hop.privateKeyPassphrase || ""}
                                    onChange={(event) => updateSshJumpHost(index, { privateKeyPassphrase: event.target.value })}
                                    className={fieldClass}
                                    autoComplete="off"
                                  />
                                </>
                              )}
                              <label className="text-right text-[10px] wb-muted">Host key</label>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={hop.strictHostKeyChecking}
                                  onCheckedChange={(strictHostKeyChecking) => updateSshJumpHost(index, { strictHostKeyChecking })}
                                  className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                                  aria-label={`Verify SSH host key for hop ${index + 2}`}
                                />
                                <span className={cn("text-[10px]", hop.strictHostKeyChecking ? "wb-muted" : "text-amber-400")}>
                                  {hop.strictHostKeyChecking ? "Verify known_hosts" : "Host identity unverified"}
                                </span>
                              </div>
                              <span />
                              <div>
                                <button
                                  type="button"
                                  className="wb-text-button h-6 px-2 text-[10px] text-red-300"
                                  onClick={() => removeSshJumpHost(index)}
                                >
                                  Remove hop
                                </button>
                              </div>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>

                  <span />
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      className="wb-text-button h-7 border border-[hsl(var(--wb-border))] px-3 text-[11px] text-[hsl(var(--wb-text))]"
                      onClick={() => void handleTestSshTunnel()}
                      disabled={status?.type === "loading"}
                    >
                      {status?.type === "loading" && status.scope === "ssh" ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={12} />
                      )}
                      {status?.type === "loading" && status.scope === "ssh"
                        ? "Testing SSH…"
                        : "Test SSH Tunnel"}
                    </button>
                    <span className="text-[10px] wb-muted">
                      Verifies host keys and every jump-host credential without contacting the database.
                    </span>
                  </div>

                  {isRemoteSqlite && (
                    <>
                      <div className="col-span-2 my-2 border-t border-[hsl(var(--wb-border-subtle))]" />

                      <span className={labelClass}>Worker placement</span>
                      <Select
                        value={remoteSqlite.placement}
                        onValueChange={(placement) =>
                          updateRemoteSqlite({
                            placement: placement as typeof remoteSqlite.placement,
                          })
                        }
                      >
                        <SelectTrigger className={fieldClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                          <SelectItem value="session">Session only · remove on disconnect</SelectItem>
                          <SelectItem value="persist">Persistent · reuse the verified version</SelectItem>
                          <SelectItem value="preplaced">Preplaced · never upload</SelectItem>
                        </SelectContent>
                      </Select>

                      {remoteSqlite.placement !== "session" && (
                        <>
                          <label className={labelClass} htmlFor="sqlite-worker-path">
                            Worker path
                          </label>
                          <input
                            id="sqlite-worker-path"
                            value={remoteSqlite.workerPath || ""}
                            onChange={(event) =>
                              updateRemoteSqlite({ workerPath: event.target.value })
                            }
                            className={cn(fieldClass, "font-mono text-[11px]")}
                            placeholder="/opt/oxide/oxide-sqlite-worker"
                            autoComplete="off"
                          />
                        </>
                      )}

                      {remoteSqlite.placement !== "preplaced" && (
                        <>
                          <span className={labelClass}>Worker upload</span>
                          <div className="flex min-h-7 items-center gap-2">
                            <Switch
                              checked={remoteSqlite.allowWorkerUpload}
                              onCheckedChange={(allowWorkerUpload) =>
                                updateRemoteSqlite({
                                  allowWorkerUpload,
                                  ...(allowWorkerUpload
                                    ? {}
                                    : { approvedWorkerDigest: undefined }),
                                })
                              }
                              className="h-5 w-9 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border))] [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                              aria-label="Allow signed SQLite worker upload"
                            />
                            <span className="text-[11px] wb-muted">
                              {remoteSqlite.approvedWorkerDigest
                                ? `Approved SHA-256 ${remoteSqlite.approvedWorkerDigest.slice(0, 12)}…`
                                : "Prepare the exact signed worker before upload"}
                            </span>
                          </div>
                        </>
                      )}

                      <label className={labelClass} htmlFor="sqlite-worker-source">
                        Worker source
                      </label>
                      <div className="flex min-w-0 gap-2">
                        <input
                          id="sqlite-worker-source"
                          value={sqliteWorkerBaseUrlInput}
                          onChange={(event) =>
                            setSqliteWorkerBaseUrlInput(event.target.value)
                          }
                          onBlur={() => void saveSqliteWorkerBaseUrl()}
                          className={cn(fieldClass, "min-w-0 font-mono text-[11px]")}
                          placeholder="Official release source (leave blank)"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="wb-text-button h-7 shrink-0 border border-[hsl(var(--wb-border))] px-2 text-[11px]"
                          disabled={
                            isPreparingSqliteWorker ||
                            (remoteSqlite.placement !== "preplaced" &&
                              !remoteSqlite.allowWorkerUpload)
                          }
                          onClick={() => void handlePrepareSqliteWorker()}
                        >
                          {isPreparingSqliteWorker ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Download size={12} />
                          )}
                          {isPreparingSqliteWorker ? "Preparing…" : "Prepare"}
                        </button>
                      </div>
                      <div />
                      <p className="text-[10px] leading-4 wb-muted">
                        Leave blank to use the signed source embedded in official
                        OxideStudio builds. Custom sources must be credential-free HTTPS.
                      </p>

                      <div className="col-start-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2.5 py-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                        OxideStudio detects Linux x64 or ARM64, verifies the signed
                        manifest and binary digest locally, then checks the same
                        digest on the SSH host before starting the worker over stdio.
                        Database credentials are never sent to the download source.
                      </div>
                    </>
                  )}
                </>
              )}
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
                  {driverChoices.map((choice) => (
                    <SelectItem key={choice.driver} value={choice.driver}>
                      {choice.label}
                      {choice.availability === "activationRequired"
                        ? " · activate driver"
                        : choice.availability === "installationRequired"
                          ? " · install driver"
                          : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className={labelClass} htmlFor="connection-environment">
                Environment
              </label>
              <div>
                <select
                  id="connection-environment"
                  value={selectedConnection.environment || "unclassified"}
                  onChange={(event) =>
                    updateField(
                      "environment",
                      event.target.value as NonNullable<
                        ConnectionConfig["environment"]
                      >,
                    )
                  }
                  className={fieldClass}
                >
                  <option value="unclassified">Unclassified — AI writes blocked</option>
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production — AI writes blocked</option>
                </select>
                <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  Agent writes require an explicit non-production classification
                  and a separate approval for every operation.
                </p>
              </div>

              <label
                className={labelClass}
                htmlFor="connection-production-databases"
              >
                Protected DBs
              </label>
              <div>
                <input
                  id="connection-production-databases"
                  value={(selectedConnection.productionDatabases || []).join(", ")}
                  onChange={(event) =>
                    updateField(
                      "productionDatabases",
                      event.target.value
                        .split(",")
                        .map((database) => database.trim())
                        .filter(Boolean),
                    )
                  }
                  className={fieldClass}
                  placeholder="production, customer_data"
                />
                <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  These database names stay read-only even on development or
                  staging connections.
                </p>
              </div>

              <label className={labelClass} htmlFor="connection-tags">
                Tags
              </label>
              <input
                id="connection-tags"
                value={(selectedConnection.tags || []).join(", ")}
                onChange={(event) =>
                  updateField(
                    "tags",
                    event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
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
              disabled={status?.type === "loading" || !canUseSelectedDriver}
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
                      : "wb-muted",
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
              disabled={isSaving || !canUseSelectedDriver}
            >
              Apply
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[64px] justify-center text-[12px]"
              onClick={() => void handleConfirm()}
              disabled={
                isSaving ||
                !canUseSelectedDriver ||
                !selectedConnection.name.trim()
              }
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : "OK"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
