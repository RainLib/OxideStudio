import type {
  AiCliAuthenticationMethod,
  AiCliProviderConfig,
} from "@/services/tauri/ai.service";
import { create } from "zustand";

export type AssistantCliSetupPhase =
  | "checking"
  | "missing"
  | "installing"
  | "auth-required"
  | "authorizing"
  | "ready"
  | "error";

export type AssistantCliSetupState = {
  phase: AssistantCliSetupPhase;
  message: string;
  executablePath?: string;
  version?: string;
  refreshing?: boolean;
  authenticationMethods?: AiCliAuthenticationMethod[];
  installationSessionId?: string;
  authenticationSessionId?: string;
  authenticationMethodId?: string;
  browserUrl?: string;
  authMethodsLoading?: boolean;
};

type CliProviderKind = AiCliProviderConfig["kind"];
type SetupUpdate =
  | AssistantCliSetupState
  | ((current: AssistantCliSetupState | null) => AssistantCliSetupState);

type ProbeIdentity = {
  fingerprint: string;
  completedRevision: number;
  verifiedAt: number;
};

type AssistantCliSetupStore = {
  setupByProvider: Partial<Record<CliProviderKind, AssistantCliSetupState>>;
  detectionRevisionByProvider: Record<CliProviderKind, number>;
  probeIdentityByProvider: Partial<Record<CliProviderKind, ProbeIdentity>>;
  updateSetup: (provider: CliProviderKind, update: SetupUpdate) => void;
  requestDetection: (provider: CliProviderKind) => void;
  completeProbe: (
    provider: CliProviderKind,
    fingerprint: string,
    revision: number,
    verifiedAt?: number,
  ) => void;
  reset: () => void;
};

const initialRevisions: Record<CliProviderKind, number> = {
  "codex-cli": 0,
  "codebuddy-cli": 0,
};

export const useAssistantCliSetupStore = create<AssistantCliSetupStore>(
  (set) => ({
    setupByProvider: {},
    detectionRevisionByProvider: initialRevisions,
    probeIdentityByProvider: {},
    updateSetup: (provider, update) =>
      set((current) => {
        const previous = current.setupByProvider[provider] ?? null;
        const requested = typeof update === "function" ? update(previous) : update;
        const next = requested.phase === "authorizing" || !requested.browserUrl
          ? requested
          : { ...requested, browserUrl: undefined };
        if (previous === next) return current;
        return {
          setupByProvider: {
            ...current.setupByProvider,
            [provider]: next,
          },
        };
      }),
    requestDetection: (provider) =>
      set((current) => ({
        detectionRevisionByProvider: {
          ...current.detectionRevisionByProvider,
          [provider]: current.detectionRevisionByProvider[provider] + 1,
        },
      })),
    completeProbe: (provider, fingerprint, revision, verifiedAt = Date.now()) =>
      set((current) => ({
        probeIdentityByProvider: {
          ...current.probeIdentityByProvider,
          [provider]: {
            fingerprint,
            completedRevision: revision,
            verifiedAt,
          },
        },
      })),
    reset: () =>
      set({
        setupByProvider: {},
        detectionRevisionByProvider: initialRevisions,
        probeIdentityByProvider: {},
      }),
  }),
);
