import type {
  ConnectionStatus,
  UpdateConnectionField,
} from "@/features/connections/model/connectionFormTypes";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { ConnectionAppearancePicker } from "@/features/connections/ui/ConnectionAppearancePicker";
import { ConnectionDatabaseField } from "@/features/connections/ui/ConnectionDatabaseField";
import { ConnectionDriverPackageFields } from "@/features/connections/ui/ConnectionDriverPackageFields";
import { ConnectionElasticsearchFields } from "@/features/connections/ui/ConnectionElasticsearchFields";
import { ConnectionAuthenticationFields } from "@/features/connections/ui/ConnectionAuthenticationFields";
import { ConnectionHostField } from "@/features/connections/ui/ConnectionHostField";
import { ConnectionNotesField } from "@/features/connections/ui/ConnectionNotesField";
import { ConnectionRocketMqFields } from "@/features/connections/ui/ConnectionRocketMqFields";
import { ConnectionUrlField } from "@/features/connections/ui/ConnectionUrlField";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import type { DatabaseDriverProfile } from "@/lib/databaseDialect";
import type {
  DatabaseCapabilities,
  DatabaseDriverInstallation,
} from "@/services/tauri/types/database";

interface ConnectionGeneralFieldsProps {
  selectedConnection: ConnectionConfig;
  profile: DatabaseDriverProfile;
  updateField: UpdateConnectionField;
  isFileBased: boolean;
  fileExtension: "sqlite" | "duckdb" | "db";
  capabilities: DatabaseCapabilities;
  fileDriver: string;
  isInfluxDb3: boolean;
  isInfluxDb2: boolean;
  mongoOidcEnabled: boolean;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  isMongoDb: boolean;
  setMongoOidcEnabled: (enabled: boolean) => void;
  isInfluxDb: boolean;
  influxDbVersion: "1" | "2";
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  isVictoriaMetrics: boolean;
  supportsConnectionDatabase: boolean;
  availableDriverPackages: DatabaseDriverInstallation[];
  selectDriverPackage: (value: string) => void;
  unavailableDriverPackages: DatabaseDriverInstallation[];
  showConnectionUrl: boolean;
  displayedUrl: string;
  updateConnectionUrl: (value: string) => void;
  connectionUrlTemplate: string | null;
  isRemoteSqlite: boolean;
  isRocketMq: boolean;
  updateRocketMq: (
    updates: Partial<NonNullable<ConnectionConfig["rocketMq"]>>,
  ) => void;
  showConnectionNotes: boolean;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

export function ConnectionGeneralFields({
  selectedConnection,
  profile,
  updateField,
  isFileBased,
  fileExtension,
  capabilities,
  fileDriver,
  isInfluxDb3,
  isInfluxDb2,
  mongoOidcEnabled,
  showPassword,
  setShowPassword,
  isMongoDb,
  setMongoOidcEnabled,
  isInfluxDb,
  influxDbVersion,
  updateConnectionConfig,
  setStatus,
  isVictoriaMetrics,
  supportsConnectionDatabase,
  availableDriverPackages,
  selectDriverPackage,
  unavailableDriverPackages,
  showConnectionUrl,
  displayedUrl,
  updateConnectionUrl,
  connectionUrlTemplate,
  isRemoteSqlite,
  isRocketMq,
  updateRocketMq,
  showConnectionNotes,
  updateSettings,
}: ConnectionGeneralFieldsProps) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-4">
      <div className="mb-3 flex h-7 items-center justify-end">
        <ConnectionAppearancePicker
          connection={selectedConnection}
          defaultIcon={profile.defaultIcon}
          onUpdate={updateField}
        />
      </div>
      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-y-2">
        <ConnectionHostField
          selectedConnection={selectedConnection}
          updateField={updateField}
          isFileBased={isFileBased}
          fileExtension={fileExtension}
          capabilities={capabilities}
          fileDriver={fileDriver}
        />
        <ConnectionAuthenticationFields
          selectedConnection={selectedConnection}
          updateField={updateField}
          isFileBased={isFileBased}
          isInfluxDb3={isInfluxDb3}
          isInfluxDb2={isInfluxDb2}
          mongoOidcEnabled={mongoOidcEnabled}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          isMongoDb={isMongoDb}
          setMongoOidcEnabled={setMongoOidcEnabled}
          isInfluxDb={isInfluxDb}
          influxDbVersion={influxDbVersion}
          updateConnectionConfig={updateConnectionConfig}
          setStatus={setStatus}
          isVictoriaMetrics={isVictoriaMetrics}
        />

        <ConnectionDatabaseField
          selectedConnection={selectedConnection}
          updateField={updateField}
          isFileBased={isFileBased}
          supportsConnectionDatabase={supportsConnectionDatabase}
        />

        <ConnectionElasticsearchFields
          selectedConnection={selectedConnection}
          updateField={updateField}
        />

        <ConnectionDriverPackageFields
          selectedConnection={selectedConnection}
          availableDriverPackages={availableDriverPackages}
          selectDriverPackage={selectDriverPackage}
          unavailableDriverPackages={unavailableDriverPackages}
        />

        <ConnectionUrlField
          selectedConnection={selectedConnection}
          updateField={updateField}
          showConnectionUrl={showConnectionUrl}
          displayedUrl={displayedUrl}
          updateConnectionUrl={updateConnectionUrl}
          connectionUrlTemplate={connectionUrlTemplate}
          isFileBased={isFileBased}
          isRemoteSqlite={isRemoteSqlite}
          capabilities={capabilities}
        />

        <ConnectionRocketMqFields
          selectedConnection={selectedConnection}
          isRocketMq={isRocketMq}
          updateRocketMq={updateRocketMq}
        />

        <ConnectionNotesField
          selectedConnection={selectedConnection}
          updateField={updateField}
          showConnectionNotes={showConnectionNotes}
          updateSettings={updateSettings}
        />

      </div>
    </div>
  );
}
