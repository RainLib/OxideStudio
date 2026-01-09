import { useEffect, useRef } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useLspClient } from "@/hooks/useLspClient";
import { lspClient } from "@/services/lsp";
import { schemaService } from "@/services/tauri";

export function LspConnectionSyncer() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { schemas, tables, currentSchema } = useSchemaStore();
  const { isReady } = useLspClient();

  // Track if we've already sent config for this connection+schema
  const lastConfigRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!isReady || !activeConnectionId) return;

    const connection = connections.find((c) => c.id === activeConnectionId);
    if (!connection) return;

    // Wait for schemas to be loaded
    if (!schemas || schemas.length === 0) {
      console.log("[LSP] Waiting for schemas to load...");
      return;
    }

    // Wait for tables to be loaded
    if (!tables || tables.length === 0) {
      console.log("[LSP] Waiting for tables to load...");
      return;
    }

    // Create a unique key for this configuration
    const configKey = `${activeConnectionId}:${currentSchema}:${tables.length}`;

    // Skip if we've already sent this exact configuration
    if (lastConfigRef.current === configKey) {
      console.log("[LSP] Skipping duplicate configuration send");
      return;
    }

    // Debounce: wait 500ms before sending
    debounceTimerRef.current = setTimeout(() => {
      console.log("[LSP] Building schema configuration for:", connection.name);
      console.log("[LSP] Current schema:", currentSchema);
      console.log("[LSP] Tables available:", tables.length);

      // Build full schema structure like Python script
      const schemaId = connection.id; // Use connection ID as schema ID

      // Build tables array with columns
      // tables is an ARRAY: TableInfo[]
      const buildTableDefinitions = async () => {
        const tablePromises = tables.map(async (table) => {
          try {
            // Fetch columns for each table
            const columns = await schemaService.getColumns(
              activeConnectionId,
              currentSchema || "",
              table.name
            );

            return {
              name: table.name,
              comment: table.comment || null,
              source_location: null,
              columns: columns.map((col: any) => ({
                name: col.name,
                data_type: col.type || "VARCHAR",
                nullable: col.nullable !== false,
                comment: col.comment || null,
                source_location: null,
              })),
            };
          } catch (error) {
            console.error(
              `[LSP] Failed to fetch columns for ${table.name}:`,
              error
            );
            // Return table without columns if fetch fails
            return {
              name: table.name,
              comment: table.comment || null,
              source_location: null,
              columns: [],
            };
          }
        });

        const lspTables = await Promise.all(tablePromises);

        console.log("[LSP] Built tables with columns:", lspTables.length);
        console.log(
          "[LSP] Table names:",
          lspTables.map((t) => t.name).join(", ")
        );

        // Build configuration matching Python script format
        const config = {
          schemas: [
            {
              id: schemaId,
              database: currentSchema || connection.database,
              source_uri: null,
              tables: lspTables,
              functions: [],
            },
          ],
          // Map document URIs to schema ID
          fileSchemas: {
            "inmemory://model/1": schemaId,
            "inmemory://model/2": schemaId,
            "inmemory://model/3": schemaId,
            "inmemory://model/4": schemaId,
            "inmemory://model/5": schemaId,
          },
        };

        console.log("[LSP] Sending schema configuration:");
        console.log("[LSP] - Schema ID:", schemaId);
        console.log("[LSP] - Database:", currentSchema || connection.database);
        console.log("[LSP] - Tables:", lspTables.map((t) => t.name).join(", "));

        try {
          await lspClient.updateConfiguration(config);
          // Mark this configuration as sent
          lastConfigRef.current = configKey;
          console.log("[LSP] ✅ Configuration sent and cached");
        } catch (err) {
          console.error("[LSP] Failed to sync schema:", err);
        }
      };

      buildTableDefinitions();
    }, 500); // 500ms debounce

    // Cleanup function
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    activeConnectionId,
    connections,
    isReady,
    schemas,
    tables,
    currentSchema,
  ]);

  return null;
}
