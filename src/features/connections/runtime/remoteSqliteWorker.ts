import { type ConnectionConfig } from "@/features/connections/model/types";
import { connectionService } from "@/services/tauri";
import { useSettingsStore } from "@/store/useSettingsStore";
export function usesRemoteSqliteWorker(config: ConnectionConfig) {
  return (
    config.driver.trim().toLowerCase() === "sqlite" &&
    config.sshTunnel?.enabled === true &&
    Boolean(config.sshTunnel.remoteSqlite)
  );
}

export async function prepareRemoteSqliteWorker(config: ConnectionConfig) {
  if (!usesRemoteSqliteWorker(config) || !config.sshTunnel) return;
  const downloadBaseUrl =
    useSettingsStore.getState().settings.drivers.sqliteWorkerBaseUrl;
  const key = [
    config.sshTunnel.username.trim(),
    config.sshTunnel.host.trim().toLowerCase(),
    config.sshTunnel.port,
    ...(config.sshTunnel.jumpHosts || []).map((hop) =>
      [
        hop.username.trim(),
        hop.host.trim().toLowerCase(),
        hop.port,
        hop.authMethod,
      ].join("@"),
    ),
    downloadBaseUrl,
  ].join("|");
  const cached = remoteSqlitePreparationCache.get(key);
  if (cached && cached > Date.now()) return;
  const pending = remoteSqlitePreparationFlights.get(key);
  if (pending) return pending;
  const preparation = connectionService
    .prepareRemoteSqliteWorker(config.sshTunnel, downloadBaseUrl)
    .then(() => {
      // The desktop process pins one worker package version. A short cache
      // avoids a second SSH platform probe when Test is immediately followed
      // by Connect, while still revalidating a changed host during long runs.
      remoteSqlitePreparationCache.set(key, Date.now() + 5 * 60_000);
    })
    .finally(() => {
      remoteSqlitePreparationFlights.delete(key);
    });
  remoteSqlitePreparationFlights.set(key, preparation);
  return preparation;
}

export const remoteSqlitePreparationCache = new Map<string, number>();

export const remoteSqlitePreparationFlights = new Map<string, Promise<void>>();
