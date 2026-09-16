import { type AiProviderConfig } from "@/services/tauri/ai.service";

export function assistantConversationId(provider: AiProviderConfig | null) {
  if (!provider) return undefined;
  if (provider.kind !== "openai-compatible") {
    // A CLI provider can have more than one signed-in profile on the same
    // machine. Keeping a conversation keyed only by its kind would send prior
    // workspace context to whichever identity happens to be selected next.
    // These fields are configuration identifiers, never environment values or
    // credentials, and are reduced to a fixed non-secret digest before they
    // cross into the persisted conversation key.
    const identity = JSON.stringify({
      kind: provider.kind,
      profileId: provider.profileId.trim(),
      executablePath: provider.executablePath?.trim() || "",
    });
    return `provider:cli:${nonSecretDestinationDigest(identity)}`;
  }
  // Keep HTTP conversation history inside one non-secret destination boundary.
  // The API key is intentionally excluded: rotating a credential for the same
  // endpoint must not leak it into identifiers or discard a valid conversation.
  const identity = JSON.stringify({
    kind: provider.kind,
    baseUrl: canonicalHttpDestination(provider.baseUrl),
  });
  return `provider:http:${nonSecretDestinationDigest(identity)}`;
}

export function assistantConversationScopeKey(
  projectId: string,
  conversationScope?: string,
) {
  return JSON.stringify([projectId, conversationScope || "default"]);
}

export function assistantConversationBelongsToScope(
  conversationId: string,
  conversationScope: string,
) {
  return (
    conversationId === conversationScope ||
    conversationId.startsWith(`${conversationScope}:chat:`)
  );
}

export function createAssistantConversationId(
  conversationScope: string,
  now = Date.now(),
  randomToken = assistantConversationRandomToken(),
) {
  const normalizedToken = randomToken
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "")
    .slice(0, 8)
    .padEnd(8, "0");
  const conversationId = `${conversationScope}:chat:${now.toString(36)}-${normalizedToken}`;
  if (conversationId.length > 80) {
    throw new Error("Assistant conversation identity exceeds the host limit.");
  }
  return conversationId;
}

function assistantConversationRandomToken() {
  try {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  }
}

function canonicalHttpDestination(baseUrl: string) {
  const fallback = baseUrl.trim().replace(/\/+$/u, "");
  try {
    const url = new URL(fallback);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return fallback;
  }
}

// A synchronous 128-bit avalanche digest keeps conversation ids within the
// Host's 80-character boundary. It is an identity key, not a credential hash;
// the configured API credential is never included in the source value.
function nonSecretDestinationDigest(value: string) {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}
