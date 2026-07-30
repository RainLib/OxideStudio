import { Database } from "lucide-react";
import {
  SiClickhouse,
  SiCockroachlabs,
  SiElasticsearch,
  SiMariadb,
  SiMongodb,
  SiMysql,
  SiPostgresql,
  SiRedis,
  SiSqlite,
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
  clickhouse: { icon: SiClickhouse, color: "#f5c400" },
  cockroachdb: { icon: SiCockroachlabs, color: "#6933ff" },
};

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
