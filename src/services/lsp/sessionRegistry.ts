import { invoke } from "@tauri-apps/api/core";
import type { DatabaseDriver } from "@/services/tauri/types";
import { LspClient } from "./client";
import {
  builtInLspProfileForDriver,
  lspSessionKeyForDriver,
  type BuiltInLspProfile,
} from "./profiles";

type LspBinaryInfo = {
  version: string;
  path: string;
  exists: boolean;
  size_bytes?: number | null;
  modified_unix_ms?: number | null;
  source_revision?: string | null;
  source_dirty?: boolean | null;
  sha256?: string | null;
  integrity_verified?: boolean | null;
};

export type LspSessionDescriptor = {
  key: string;
  profile: BuiltInLspProfile;
  client: LspClient;
};

type LspSessionEntry = {
  client: LspClient;
  consumers: number;
  shutdownTimer: ReturnType<typeof setTimeout> | null;
};

const clientsBySessionKey = new Map<string, LspSessionEntry>();
let binaryInfoPromise: Promise<LspBinaryInfo> | null = null;
export const LSP_SESSION_IDLE_SHUTDOWN_MS = 30_000;

export function getLspSessionDescriptor(options: {
  connectionId: string | null | undefined;
  driver: DatabaseDriver | null | undefined;
}): LspSessionDescriptor | null {
  if (!options.connectionId || !options.driver) return null;

  const profile = builtInLspProfileForDriver(options.driver);
  if (!profile || profile.activationPolicy === "off") return null;

  const key = lspSessionKeyForDriver({
    connectionId: options.connectionId,
    driver: options.driver,
  });
  let entry = clientsBySessionKey.get(key);
  if (!entry) {
    entry = {
      client: new LspClient(key),
      consumers: 0,
      shutdownTimer: null,
    };
    clientsBySessionKey.set(key, entry);
  }

  return { key, profile, client: entry.client };
}

export async function ensureLspSession(options: {
  connectionId: string;
  driver: DatabaseDriver;
}) {
  const descriptor = getLspSessionDescriptor(options);
  if (!descriptor) return null;

  if (
    descriptor.client.isInitialized() &&
    (await descriptor.client.isRunning())
  ) {
    return descriptor;
  }

  const binaryInfo = await getBundledLspBinaryInfo();
  if (!binaryInfo.exists) {
    throw new Error(`LSP binary not found at: ${binaryInfo.path}`);
  }

  await descriptor.client.initialize(binaryInfo.path);
  return descriptor;
}

/**
 * Retains one mounted consumer of an LSP session. The matching release keeps a
 * short idle grace period so pane switches do not churn the bundled process.
 */
export function retainLspSession(sessionKey: string) {
  const entry = clientsBySessionKey.get(sessionKey);
  if (!entry) return () => undefined;

  if (entry.shutdownTimer) {
    clearTimeout(entry.shutdownTimer);
    entry.shutdownTimer = null;
  }
  entry.consumers += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    releaseLspSession(sessionKey);
  };
}

export async function shutdownLspSession(sessionKey: string) {
  const entry = clientsBySessionKey.get(sessionKey);
  if (!entry) return;
  if (entry.shutdownTimer) clearTimeout(entry.shutdownTimer);
  entry.shutdownTimer = null;
  clientsBySessionKey.delete(sessionKey);
  if (entry.client.isInitialized()) {
    await entry.client.shutdown().catch(() => undefined);
  }
}

export async function shutdownAllLspSessions() {
  await Promise.all(
    Array.from(clientsBySessionKey.keys(), (key) => shutdownLspSession(key))
  );
}

function releaseLspSession(sessionKey: string) {
  const entry = clientsBySessionKey.get(sessionKey);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  if (entry.consumers > 0 || entry.shutdownTimer) return;

  entry.shutdownTimer = setTimeout(() => {
    const current = clientsBySessionKey.get(sessionKey);
    if (!current || current !== entry || current.consumers > 0) return;
    void shutdownLspSession(sessionKey);
  }, LSP_SESSION_IDLE_SHUTDOWN_MS);
}

async function getBundledLspBinaryInfo() {
  if (!binaryInfoPromise) {
    binaryInfoPromise = invoke<LspBinaryInfo>("check_lsp_binary");
  }
  return binaryInfoPromise;
}
