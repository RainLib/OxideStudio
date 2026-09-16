import {
  type ConnectionConfig,
  type ConnectionRuntimeState,
} from "@/features/connections/model/types";
import { validateRocketMqConnection } from "@/features/mq/model/rocketmq";
import {
  applyElasticsearchConnectionOptions,
  applyInfluxDbConnectionOptions,
  applyVictoriaMetricsConnectionOptions,
  buildConnectionUrl,
  normalizeConnectionUrlForDriver,
  victoriaMetricsConnectionOptionsFromUrl,
} from "@/lib/connectionUrlParser";
import type { ManagedDataSourceDescriptor } from "@/services/tauri/enterprise.service";
export function isManagedConnection(
  config: ConnectionConfig,
): config is ConnectionConfig & {
  origin: "managed";
  managedDescriptor: ManagedDataSourceDescriptor;
} {
  return config.origin === "managed" && Boolean(config.managedDescriptor);
}

export function connectionUrlForConfig(config: ConnectionConfig) {
  const connectionUrl =
    config.connectionUrl && config.connectionUrl.trim()
      ? normalizeConnectionUrlForDriver(config.driver, config.connectionUrl, {
          // A connection pinned to an external package may use JDBC's nested
          // scheme (`jdbc:oracle:...`). Preserve it instead of rewriting it for
          // a bundled driver that happens to share the product name.
          preserveJdbcPrefix: Boolean(config.driverPackageVersion),
        })
      : buildConnectionUrl({
          driver: config.driver,
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.database,
          sslMode: config.sslMode || "disable",
        });

  if (config.driver === "elasticsearch") {
    return applyElasticsearchConnectionOptions(connectionUrl, {
      mode: config.elasticsearchMode,
      kibanaBasePath: config.elasticsearchKibanaBasePath,
      connectivityCheckPath: config.elasticsearchConnectivityCheckPath,
      connectivityCheckDisabled: config.elasticsearchConnectivityCheckDisabled,
      indexGroupingPattern: config.indexGroupingPattern,
    });
  }
  return config.driver === "influxdb"
    ? applyInfluxDbConnectionOptions(connectionUrl, {
        version: config.influxDbVersion,
        organization: config.influxDbOrganization,
      })
    : config.driver === "victoriametrics"
      ? applyVictoriaMetricsConnectionOptions(connectionUrl, {
          // Legacy/pasted URLs can carry a tenant-specific API mount before
          // the explicit form fields exist. Preserve it rather than silently
          // rewriting the endpoint to the default Prometheus mount.
          ...victoriaMetricsConnectionOptionsFromUrl(connectionUrl),
          ...(config.victoriaMetricsApiPath
            ? { apiPath: config.victoriaMetricsApiPath }
            : {}),
          ...(config.victoriaMetricsLookback
            ? { lookback: config.victoriaMetricsLookback }
            : {}),
        })
      : connectionUrl;
}

export function isRocketMqConnection(config: ConnectionConfig) {
  return config.driver.trim().toLowerCase() === "rocketmq";
}

export function rocketMqConfigFor(config: ConnectionConfig) {
  if (!config.rocketMq)
    throw new Error("RocketMQ NameServer configuration is required.");
  return validateRocketMqConnection(config.rocketMq);
}

export function enabledSshTunnel(config: ConnectionConfig) {
  return config.sshTunnel?.enabled ? config.sshTunnel : undefined;
}

export function beginConnectionRuntime(
  states: Record<string, ConnectionRuntimeState>,
  connectionId: string,
) {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [
      id,
      id !== connectionId && state.status === "connecting"
        ? { status: "idle" as const, updatedAt: Date.now() }
        : state,
    ]),
  ) as Record<string, ConnectionRuntimeState>;
}
