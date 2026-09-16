import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { defaultDatabasePort } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";

interface ConnectionHostFieldProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  isFileBased: boolean;
  fileExtension: "sqlite" | "duckdb" | "db";
  capabilities: DatabaseCapabilities;
  fileDriver: string;
}

/** Host, port, and local database-file selection for a connection. */
export function ConnectionHostField({
  selectedConnection,
  updateField,
  isFileBased,
  fileExtension,
  capabilities,
  fileDriver,
}: ConnectionHostFieldProps) {
  return (
    <>
      <label className={labelClass} htmlFor="connection-host">
        {isFileBased ? "File" : "Host"}
      </label>
      <div
        className={cn(
          !isFileBased && "grid grid-cols-[minmax(0,1fr)_116px] gap-2",
        )}
      >
        <input
          id="connection-host"
          value={
            isFileBased
              ? selectedConnection.database || ""
              : selectedConnection.host || ""
          }
          onChange={(event) =>
            updateField(
              isFileBased ? "database" : "host",
              event.target.value,
              true,
            )
          }
          className={fieldClass}
          placeholder={
            isFileBased
              ? `:memory: or /path/to/database.${fileExtension}`
              : "localhost"
          }
        />
        {isFileBased && (
          <button
            type="button"
            className="wb-text-button mt-1 h-6 px-1 text-[11px]"
            onClick={async () => {
              const { open } = await import("@tauri-apps/plugin-dialog");
              const file = await open({
                multiple: false,
                directory: false,
                filters: [
                  {
                    name: `${capabilities.displayName} databases`,
                    extensions:
                      fileDriver === "duckdb"
                        ? ["duckdb", "ddb", "db"]
                        : fileDriver === "sqlite"
                          ? ["db", "sqlite", "sqlite3", "db3"]
                          : ["db"],
                  },
                ],
              });
              if (typeof file === "string") {
                updateField("database", file, true);
              }
            }}
          >
            Choose database file…
          </button>
        )}
        {!isFileBased && (
          <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2">
            <span className="text-right text-[11px] wb-muted">Port</span>
            <input
              type="number"
              value={selectedConnection.port || ""}
              onChange={(event) =>
                updateField(
                  "port",
                  event.target.value ? Number(event.target.value) : undefined,
                  true,
                )
              }
              className={fieldClass}
              placeholder={String(
                defaultDatabasePort(selectedConnection.driver) || "",
              )}
              aria-label="Port"
            />
          </div>
        )}
      </div>
    </>
  );
}
