import type {
  DatabaseCapabilities,
  FunctionInfo,
  SchemaObjectInfo,
  TableDataTransferEndpoint,
  TableDataTransferObjectKind,
  TableDataTransferObjectSelection,
  TableDataTransferPreview,
  TableInfo,
} from "@/services/tauri/types";

export function displayEndpoint(endpoint: TableDataTransferEndpoint) {
  return [endpoint.database, endpoint.schema, endpoint.table]
    .filter((value) => value?.trim())
    .join(".");
}

export function createTableDataTransferId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `transfer-${randomId}`
    : `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function transferCompatibilityClass(
  compatibility: TableDataTransferPreview["mappedColumns"][number]["compatibility"],
) {
  switch (compatibility) {
    case "exact":
      return "text-[hsl(var(--wb-success))]";
    case "safe":
      return "text-[hsl(var(--wb-accent))]";
    case "review":
      return "text-[hsl(var(--wb-warning))]";
    case "unsupported":
      return "text-[hsl(var(--destructive))]";
  }
}

/**
 * Keep the chooser aligned with the Rust `table_data_dialect` boundary. A
 * connection being present in Explorer, or even supporting ordinary row
 * editing, does not prove that cross-connection paging, type mapping and
 * parameterized batch writes have been verified for it.
 */
export function supportsBoundedTableDataTransfer(
  driver: string,
  capabilities?: DatabaseCapabilities | null,
) {
  // When capabilities are available they describe the exact live connection.
  // An external package may use a familiar driver id (for example postgres)
  // while deliberately withholding the reviewed transfer contract, so a
  // bundled-name fallback must never override an explicit false value.
  if (capabilities) return capabilities.supportsTableDataTransfer === true;
  return new Set([
    "postgres",
    "postgresql",
    "pgsql",
    "mysql",
    "mariadb",
    "sqlite",
    "sqlite3",
    "duckdb",
  ]).has(driver.trim().toLocaleLowerCase());
}

export function canExecuteTableDataTransfer(
  preview: TableDataTransferPreview | null,
  confirmation: string,
  isSubmitting: boolean,
) {
  return Boolean(
    preview?.canExecute === true &&
      confirmation.trim() === preview.confirmationToken &&
      !isSubmitting,
  );
}

export function supportsTableDataTransferUpsert(
  distribution: "bundled" | "external" | "managed" | null,
) {
  return distribution === "bundled";
}

export function supportsPostgresIdentityReseed(driver: string | undefined) {
  return new Set(["postgres", "postgresql", "pgsql"]).has(
    driver?.trim().toLocaleLowerCase() || "",
  );
}

export const transferObjectKindOrder: TableDataTransferObjectKind[] = [
  "SEQUENCE",
  "VIEW",
  "MATERIALIZED_VIEW",
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "EVENT",
];

export function transferObjectKey(object: TableDataTransferObjectSelection) {
  return `${object.objectType}:${object.parentName || ""}:${object.name}`;
}

export function buildTransferObjectInventory(
  relations: TableInfo[],
  routines: FunctionInfo[],
  descriptors: SchemaObjectInfo[],
): TableDataTransferObjectSelection[] {
  const inventory: TableDataTransferObjectSelection[] = [];
  for (const relation of relations) {
    const objectType = relation.type?.trim().toLocaleUpperCase() || "";
    if (objectType.includes("MATERIALIZED") && objectType.includes("VIEW")) {
      inventory.push({ objectType: "MATERIALIZED_VIEW", name: relation.name });
    } else if (objectType.includes("VIEW")) {
      inventory.push({ objectType: "VIEW", name: relation.name });
    }
  }
  for (const routine of routines) {
    inventory.push({
      objectType:
        routine.routine_type?.toLocaleLowerCase() === "procedure"
          ? "PROCEDURE"
          : "FUNCTION",
      name: routine.name,
    });
  }
  const descriptorKinds = new Map<string, TableDataTransferObjectKind>([
    ["TRIGGER", "TRIGGER"],
    ["SEQUENCE", "SEQUENCE"],
    ["EVENT", "EVENT"],
  ]);
  for (const descriptor of descriptors) {
    const objectType = descriptorKinds.get(
      descriptor.objectType.trim().toLocaleUpperCase().replace(/ /g, "_"),
    );
    if (!objectType) continue;
    inventory.push({
      objectType,
      name: descriptor.name,
      parentName: descriptor.parentName || undefined,
    });
  }
  const unique = new Map(
    inventory.map((object) => [transferObjectKey(object), object]),
  );
  return [...unique.values()].sort((left, right) => {
    const kindOrder =
      transferObjectKindOrder.indexOf(left.objectType) -
      transferObjectKindOrder.indexOf(right.objectType);
    if (kindOrder !== 0) return kindOrder;
    return `${left.parentName || ""}:${left.name}`.localeCompare(
      `${right.parentName || ""}:${right.name}`,
    );
  });
}
