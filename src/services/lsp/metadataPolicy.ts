/**
 * Some federated warehouses expose a very large catalog and make every
 * column-metadata request comparatively expensive. Keep their relation-name
 * completion complete, while loading fields only for an open or referenced
 * relation. This matches DBX's Trino/Presto completion policy.
 */
const ON_DEMAND_ONLY_COLUMN_METADATA_DRIVERS = new Set([
  "trino",
  "prestosql",
]);

export function usesOnDemandOnlyLspColumnMetadata(driver: string) {
  return ON_DEMAND_ONLY_COLUMN_METADATA_DRIVERS.has(
    driver.trim().toLocaleLowerCase(),
  );
}
