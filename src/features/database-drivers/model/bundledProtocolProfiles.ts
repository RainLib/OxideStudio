import { capabilitiesKey } from "@/features/database-drivers/model/driverIdentity";
import { type DatabaseDriverProfile } from "@/features/database-drivers/model/driverProfileTypes";
import type { DatabaseDriver } from "@/services/tauri/types";

// DBX implements these products through its native PostgreSQL runtime. Keep
// their selected product identity and connection defaults in Oxide instead of
// silently presenting them as generic PostgreSQL. The shared runtime remains
// deliberately conservative: vendor-specific metadata/DDL is not inferred.
const BUNDLED_POSTGRES_PRODUCT_OVERRIDES: Readonly<
  Record<
    string,
    Readonly<{
      menuLabel: string;
      displayName: string;
      defaultDatabase: string;
      defaultPort: number;
    }>
  >
> = {
  redshift: {
    menuLabel: "Amazon Redshift",
    displayName: "Amazon Redshift",
    defaultDatabase: "dev",
    defaultPort: 5439,
  },
  gaussdb: {
    menuLabel: "GaussDB",
    displayName: "GaussDB",
    defaultDatabase: "postgres",
    defaultPort: 5432,
  },
  opengauss: {
    menuLabel: "openGauss",
    displayName: "openGauss",
    defaultDatabase: "postgres",
    defaultPort: 5432,
  },
};

export function bundledProtocolProfileForDriver(
  profile: DatabaseDriverProfile,
  driver: DatabaseDriver,
): DatabaseDriverProfile {
  const override = BUNDLED_POSTGRES_PRODUCT_OVERRIDES[capabilitiesKey(driver)];
  if (!override || capabilitiesKey(profile.driver) !== "postgres")
    return profile;
  return {
    ...profile,
    driver,
    menuLabel: override.menuLabel,
    defaultDatabase: override.defaultDatabase,
    capabilities: {
      ...profile.capabilities,
      displayName: override.displayName,
      defaultPort: override.defaultPort,
    },
  };
}
