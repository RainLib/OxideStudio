import { Database } from "lucide-react";
import { DiMsqlServer } from "react-icons/di";
import {
  SiApachecassandra,
  SiApachehbase,
  SiApachehive,
  SiApachekafka,
  SiApachekylin,
  SiApachepulsar,
  SiApachespark,
  SiClickhouse,
  SiCloudflare,
  SiCockroachlabs,
  SiDatabricks,
  SiDuckdb,
  SiElasticsearch,
  SiGooglebigquery,
  SiH2Database,
  SiInfluxdb,
  SiMariadb,
  SiMilvus,
  SiMongodb,
  SiMysql,
  SiNeo4J,
  SiPostgresql,
  SiQdrant,
  SiRedis,
  SiSnowflake,
  SiSqlite,
  SiTeradata,
  SiTidb,
  SiTimescale,
  SiTrino,
  SiTurso,
} from "react-icons/si";
import type { IconType } from "react-icons";
import type { CSSProperties } from "react";

type DatabaseBrand = {
  icon: IconType;
  color: string;
};

const DATABASE_BRANDS: Record<string, DatabaseBrand> = {
  postgres: { icon: SiPostgresql, color: "#4169e1" },
  postgresql: { icon: SiPostgresql, color: "#4169e1" },
  mysql: { icon: SiMysql, color: "#4479a1" },
  mariadb: { icon: SiMariadb, color: "#c0765a" },
  mongodb: { icon: SiMongodb, color: "#47a248" },
  redis: { icon: SiRedis, color: "#dc382d" },
  elasticsearch: { icon: SiElasticsearch, color: "#00a9a5" },
  sqlite: { icon: SiSqlite, color: "#6aa9d3" },
  duckdb: { icon: SiDuckdb, color: "#fff000" },
  clickhouse: { icon: SiClickhouse, color: "#f5c400" },
  cockroachdb: { icon: SiCockroachlabs, color: "#6933ff" },
  timescaledb: { icon: SiTimescale, color: "#fdb515" },
  tidb: { icon: SiTidb, color: "#ea3a3a" },
  sqlserver: { icon: DiMsqlServer, color: "#cc2927" },
  h2: { icon: SiH2Database, color: "#1d76db" },
  trino: { icon: SiTrino, color: "#dd00a1" },
  hive: { icon: SiApachehive, color: "#fdee21" },
  spark: { icon: SiApachespark, color: "#e25a1c" },
  kylin: { icon: SiApachekylin, color: "#4b91d3" },
  databricks: { icon: SiDatabricks, color: "#ff3621" },
  snowflake: { icon: SiSnowflake, color: "#29b5e8" },
  bigquery: { icon: SiGooglebigquery, color: "#669df6" },
  teradata: { icon: SiTeradata, color: "#f37440" },
  cassandra: { icon: SiApachecassandra, color: "#1287b1" },
  hbase: { icon: SiApachehbase, color: "#b9a06a" },
  neo4j: { icon: SiNeo4J, color: "#4581c3" },
  qdrant: { icon: SiQdrant, color: "#dc244c" },
  milvus: { icon: SiMilvus, color: "#00a1ea" },
  influxdb: { icon: SiInfluxdb, color: "#22adf6" },
  turso: { icon: SiTurso, color: "#4ff8d2" },
  "cloudflare-d1": { icon: SiCloudflare, color: "#f6821f" },
  easysearch: { icon: SiElasticsearch, color: "#00a9a5" },
  mq: { icon: SiApachekafka, color: "#d6d6d6" },
  pulsar: { icon: SiApachepulsar, color: "#188fff" },
};

/**
 * DBX maintains a product-specific icon catalogue under Apache-2.0. Keep the
 * asset mapping separate from the fallback vector marks so every product is
 * recognisable even when react-icons does not ship a vendor logo. New drivers
 * only need one entry here; all UI surfaces consume DatabaseBrandIcon.
 */
