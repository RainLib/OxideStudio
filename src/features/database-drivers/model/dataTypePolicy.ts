import type { DatabaseCapabilities } from "@/services/tauri/types";

export function defaultStringDataType(
  capabilities: Pick<
    DatabaseCapabilities,
    "commonDataTypes" | "defaultPrimaryKeyType"
  >,
) {
  const preferred = ["VARCHAR", "TEXT", "STRING"];
  const type =
    preferred
      .map((candidate) =>
        capabilities.commonDataTypes.find(
          (value) => value.toUpperCase() === candidate,
        ),
      )
      .find(Boolean) ||
    capabilities.commonDataTypes[0] ||
    capabilities.defaultPrimaryKeyType ||
    "TEXT";
  return type;
}

export function defaultLengthForDataType(dataType: string) {
  const normalized = dataType.trim().toUpperCase();
  if (normalized === "VARCHAR" || normalized === "CHAR") return "255";
  if (normalized === "DECIMAL" || normalized === "NUMERIC") return "10,2";
  return "";
}

function normalizedDataTypeBase(dataType: string) {
  return dataType
    .trim()
    .toUpperCase()
    .split("(")[0]!
    .trim()
    .split(/\s+/)[0]!
    .trim();
}

export function supportsAutoIncrementForDataType(
  capabilities: Pick<
    DatabaseCapabilities,
    "autoIncrementKeyword" | "commonDataTypes" | "lspLanguageId"
  >,
  dataType: string,
) {
  const baseType = normalizedDataTypeBase(dataType);
  if (!baseType) return false;

  const integerTypes = new Set([
    "TINYINT",
    "SMALLINT",
    "MEDIUMINT",
    "INT",
    "INTEGER",
    "BIGINT",
  ]);

  if (capabilities.autoIncrementKeyword) {
    return integerTypes.has(baseType);
  }

  if (["SMALLSERIAL", "SERIAL", "BIGSERIAL"].includes(baseType)) {
    return true;
  }

  if ((capabilities.lspLanguageId || "").toLowerCase() === "postgres") {
    return (
      integerTypes.has(baseType) || ["INT2", "INT4", "INT8"].includes(baseType)
    );
  }

  return false;
}
