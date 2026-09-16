import { invokeWithInterceptors } from "../client";
import type { AiCliAuthenticationLaunchResult, AiCliAuthenticationMethod, AiCliAuthenticationStatus, AiCliCapabilityRequestOptions, AiCliDetectionResult, AiCliInstallationLaunchResult, AiCliInstallationStatus, AiCliModelInfo, AiCliCommandInfo, AiCliProviderConfig, AiProviderConfig, AiProviderTestResult } from "./contracts";

export async function testProvider(
  config: AiProviderConfig
): Promise<AiProviderTestResult> {
  if (config.kind !== "openai-compatible") {
    return invokeWithInterceptors<AiProviderTestResult>(
      "ai_cli_test_provider",
      { config },
    );
  }
  return invokeWithInterceptors<AiProviderTestResult>("ai_test_provider", {
    config,
  });
}

export async function detectCliProvider(
  config: AiCliProviderConfig,
): Promise<AiCliDetectionResult> {
  return invokeWithInterceptors<AiCliDetectionResult>("ai_cli_detect", {
    config,
  });
}

export async function listCliModels(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<AiCliModelInfo[]> {
  return invokeWithInterceptors<AiCliModelInfo[]>("ai_cli_list_models", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function listCliEfforts(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("ai_cli_list_efforts", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function listCliCommands(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<AiCliCommandInfo[]> {
  return invokeWithInterceptors<AiCliCommandInfo[]>("ai_cli_list_commands", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function beginCliInstallation(
  provider: AiCliProviderConfig["kind"],
): Promise<AiCliInstallationLaunchResult> {
  return invokeWithInterceptors<AiCliInstallationLaunchResult>(
    "ai_cli_install_provider",
    { provider },
  );
}

export async function getCliInstallationStatus(
  sessionId: string,
): Promise<AiCliInstallationStatus> {
  return invokeWithInterceptors<AiCliInstallationStatus>(
    "ai_cli_installation_status",
    { sessionId },
  );
}

export async function beginCliAuthentication(
  config: AiCliProviderConfig,
  methodId?: string,
): Promise<AiCliAuthenticationLaunchResult> {
  return invokeWithInterceptors<AiCliAuthenticationLaunchResult>(
    "ai_cli_begin_authentication",
    { config, methodId },
  );
}

export async function listCliAuthenticationMethods(
  config: AiCliProviderConfig,
): Promise<AiCliAuthenticationMethod[]> {
  return invokeWithInterceptors<AiCliAuthenticationMethod[]>(
    "ai_cli_list_authentication_methods",
    { config },
  );
}

export async function getCliAuthenticationStatus(
  sessionId: string,
): Promise<AiCliAuthenticationStatus> {
  return invokeWithInterceptors<AiCliAuthenticationStatus>(
    "ai_cli_authentication_status",
    { sessionId },
  );
}

export async function cancelCliAuthentication(
  sessionId: string,
): Promise<AiCliAuthenticationStatus> {
  return invokeWithInterceptors<AiCliAuthenticationStatus>(
    "ai_cli_cancel_authentication",
    { sessionId },
  );
}

export async function setCliEnvironment(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
  environment: Record<string, string>,
): Promise<string[]> {
  const result = await invokeWithInterceptors<{
    keys: string[];
    revision: string;
  }>("ai_cli_set_environment", {
    request: { provider, profileId, environment },
  });
  cliEnvironmentRevisions.set(
    `${provider}\u0000${profileId}`,
    result.revision,
  );
  notifyCliEnvironmentRevision(provider, profileId);
  return result.keys;
}

const cliEnvironmentRevisions = new Map<string, string>();
const cliEnvironmentRevisionListeners = new Set<
  (provider: AiCliProviderConfig["kind"], profileId: string) => void
>();

function notifyCliEnvironmentRevision(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
) {
  for (const listener of cliEnvironmentRevisionListeners) {
    listener(provider, profileId);
  }
}

export function getCliEnvironmentRevision(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
) {
  return cliEnvironmentRevisions.get(`${provider}\u0000${profileId}`) ?? "";
}

/**
 * A revision is intentionally opaque: it tells the renderer that a private
 * CLI environment changed without exposing a value or deriving a secret hash.
 */
export function subscribeCliEnvironmentRevision(
  listener: (provider: AiCliProviderConfig["kind"], profileId: string) => void,
) {
  cliEnvironmentRevisionListeners.add(listener);
  return () => cliEnvironmentRevisionListeners.delete(listener);
}

export async function getCliEnvironment(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
): Promise<Record<string, string>> {
  return invokeWithInterceptors<Record<string, string>>(
    "ai_cli_get_environment",
    { request: { provider, profileId } },
  );
}
