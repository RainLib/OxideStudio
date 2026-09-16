import type { KnownDatabaseDriver } from "@/services/tauri/types";
import type { DatabaseDriverProfile } from "./driverProfileTypes";
import { consulProfile } from "./profiles/consul";
import { elasticsearchProfile } from "./profiles/elasticsearch";
import { etcdProfile } from "./profiles/etcd";
import { influxdbProfile } from "./profiles/influxdb";
import { influxdb3Profile } from "./profiles/influxdb3";
import { meilisearchProfile } from "./profiles/meilisearch";
import { mongodbProfile } from "./profiles/mongodb";
import { mysqlProfile } from "./profiles/mysql";
import { nacosProfile } from "./profiles/nacos";
import { postgresProfile } from "./profiles/postgres";
import { redisProfile } from "./profiles/redis";
import { sqliteProfile } from "./profiles/sqlite";
import { victoriametricsProfile } from "./profiles/victoriametrics";

export const DATABASE_DRIVER_PROFILES: Record<
  KnownDatabaseDriver,
  DatabaseDriverProfile
> = {
  postgres: postgresProfile,
  mysql: mysqlProfile,
  sqlite: sqliteProfile,
  redis: redisProfile,
  elasticsearch: elasticsearchProfile,
  etcd: etcdProfile,
  nacos: nacosProfile,
  consul: consulProfile,
  meilisearch: meilisearchProfile,
  mongodb: mongodbProfile,
  influxdb: influxdbProfile,
  influxdb3: influxdb3Profile,
  victoriametrics: victoriametricsProfile,
};
