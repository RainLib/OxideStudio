import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import {
  signedCatalogReleaseForDriver,
  uniqueConnections,
} from "@/features/connections/model/connectionFormPolicy";
import {
  type ConnectionStatus,
  type FormSection,
} from "@/features/connections/model/connectionFormTypes";
import { createConnectionDraftActions } from "@/features/connections/model/createConnectionDraftActions";
import { createConnectionDriverActions } from "@/features/connections/model/createConnectionDriverActions";
import { createConnectionSshActions } from "@/features/connections/model/createConnectionSshActions";
import { ConnectionAdvancedFields } from "@/features/connections/ui/ConnectionAdvancedFields";
import { ConnectionDriverAvailability } from "@/features/connections/ui/ConnectionDriverAvailability";
import { ConnectionGeneralFields } from "@/features/connections/ui/ConnectionGeneralFields";
import { ConnectionSshFields } from "@/features/connections/ui/ConnectionSshFields";
import {
  dataSourceDriverChoices,
  type DataSourceDriverAvailability,
} from "@/features/database-drivers";
import { shouldShowConnectionUrl } from "@/features/database-drivers/model/connectionFormVisibility";
import {
  applyElasticsearchConnectionOptions,
  applyInfluxDbConnectionOptions,
  applyVictoriaMetricsConnectionOptions,
  buildConnectionUrl,
} from "@/lib/connectionUrlParser";
import {
  connectionUrlTemplateForDriver,
  databaseDriverProfile,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { mongoConnectionUsesOidc } from "@/lib/mongodbOidcConnection";
import { cn } from "@/lib/utils";
import {
  databaseService,
  type DatabaseCapabilities,
  type DatabaseDriverCatalogEntry,
  type DatabaseDriverInstallation,
} from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { AlertCircle, Check, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataSourceList } from "./DataSourceList";

export interface ConnectionFormProps {
  onConnected?: () => void;
  onCancel?: () => void;
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
  }, [
    selectedConnection?.driver,
    selectedConnection?.driverPackageVersion,
    selectedConnection?.id,
  ]);

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
        setCatalogRelease(
          signedCatalogReleaseForDriver(result.catalog.packages, driver),
        );
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
    resolvedCapabilities ||
    defaultDatabaseCapabilities(selectedConnection.driver);
  const isFileBased = capabilities.connectionMode === "file";
  const supportsConnectionDatabase =
    capabilities.supportsConnectionDatabase !== false;
  const showConnectionUrl = shouldShowConnectionUrl(capabilities.dataModel);
  const fileDriver = selectedConnection.driver.toLowerCase();
  const isRemoteSqlite = fileDriver === "sqlite";
  const isInfluxDb3 = fileDriver === "influxdb3";
  const isInfluxDb = fileDriver === "influxdb";
  const influxDbVersion = selectedConnection.influxDbVersion || "1";
  const isInfluxDb2 = isInfluxDb && influxDbVersion === "2";
  const isMongoDb = fileDriver === "mongodb";
  const isVictoriaMetrics = fileDriver === "victoriametrics";
  const isRocketMq = fileDriver === "rocketmq";
  const fileExtension =
    fileDriver === "duckdb"
      ? "duckdb"
      : fileDriver === "sqlite"
        ? "sqlite"
        : "db";
  const formSections: ReadonlyArray<readonly [FormSection, string]> =
    isFileBased
      ? isRemoteSqlite
        ? [
            ["general", "General"],
            ["ssl", "Remote"],
            ["advanced", "Advanced"],
          ]
        : [
            ["general", "General"],
            ["advanced", "Advanced"],
          ]
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
      : selectedConnection.driver === "influxdb"
        ? applyInfluxDbConnectionOptions(baseGeneratedUrl, {
            version: selectedConnection.influxDbVersion,
            organization: selectedConnection.influxDbOrganization,
          })
        : selectedConnection.driver === "victoriametrics"
          ? applyVictoriaMetricsConnectionOptions(baseGeneratedUrl, {
              apiPath: selectedConnection.victoriaMetricsApiPath,
              lookback: selectedConnection.victoriaMetricsLookback,
            })
          : baseGeneratedUrl;
  const displayedUrl = selectedConnection.connectionUrl?.trim() || generatedUrl;
  const mongoOidcEnabled = isMongoDb && mongoConnectionUsesOidc(displayedUrl);
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

  const {
    updateField,
    updateSshTunnel,
    setMongoOidcEnabled,
    updateRocketMq,
    updateRemoteSqlite,
    addSshJumpHost,
    updateSshJumpHost,
    removeSshJumpHost,
    changeDriver,
    createDataSource,
    updateConnectionUrl,
  } = createConnectionDraftActions({
    updateConnectionConfig,
    setStatus,
    sshTunnel,
    displayedUrl,
    selectedConnection,
    remoteSqlite,
    createNewConnection,
    driverChoices,
  });

  const {
    refreshDriverStatus,
    installSelectedDriver,
    installSelectedDriverFromCatalogUrl,
    selectDriverPackage,
  } = createConnectionDriverActions({
    setIsRefreshingDriverStatus,
    refreshDatabaseDriverCatalog,
    setDriverPackages,
    setStatus,
    selectedConnection,
    setIsInstallingDriver,
    selectedDriverAvailability,
    driverPackages,
    catalogRelease,
    driverCatalogUrl,
    selectedDriverLabel,
    catalogUrlInput,
    updateSettings,
    driverStorePath,
    sqliteWorkerBaseUrl,
    setCatalogRelease,
    setIsCatalogInstallSetupOpen,
    availableDriverPackages,
    updateConnectionConfig,
    supportsConnectionDatabase,
  });

  const handleTest = async () => {
    if (!canUseSelectedDriver) {
      setStatus({
        type: "error",
        message:
          "Install and activate this driver before testing the connection.",
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

  const {
    handlePrepareSqliteWorker,
    handleTestSshTunnel,
    saveSqliteWorkerBaseUrl,
  } = createConnectionSshActions({
    sshTunnel,
    setStatus,
    setIsPreparingSqliteWorker,
    sqliteWorkerBaseUrlInput,
    sqliteWorkerBaseUrl,
    updateSettings,
    driverCatalogUrl,
    driverStorePath,
    remoteSqlite,
    updateRemoteSqlite,
    setSqliteWorkerBaseUrlInput,
  });

  const handleApply = async () => {
    if (!canUseSelectedDriver) {
      setStatus({
        type: "error",
        message:
          "Install and activate this driver before saving the connection.",
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
          <ConnectionDriverAvailability
            selectedDriverAvailability={selectedDriverAvailability}
            selectedDriverLabel={selectedDriverLabel}
            isInstallingDriver={isInstallingDriver}
            installSelectedDriver={installSelectedDriver}
            catalogRelease={catalogRelease}
            setIsCatalogInstallSetupOpen={setIsCatalogInstallSetupOpen}
            isRefreshingDriverStatus={isRefreshingDriverStatus}
            refreshDriverStatus={refreshDriverStatus}
            isCatalogInstallSetupOpen={isCatalogInstallSetupOpen}
            catalogUrlInput={catalogUrlInput}
            setCatalogUrlInput={setCatalogUrlInput}
            installSelectedDriverFromCatalogUrl={
              installSelectedDriverFromCatalogUrl
            }
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {section === "general" && (
            <ConnectionGeneralFields
              selectedConnection={selectedConnection}
              profile={profile}
              updateField={updateField}
              isFileBased={isFileBased}
              fileExtension={fileExtension}
              capabilities={capabilities}
              fileDriver={fileDriver}
              isInfluxDb3={isInfluxDb3}
              isInfluxDb2={isInfluxDb2}
              mongoOidcEnabled={mongoOidcEnabled}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              isMongoDb={isMongoDb}
              setMongoOidcEnabled={setMongoOidcEnabled}
              isInfluxDb={isInfluxDb}
              influxDbVersion={influxDbVersion}
              updateConnectionConfig={updateConnectionConfig}
              setStatus={setStatus}
              isVictoriaMetrics={isVictoriaMetrics}
              supportsConnectionDatabase={supportsConnectionDatabase}
              availableDriverPackages={availableDriverPackages}
              selectDriverPackage={selectDriverPackage}
              unavailableDriverPackages={unavailableDriverPackages}
              showConnectionUrl={showConnectionUrl}
              displayedUrl={displayedUrl}
              updateConnectionUrl={updateConnectionUrl}
              connectionUrlTemplate={connectionUrlTemplate}
              isRemoteSqlite={isRemoteSqlite}
              isRocketMq={isRocketMq}
              updateRocketMq={updateRocketMq}
              showConnectionNotes={showConnectionNotes}
              updateSettings={updateSettings}
            />
          )}

          {section === "ssl" && (
            <ConnectionSshFields
              isRemoteSqlite={isRemoteSqlite}
              selectedConnection={selectedConnection}
              updateField={updateField}
              sshTunnel={sshTunnel}
              updateSshTunnel={updateSshTunnel}
              remoteSqlite={remoteSqlite}
              showSshPassword={showSshPassword}
              setShowSshPassword={setShowSshPassword}
              showSshPassphrase={showSshPassphrase}
              setShowSshPassphrase={setShowSshPassphrase}
              addSshJumpHost={addSshJumpHost}
              updateSshJumpHost={updateSshJumpHost}
              removeSshJumpHost={removeSshJumpHost}
              handleTestSshTunnel={handleTestSshTunnel}
              status={status}
              updateRemoteSqlite={updateRemoteSqlite}
              sqliteWorkerBaseUrlInput={sqliteWorkerBaseUrlInput}
              setSqliteWorkerBaseUrlInput={setSqliteWorkerBaseUrlInput}
              saveSqliteWorkerBaseUrl={saveSqliteWorkerBaseUrl}
              isPreparingSqliteWorker={isPreparingSqliteWorker}
              handlePrepareSqliteWorker={handlePrepareSqliteWorker}
            />
          )}

          {section === "advanced" && (
            <ConnectionAdvancedFields
              selectedConnection={selectedConnection}
              changeDriver={changeDriver}
              driverChoices={driverChoices}
              updateField={updateField}
            />
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
