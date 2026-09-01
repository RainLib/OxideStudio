export type RocketMqConnectionConfig = {
  namesrvAddr: string;
  clusterName?: string;
  accessKey?: string;
  secretKey?: string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  tlsSkipVerify?: boolean;
};

export const ROCKETMQ_WORKSPACE_CAPABILITIES = [
  "brokers",
  "topics",
  "consumerGroups",
  "consumerLag",
  "messages",
  "trace",
  "acls",
] as const;

/** Normalizes the NameServer list without accepting a URL, path, or an
 * incomplete endpoint. This value is passed to the native RocketMQ Agent,
 * never used as a browser URL. */
export function normalizeRocketMqNameServers(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(/[;,]/)) {
    const endpoint = raw.trim();
    if (!endpoint) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint) || /[/?#]/.test(endpoint)) {
      throw new Error("RocketMQ NameServer addresses must be host:port values without a URL scheme");
    }
    const match = endpoint.match(/^(?:\[([0-9a-f:]+)\]|([a-z0-9._-]+)):(\d{1,5})$/i);
    const host = match?.[1] || match?.[2];
    const port = Number(match?.[3]);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("RocketMQ NameServer addresses are invalid");
    }
    seen.add(match?.[1] ? `[${host}]:${port}` : `${host}:${port}`);
  }
  if (!seen.size) throw new Error("RocketMQ NameServer address is required");
  return [...seen];
}

export function validateRocketMqConnection(config: RocketMqConnectionConfig) {
  const namesrvAddr = normalizeRocketMqNameServers(config.namesrvAddr);
  if (Boolean(config.accessKey) !== Boolean(config.secretKey)) {
    throw new Error("RocketMQ Access Key and Secret Key must be provided together");
  }
  for (const [name, value] of [["request timeout", config.requestTimeoutMs], ["connect timeout", config.connectTimeoutMs]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 300_000)) {
      throw new Error(`RocketMQ ${name} must be between 1 and 300000 milliseconds`);
    }
  }
  return { ...config, namesrvAddr: namesrvAddr.join(",") };
}