const DATABASE_ICON_FILES: Record<string, string> = {
  access: "access.png",
  bigquery: "bigquery.svg",
  cassandra: "cassandra.svg",
  chromadb: "chromadb.svg",
  clickhouse: "clickhouse.svg",
  "cloudflare-d1": "cloudflare-d1.svg",
  cockroachdb: "cockroachdb.svg",
  databend: "databend.svg",
  databricks: "databricks.svg",
  dameng: "dm.svg",
  db2: "db2.svg",
  doris: "doris.svg",
  duckdb: "duckdb.svg",
  easysearch: "easysearch.svg",
  elasticsearch: "elasticsearch.svg",
  etcd: "etcd.svg",
  exasol: "exasol.svg",
  firebird: "firebird.svg",
  gaussdb: "gaussdb.svg",
  gbase: "gbase.png",
  goldendb: "goldendb.png",
  greenplum: "postgres.svg",
  h2: "h2.svg",
  hbase: "hbase.svg",
  highgo: "highgo.png",
  hive: "hive.svg",
  influxdb: "influxdb.svg",
  informix: "informix.svg",
  iotdb: "iotdb.svg",
  iris: "iris.svg",
  jdbc: "jdbcx.svg",
  kingbase: "kingbase.svg",
  kwdb: "kwdb.svg",
  kylin: "apache_kylin.svg",
  manticoresearch: "manticoresearch.png",
  mariadb: "mariadb.svg",
  milvus: "milvus.png",
  mongodb: "mongodb.svg",
  mysql: "mysql.svg",
  mq: "kafka.svg",
  nacos: "nacos.png",
  neo4j: "neo4j.svg",
  "oceanbase-oracle": "oceanbase.svg",
  opengauss: "opengauss.svg",
  oracle: "oracle.svg",
  oscar: "oscar.png",
  postgres: "postgres.svg",
  postgresql: "postgres.svg",
  prestosql: "presto.svg",
  qdrant: "qdrant.svg",
  questdb: "questdb.svg",
  redis: "redis.svg",
  redshift: "redshift.svg",
  rqlite: "rqlite.png",
  saphana: "saphana.svg",
  snowflake: "snowflake.svg",
  spark: "spark-logo.png",
  sqlite: "sqlite.svg",
  sqlserver: "sqlserver.svg",
  starrocks: "starrocks.svg",
  sundb: "sundb.svg",
  tdengine: "tdengine.svg",
  teradata: "teradata.svg",
  tidb: "tidb.svg",
  trino: "trino.svg",
  turso: "turso.png",
  uxdb: "uxdb.svg",
  vastbase: "vastbase.svg",
  vertica: "vertica.webp",
  weaviate: "weaviate.svg",
  xugu: "xugu.png",
  yashandb: "yashandb.png",
  yugabytedb: "postgres.svg",
  zookeeper: "zookeeper.svg",
};

export function databaseBrandAssetFile(
  driver: string | null | undefined,
) {
  return DATABASE_ICON_FILES[String(driver || "").trim().toLowerCase()] || null;
}

export function hasDatabaseBrandIcon(driver: string | null | undefined) {
  const normalized = String(driver || "").trim().toLowerCase();
  return Boolean(DATABASE_ICON_FILES[normalized] || DATABASE_BRANDS[normalized]);
}

interface DatabaseBrandIconProps {
  driver: string | null | undefined;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function DatabaseBrandIcon({
  driver,
  size = 14,
  className,
  style,
  title,
}: DatabaseBrandIconProps) {
  const normalizedDriver = String(driver || "").trim().toLowerCase();
  const brand = DATABASE_BRANDS[normalizedDriver];
  const assetFile = databaseBrandAssetFile(normalizedDriver);

  if (assetFile) {
    return (
      <img
        src={`/database-icons/${assetFile}`}
        width={size}
        height={size}
        className={className}
        style={style}
        data-database-brand={normalizedDriver}
        alt={title || ""}
        title={title}
        aria-hidden={title ? undefined : true}
      />
    );
  }

  if (!brand) {
    return (
      <Database
        size={size}
        className={className}
        style={style}
        data-database-brand={normalizedDriver || "generic"}
        aria-hidden={title ? undefined : true}
        aria-label={title}
      />
    );
  }

  const Icon = brand.icon;
  return (
    <Icon
      size={size}
      className={className}
      color={typeof style?.color === "string" ? style.color : brand.color}
      style={style}
      data-database-brand={normalizedDriver}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
