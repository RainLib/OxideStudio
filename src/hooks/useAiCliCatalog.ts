import {
  aiService,
  type AiCliCommandInfo,
  type AiCliModelInfo,
  type AiCliProviderConfig,
} from "@/services/tauri/ai.service";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_FAILURE_RETRY_MS = 30 * 1000;
const CATALOG_CACHE_SCHEMA_VERSION = 1;

export type AiCliCatalogStatus =
  "idle" | "loading" | "ready" | "empty" | "error";

export interface AiCliCatalogSnapshot {
  status: AiCliCatalogStatus;
  models: AiCliModelInfo[];
  commands: AiCliCommandInfo[];
  warning?: string;
  loadedAt?: number;
  /** Last known provider capabilities remain selectable while a refresh fails. */
  stale?: boolean;
}

export interface AiCliCatalogController extends AiCliCatalogSnapshot {
  /**
   * CodeBuddy exposes reasoning levels after selecting a model in ACP. This
   * capability deliberately has its own cache key so a level list never leaks
   * from the previously selected model into the new one.
   */
  efforts: string[];
  effortStatus: AiCliCatalogStatus;
  effortWarning?: string;
  refresh: () => void;
}

const EMPTY_CATALOG: AiCliCatalogSnapshot = {
  status: "idle",
  models: [],
  commands: [],
};

type CatalogResourceStatus = "ready" | "empty" | "error";

interface CachedCatalogResource<T> {
  values: T[];
  status: CatalogResourceStatus;
  /** Time of the most recent request, including a failed refresh. */
  checkedAt: number;
  /** Time of the most recent successful response. */
  loadedAt?: number;
  warning?: string;
  stale?: boolean;
}

// Keep capability data for the renderer lifetime so remounting the Assistant or
// opening another consumer reuses it. Cross-restart reuse is delegated to the
// Rust metadata store, whose identity is keyed and opaque; localStorage must not
// expose executable paths, profiles, or private-environment identity.
const modelCache = new Map<string, CachedCatalogResource<AiCliModelInfo>>();
const modelRequests = new Map<
  string,
  Promise<CachedCatalogResource<AiCliModelInfo>>
>();
const commandCache = new Map<
  string,
  CachedCatalogResource<AiCliCommandInfo>
>();
const commandRequests = new Map<
  string,
  Promise<CachedCatalogResource<AiCliCommandInfo>>
>();

interface CachedEfforts {
  efforts: string[];
  status: AiCliCatalogStatus;
  warning?: string;
  checkedAt?: number;
  loadedAt?: number;
  stale?: boolean;
}

const effortCache = new Map<string, CachedEfforts>();
const effortRequests = new Map<string, Promise<CachedEfforts>>();

function catalogSignature(
  config: AiCliProviderConfig,
  runtimeVersion = "",
  environmentRevision = aiService.getCliEnvironmentRevision(
    config.kind,
    config.profileId,
  ),
) {
  return JSON.stringify({
    schemaVersion: CATALOG_CACHE_SCHEMA_VERSION,
    kind: config.kind,
    profileId: config.profileId.trim(),
    executablePath: config.executablePath?.trim() || "",
    environmentKeys: [...(config.environmentKeys ?? [])]
      .map((key) => key.trim())
      .filter(Boolean)
      .sort(),
    environmentRevision,
    runtimeVersion: runtimeVersion.trim(),
  });
}

function isEffortFresh(cached: CachedEfforts | undefined) {
  const checkedAt = cached?.checkedAt ?? cached?.loadedAt;
  if (!cached || !checkedAt) return false;
  const ttl = cached.stale ? CATALOG_FAILURE_RETRY_MS : CATALOG_TTL_MS;
  return Date.now() - checkedAt < ttl;
}

function isCatalogResourceFresh<T>(
  resource: CachedCatalogResource<T> | undefined,
) {
  if (!resource) return false;
  const ttl = resource.stale
    ? CATALOG_FAILURE_RETRY_MS
    : CATALOG_TTL_MS;
  return Date.now() - resource.checkedAt < ttl;
}

