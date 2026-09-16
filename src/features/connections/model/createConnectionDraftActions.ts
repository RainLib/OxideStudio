import type {
  ConnectionSshDraft,
  RemoteSqliteDraft,
  ConnectionStatus,
} from "./connectionFormTypes";
import type { DataSourceDriverChoice } from "@/features/database-drivers/model/dataSourceDriverChoices";
import {
  elasticsearchConnectionOptionsFromQueryParams,
  influxDbConnectionOptionsFromQueryParams,
  parseConnectionUrl,
  victoriaMetricsConnectionOptionsFromUrl,
} from "@/lib/connectionUrlParser";
import {
  databaseDriverProfile,
  defaultConnectionIcon,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";
import { setMongoConnectionOidc } from "@/lib/mongodbOidcConnection";
import { type DatabaseDriver } from "@/services/tauri";
import { type ConnectionConfig } from "@/store/useConnectionStore";

interface ConnectionDraftActionsContext {
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  sshTunnel: ConnectionSshDraft;
  displayedUrl: string;
  selectedConnection: ConnectionConfig;
  remoteSqlite: RemoteSqliteDraft;
  createNewConnection: () => ConnectionConfig;
  driverChoices: DataSourceDriverChoice[];
}

export function createConnectionDraftActions({
  updateConnectionConfig,
  setStatus,
  sshTunnel,
  displayedUrl,
  selectedConnection,
  remoteSqlite,
  createNewConnection,
  driverChoices,
}: ConnectionDraftActionsContext) {
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

  const setMongoOidcEnabled = (enabled: boolean) => {
    const nextUrl = setMongoConnectionOidc(displayedUrl, enabled);
    updateConnectionConfig({
      connectionUrl: nextUrl,
      ...(enabled
        ? { user: "", password: "", driverPackageVersion: undefined }
        : {}),
    });
    setStatus(null);
  };

  const updateRocketMq = (
    updates: Partial<NonNullable<ConnectionConfig["rocketMq"]>>,
  ) => {
    updateConnectionConfig({
      rocketMq: {
        namesrvAddr: "127.0.0.1:9876",
        ...selectedConnection.rocketMq,
        ...updates,
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
        message:
          "An SSH route supports at most four hops including the primary host.",
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
      rocketMq:
        driver.toLowerCase() === "rocketmq"
          ? selectedConnection.rocketMq || { namesrvAddr: "127.0.0.1:9876" }
          : undefined,
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
      rocketMq:
        driver.toLowerCase() === "rocketmq"
          ? { namesrvAddr: "127.0.0.1:9876" }
          : undefined,
    });
  };

  const updateConnectionUrl = (value: string) => {
    const parsed = parseConnectionUrl(value, selectedConnection.driver);
    const elasticsearchOptions =
      parsed?.driver === "elasticsearch"
        ? elasticsearchConnectionOptionsFromQueryParams(parsed.queryParams)
        : null;
    const influxDbOptions =
      parsed?.driver === "influxdb"
        ? influxDbConnectionOptionsFromQueryParams(parsed.queryParams)
        : null;
    const victoriaMetricsOptions =
      parsed?.driver === "victoriametrics"
        ? victoriaMetricsConnectionOptionsFromUrl(value)
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
            ...(influxDbOptions
              ? {
                  influxDbVersion: influxDbOptions.version,
                  influxDbOrganization: influxDbOptions.organization,
                }
              : {}),
            ...(victoriaMetricsOptions
              ? {
                  victoriaMetricsApiPath: victoriaMetricsOptions.apiPath,
                  victoriaMetricsLookback: victoriaMetricsOptions.lookback,
                }
              : {}),
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

  return {
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
  };
}
