import {
  driverCandidateAvailability,
  driverCandidateConformance,
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  referenceDriverDeliveryPlan,
} from "@/features/database-drivers";
import {
  formatDriverCacheBytes,
  normalizeCredentialFreeHttpsRoot,
} from "@/features/database-drivers/settings/driverSettingsPolicy";
import { databaseService } from "@/services/tauri/database.service";
import type {
  DatabaseDriverCatalogEntry,
  DatabaseDriverInstallation,
  DatabaseDriverProbeResult,
  DatabaseDriverRuntimeSummary,
  DatabaseDriverStoreInfo,
  ManagedJavaRuntimeInstallation,
} from "@/services/tauri/types";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useEffect, useMemo, useState } from "react";
export function useDriverManagement() {
  const catalogUrl = useSettingsStore(
    (state) => state.settings.drivers.catalogUrl,
  );
  const driverStorePath = useSettingsStore(
    (state) => state.settings.drivers.storePath,
  );
  const sqliteWorkerBaseUrl = useSettingsStore(
    (state) => state.settings.drivers.sqliteWorkerBaseUrl,
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [installations, setInstallations] = useState<
    DatabaseDriverInstallation[] | null
  >(null);
  const [javaRuntimes, setJavaRuntimes] = useState<
    ManagedJavaRuntimeInstallation[] | null
  >(null);
  const [driverStore, setDriverStore] =
    useState<DatabaseDriverStoreInfo | null>(null);
  const [driverRuntimes, setDriverRuntimes] = useState<
    DatabaseDriverRuntimeSummary[] | null
  >(null);
  const [catalogUrlInput, setCatalogUrlInput] = useState(catalogUrl);
  const [sqliteWorkerBaseUrlInput, setSqliteWorkerBaseUrlInput] =
    useState(sqliteWorkerBaseUrl);
  const [catalogEntries, setCatalogEntries] = useState<
    DatabaseDriverCatalogEntry[] | null
  >(null);
  const [catalogStatus, setCatalogStatus] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probeStates, setProbeStates] = useState<
    Record<
      string,
      | { status: "loading" }
      | { status: "success"; result: DatabaseDriverProbeResult }
      | { status: "error"; message: string }
    >
  >({});
  const [packageAction, setPackageAction] = useState<
    | { status: "idle" }
    | { status: "loading"; key: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const candidateAvailability = useMemo(() => {
    const installed = installations || [];
    const catalog = catalogEntries || [];
    return REFERENCE_DATABASE_DRIVER_CANDIDATES.map((candidate) => ({
      candidate,
      availability: driverCandidateAvailability(candidate, installed),
      conformance: driverCandidateConformance(candidate, installed, catalog),
      delivery: referenceDriverDeliveryPlan(candidate),
    }));
  }, [catalogEntries, installations]);
  const candidateCoverage = useMemo(
    () => ({
      bundled: candidateAvailability.filter(
        ({ availability }) => availability === "bundled",
      ).length,
      activePackage: candidateAvailability.filter(
        ({ availability }) => availability === "activePackage",
      ).length,
      requiresPackage: candidateAvailability.filter(
        ({ availability }) => availability === "requiresPackage",
      ).length,
      activeRecorded: candidateAvailability.filter(
        ({ conformance }) => conformance.state === "activeRecorded",
      ).length,
      activeUnrecorded: candidateAvailability.filter(
        ({ conformance }) => conformance.state === "activeUnrecorded",
      ).length,
    }),
    [candidateAvailability],
  );

  const refreshInstallations = async () => {
    const [drivers, runtimes, store] = await Promise.all([
      databaseService.listDatabaseDriverInstallations(),
      databaseService.listManagedJavaRuntimes(),
      databaseService.getDatabaseDriverStoreInfo(),
    ]);
    setInstallations(drivers);
    setJavaRuntimes(runtimes);
    setDriverStore(store);
    setLoadError(null);
  };

  const refreshDriverRuntimes = async () => {
    // Older embedded/test hosts can omit this newly added read-only command.
    // Driver installation management must remain usable in that case.
    const loadRuntimes = databaseService.listExternalDatabaseDriverRuntimes;
    if (!loadRuntimes) {
      setDriverRuntimes([]);
      return;
    }
    try {
      setDriverRuntimes(await loadRuntimes());
    } catch {
      setDriverRuntimes([]);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      databaseService.listDatabaseDriverInstallations(),
      databaseService.listManagedJavaRuntimes(),
      databaseService.getDatabaseDriverStoreInfo(),
    ])
      .then(([drivers, runtimes, store]) => {
        if (active) {
          setInstallations(drivers);
          setJavaRuntimes(runtimes);
          setDriverStore(store);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to inspect drivers.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refreshDriverRuntimes();
  }, []);

  useEffect(() => {
    // Runtime health is connection-owned and can change after a sidecar exits;
    // keep the Driver Manager truthful without requiring the user to reopen it.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshDriverRuntimes();
      }
    }, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setCatalogUrlInput(catalogUrl);
  }, [catalogUrl]);

  useEffect(() => {
    setSqliteWorkerBaseUrlInput(sqliteWorkerBaseUrl);
  }, [sqliteWorkerBaseUrl]);

  const saveSqliteWorkerSource = async () => {
    const normalized = normalizeCredentialFreeHttpsRoot(
      sqliteWorkerBaseUrlInput,
    );
    if (normalized === null) {
      setPackageAction({
        status: "error",
        message:
          "SQLite worker source must be a credential-free HTTPS URL without query parameters or fragments.",
      });
      return;
    }
    try {
      await updateSettings({
        drivers: {
          catalogUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl: normalized,
        },
      });
      setSqliteWorkerBaseUrlInput(normalized);
      setPackageAction({
        status: "success",
        message: normalized
          ? "Remote SQLite worker source saved."
          : "Remote SQLite worker downloads disabled.",
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to save the SQLite worker source.",
      });
    }
  };

  const reconnectDriverRuntime = async (
    runtime: DatabaseDriverRuntimeSummary,
  ) => {
    const key = `runtime-reconnect:${runtime.driver}:${runtime.packageVersion}`;
    setPackageAction({ status: "loading", key });
    try {
      const result =
        await databaseService.reconnectExternalDatabaseDriverRuntimes(
          runtime.driver,
          runtime.packageVersion,
        );
      await refreshDriverRuntimes();
      setPackageAction({
        status: "success",
        message:
          result.reconnectedCount > 0
            ? `Reconnected ${result.reconnectedCount} exited driver runtime${result.reconnectedCount === 1 ? "" : "s"}.`
            : result.budgetBlockedCount > 0
              ? "Reconnect is temporarily limited to prevent a crash loop."
              : "No exited driver runtime still required reconnecting.",
      });
    } catch {
      setPackageAction({
        status: "error",
        message:
          "The exited driver runtime could not be reconnected. Review its package and reconnect the data source manually.",
      });
    }
  };

  const checkCatalog = async () => {
    const nextUrl = catalogUrlInput.trim();
    if (!nextUrl) {
      setCatalogEntries(null);
      setCatalogStatus({
        status: "error",
        message:
          "Enter an HTTPS catalog URL before checking for driver packages.",
      });
      return;
    }
    setCatalogStatus({ status: "loading" });
    try {
      const result =
        await databaseService.getExternalDatabaseDriverCatalog(nextUrl);
      await updateSettings({
        drivers: {
          catalogUrl: result.sourceUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl,
        },
      });
      setCatalogEntries(result.catalog.packages);
      setCatalogStatus({
        status: "success",
        message: `${result.catalog.packages.length} signed package${result.catalog.packages.length === 1 ? "" : "s"} available for review.`,
      });
    } catch (error) {
      setCatalogEntries(null);
      setCatalogStatus({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to verify driver catalog.",
      });
    }
  };

  const importPackage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Database Driver Package",
      });
      if (typeof selected !== "string") return;
      setPackageAction({ status: "loading", key: "import" });
      const installed = await databaseService.installExternalDatabaseDriver(
        selected,
        true,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installed.displayName} ${installed.packageVersion || ""} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to install driver package.",
      });
    }
  };

  const installCatalogPackage = async (entry: DatabaseDriverCatalogEntry) => {
    const nextUrl = catalogUrlInput.trim();
    if (!nextUrl || !entry.archiveSha256) return;
    const key = `catalog-install:${entry.driverId}:${entry.packageVersion}`;
    try {
      setPackageAction({ status: "loading", key });
      const installed =
        await databaseService.installExternalDatabaseDriverFromCatalog(
          nextUrl,
          entry.driverId,
          entry.packageVersion,
          true,
        );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installed.displayName} ${installed.packageVersion || ""} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to install driver package.",
      });
    }
  };

  const importJavaRuntime = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Signed Java 21 Runtime",
      });
      if (typeof selected !== "string") return;
      setPackageAction({ status: "loading", key: "import-java" });
      const runtime = await databaseService.installManagedJavaRuntime(
        selected,
        true,
      );
      await refreshInstallations();
      setPackageAction({
        status: "success",
        message: `Java ${runtime.javaMajor} runtime ${runtime.runtimeVersion} installed and activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to install Java runtime.",
      });
    }
  };

  const migrateDriverStore = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const parentDirectory = await open({
        directory: true,
        multiple: false,
        title: "Choose a parent directory for the migrated Driver Store",
      });
      if (typeof parentDirectory !== "string") return;
      const separator = parentDirectory.includes("\\") ? "\\" : "/";
      const destination = `${parentDirectory.replace(/[\\/]+$/u, "")}${separator}oxide-database-drivers`;
      setPackageAction({ status: "loading", key: "migrate-store" });
      const store =
        await databaseService.migrateDatabaseDriverStore(destination);
      setDriverStore(store);
      await updateSettings({
        drivers: {
          catalogUrl,
          storePath: store.activePath,
          sqliteWorkerBaseUrl,
        },
      });
      setPackageAction({
        status: "success",
        message:
          "Driver Store copied and verified. Restart OxideStudio to use the new location; the old store was kept unchanged.",
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to migrate Driver Store.",
      });
    }
  };

  const cleanDriverCache = async () => {
    try {
      setPackageAction({ status: "loading", key: "prune-cache" });
      const result = await databaseService.pruneDatabaseDriverCache();
      const skipped = result.skippedEntries
        ? ` ${result.skippedEntries} unknown or unsafe cache ${result.skippedEntries === 1 ? "entry was" : "entries were"} left unchanged.`
        : "";
      setPackageAction({
        status: "success",
        message: `Freed ${formatDriverCacheBytes(result.bytesRemoved)} from ${result.filesRemoved} cached file${result.filesRemoved === 1 ? "" : "s"}; ${result.retainedVersions} protected version${result.retainedVersions === 1 ? " was" : "s were"} retained.${skipped}`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to clean Driver Store cache.",
      });
    }
  };

  const activatePackage = async (installation: DatabaseDriverInstallation) => {
    const packageVersion = installation.packageVersion;
    if (!packageVersion) return;
    const key = `activate:${installation.driver}:${packageVersion}`;
    setPackageAction({ status: "loading", key });
    try {
      await databaseService.activateExternalDatabaseDriver(
        installation.driver,
        packageVersion,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installation.displayName} ${packageVersion} activated.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to activate package.",
      });
    }
  };

  const rollbackPackage = async (installation: DatabaseDriverInstallation) => {
    const key = `rollback:${installation.driver}`;
    setPackageAction({ status: "loading", key });
    try {
      const state = await databaseService.rollbackExternalDatabaseDriver(
        installation.driver,
      );
      await refreshInstallations();
      await useDatabaseDriverCatalogStore.getState().refresh();
      setPackageAction({
        status: "success",
        message: `${installation.displayName} rolled back to ${state.current}.`,
      });
    } catch (error) {
      setPackageAction({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to roll back package.",
      });
    }
  };

  const probePackage = async (installation: DatabaseDriverInstallation) => {
    const key = `${installation.driver}:${installation.packageVersion || "active"}`;
    setProbeStates((state) => ({ ...state, [key]: { status: "loading" } }));
    try {
      const result = await databaseService.probeExternalDatabaseDriver(
        installation.driver,
      );
      setProbeStates((state) => ({
        ...state,
        [key]: { status: "success", result },
      }));
    } catch (error) {
      setProbeStates((state) => ({
        ...state,
        [key]: {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to start this driver package.",
        },
      }));
    }
  };

  return {
    installations,
    javaRuntimes,
    driverStore,
    driverRuntimes,
    catalogUrlInput,
    setCatalogUrlInput,
    sqliteWorkerBaseUrlInput,
    setSqliteWorkerBaseUrlInput,
    catalogEntries,
    catalogStatus,
    loadError,
    probeStates,
    packageAction,
    candidateAvailability,
    candidateCoverage,
    refreshDriverRuntimes,
    saveSqliteWorkerSource,
    reconnectDriverRuntime,
    checkCatalog,
    importPackage,
    installCatalogPackage,
    importJavaRuntime,
    migrateDriverStore,
    cleanDriverCache,
    activatePackage,
    rollbackPackage,
    probePackage,
  };
}
