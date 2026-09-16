import { normalizeSignedCatalogUrl } from "@/features/connections/model/connectionFormPolicy";
import type {
  ConnectionSshDraft,
  ConnectionStatus,
  RemoteSqliteDraft,
} from "@/features/connections/model/connectionFormTypes";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import { connectionService } from "@/services/tauri";
import type { RemoteSqliteSshConfig } from "@/services/tauri/types/connections";

interface ConnectionSshActionsContext {
  sshTunnel: ConnectionSshDraft;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setIsPreparingSqliteWorker: React.Dispatch<React.SetStateAction<boolean>>;
  sqliteWorkerBaseUrlInput: string;
  sqliteWorkerBaseUrl: string;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  driverCatalogUrl: string;
  driverStorePath: string;
  remoteSqlite: RemoteSqliteDraft;
  updateRemoteSqlite: (updates: Partial<RemoteSqliteSshConfig>) => void;
  setSqliteWorkerBaseUrlInput: React.Dispatch<React.SetStateAction<string>>;
}

export function createConnectionSshActions({
  sshTunnel,
  setStatus,
  setIsPreparingSqliteWorker,
  sqliteWorkerBaseUrlInput,
  sqliteWorkerBaseUrl,
  updateSettings,
  driverCatalogUrl,
  driverStorePath,
  remoteSqlite,
  updateRemoteSqlite,
  setSqliteWorkerBaseUrlInput,
}: ConnectionSshActionsContext) {
  const handlePrepareSqliteWorker = async () => {
    if (!sshTunnel.enabled || !sshTunnel.remoteSqlite) {
      setStatus({
        type: "error",
        message:
          "Enable the remote SQLite connection before preparing its worker.",
      });
      return;
    }
    setIsPreparingSqliteWorker(true);
    setStatus({
      type: "loading",
      message: "Checking the SSH host and signed SQLite worker…",
    });
    try {
      const rawSource = sqliteWorkerBaseUrlInput.trim();
      const normalizedSource = rawSource
        ? normalizeSignedCatalogUrl(rawSource)
        : "";
      if (rawSource && !normalizedSource) {
        throw new Error(
          "Worker source must be a credential-free HTTPS URL without query parameters or fragments.",
        );
      }
      if (normalizedSource !== sqliteWorkerBaseUrl) {
        await updateSettings({
          drivers: {
            catalogUrl: driverCatalogUrl,
            storePath: driverStorePath,
            sqliteWorkerBaseUrl: normalizedSource || "",
          },
        });
      }
      const result = await connectionService.prepareRemoteSqliteWorker(
        sshTunnel,
        normalizedSource || "",
      );
      if (
        remoteSqlite.placement !== "preplaced" &&
        remoteSqlite.allowWorkerUpload &&
        result.digest
      ) {
        updateRemoteSqlite({ approvedWorkerDigest: result.digest });
      }
      setStatus({
        type: "success",
        message:
          remoteSqlite.placement !== "preplaced" &&
          remoteSqlite.allowWorkerUpload
            ? `SQLite worker ${result.version} is ready for ${result.platform} and approved for this SSH target.`
            : `SQLite worker ${result.version} is ready for ${result.platform}.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsPreparingSqliteWorker(false);
    }
  };

  const handleTestSshTunnel = async () => {
    if (!sshTunnel.enabled) {
      setStatus({
        type: "error",
        message: "Enable the SSH tunnel before testing it.",
        scope: "ssh",
      });
      return;
    }
    setStatus({
      type: "loading",
      message: "Authenticating SSH tunnel…",
      scope: "ssh",
    });
    try {
      const message = await connectionService.testSshTunnel(sshTunnel);
      setStatus({ type: "success", message, scope: "ssh" });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        scope: "ssh",
      });
    }
  };

  const saveSqliteWorkerBaseUrl = async () => {
    const raw = sqliteWorkerBaseUrlInput.trim();
    const normalized = raw ? normalizeSignedCatalogUrl(raw) : "";
    if (raw && !normalized) {
      setStatus({
        type: "error",
        message:
          "Worker source must be a credential-free HTTPS URL without query parameters or fragments.",
      });
      return;
    }
    try {
      await updateSettings({
        drivers: {
          catalogUrl: driverCatalogUrl,
          storePath: driverStorePath,
          sqliteWorkerBaseUrl: normalized || "",
        },
      });
      setSqliteWorkerBaseUrlInput(normalized || "");
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    handlePrepareSqliteWorker,
    handleTestSshTunnel,
    saveSqliteWorkerBaseUrl,
  };
}
