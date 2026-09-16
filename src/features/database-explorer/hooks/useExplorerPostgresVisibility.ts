import { useEffect } from "react";

interface UseExplorerPostgresVisibilityContext {
  postgresDatabaseVisibilityStorageKey: string | null;
  postgresVisibilityKey: string | null;
  setPostgresVisibilityKey: React.Dispatch<React.SetStateAction<string | null>>;
  setShowAllPostgresDatabases: React.Dispatch<React.SetStateAction<boolean>>;
  setVisiblePostgresDatabaseNames: React.Dispatch<
    React.SetStateAction<string[]>
  >;
}

export function useExplorerPostgresVisibility({
  postgresDatabaseVisibilityStorageKey,
  postgresVisibilityKey,
  setPostgresVisibilityKey,
  setShowAllPostgresDatabases,
  setVisiblePostgresDatabaseNames,
}: UseExplorerPostgresVisibilityContext) {
  useEffect(() => {
    if (!postgresDatabaseVisibilityStorageKey) {
      if (postgresVisibilityKey !== null) {
        setPostgresVisibilityKey(null);
        setShowAllPostgresDatabases(true);
        setVisiblePostgresDatabaseNames([]);
      }
      return;
    }
    if (postgresVisibilityKey === postgresDatabaseVisibilityStorageKey) return;

    let showAll = true;
    let databases: string[] = [];
    try {
      const saved = localStorage.getItem(postgresDatabaseVisibilityStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          all?: unknown;
          databases?: unknown;
        };
        showAll = parsed.all !== false;
        databases = Array.isArray(parsed.databases)
          ? parsed.databases.filter(
              (database): database is string => typeof database === "string",
            )
          : [];
      }
    } catch (error) {
      console.warn("Failed to restore visible PostgreSQL databases", error);
    }

    setShowAllPostgresDatabases(showAll);
    setVisiblePostgresDatabaseNames(databases);
    setPostgresVisibilityKey(postgresDatabaseVisibilityStorageKey);
  }, [postgresDatabaseVisibilityStorageKey, postgresVisibilityKey]);
}
