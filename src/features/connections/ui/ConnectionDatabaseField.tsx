import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import { defaultDatabaseName } from "@/lib/databaseDialect";

interface ConnectionDatabaseFieldProps {
  selectedConnection: ConnectionConfig;
  updateField: UpdateConnectionField;
  isFileBased: boolean;
  supportsConnectionDatabase: boolean;
}

/** Optional logical database name for network drivers that support one. */
export function ConnectionDatabaseField({
  selectedConnection,
  updateField,
  isFileBased,
  supportsConnectionDatabase,
}: ConnectionDatabaseFieldProps) {
  if (isFileBased || !supportsConnectionDatabase) return null;

  return (
    <>
      <label className={labelClass} htmlFor="connection-database">
        Database
      </label>
      <input
        id="connection-database"
        value={selectedConnection.database || ""}
        onChange={(event) => updateField("database", event.target.value, true)}
        className={fieldClass}
        placeholder={
          defaultDatabaseName(selectedConnection.driver) || "database"
        }
      />
    </>
  );
}
