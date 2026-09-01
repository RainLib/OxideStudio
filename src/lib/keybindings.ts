export type KeybindingEventLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export type RefreshShortcutEventLike = KeybindingEventLike & {
  isComposing?: boolean;
};

export function normalizeKeybinding(binding: string) {
  const compact = binding
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    cmd: "mod",
    ctrl: "mod",
    control: "mod",
    option: "alt",
    return: "enter",
    esc: "escape",
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
  };
  return compact
    .split("+")
    .map((part) => aliases[part] || part)
    .join("+");
}

export function keybindingMatchesEvent(
  binding: string,
  event: KeybindingEventLike
) {
  const parts = normalizeKeybinding(binding).split("+").filter(Boolean);
  const key = parts[parts.length - 1];
  if (!key) return false;

  const wantsMod = parts.includes("mod");
  const wantsAlt = parts.includes("alt");
  const wantsShift = parts.includes("shift");
  const wantsCtrl = parts.includes("ctrl");
  const eventKey = normalizeEventKey(event.key);

  if (key !== eventKey) return false;
  if (wantsMod !== (event.metaKey || event.ctrlKey)) return false;
  if (wantsAlt !== event.altKey) return false;
  if (wantsShift !== event.shiftKey) return false;
  if (wantsCtrl && !event.ctrlKey) return false;

  return true;
}

/**
 * Match the Database Explorer's refresh gesture without stealing modified F5
 * combinations or text-composition input. `Mod` follows the host platform:
 * Command on Apple platforms and Ctrl (with Meta as a desktop fallback) on
 * Windows/Linux, matching the shared workbench keybinding behavior.
 */
export function isExplorerRefreshShortcut(
  event: RefreshShortcutEventLike,
  platform = globalThis.navigator?.platform || "",
) {
  if (event.isComposing || event.altKey || event.shiftKey) return false;

  if (event.key === "F5") {
    return !event.metaKey && !event.ctrlKey;
  }

  if (event.key.toLowerCase() !== "r") return false;
  const isApplePlatform = /Mac|iPhone|iPad|iPod/iu.test(platform);
  return isApplePlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey || event.metaKey;
}

export function formatKeybinding(binding: string) {
  return normalizeKeybinding(binding)
    .split("+")
    .map((part) => {
      if (part === "mod") return "⌘/Ctrl";
      if (part === "shift") return "⇧";
      if (part === "alt") return "⌥";
      if (part === "enter") return "Enter";
      if (part === "escape") return "Esc";
      if (part.startsWith("arrow")) return part.replace("arrow", "Arrow ");
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(" ");
}

export function keymapConflicts(keymap: Record<string, string[]>) {
  const byBinding = new Map<string, string[]>();
  Object.entries(keymap).forEach(([actionId, bindings]) => {
    bindings.forEach((binding) => {
      const normalized = normalizeKeybinding(binding);
      byBinding.set(normalized, [...(byBinding.get(normalized) ?? []), actionId]);
    });
  });

  return Array.from(byBinding.entries())
    .filter(([, actions]) => actions.length > 1)
    .map(([binding, actions]) => ({ binding, actions }));
}

function normalizeEventKey(key: string) {
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  return normalizeKeybinding(lower);
}
