import { schemaService } from "@/services/tauri";

export async function activateBackendSchema(
  connectionId: string,
  schema: string | null,
) {
  if (!schema) return true;

  try {
    await schemaService.setCurrentSchema(connectionId, schema);
    return true;
  } catch (error) {
    console.warn("Store: Failed to activate backend schema", error);
    return false;
  }
}
