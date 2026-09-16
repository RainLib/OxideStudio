import {
  NATIVE_FILE_BASED_DATABASE_DRIVERS,
  capabilitiesKey,
} from "@/features/database-drivers/model/driverIdentity";
import { type DatabaseDriverProfile } from "@/features/database-drivers/model/driverProfileTypes";
import type { DatabaseDriver } from "@/services/tauri/types";

function formatDriverDisplayName(driver: DatabaseDriver) {
  return (
    String(driver)
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Database"
  );
}

export function fallbackDatabaseDriverProfile(
  driver: DatabaseDriver,
): DatabaseDriverProfile {
  const displayName = formatDriverDisplayName(driver);
  return {
    driver,
    menuLabel: displayName,
    defaultDatabase: "",
    urlScheme: String(driver),
    protocolAliases: [String(driver)],
    sslModeParamName: "sslmode",
    sslModeParamAliases: ["sslmode", "ssl"],
    defaultIcon: "Database",
    iconClassName: "text-muted-foreground",
    defaultAccentClassName:
      "bg-muted text-muted-foreground group-hover:bg-muted/80",
    capabilities: {
      displayName,
      dataModel: "relational",
      connectionMode: NATIVE_FILE_BASED_DATABASE_DRIVERS.has(
        capabilitiesKey(driver),
      )
        ? "file"
        : "network",
      lspLanguageId: "sql",
      namespaceLabel: "schema",
      identifierQuote: '"',
      defaultPort: 0,
      // Unknown ids are not a usable driver contract. An active signed
      // package replaces this profile with its declared capabilities.
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsDatabaseCatalogs: false,
      supportsConnectionDatabase: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: false,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: false,
      supportsTableConstraints: false,
      supportsForeignKeys: false,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: false,
      supportsQueryCancellation: false,
      supportsExplainPlan: false,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "INTEGER",
      commonDataTypes: [
        "INTEGER",
        "BIGINT",
        "VARCHAR",
        "TEXT",
        "BOOLEAN",
        "DATE",
        "TIMESTAMP",
        "DECIMAL",
      ],
    },
  };
}
