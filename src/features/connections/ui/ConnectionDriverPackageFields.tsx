import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVE_DRIVER_PACKAGE_VALUE } from "@/features/connections/model/connectionFormPolicy";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";
import type { DatabaseDriverInstallation } from "@/services/tauri/types/database";

interface ConnectionDriverPackageFieldsProps {
  selectedConnection: ConnectionConfig;
  availableDriverPackages: DatabaseDriverInstallation[];
  selectDriverPackage: (value: string) => void;
  unavailableDriverPackages: DatabaseDriverInstallation[];
}

/** Driver package pinning and unavailable-runtime guidance. */
export function ConnectionDriverPackageFields({
  selectedConnection,
  availableDriverPackages,
  selectDriverPackage,
  unavailableDriverPackages,
}: ConnectionDriverPackageFieldsProps) {
  return (
    <>
      {availableDriverPackages.length > 0 && (
        <>
          <label className={labelClass} htmlFor="connection-driver-package">
            Driver package
          </label>
          <Select
            value={
              selectedConnection.driverPackageVersion || ACTIVE_DRIVER_PACKAGE_VALUE
            }
            onValueChange={selectDriverPackage}
          >
            <SelectTrigger id="connection-driver-package" className={fieldClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
              <SelectItem value={ACTIVE_DRIVER_PACKAGE_VALUE}>
                Active package (recommended)
              </SelectItem>
              {availableDriverPackages.map((installation) => (
                <SelectItem
                  key={installation.packageVersion}
                  value={installation.packageVersion || "active"}
                >
                  Pin {installation.packageVersion}
                  {installation.active ? " · active" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      {unavailableDriverPackages.length > 0 && (
        <p
          className="col-start-2 text-[10px] text-[hsl(var(--wb-warning))]"
          role="status"
        >
          {unavailableDriverPackages.length === 1
            ? "An installed JDBC driver package needs a signed Java runtime before it can be selected."
            : "Some installed JDBC driver packages need a signed Java runtime before they can be selected."}
        </p>
      )}
    </>
  );
}
