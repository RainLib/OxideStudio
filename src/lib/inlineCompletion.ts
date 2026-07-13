import type {
  AiInlineCompletionRequest,
  InlineLspContext,
} from "@/services/tauri/ai.service";

export type InlineCompletionStatus =
  | "off"
  | "local"
  | "thinking"
  | "ai"
  | "offline";

export const INLINE_COMPLETION_PREFIX_LIMIT = 8_192;
export const INLINE_COMPLETION_SUFFIX_LIMIT = 4_096;
export const INLINE_COMPLETION_DEBOUNCE_MS = 300;

export function boundedInlineContext(value: string, positionOffset: number) {
  return {
    prefix: value.slice(
      Math.max(0, positionOffset - INLINE_COMPLETION_PREFIX_LIMIT),
      positionOffset
    ),
    suffix: value.slice(
      positionOffset,
      positionOffset + INLINE_COMPLETION_SUFFIX_LIMIT
    ),
  };
}

function plainSnippetText(value: string) {
  return value
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}

export function localInlineSuggestion(
  prefix: string,
  context: InlineLspContext
): string {
  const candidates = context.candidates || [];
  if (candidates.length === 0) return "";
  const word = prefix.match(/[\p{L}\p{N}_$@:.?]+$/u)?.[0] || "";
  const candidate = candidates.find((item) => {
    const text = plainSnippetText(item.insertText || item.label);
    return word
      ? text.toLocaleLowerCase().startsWith(word.toLocaleLowerCase()) &&
          text.length > word.length
      : text.length > 0;
  });
  if (!candidate) return "";
  const text = plainSnippetText(candidate.insertText || candidate.label);
  return word ? text.slice(word.length) : text;
}

export function cleanInlineSuggestion(
  raw: string,
  prefix: string,
  suffix: string
) {
  let value = raw.trimEnd();
  if (value.startsWith("```")) {
    value = value.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
  }
  const prefixTail = prefix.slice(-Math.min(prefix.length, 512));
  if (prefixTail && value.startsWith(prefixTail)) {
    value = value.slice(prefixTail.length);
  }
  const maxOverlap = Math.min(value.length, suffix.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (value.slice(-length) === suffix.slice(0, length)) {
      value = value.slice(0, -length);
      break;
    }
  }
  return value
    .split(/\r?\n/)
    .slice(0, 12)
    .join("\n")
    .slice(0, 2_048);
}

export function shouldRequestAiInlineCompletion(options: {
  prefix: string;
  hasSelection: boolean;
  automatic: boolean;
  explicit: boolean;
}) {
  if (options.hasSelection) return false;
  if (!options.explicit && !options.automatic) return false;
  const lines = options.prefix.split(/\r?\n/);
  const line = lines[lines.length - 1] || "";
  if (!options.explicit && /['"`]([^'"`]*)$/.test(line)) return false;
  if (/^\s*--/.test(line)) return options.explicit || line.trim().length >= 8;
  return options.explicit || options.prefix.trim().length >= 2;
}

export function inlineCompletionCacheKey(
  request: Omit<AiInlineCompletionRequest, "requestId">
) {
  return stableHash(
    JSON.stringify({
      protocol: request.protocol,
      model: request.config.model,
      prefix: request.prefix,
      suffix: request.suffix,
      languageId: request.languageId,
      dialect: request.dialect,
      filePath: request.filePath,
      lspContext: request.lspContext,
      relatedSnippets: request.relatedSnippets,
    })
  );
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export class InlineCompletionCache {
  private values = new Map<string, { text: string; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 100,
    private readonly ttlMs = 5 * 60_000
  ) {}

  get(key: string, now = Date.now()) {
    const value = this.values.get(key);
    if (!value) return undefined;
    if (value.expiresAt <= now) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, value);
    return value.text;
  }

  set(key: string, text: string, now = Date.now()) {
    this.values.delete(key);
    this.values.set(key, { text, expiresAt: now + this.ttlMs });
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (!oldest) break;
      this.values.delete(oldest);
    }
  }

  clear() {
    this.values.clear();
  }
}
