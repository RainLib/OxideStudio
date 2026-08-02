/** Driver-neutral merge for configured and discovered database catalogs. */
export function mergeCatalogNames(
  configuredCatalog: string | null | undefined,
  discoveredCatalogs: readonly string[],
) {
  return [configuredCatalog, ...discoveredCatalogs]
    .filter((catalog): catalog is string => Boolean(catalog?.trim()))
    .filter((catalog, index, catalogs) => catalogs.indexOf(catalog) === index)
    .sort((left, right) =>
      left.localeCompare(right, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
}
