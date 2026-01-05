import { useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useLspClient } from "@/hooks/useLspClient";
import { lspClient } from "@/services/lsp";

export function LspConnectionSyncer() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { isReady } = useLspClient();

  useEffect(() => {
    if (!isReady || !activeConnectionId) return;

    const connection = connections.find((c) => c.id === activeConnectionId);
    if (!connection) return;

    // Construct Data Source Name (DSN)
    // format: user:pass@tcp(host:port)/db_name
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
      // TODO: Handle SSL and other params if needed
      const host = connection.host || "localhost";
      const port = connection.port || 5432;
      dsn = `postgresql://${connection.user}:${connection.password}@${host}:${port}/${connection.database}`;

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

    console.log("[LSP] Syncing connection:", connection.name);
    lspClient.updateConfiguration(config).catch((err) => {
      console.error("[LSP] Failed to sync connection:", err);
    });
  }, [activeConnectionId, connections, isReady]);

  return null;
}
