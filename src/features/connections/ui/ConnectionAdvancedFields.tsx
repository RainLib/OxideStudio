import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UpdateConnectionField } from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  fieldClass,
  labelClass,
} from "@/features/connections/ui/connectionFormStyles";
import type { DataSourceDriverChoice } from "@/features/database-drivers/model/dataSourceDriverChoices";
import type { DatabaseDriver } from "@/services/tauri/types/database";

interface ConnectionAdvancedFieldsProps {
  selectedConnection: ConnectionConfig;
  changeDriver: (driver: DatabaseDriver) => void;
  driverChoices: DataSourceDriverChoice[];
  updateField: UpdateConnectionField;
}

export function ConnectionAdvancedFields({
  selectedConnection,
  changeDriver,
  driverChoices,
  updateField,
}: ConnectionAdvancedFieldsProps) {
  return (
    <div className="mx-auto grid w-full max-w-[720px] grid-cols-[132px_minmax(0,1fr)] gap-y-3 px-6 py-5">
      <span className={labelClass}>Driver</span>
      <Select
        value={selectedConnection.driver}
        onValueChange={(value) => changeDriver(value as DatabaseDriver)}
      >
        <SelectTrigger className={fieldClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          {driverChoices.map((choice) => (
            <SelectItem key={choice.driver} value={choice.driver}>
              {choice.label}
              {choice.availability === "activationRequired"
                ? " · activate driver"
                : choice.availability === "installationRequired"
                  ? " · install driver"
                  : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className={labelClass} htmlFor="connection-environment">
        Environment
      </label>
      <div>
        <select
          id="connection-environment"
          value={selectedConnection.environment || "unclassified"}
          onChange={(event) =>
            updateField(
              "environment",
              event.target.value as NonNullable<
                ConnectionConfig["environment"]
              >,
            )
          }
          className={fieldClass}
        >
          <option value="unclassified">Unclassified — AI writes blocked</option>
          <option value="development">Development</option>
          <option value="staging">Staging</option>
          <option value="production">Production — AI writes blocked</option>
        </select>
        <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Agent writes require an explicit non-production classification and a
          separate approval for every operation.
        </p>
      </div>

      <label className={labelClass} htmlFor="connection-production-databases">
        Protected DBs
      </label>
      <div>
        <input
          id="connection-production-databases"
          value={(selectedConnection.productionDatabases || []).join(", ")}
          onChange={(event) =>
            updateField(
              "productionDatabases",
              event.target.value
                .split(",")
                .map((database) => database.trim())
                .filter(Boolean),
            )
          }
          className={fieldClass}
          placeholder="production, customer_data"
        />
        <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          These database names stay read-only even on development or staging
          connections.
        </p>
      </div>

      <label className={labelClass} htmlFor="connection-tags">
        Tags
      </label>
      <input
        id="connection-tags"
        value={(selectedConnection.tags || []).join(", ")}
        onChange={(event) =>
          updateField(
            "tags",
            event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          )
        }
        className={fieldClass}
        placeholder="development, local"
      />
    </div>
  );
}
