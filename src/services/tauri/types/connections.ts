import type { DatabaseDriver } from "./database";

/**
 * 保存的连接配置
 */
export type SshAuthMethod = "password" | "privateKey";

export type SqliteWorkerPlacement = "session" | "persist" | "preplaced";

export interface RemoteSqliteSshConfig {
  placement: SqliteWorkerPlacement;
  workerPath?: string;
  allowWorkerUpload: boolean;
  /** Exact signed worker SHA-256 authorized for this SSH target. */
  approvedWorkerDigest?: string;
}

/** One SSH hop after the primary tunnel host. The final hop owns any remote
 * SQLite worker session; jump hops only carry authenticated transport. */
export interface SshJumpHostConfig {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  strictHostKeyChecking: boolean;
}

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  strictHostKeyChecking: boolean;
  /** Ordered hops reached through the primary host, limited by the Host. */
  jumpHosts?: SshJumpHostConfig[];
  /** Enables the signed stdio worker path instead of TCP forwarding for SQLite. */
  remoteSqlite?: RemoteSqliteSshConfig;
}

export interface SavedConnection {
  id: string;
  projectId?: string;
  name: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string;
  url: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionUrl?: string;
  sslMode?: string;
  /** Native InfluxDB protocol generation. InfluxDB 3 uses its own driver id. */
  influxDbVersion?: "1" | "2";
  /** InfluxDB 2.x organization. It is serialized only into the live URL query. */
  influxDbOrganization?: string;
  /** VictoriaMetrics-compatible Prometheus API mount path. */
  victoriaMetricsApiPath?: string;
  /** Bounded historical range used when discovering metric labels. */
  victoriaMetricsLookback?: string;
  /** Elasticsearch HTTP transport. Kibana mode uses the Console proxy endpoint. */
  elasticsearchMode?: "direct" | "kibana";
  /** Optional Kibana/OpenSearch Dashboards deployment base path. */
  elasticsearchKibanaBasePath?: string;
  /** Least-privilege GET path used to verify Elasticsearch connectivity. */
  elasticsearchConnectivityCheckPath?: string;
  /** Skip Elasticsearch probing when the account cannot access a stable health path. */
  elasticsearchConnectivityCheckDisabled?: boolean;
  /** Optional regex that collapses rolling Elasticsearch index names into a `*` pattern. */
  indexGroupingPattern?: string;
  /** Dedicated RocketMQ workspace configuration. It is never encoded as a
   * browser URL because NameServer lists and ACL material are structured. */
  rocketMq?: {
    namesrvAddr: string;
    clusterName?: string;
    accessKey?: string;
    secretKey?: string;
    requestTimeoutMs?: number;
    connectTimeoutMs?: number;
    tlsSkipVerify?: boolean;
  };
  sshTunnel?: SshTunnelConfig;
  tags?: string[];
  /** Optional human-readable context shown beside the data source in Explorer. */
  note?: string;
  icon?: string;
  color?: string;
  /** AI write-safety classification. Legacy connections deserialize as unclassified. */
  environment?: "unclassified" | "development" | "staging" | "production";
  /** Database names that must remain AI read-only even on non-production servers. */
  productionDatabases?: string[];
}

/** A desktop-picked external connection configuration, before it is parsed or saved. */
export interface ConnectionImportFile {
  fileName: string;
  content: string;
}
