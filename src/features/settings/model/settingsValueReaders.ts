import { type SqlSnippetSetting } from "@/features/query-editor/model/sqlCommandSnippets";
import {
  type AppSettings,
  type VimCustomMapping,
  type VimMappingMode,
} from "@/features/settings/model/settingsTypes";

export function normalizedCommandPolicy(
  raw: Record<string, unknown>,
): AppSettings["ai"]["shell"]["commandPolicy"] {
  const policy = recordAt(raw, ["ai", "shell", "commandPolicy"]);
  const sourceRules = Array.isArray(policy.rules) ? policy.rules : [];
  const rules = sourceRules
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((rule) => {
      const id =
        typeof rule.id === "string" ? rule.id.trim().slice(0, 120) : "";
      const action: "confirm" | "block" | null =
        rule.action === "block" || rule.action === "confirm"
          ? rule.action
          : null;
      if (!id || !action) return [];
      const executables = Array.isArray(rule.executables)
        ? rule.executables
            .filter((value): value is string => typeof value === "string")
            .slice(0, 100)
            .map((value) => value.trim().slice(0, 512))
            .filter(Boolean)
        : undefined;
      const sandboxModes = Array.isArray(rule.sandboxModes)
        ? rule.sandboxModes.filter(
            (value): value is "workspace-write" | "unrestricted" =>
              value === "workspace-write" || value === "unrestricted",
          )
        : undefined;
      return [
        {
          id,
          action,
          ...(executables?.length ? { executables } : {}),
          ...(typeof rule.argumentRegex === "string"
            ? { argumentRegex: rule.argumentRegex.slice(0, 512) }
            : {}),
          ...(typeof rule.cwdGlob === "string"
            ? { cwdGlob: rule.cwdGlob.slice(0, 512) }
            : {}),
          ...(sandboxModes?.length ? { sandboxModes } : {}),
          ...(typeof rule.message === "string"
            ? { message: rule.message.slice(0, 500) }
            : {}),
        },
      ];
    });
  return { version: 1, rules };
}

export function normalizeKeymap(
  raw: Record<string, unknown>,
  defaults: Record<string, string[]>,
) {
  const keymap: Record<string, string[]> = { ...defaults };
  Object.entries(raw).forEach(([actionId, value]) => {
    if (Array.isArray(value)) {
      keymap[actionId] = value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      );
    } else if (typeof value === "string" && value.trim()) {
      keymap[actionId] = [value.trim()];
    }
  });
  return keymap;
}

export function getAt(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function recordAt(value: Record<string, unknown>, path: string[]) {
  const record = getAt(value, path);
  return isRecord(record) ? record : {};
}

export function boolAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: boolean,
) {
  const item = getAt(value, path);
  return typeof item === "boolean" ? item : fallback;
}

export function numberAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: number,
  min: number,
  max: number,
) {
  const item = getAt(value, path);
  if (typeof item !== "number" || !Number.isFinite(item)) return fallback;
  return Math.min(max, Math.max(min, Math.round(item)));
}

export function stringAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: string,
  maxLength: number,
) {
  const item = getAt(value, path);
  if (typeof item !== "string") return fallback;
  const normalized = item.trim();
  return normalized && normalized.length <= maxLength ? normalized : fallback;
}

export function boundedHttpsUrlAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: string,
) {
  const item = getAt(value, path);
  if (typeof item !== "string") return fallback;
  const normalized = item.trim();
  if (!normalized) return "";
  if (normalized.length > 512) return fallback;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

export function vimMappingsAt(
  value: Record<string, unknown>,
  path: string[],
): VimCustomMapping[] {
  const mappings = getAt(value, path);
  if (!Array.isArray(mappings)) return [];

  return mappings.flatMap((item): VimCustomMapping[] => {
    if (!isRecord(item)) return [];
    const mode = item.mode;
    const lhs = item.lhs;
    const rhs = item.rhs;
    if (
      !["all", "normal", "insert", "visual"].includes(String(mode)) ||
      typeof lhs !== "string" ||
      !lhs.trim() ||
      lhs.length > 128 ||
      typeof rhs !== "string" ||
      !rhs.trim() ||
      rhs.length > 512
    ) {
      return [];
    }

    return [
      {
        mode: mode as VimMappingMode,
        lhs: lhs.trim(),
        rhs: rhs.trim(),
        recursive: item.recursive !== false,
      },
    ];
  });
}

export function sqlSnippetsAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: SqlSnippetSetting[],
): SqlSnippetSetting[] {
  const snippets = getAt(value, path);
  if (!Array.isArray(snippets)) {
    return fallback.map((snippet) => ({ ...snippet }));
  }

  const ids = new Set<string>();
  const prefixes = new Set<string>();
  return snippets.slice(0, 100).flatMap((item): SqlSnippetSetting[] => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 120) : "";
    const prefix =
      typeof item.prefix === "string" ? item.prefix.trim().toLowerCase() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const detail = typeof item.detail === "string" ? item.detail.trim() : "";
    const body = typeof item.body === "string" ? item.body : "";
    if (
      !id ||
      ids.has(id) ||
      !/^[a-z_][a-z0-9_-]{0,31}$/u.test(prefix) ||
      prefixes.has(prefix) ||
      !label ||
      label.length > 120 ||
      detail.length > 240 ||
      !body.trim() ||
      body.length > 65_536
    ) {
      return [];
    }
    ids.add(id);
    prefixes.add(prefix);
    return [
      {
        id,
        prefix,
        label,
        detail: detail || "Custom SQL snippet",
        body,
        enabled: item.enabled !== false,
      },
    ];
  });
}

export function enumAt<T extends string>(
  value: Record<string, unknown>,
  path: string[],
  options: readonly T[],
  fallback: T,
) {
  const item = getAt(value, path);
  return typeof item === "string" && options.includes(item as T)
    ? (item as T)
    : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
