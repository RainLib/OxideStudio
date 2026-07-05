import type { AiToolFamily } from "@/ai/tools/families";
import { registerAiToolFamily } from "@/ai/tools/families";
import type { DatabaseDriverProfile } from "@/lib/databaseDialect";
import { registerDatabaseDriverProfile } from "@/lib/databaseDialect";
import type { DatabaseObjectPreviewProvider } from "@/lib/databaseObjectPreview";
import { registerDatabaseObjectPreviewProvider } from "@/lib/databaseObjectPreview";

export type DatabaseProvider = {
  id: string;
  displayName: string;
  priority?: number;
  driverProfiles?: DatabaseDriverProfile[];
  objectPreviewProviders?: DatabaseObjectPreviewProvider[];
  aiToolFamilies?: AiToolFamily[];
  activate?: () => void;
};

export type RegisteredDatabaseProvider = Omit<DatabaseProvider, "activate"> & {
  activated: boolean;
};

const registeredDatabaseProviders = new Map<string, RegisteredDatabaseProvider>();

export function registerDatabaseProvider(
  provider: DatabaseProvider | DatabaseProvider[]
) {
  const providers = Array.isArray(provider) ? provider : [provider];

  for (const value of providers) {
    registerSingleDatabaseProvider(value);
  }
}

export function listRegisteredDatabaseProviders() {
  return Array.from(registeredDatabaseProviders.values()).sort(
    compareRegisteredProviders
  );
}

function registerSingleDatabaseProvider(provider: DatabaseProvider) {
  const id = provider.id.trim();
  if (!id) {
    throw new Error("Database provider id is required");
  }

  for (const profile of provider.driverProfiles ?? []) {
    registerDatabaseDriverProfile(profile);
  }
  for (const previewProvider of provider.objectPreviewProviders ?? []) {
    registerDatabaseObjectPreviewProvider(previewProvider);
  }
  for (const family of provider.aiToolFamilies ?? []) {
    registerAiToolFamily(family);
  }

  provider.activate?.();
  registeredDatabaseProviders.set(id, {
    id,
    displayName: provider.displayName,
    priority: provider.priority,
    driverProfiles: provider.driverProfiles ?? [],
    objectPreviewProviders: provider.objectPreviewProviders ?? [],
    aiToolFamilies: provider.aiToolFamilies ?? [],
    activated: true,
  });
}

function compareRegisteredProviders(
  left: RegisteredDatabaseProvider,
  right: RegisteredDatabaseProvider
) {
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return left.displayName.localeCompare(right.displayName);
}
