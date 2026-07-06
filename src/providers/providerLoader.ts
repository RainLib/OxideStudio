import {
  listRegisteredDatabaseProviders,
  registerDatabaseProvider,
  type DatabaseProvider,
} from "./databaseProviders";

export type DatabaseProviderRegistration =
  | DatabaseProvider
  | DatabaseProvider[];

export type DatabaseProviderModule =
  | DatabaseProviderRegistration
  | {
      default?: DatabaseProviderRegistration;
      providers?: DatabaseProviderRegistration;
      register?: () =>
        | void
        | DatabaseProviderRegistration
        | Promise<void | DatabaseProviderRegistration>;
    };

export type DatabaseProviderLoader = {
  id: string;
  load: () => DatabaseProviderModule | Promise<DatabaseProviderModule>;
};

export type DatabaseProviderModuleLoader = () => Promise<DatabaseProviderModule>;

export type DatabaseProviderLoadStatus = {
  id: string;
  status: "loaded" | "skipped" | "failed";
  providerIds: string[];
  error?: string;
};

export function createDatabaseProviderLoaders(
  modules: Record<string, DatabaseProviderModuleLoader>
): DatabaseProviderLoader[] {
  return Object.entries(modules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, load]) => ({ id, load }));
}

export async function loadDatabaseProviders(
  loaders: DatabaseProviderLoader[]
): Promise<DatabaseProviderLoadStatus[]> {
  const statuses: DatabaseProviderLoadStatus[] = [];

  for (const loader of loaders) {
    const id = loader.id.trim();
    if (!id) {
      statuses.push({
        id: loader.id,
        status: "failed",
        providerIds: [],
        error: "Database provider loader id is required",
      });
      continue;
    }

    try {
      const beforeIds = new Set(
        listRegisteredDatabaseProviders().map((provider) => provider.id)
      );
      const module = await loader.load();
      const providers = await resolveProviderRegistrations(module);

      if (providers.length > 0) {
        registerDatabaseProvider(providers);
      }

      const explicitProviderIds = providers.map((provider) => provider.id.trim());
      const registeredProviderIds = listRegisteredDatabaseProviders()
        .map((provider) => provider.id)
        .filter((providerId) => !beforeIds.has(providerId));
      const providerIds = Array.from(
        new Set([...explicitProviderIds, ...registeredProviderIds])
      ).filter(Boolean);

      statuses.push({
        id,
        status: providerIds.length > 0 ? "loaded" : "skipped",
        providerIds,
      });
    } catch (error) {
      statuses.push({
        id,
        status: "failed",
        providerIds: [],
        error: errorMessage(error),
      });
    }
  }

  return statuses;
}

async function resolveProviderRegistrations(
  module: DatabaseProviderModule
): Promise<DatabaseProvider[]> {
  const providers: DatabaseProvider[] = [];

  if (isProviderRegistration(module)) {
    appendProviders(providers, module);
  } else if (isProviderContainer(module)) {
    appendProviders(providers, module.default);
    appendProviders(providers, module.providers);

    if (module.register) {
      appendProviders(providers, await module.register());
    }
  }

  return providers;
}

function appendProviders(
  target: DatabaseProvider[],
  registration: void | DatabaseProviderRegistration | undefined
) {
  if (!registration) return;

  if (Array.isArray(registration)) {
    for (const provider of registration) {
      target.push(provider);
    }
    return;
  }

  if (isDatabaseProvider(registration)) {
    target.push(registration);
  }
}

function isProviderRegistration(
  value: DatabaseProviderModule
): value is DatabaseProviderRegistration {
  return Array.isArray(value) || isDatabaseProvider(value);
}

function isProviderContainer(
  value: DatabaseProviderModule
): value is Exclude<DatabaseProviderModule, DatabaseProviderRegistration> {
  return (
    !Array.isArray(value) &&
    !isDatabaseProvider(value) &&
    (Boolean(value.default) || Boolean(value.providers) || Boolean(value.register))
  );
}

function isDatabaseProvider(value: unknown): value is DatabaseProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<DatabaseProvider>;
  return typeof provider.id === "string" && typeof provider.displayName === "string";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