function effortSignature(catalogKey: string, config: AiCliProviderConfig) {
  return `${catalogKey}\n${config.model.trim() || "default"}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadCatalogResource<T>(
  signature: string,
  force: boolean,
  cache: Map<string, CachedCatalogResource<T>>,
  requests: Map<string, Promise<CachedCatalogResource<T>>>,
  load: () => Promise<T[]>,
  normalize: (values: readonly T[]) => T[],
) {
  const cached = cache.get(signature);
  if (!force && isCatalogResourceFresh(cached)) return cached!;

  const pending = requests.get(signature);
  if (pending) {
    if (!force) return pending;
    // A manual refresh requested during initial discovery must not be consumed
    // by that non-forced request. Let it settle, then issue one real refresh.
    await pending;
    const replacement = requests.get(signature);
    if (replacement && replacement !== pending) return replacement;
  }

  let request: Promise<CachedCatalogResource<T>>;
  request = load()
    .then((values) => {
      const normalized = normalize(values);
      const now = Date.now();
      const next: CachedCatalogResource<T> = {
        values: normalized,
        status: normalized.length ? "ready" : "empty",
        checkedAt: now,
        loadedAt: now,
      };
      cache.set(signature, next);
      return next;
    })
    .catch((error: unknown) => {
      const previous = cache.get(signature) ?? cached;
      const values = previous?.values ?? [];
      const next: CachedCatalogResource<T> = {
        values,
        status: values.length ? "ready" : "error",
        checkedAt: Date.now(),
        loadedAt: previous?.loadedAt,
        warning: errorMessage(error),
        stale: true,
      };
      cache.set(signature, next);
      return next;
    })
    .finally(() => {
      if (requests.get(signature) === request) requests.delete(signature);
    });

  requests.set(signature, request);
  return request;
}

function catalogSnapshot(signature: string): AiCliCatalogSnapshot {
  const modelResource = modelCache.get(signature);
  const commandResource = commandCache.get(signature);
  const warnings = [
    modelResource?.warning
      ? `Model catalog: ${modelResource.warning}`
      : null,
    commandResource?.warning
      ? `Command catalog: ${commandResource.warning}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const loadedTimes = [
    modelResource?.loadedAt,
    commandResource?.loadedAt,
  ].filter((value): value is number => typeof value === "number");

  return {
    status: !modelResource
      ? "loading"
      : modelResource.status === "error"
        ? "error"
        : modelResource.values.length
          ? "ready"
          : "empty",
    models: modelResource?.values ?? [],
    commands: commandResource?.values ?? [],
    warning: warnings.length ? warnings.join(" ") : undefined,
    loadedAt: loadedTimes.length ? Math.max(...loadedTimes) : undefined,
    stale: Boolean(modelResource?.stale || commandResource?.stale),
  };
}

async function loadCatalog(
  config: AiCliProviderConfig,
  signature: string,
  runtimeVersion: string | undefined,
  force: boolean,
): Promise<AiCliCatalogSnapshot> {
  await Promise.all([
    loadCatalogResource(
      signature,
      force,
      modelCache,
      modelRequests,
      () =>
        aiService.listCliModels(config, {
          runtimeVersion,
          forceRefresh: force,
        }),
      (values) => uniqueBy(values, (model) => model.id.trim()),
    ),
    loadCatalogResource(
      signature,
      force,
      commandCache,
      commandRequests,
      () =>
        aiService.listCliCommands(config, {
          runtimeVersion,
          forceRefresh: force,
        }),
      (values) => uniqueBy(values, (command) => command.name.trim()),
    ),
  ]);
  return catalogSnapshot(signature);
}

