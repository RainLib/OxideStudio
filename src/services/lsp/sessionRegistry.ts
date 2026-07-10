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
};

export type LspSessionDescriptor = {
  key: string;
  profile: BuiltInLspProfile;
  client: LspClient;
};

const clientsBySessionKey = new Map<string, LspClient>();
let binaryInfoPromise: Promise<LspBinaryInfo> | null = null;

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
  let client = clientsBySessionKey.get(key);
  if (!client) {
    client = new LspClient(key);
    clientsBySessionKey.set(key, client);
  }

  return { key, profile, client };
}

export async function ensureLspSession(options: {
  connectionId: string;
  driver: DatabaseDriver;
}) {
  const descriptor = getLspSessionDescriptor(options);
  if (!descriptor) return null;

  if (descriptor.client.isInitialized()) {
    return descriptor;
  }

  const binaryInfo = await getBundledLspBinaryInfo();
  if (!binaryInfo.exists) {
    throw new Error(`LSP binary not found at: ${binaryInfo.path}`);
  }

  await descriptor.client.initialize(binaryInfo.path);
  return descriptor;
}

async function getBundledLspBinaryInfo() {
  if (!binaryInfoPromise) {
    binaryInfoPromise = invoke<LspBinaryInfo>("check_lsp_binary");
  }
  return binaryInfoPromise;
}
