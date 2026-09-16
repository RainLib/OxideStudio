import {
  ACTIVE_DRIVER_PACKAGE_VALUE,
  normalizeSignedCatalogUrl,
  signedCatalogReleaseForDriver,
} from "@/features/connections/model/connectionFormPolicy";
import type { ConnectionStatus } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import type { DataSourceDriverAvailability } from "@/features/database-drivers/model/dataSourceDriverChoices";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import { buildConnectionUrl } from "@/lib/connectionUrlParser";
import { databaseService } from "@/services/tauri";
import type {
  DatabaseDriverCatalogEntry,
  DatabaseDriverInstallation,
} from "@/services/tauri/types/database";

interface ConnectionDriverActionsContext {
  setIsRefreshingDriverStatus: React.Dispatch<React.SetStateAction<boolean>>;
  refreshDatabaseDriverCatalog: () => Promise<void>;
  setDriverPackages: React.Dispatch<
    React.SetStateAction<DatabaseDriverInstallation[]>
  >;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  selectedConnection: ConnectionConfig;
  setIsInstallingDriver: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDriverAvailability: DataSourceDriverAvailability;
  driverPackages: DatabaseDriverInstallation[];
  catalogRelease: DatabaseDriverCatalogEntry | null;
  driverCatalogUrl: string;
  selectedDriverLabel: string;
  catalogUrlInput: string;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  driverStorePath: string;
  sqliteWorkerBaseUrl: string;
  setCatalogRelease: React.Dispatch<
    React.SetStateAction<DatabaseDriverCatalogEntry | null>
  >;
  setIsCatalogInstallSetupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  availableDriverPackages: DatabaseDriverInstallation[];
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  supportsConnectionDatabase: boolean;
}

export function createConnectionDriverActions({
  setIsRefreshingDriverStatus,
  refreshDatabaseDriverCatalog,
  setDriverPackages,
  setStatus,
  selectedConnection,
  setIsInstallingDriver,
  selectedDriverAvailability,
  driverPackages,
  catalogRelease,
  driverCatalogUrl,
  selectedDriverLabel,
  catalogUrlInput,
  updateSettings,
  driverStorePath,
  sqliteWorkerBaseUrl,
  setCatalogRelease,
  setIsCatalogInstallSetupOpen,
  availableDriverPackages,
  updateConnectionConfig,
  supportsConnectionDatabase,
}: ConnectionDriverActionsContext) {
  const refreshDriverStatus = async () => {
    setIsRefreshingDriverStatus(true);
    try {
      await refreshDatabaseDriverCatalog();
      const installations =
        await databaseService.listDatabaseDriverInstallations();
      setDriverPackages(installations);
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not refresh driver status.",
      });
    } finally {
      setIsRefreshingDriverStatus(false);
    }
  };

  const installSelectedDriver = async () => {
    if (!selectedConnection) return;
    setIsInstallingDriver(true);
    setStatus({
      type: "loading",
      message: "Installing signed driver package...",
    });
    try {
      if (selectedDriverAvailability === "activationRequired") {
        const inactivePackage = driverPackages.find(
          (installation) =>
            installation.driver.toLowerCase() ===
              selectedConnection.driver.toLowerCase() &&
            installation.distribution === "external" &&
            installation.status === "ready" &&
            installation.runtimeReady !== false &&
            installation.packageVersion,
        );
        if (!inactivePackage?.packageVersion) {
          throw new Error(
            "No verified installed package is available to activate.",
          );
        }
        await databaseService.activateExternalDatabaseDriver(
          selectedConnection.driver,
          inactivePackage.packageVersion,
        );
      } else if (catalogRelease && driverCatalogUrl.trim()) {
        await databaseService.installExternalDatabaseDriverFromCatalog(
          driverCatalogUrl.trim(),
          catalogRelease.driverId,
          catalogRelease.packageVersion,
          true,
        );
      } else {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const packageDirectory = await open({
          directory: true,
          multiple: false,
          title: `Choose Signed ${selectedDriverLabel} Driver Package`,
        });
        if (typeof packageDirectory !== "string") {
          setStatus(null);
          return;
        }
        await databaseService.installExternalDatabaseDriver(
          packageDirectory,
          true,
        );
      }
      await refreshDriverStatus();
      setStatus({
        type: "success",
        message: `${selectedDriverLabel} is installed and ready to use.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not install the driver package.",
      });
    } finally {
      setIsInstallingDriver(false);
    }
  };

  const installSelectedDriverFromCatalogUrl = async () => {
    if (!selectedConnection) return;
    const catalogUrl = normalizeSignedCatalogUrl(catalogUrlInput);
    if (!catalogUrl) {
      setStatus({
        type: "error",
        message:
          "Enter a signed HTTPS catalog URL without credentials, query parameters, or fragments.",
      });
      return;
    }
    setIsInstallingDriver(true);
    setStatus({
      type: "loading",
      message: "Checking the signed driver catalog...",
    });
    try {
      const result =
        await databaseService.getExternalDatabaseDriverCatalog(catalogUrl);
      const release = signedCatalogReleaseForDriver(
        result.catalog.packages,
        selectedConnection.driver,
      );
      if (!release) {
        throw new Error(
          `The signed catalog has no downloadable ${selectedDriverLabel} package.`,
        );
      }
      await updateSettings({
        drivers: {
          catalogUrl: result.sourceUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl,
        },
      });
      setCatalogRelease(release);
      setStatus({
        type: "loading",
        message: "Downloading and verifying signed driver package...",
      });
      await databaseService.installExternalDatabaseDriverFromCatalog(
        result.sourceUrl,
        release.driverId,
        release.packageVersion,
        true,
      );
      await refreshDriverStatus();
      setIsCatalogInstallSetupOpen(false);
      setStatus({
        type: "success",
        message: `${selectedDriverLabel} is installed and ready to use.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not install the driver package.",
      });
    } finally {
      setIsInstallingDriver(false);
    }
  };

  const selectDriverPackage = (value: string) => {
    const packageVersion =
      value === ACTIVE_DRIVER_PACKAGE_VALUE ? undefined : value;
    const nextPackage = availableDriverPackages.find((installation) =>
      packageVersion
        ? installation.packageVersion === packageVersion
        : installation.active,
    );
    const nextTemplate = nextPackage?.connectionUrlTemplate;
    updateConnectionConfig({
      driverPackageVersion: packageVersion,
      // Persist a template-generated value at the moment a version is picked.
      // That makes a connection pin independent from a later active-package
      // change which may use a different JDBC grammar.
      ...(nextTemplate && !selectedConnection.connectionUrl?.trim()
        ? {
            connectionUrl: buildConnectionUrl({
              driver: selectedConnection.driver,
              host: selectedConnection.host,
              port: selectedConnection.port,
              user: selectedConnection.user,
              password: selectedConnection.password,
              database: supportsConnectionDatabase
                ? selectedConnection.database
                : "",
              sslMode: selectedConnection.sslMode || "disable",
              connectionUrlTemplate: nextTemplate,
            }),
          }
        : {}),
    });
    setStatus(null);
  };

  return {
    refreshDriverStatus,
    installSelectedDriver,
    installSelectedDriverFromCatalogUrl,
    selectDriverPackage,
  };
}
