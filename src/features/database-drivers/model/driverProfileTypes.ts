import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

export type DatabaseDriverCapabilities = Omit<DatabaseCapabilities, "driver">;

export type DatabaseDriverProfile = {
  driver: DatabaseDriver;
  menuLabel: string;
  defaultDatabase: string;
  urlScheme: string;
  /** Present only when an active signed package owns a non-generic URL grammar. */
  connectionUrlTemplate?: string | null;
  protocolAliases: string[];
  sslModeParamName: string;
  sslModeParamAliases: string[];
  defaultIcon: string;
  iconClassName: string;
  defaultAccentClassName: string;
  capabilities: DatabaseDriverCapabilities;
};
