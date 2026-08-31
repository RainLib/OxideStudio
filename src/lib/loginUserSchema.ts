import type { SavedConnection } from "@/services/tauri/types";

const USER_SCHEMA_DRIVERS = new Set(["oracle", "dameng", "oceanbase-oracle"]);

/**
 * Oracle-family schemas are database users. Highlight only that explicit
 * family so a PostgreSQL/MySQL schema that happens to equal the login name is
 * never presented as the current account by coincidence.
 */
export function isLoginUserSchema(
  connection: Pick<SavedConnection, "driver" | "user">,
  schemaName: string,
) {
  if (!USER_SCHEMA_DRIVERS.has(connection.driver.trim().toLocaleLowerCase())) {
    return false;
  }
  const user = connection.user?.trim();
  const schema = schemaName.trim();
  return Boolean(
    user &&
      schema &&
      user.localeCompare(schema, undefined, { sensitivity: "accent" }) === 0,
  );
}
