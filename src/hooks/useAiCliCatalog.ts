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

export type AiCliCatalogStatus =
  "idle" | "loading" | "ready" | "empty" | "error";

export interface AiCliCatalogSnapshot {
  status: AiCliCatalogStatus;
  models: AiCliModelInfo[];
  commands: AiCliCommandInfo[];
  warning?: string;
  loadedAt?: number;
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

interface CachedCatalog extends AiCliCatalogSnapshot {
  signature: string;
}

const EMPTY_CATALOG: AiCliCatalogSnapshot = {
  status: "idle",
  models: [],
  commands: [],
};

const catalogCache = new Map<string, CachedCatalog>();
const catalogRequests = new Map<string, Promise<CachedCatalog>>();

interface CachedEfforts {
  efforts: string[];
  status: AiCliCatalogStatus;
  warning?: string;
  loadedAt?: number;
}

const effortCache = new Map<string, CachedEfforts>();
const effortRequests = new Map<string, Promise<CachedEfforts>>();

function catalogSignature(config: AiCliProviderConfig) {
  return JSON.stringify({
    kind: config.kind,
    profileId: config.profileId,
    executablePath: config.executablePath?.trim() || "",
    environmentKeys: [...(config.environmentKeys ?? [])].sort(),
    environmentRevision: aiService.getCliEnvironmentRevision(
      config.kind,
      config.profileId,
    ),
  });
}

function isFresh(catalog: { loadedAt?: number } | undefined) {
  return Boolean(
    catalog?.loadedAt && Date.now() - catalog.loadedAt < CATALOG_TTL_MS,
  );
}

function effortSignature(config: AiCliProviderConfig) {
  return `${catalogSignature(config)}\n${config.model.trim() || "default"}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadCatalog(
  config: AiCliProviderConfig,
  force: boolean,
): Promise<CachedCatalog> {
  const signature = catalogSignature(config);
  const cached = catalogCache.get(signature);
  if (!force && cached?.status === "ready" && isFresh(cached)) return cached;
  if (!force && cached?.status === "empty" && isFresh(cached)) return cached;

  const pending = catalogRequests.get(signature);
  if (pending) return pending;

  const previousModels = cached?.models ?? [];
  const previousCommands = cached?.commands ?? [];
  const loading: CachedCatalog = {
    signature,
    status: "loading",
    models: previousModels,
    commands: previousCommands,
    loadedAt: cached?.loadedAt,
  };
  catalogCache.set(signature, loading);

  const request = Promise.allSettled([
    aiService.listCliModels(config),
    aiService.listCliCommands(config),
  ])
    .then(([modelResult, commandResult]) => {
      const models =
        modelResult.status === "fulfilled"
          ? uniqueBy(modelResult.value, (model) => model.id.trim())
          : force
            ? []
            : previousModels;
      const commands =
        commandResult.status === "fulfilled"
          ? uniqueBy(commandResult.value, (command) => command.name.trim())
          : force
            ? []
            : previousCommands;
      const warnings = [
        modelResult.status === "rejected"
          ? `Model catalog: ${errorMessage(modelResult.reason)}`
          : null,
        commandResult.status === "rejected"
          ? `Command catalog: ${errorMessage(commandResult.reason)}`
          : null,
      ].filter((value): value is string => Boolean(value));

      const modelsUnavailable =
        modelResult.status === "rejected" && models.length === 0;
      const next: CachedCatalog = {
        signature,
        status: modelsUnavailable
          ? "error"
          : models.length === 0
            ? "empty"
            : "ready",
        models,
        commands,
        warning: warnings.length ? warnings.join(" ") : undefined,
        loadedAt: Date.now(),
      };
      catalogCache.set(signature, next);
      return next;
    })
    .finally(() => {
      catalogRequests.delete(signature);
    });

  catalogRequests.set(signature, request);
  return request;
}

async function loadEfforts(
  config: AiCliProviderConfig,
  force: boolean,
): Promise<CachedEfforts> {
  // Codex exposes effort support on the model catalog itself. CodeBuddy's ACP
  // only reports it after the selected model has been configured.
  if (config.kind !== "codebuddy-cli") {
    return { efforts: [], status: "idle" };
  }
  const signature = effortSignature(config);
  const cached = effortCache.get(signature);
  if (!force && cached && isFresh(cached)) return cached;

  const pending = effortRequests.get(signature);
  if (pending) return pending;

  const request = aiService
    .listCliEfforts(config)
    .then((values) => {
      const efforts = [
        ...new Set(values.map((value) => value.trim()).filter(Boolean)),
      ];
      const next: CachedEfforts = {
        efforts,
        status: efforts.length ? "ready" : "empty",
        loadedAt: Date.now(),
      };
      effortCache.set(signature, next);
      return next;
    })
    .catch((error: unknown) => {
      const next: CachedEfforts = {
        efforts: [],
        status: "error",
        warning: `Reasoning capability: ${errorMessage(error)}`,
        loadedAt: Date.now(),
      };
      effortCache.set(signature, next);
      return next;
    })
    .finally(() => {
      effortRequests.delete(signature);
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
): AiCliCatalogController {
  const environmentRevision = useCliEnvironmentRevision(config);
  const signature = useMemo(
    () => (config ? catalogSignature(config) : null),
    [
      config?.kind,
      config?.profileId,
      config?.executablePath,
      config?.environmentKeys,
      environmentRevision,
    ],
  );
  const configRef = useRef(config);
  configRef.current = config;
  const [snapshot, setSnapshot] = useState<AiCliCatalogSnapshot>(EMPTY_CATALOG);
  const [effortSnapshot, setEffortSnapshot] = useState<CachedEfforts>({
    efforts: [],
    status: "idle",
  });
  const [refreshRequest, setRefreshRequest] = useState<{
    signature: string;
    revision: number;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !config || !signature) {
      setSnapshot(EMPTY_CATALOG);
      return;
    }

    let disposed = false;
    const cached = catalogCache.get(signature);
    setSnapshot(
      cached ? { ...cached } : { status: "loading", models: [], commands: [] },
    );
    const force = refreshRequest?.signature === signature;
    void loadCatalog(config, force).then((next) => {
      if (disposed || next.signature !== signature) return;
      setSnapshot({ ...next });
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
    const currentEffortSignature = effortSignature(config);
    const cached = effortCache.get(currentEffortSignature);
    setEffortSnapshot(
      cached
        ? { ...cached }
        : { efforts: [], status: "loading" },
    );
    const force = refreshRequest?.signature === signature;
    void loadEfforts(config, force).then((next) => {
      if (disposed || effortSignature(config) !== currentEffortSignature) return;
      setEffortSnapshot({ ...next });
    });
    return () => {
      disposed = true;
    };
  }, [config?.kind, config?.model, enabled, refreshRequest, signature]);

  const refresh = useCallback(() => {
    const current = configRef.current;
    if (!current) return;
    const currentSignature = catalogSignature(current);
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
  catalogCache.clear();
  catalogRequests.clear();
  effortCache.clear();
  effortRequests.clear();
}
