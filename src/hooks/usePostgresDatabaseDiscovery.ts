import { useEffect, useMemo, useState } from "react";
import {
  readCachedPostgresDatabaseCatalog,
  refreshPostgresDatabaseCatalog,
  subscribePostgresDatabaseCatalog,
  type PostgresDatabaseCatalogIdentity,
} from "@/services/postgresDatabaseCatalogCache";
import type { DatabaseDriver } from "@/services/tauri/types";

export type PostgresDatabaseDiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface PostgresDatabaseDiscoveryState {
  connectionId: string | null;
  status: PostgresDatabaseDiscoveryStatus;
  databases: string[];
  error: string | null;
  source: "cache" | "remote" | null;
  isRefreshing: boolean;
  cacheLoaded: boolean;
}

interface UsePostgresDatabaseDiscoveryOptions {
  projectId: string;
  connectionId: string | null;
  driver: DatabaseDriver | null | undefined;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
  canBrowseDatabaseCatalogs?: boolean;
  isConnectionReady: boolean;
  refreshVersion: number;
}

const EMPTY_DISCOVERY: PostgresDatabaseDiscoveryState = {
  connectionId: null,
  status: "idle",
  databases: [],
  error: null,
  source: null,
  isRefreshing: false,
  cacheLoaded: false,
};

function discoveryKey(identity: PostgresDatabaseCatalogIdentity) {
  return JSON.stringify([
    identity.projectId,
    identity.connectionId,
    identity.driver,
    identity.driverPackageVersion || null,
    identity.connectionDatabaseName || null,
  ]);
}

/**
 * Project-scoped stale-while-revalidate discovery for PostgreSQL databases.
 * SQLite hydration always completes before a live refresh is admitted, and a
 * slow live request never clears cached rows or touches global schema loading.
 */
export function usePostgresDatabaseDiscovery({
  projectId,
  connectionId,
  driver,
  driverPackageVersion,
  connectionDatabaseName,
  canBrowseDatabaseCatalogs = false,
  isConnectionReady,
  refreshVersion,
}: UsePostgresDatabaseDiscoveryOptions): PostgresDatabaseDiscoveryState {
  const identity = useMemo<PostgresDatabaseCatalogIdentity | null>(
    () =>
      connectionId && driver && canBrowseDatabaseCatalogs
        ? {
            projectId,
            connectionId,
            driver,
            driverPackageVersion: driverPackageVersion || null,
            connectionDatabaseName: connectionDatabaseName || null,
          }
        : null,
    [
      canBrowseDatabaseCatalogs,
      connectionDatabaseName,
      connectionId,
      driver,
      driverPackageVersion,
      projectId,
    ]
  );
  const scopeKey = identity ? discoveryKey(identity) : null;
  const [state, setState] = useState<PostgresDatabaseDiscoveryState>(
    EMPTY_DISCOVERY
  );
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!identity || !scopeKey) {
      setHydratedScopeKey(null);
      setState(EMPTY_DISCOVERY);
      return () => {
        cancelled = true;
      };
    }

    // The configured/current database is rendered separately by the tree, so
    // catalog hydration can remain visually ready while SQLite is queried.
    setHydratedScopeKey(null);
    setState({
      connectionId: identity.connectionId,
      status: "success",
      databases: [],
      error: null,
      source: null,
      isRefreshing: false,
      cacheLoaded: false,
    });

    void readCachedPostgresDatabaseCatalog(identity).then((snapshot) => {
      if (cancelled) return;
      setState({
        connectionId: identity.connectionId,
        status: "success",
        databases: snapshot?.databases || [],
        error: null,
        source: snapshot?.source || null,
        isRefreshing: false,
        cacheLoaded: true,
      });
      setHydratedScopeKey(scopeKey);
    });

    return () => {
      cancelled = true;
    };
  }, [identity, scopeKey]);

  useEffect(() => {
    if (!identity || !scopeKey) return;
    return subscribePostgresDatabaseCatalog(identity, (snapshot) => {
      setState({
        connectionId: identity.connectionId,
        status: "success",
        databases: snapshot.databases,
        error: null,
        source: snapshot.source,
        isRefreshing: false,
        cacheLoaded: true,
      });
      setHydratedScopeKey(scopeKey);
    });
  }, [identity, scopeKey]);

  useEffect(() => {
    if (
      !identity ||
      !scopeKey ||
      hydratedScopeKey !== scopeKey ||
      !isConnectionReady ||
      state.connectionId !== identity.connectionId ||
      !state.cacheLoaded
    ) {
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      isRefreshing: true,
      error: null,
    }));

    void refreshPostgresDatabaseCatalog(identity)
      .then((snapshot) => {
        if (cancelled) return;
        setState({
          connectionId: identity.connectionId,
          status: "success",
          databases: snapshot.databases,
          error: null,
          source: "remote",
          isRefreshing: false,
          cacheLoaded: true,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({
          ...current,
          status:
            current.source === "cache" || current.databases.length > 0
              ? "success"
              : "error",
          error: message,
          isRefreshing: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    identity,
    hydratedScopeKey,
    isConnectionReady,
    refreshVersion,
    scopeKey,
    state.cacheLoaded,
    state.connectionId,
  ]);

  // Effects run after render. If two projects happen to reuse the same
  // connection id, never expose the previous project's rows for even one
  // frame while the new SQLite scope is being hydrated.
  if (!identity || !scopeKey) return EMPTY_DISCOVERY;
  if (hydratedScopeKey !== scopeKey) {
    return {
      connectionId: identity.connectionId,
      status: "success",
      databases: [],
      error: null,
      source: null,
      isRefreshing: false,
      cacheLoaded: false,
    };
  }

  return state;
}