async function loadEfforts(
  config: AiCliProviderConfig,
  signature: string,
  runtimeVersion: string | undefined,
  force: boolean,
): Promise<CachedEfforts> {
  // Codex exposes effort support on the model catalog itself. CodeBuddy's ACP
  // only reports it after the selected model has been configured.
  if (config.kind !== "codebuddy-cli") {
    return { efforts: [], status: "idle" };
  }
  const cached = effortCache.get(signature);
  if (!force && isEffortFresh(cached)) return cached!;

  const pending = effortRequests.get(signature);
  if (pending) {
    if (!force) return pending;
    await pending;
    const replacement = effortRequests.get(signature);
    if (replacement && replacement !== pending) return replacement;
  }

  let request: Promise<CachedEfforts>;
  request = aiService
    .listCliEfforts(config, {
      runtimeVersion,
      forceRefresh: force,
    })
    .then((values) => {
      const efforts = [
        ...new Set(values.map((value) => value.trim()).filter(Boolean)),
      ];
      const next: CachedEfforts = {
        efforts,
        status: efforts.length ? "ready" : "empty",
        checkedAt: Date.now(),
        loadedAt: Date.now(),
      };
      effortCache.set(signature, next);
      return next;
    })
    .catch((error: unknown) => {
      const previous = effortCache.get(signature) ?? cached;
      const efforts = previous?.efforts ?? [];
      const next: CachedEfforts = {
        efforts,
        status: efforts.length ? "ready" : "error",
        warning: `Reasoning capability: ${errorMessage(error)}`,
        checkedAt: Date.now(),
        loadedAt: previous?.loadedAt,
        stale: true,
      };
      effortCache.set(signature, next);
      return next;
    })
    .finally(() => {
      if (effortRequests.get(signature) === request) {
        effortRequests.delete(signature);
      }
    });
  effortRequests.set(signature, request);
  return request;
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useAiCliCatalog(
  config: AiCliProviderConfig | null,
  enabled: boolean,
  runtimeVersion?: string,
): AiCliCatalogController {
  const environmentRevision = useCliEnvironmentRevision(config);
  const signature = useMemo(
    () =>
      config
        ? catalogSignature(config, runtimeVersion, environmentRevision)
        : null,
    [
      config?.kind,
      config?.profileId,
      config?.executablePath,
      config?.environmentKeys,
      environmentRevision,
      runtimeVersion,
    ],
  );
  const configRef = useRef(config);
  configRef.current = config;
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const [snapshot, setSnapshot] = useState<AiCliCatalogSnapshot>(EMPTY_CATALOG);
  const [effortSnapshot, setEffortSnapshot] = useState<CachedEfforts>({
    efforts: [],
    status: "idle",
  });
  const [refreshRequest, setRefreshRequest] = useState<{
    signature: string;
    revision: number;
  } | null>(null);
  const handledCatalogRefreshRef = useRef<string | null>(null);
  const handledEffortRefreshRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !config || !signature) {
      setSnapshot(EMPTY_CATALOG);
      return;
    }

    let disposed = false;
    setSnapshot(catalogSnapshot(signature));
    const refreshToken =
      refreshRequest?.signature === signature
        ? `${signature}\n${refreshRequest.revision}`
        : null;
    const force = Boolean(
      refreshToken && handledCatalogRefreshRef.current !== refreshToken,
    );
    if (refreshToken) handledCatalogRefreshRef.current = refreshToken;
    void loadCatalog(config, signature, runtimeVersion, force).then((next) => {
      if (disposed || signatureRef.current !== signature) return;
      setSnapshot(next);
    });
    return () => {
      disposed = true;
    };
  }, [enabled, refreshRequest, signature]);

  useEffect(() => {
    if (!enabled || !config || !signature || config.kind !== "codebuddy-cli") {
      setEffortSnapshot({ efforts: [], status: "idle" });
      return;
    }

    let disposed = false;
    const currentEffortSignature = effortSignature(signature, config);
    const cached = effortCache.get(currentEffortSignature);
    setEffortSnapshot(
      cached
        ? { ...cached }
        : { efforts: [], status: "loading" },
    );
    const refreshToken =
      refreshRequest?.signature === signature
        ? `${signature}\n${refreshRequest.revision}`
        : null;
    const force = Boolean(
      refreshToken && handledEffortRefreshRef.current !== refreshToken,
    );
    if (refreshToken) handledEffortRefreshRef.current = refreshToken;
    void loadEfforts(
      config,
      currentEffortSignature,
      runtimeVersion,
      force,
    ).then((next) => {
      if (
        disposed ||
        !signatureRef.current ||
        effortSignature(signatureRef.current, config) !== currentEffortSignature
      ) {
        return;
      }
      setEffortSnapshot({ ...next });
    });
    return () => {
      disposed = true;
    };
  }, [config?.kind, config?.model, enabled, refreshRequest, signature]);

  const refresh = useCallback(() => {
    const current = configRef.current;
    const currentSignature = signatureRef.current;
    if (!current || !currentSignature) return;
    setRefreshRequest((request) => ({
      signature: currentSignature,
      revision:
        request?.signature === currentSignature ? request.revision + 1 : 1,
    }));
  }, []);

  return {
    ...snapshot,
    efforts: effortSnapshot.efforts,
    effortStatus: effortSnapshot.status,
    effortWarning: effortSnapshot.warning,
    refresh,
  };
}

export function useCliEnvironmentRevision(config: AiCliProviderConfig | null) {
  const identity = config ? `${config.kind}\u0000${config.profileId}` : null;
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!config) return () => undefined;
      return aiService.subscribeCliEnvironmentRevision((provider, profileId) => {
        if (`${provider}\u0000${profileId}` === identity) notify();
      });
    },
    [config?.kind, config?.profileId, identity],
  );
  const getSnapshot = useCallback(
    () =>
      config
        ? aiService.getCliEnvironmentRevision(config.kind, config.profileId)
        : "",
    [config?.kind, config?.profileId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetAiCliCatalogForTests() {
  modelCache.clear();
  modelRequests.clear();
  commandCache.clear();
  commandRequests.clear();
  effortCache.clear();
  effortRequests.clear();
}
