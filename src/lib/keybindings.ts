export type KeybindingEventLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export function normalizeKeybinding(binding: string) {
  return binding
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/cmd|ctrl|control/g, "mod")
    .replace(/option/g, "alt")
    .replace(/return/g, "enter")
    .replace(/esc/g, "escape")
    .replace(/left/g, "arrowleft")
    .replace(/right/g, "arrowright")
    .replace(/up/g, "arrowup")
    .replace(/down/g, "arrowdown");
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
