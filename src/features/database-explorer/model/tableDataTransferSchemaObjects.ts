export type TransferSchemaRestoreFamily = "postgres" | "mysql";

export function transferSchemaRestoreFamily(
  driver: string | undefined,
): TransferSchemaRestoreFamily | null {
  const normalized = driver?.trim().toLocaleLowerCase() || "";
  if (new Set(["postgres", "postgresql", "pgsql"]).has(normalized)) {
    return "postgres";
  }
  if (new Set(["mysql", "mariadb"]).has(normalized)) return "mysql";
  return null;
}

export function canRestoreTransferSchemaObjects(input: {
  sourceDriver: string | undefined;
  targetDriver: string | undefined;
  sourceIsExternal: boolean;
  targetIsExternal: boolean;
  sourceTable: string;
  targetTable: string;
  isBatchTransfer: boolean;
}) {
  const sourceFamily = transferSchemaRestoreFamily(input.sourceDriver);
  const targetFamily = transferSchemaRestoreFamily(input.targetDriver);
  return Boolean(
    sourceFamily &&
      targetFamily &&
      !input.sourceIsExternal &&
      !input.targetIsExternal &&
      (input.isBatchTransfer || input.sourceTable === input.targetTable),
  );
}

export function transferSchemaRestoreDescription(
  sourceDriver: string | undefined,
  targetDriver: string | undefined,
) {
  const sourceFamily = transferSchemaRestoreFamily(sourceDriver);
  const targetFamily = transferSchemaRestoreFamily(targetDriver);
  if (!sourceFamily || !targetFamily) return "Unsupported schema-object mapping.";
  if (sourceFamily === targetFamily) {
    return "Same-product catalog definitions are retained and reviewed before execution.";
  }
  return "Cross-product restoration is limited to structured BTREE indexes, UNIQUE constraints, and foreign keys. Dialect expressions remain blocked.";
}
