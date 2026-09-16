import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { useExplorerPostgresVisibility } from "@/features/database-explorer/hooks/useExplorerPostgresVisibility";
import { useExplorerSchemaVisibility } from "@/features/database-explorer/hooks/useExplorerSchemaVisibility";
import type { PostgresDatabaseDiscoveryState } from "@/hooks/usePostgresDatabaseDiscovery";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useMemo, useState } from "react";
interface UseExplorerCatalogVisibilityContext {
  activeConnectionId: string | null;
  activeProjectId: string;
  activeDriver: DatabaseDriver;
  activeConnection: ConnectionConfig | undefined;
  canBrowseDatabaseCatalogs: boolean;
  postgresDatabaseDiscovery: PostgresDatabaseDiscoveryState;
  currentSchema: string | null;
  defaultSchema: string | null;
  schemas: string[];
  shouldLimitVisibleSchemas: boolean;
}
export function useExplorerCatalogVisibility({
  activeConnectionId,
  activeProjectId,
  activeDriver,
  activeConnection,
  canBrowseDatabaseCatalogs,
  postgresDatabaseDiscovery,
  currentSchema,
  defaultSchema,
  schemas,
  shouldLimitVisibleSchemas,
}: UseExplorerCatalogVisibilityContext) {
  const [schemaVisibilityKey, setSchemaVisibilityKey] = useState<string | null>(
    null,
  );

  const [showAllSchemas, setShowAllSchemas] = useState(false);

  const [visibleSchemaNames, setVisibleSchemaNames] = useState<string[]>([]);

  const [postgresVisibilityKey, setPostgresVisibilityKey] = useState<
    string | null
  >(null);

  const [showAllPostgresDatabases, setShowAllPostgresDatabases] =
    useState(true);

  const [visiblePostgresDatabaseNames, setVisiblePostgresDatabaseNames] =
    useState<string[]>([]);

  const schemaVisibilityStorageKey = activeConnectionId
    ? `oxide-studio-visible-schemas:${activeProjectId}:${activeConnectionId}:${activeDriver}`
    : null;

  const activePostgresDatabase =
    activeConnection && canBrowseDatabaseCatalogs
      ? connectionCatalogDatabaseName(activeConnection)
      : "";

  const postgresDatabaseRows = useMemo(() => {
    const discoveredDatabases =
      postgresDatabaseDiscovery.connectionId === activeConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return [
      ...(activePostgresDatabase ? [activePostgresDatabase] : []),
      ...discoveredDatabases.filter(
        (database) => database !== activePostgresDatabase,
      ),
    ].filter(
      (database, index, rows) =>
        Boolean(database) && rows.indexOf(database) === index,
    );
  }, [
    activeConnectionId,
    activePostgresDatabase,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);

  const postgresDatabaseVisibilityStorageKey =
    activeConnectionId && canBrowseDatabaseCatalogs
      ? `oxide-studio-visible-databases:${activeProjectId}:${activeConnectionId}`
      : null;

  const visiblePostgresDatabaseSet = useMemo(
    () => new Set(visiblePostgresDatabaseNames),
    [visiblePostgresDatabaseNames],
  );

  const visiblePostgresDatabases = useMemo(
    () =>
      showAllPostgresDatabases
        ? postgresDatabaseRows
        : postgresDatabaseRows.filter((database) =>
            visiblePostgresDatabaseSet.has(database),
          ),
    [
      postgresDatabaseRows,
      showAllPostgresDatabases,
      visiblePostgresDatabaseSet,
    ],
  );

  const postgresDatabaseCountLabel = showAllPostgresDatabases
    ? `${postgresDatabaseRows.length} db`
    : `${visiblePostgresDatabases.length} of ${postgresDatabaseRows.length} db`;

  const preferredVisibleSchema =
    [currentSchema, defaultSchema, activeConnection?.database, schemas[0]].find(
      (schema): schema is string =>
        Boolean(schema && (schemas.length === 0 || schemas.includes(schema))),
    ) || null;

  const visibleSchemaSet = useMemo(
    () => new Set(visibleSchemaNames),
    [visibleSchemaNames],
  );

  const schemaRows = useMemo(() => {
    if (schemas.length === 0) {
      return currentSchema ? [currentSchema] : [];
    }

    // Catalog-aware drivers own schema visibility beneath their database
    // nodes, rather than through the connection-wide schema picker.
    if (canBrowseDatabaseCatalogs) return schemas;

    if (showAllSchemas || !shouldLimitVisibleSchemas) return schemas;

    const rows = schemas.filter((schema) => visibleSchemaSet.has(schema));
    if (
      currentSchema &&
      schemas.includes(currentSchema) &&
      !rows.includes(currentSchema)
    ) {
      rows.unshift(currentSchema);
    }

    if (rows.length === 0 && preferredVisibleSchema) {
      return [preferredVisibleSchema];
    }

    return rows;
  }, [
    canBrowseDatabaseCatalogs,
    currentSchema,
    preferredVisibleSchema,
    schemas,
    shouldLimitVisibleSchemas,
    showAllSchemas,
    visibleSchemaSet,
  ]);

  const schemaCountLabel =
    canBrowseDatabaseCatalogs || showAllSchemas || !shouldLimitVisibleSchemas
      ? String(schemas.length)
      : `${schemaRows.length} of ${schemas.length}`;

  const updateVisibleSchemas = (showAll: boolean, names: string[]) => {
    const normalizedNames = Array.from(new Set(names)).filter(
      (schema) => schemas.length === 0 || schemas.includes(schema),
    );
    setShowAllSchemas(showAll);
    setVisibleSchemaNames(normalizedNames);

    if (!schemaVisibilityStorageKey) return;

    try {
      localStorage.setItem(
        schemaVisibilityStorageKey,
        JSON.stringify({ all: showAll, schemas: normalizedNames }),
      );
    } catch (error) {
      console.warn("Failed to persist visible schemas", error);
    }
  };

  const handleToggleAllSchemas = (checked: boolean | "indeterminate") => {
    const nextChecked = checked === true;
    updateVisibleSchemas(
      nextChecked,
      nextChecked
        ? schemas
        : preferredVisibleSchema
          ? [preferredVisibleSchema]
          : [],
    );
  };

  const handleToggleSchemaVisibility = (
    schema: string,
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;

    if (showAllSchemas && !nextChecked) {
      updateVisibleSchemas(
        false,
        schemas.filter((item) => item !== schema),
      );
      return;
    }

    const nextNames = nextChecked
      ? [...visibleSchemaNames, schema]
      : visibleSchemaNames.filter((item) => item !== schema);
    updateVisibleSchemas(false, nextNames);
  };

  const updateVisiblePostgresDatabases = (
    showAll: boolean,
    names: string[],
  ) => {
    const normalizedNames = Array.from(new Set(names)).filter(
      (database) =>
        postgresDatabaseRows.length === 0 ||
        postgresDatabaseRows.includes(database),
    );
    setShowAllPostgresDatabases(showAll);
    setVisiblePostgresDatabaseNames(normalizedNames);

    if (!postgresDatabaseVisibilityStorageKey) return;
    try {
      localStorage.setItem(
        postgresDatabaseVisibilityStorageKey,
        JSON.stringify({ all: showAll, databases: normalizedNames }),
      );
    } catch (error) {
      console.warn("Failed to persist visible PostgreSQL databases", error);
    }
  };

  const handleToggleAllPostgresDatabases = (
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;
    updateVisiblePostgresDatabases(
      nextChecked,
      nextChecked ? postgresDatabaseRows : [],
    );
  };

  const handleTogglePostgresDatabaseVisibility = (
    database: string,
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;
    if (showAllPostgresDatabases && !nextChecked) {
      updateVisiblePostgresDatabases(
        false,
        postgresDatabaseRows.filter((item) => item !== database),
      );
      return;
    }

    const nextNames = nextChecked
      ? [...visiblePostgresDatabaseNames, database]
      : visiblePostgresDatabaseNames.filter((item) => item !== database);
    updateVisiblePostgresDatabases(false, nextNames);
  };

  useExplorerPostgresVisibility({
    postgresDatabaseVisibilityStorageKey,
    postgresVisibilityKey,
    setPostgresVisibilityKey,
    setShowAllPostgresDatabases,
    setVisiblePostgresDatabaseNames,
  });

  useExplorerSchemaVisibility({
    schemaVisibilityStorageKey,
    setSchemaVisibilityKey,
    setShowAllSchemas,
    setVisibleSchemaNames,
    schemaVisibilityKey,
    shouldLimitVisibleSchemas,
    preferredVisibleSchema,
    showAllSchemas,
    visibleSchemaNames,
    updateVisibleSchemas,
  });
  return {
    showAllSchemas,
    showAllPostgresDatabases,
    activePostgresDatabase,
    postgresDatabaseRows,
    visiblePostgresDatabaseSet,
    visiblePostgresDatabases,
    postgresDatabaseCountLabel,
    preferredVisibleSchema,
    visibleSchemaSet,
    schemaRows,
    schemaCountLabel,
    handleToggleAllSchemas,
    handleToggleSchemaVisibility,
    handleToggleAllPostgresDatabases,
    handleTogglePostgresDatabaseVisibility,
  };
}
