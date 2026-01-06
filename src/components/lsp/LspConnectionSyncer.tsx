import { useEffect, useState } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useLspClient } from "@/hooks/useLspClient";
import { lspClient } from "@/services/lsp";

export function LspConnectionSyncer() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { isReady } = useLspClient();
  const [lastSyncedConnection, setLastSyncedConnection] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!isReady || !activeConnectionId) return;

    // Avoid redundant syncs for the same connection
    if (lastSyncedConnection === activeConnectionId) {
      console.log("[LSP Syncer] ℹ️  Connection already synced, skipping");
      return;
    }

    const connection = connections.find((c) => c.id === activeConnectionId);
    if (!connection) return;

    // Construct Data Source Name (DSN)
    let driver = "postgresql";
    let dsn = "";

    if (connection.driver === "mysql") {
      driver = "mysql";
      // MySQL DSN: user:password@tcp(host:port)/dbname
      const host = connection.host || "localhost";
      const port = connection.port || 3306;
      dsn = `${connection.user}:${connection.password}@tcp(${host}:${port})/${connection.database}`;
    } else {
      // Postgres DSN: postgres://user:password@host:port/dbname
      const host = connection.host || "localhost";
      const port = connection.port || 5432;
      dsn = `postgresql://${connection.user}:${connection.password}@${host}:${port})/${connection.database}`;

      // Disable SSL for now if not configured (common dev issue)
      if (!dsn.includes("sslmode")) {
        dsn += "?sslmode=disable";
      }
    }

    const config = {
      connections: [
        {
          driver,
          dataSourceName: dsn,
          alias: connection.name,
        },
      ],
    };

    console.log("[LSP Syncer] 🔄 Syncing connection config:", connection.name);
    lspClient
      .updateConfiguration(config)
      .then(() => {
        console.log("[LSP Syncer] ✓ Configuration synced successfully");
        setLastSyncedConnection(activeConnectionId);

        // Wait for LSP to load schema (give it sufficient time)
        return new Promise((resolve) => setTimeout(resolve, 1000));
      })
      .then(() => {
        console.log("[LSP Syncer] ✓ Ready for document operations");
      })
      .catch((err) => {
        console.error("[LSP Syncer] ❌ Failed to sync connection:", err);
      });
  }, [activeConnectionId, connections, isReady, lastSyncedConnection]);

  return null;
}
