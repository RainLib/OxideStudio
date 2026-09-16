import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { cn } from "@/lib/utils";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import { RotateCcw } from "lucide-react";

interface ConnectionUrlFieldProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  showConnectionUrl: boolean;
  displayedUrl: string;
  updateConnectionUrl: (value: string) => void;
  connectionUrlTemplate: string | null;
  isFileBased: boolean;
  isRemoteSqlite: boolean;
  capabilities: DatabaseCapabilities;
}

/** Editable connection URL and database-specific transport guidance. */
export function ConnectionUrlField({
  selectedConnection,
  updateField,
  showConnectionUrl,
  displayedUrl,
  updateConnectionUrl,
  connectionUrlTemplate,
  isFileBased,
  isRemoteSqlite,
  capabilities,
}: ConnectionUrlFieldProps) {
  if (!showConnectionUrl) return null;

  return (
    <>
      <label className={labelClass} htmlFor="connection-url">
        URL
      </label>
      <div className="relative">
        <input
          id="connection-url"
          value={displayedUrl}
          onChange={(event) => updateConnectionUrl(event.target.value)}
          className={cn(fieldClass, "pr-8 font-mono text-[11px]")}
        />
        {selectedConnection.connectionUrl && (
          <button
            type="button"
            className="wb-icon-button absolute right-0.5 top-0.5"
            onClick={() => updateField("connectionUrl", "")}
            title="Rebuild URL from fields"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {selectedConnection.driver === "elasticsearch" && (
        <p className="col-start-2 text-[10px] wb-muted">
          Elasticsearch 6.x, 7.x, and 8.x are detected automatically. Choose an
          SSL mode to use HTTPS.
        </p>
      )}
      {connectionUrlTemplate && (
        <p className="col-start-2 text-[10px] wb-muted">
          This signed driver package supplies the URL grammar. You can edit the
          generated value; it is sent to the package unchanged.
        </p>
      )}
      {isFileBased && (
        <p className="col-start-2 text-[10px] wb-muted">
          {isRemoteSqlite
            ? "Use a local SQLite path by default, or open the Remote tab for a file hosted on Linux over SSH."
            : `Use a local ${capabilities.displayName} file path or :memory:. SSH and SSL are not used for local files.`}
        </p>
      )}
    </>
  );
}
