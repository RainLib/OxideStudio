const origins = new WeakMap<HTMLElement, HTMLElement>();

export function registerPopupFocusOrigin(surface: HTMLElement | null, trigger: HTMLElement | null) {
  if (surface && trigger) origins.set(surface, trigger);
}

/** Menus often unmount before a queued confirmation closes. Keep their trigger. */
export function popupReturnFocus(element: HTMLElement | null): HTMLElement | null {
  for (let owner = element; owner; owner = owner.parentElement) {
    const origin = origins.get(owner);
    if (origin?.isConnected) return origin;
    if (owner.getAttribute("role") === "menu") {
      const trigger = document.getElementById(owner.getAttribute("aria-labelledby") ?? "");
      if (trigger instanceof HTMLElement) return trigger;
    }
  }
  return element;
}
