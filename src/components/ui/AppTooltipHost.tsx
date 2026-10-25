import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { popupVariants } from "@/styles/variants/popup";
import { cn } from "@/lib/utils";
import { PopupPresence } from "./PopupPresence";

type Hint = { text: string; bounds: DOMRect };

/** Also themes legacy title attributes, including elements mounted in portals. */
export function AppTooltipHost() {
  const id = useId();
  const [hint, setHint] = useState<Hint | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active: HTMLElement | null = null;
    let originalTitle = "";
    let addedLabel = false;
    let description: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;
    let focused = false;
    let dismissed = false;
    let observer: MutationObserver | undefined;
    const hide = () => {
      clearTimeout(timer); observer?.disconnect();
      if (active) {
        if (!active.hasAttribute("title")) active.setAttribute("title", originalTitle);
        active.removeAttribute("data-wb-title");
        if (addedLabel && active.getAttribute("aria-label") === originalTitle) active.removeAttribute("aria-label");
        const remaining = active.getAttribute("aria-describedby")?.split(/\s+/).filter((item) => item && item !== id).join(" ");
        if (remaining) active.setAttribute("aria-describedby", remaining);
        else active.removeAttribute("aria-describedby");
      }
      active = null; hovered = false; focused = false; dismissed = false;
      setHint(null);
    };
    const reveal = () => {
      if (dismissed) return;
      if (!active?.isConnected) { hide(); return; }
      active.setAttribute("aria-describedby", [description, id].filter(Boolean).join(" "));
      setHint({ text: originalTitle, bounds: active.getBoundingClientRect() });
    };
    const begin = (event: Event, keyboard: boolean) => {
      const target = event.target instanceof Element ? event.target : null;
      const element = target?.closest<HTMLElement>("[title], [data-wb-title]");
      if (!element || element.closest("[data-wb-tooltip-trigger], [role=tooltip]")) return;
      if (active === element) {
        if (keyboard) { focused = true; clearTimeout(timer); reveal(); }
        else hovered = true;
        return;
      }
      hide();
      const title = element.getAttribute("title")?.trim();
      if (!title) return;
      active = element; originalTitle = title;
      hovered = !keyboard; focused = keyboard;
      description = element.getAttribute("aria-describedby");
      addedLabel = !element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby") && !element.textContent?.trim();
      if (addedLabel) element.setAttribute("aria-label", title);
      element.setAttribute("data-wb-title", "");
      element.removeAttribute("title");
      observer = new MutationObserver(() => {
        const updated = element.getAttribute("title");
        if (updated === null) return;
        originalTitle = updated;
        element.removeAttribute("title");
        if (addedLabel) element.setAttribute("aria-label", updated);
        reveal();
      });
      observer.observe(element, { attributes: true, attributeFilter: ["title"] });
      timer = setTimeout(reveal, keyboard ? 0 : 350);
    };
    const over = (event: Event) => begin(event, false);
    const focus = (event: Event) => begin(event, true);
    const out = (event: PointerEvent) => {
      if (active?.contains(event.relatedTarget as Node | null)) return;
      hovered = false;
      if (!focused) hide();
    };
    const blur = (event: FocusEvent) => {
      if (active?.contains(event.relatedTarget as Node | null)) return;
      focused = false;
      if (!hovered) hide();
    };
    const dismiss = () => { clearTimeout(timer); dismissed = true; setHint(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [id]);
  useLayoutEffect(() => {
    if (!hint || !surface.current) return;
    const bounds = surface.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(hint.bounds.left + hint.bounds.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, hint.bounds.bottom + bounds.height + 8 > window.innerHeight ? hint.bounds.top - bounds.height - 8 : hint.bounds.bottom + 8),
    });
  }, [hint]);
  return createPortal(<PopupPresence open={Boolean(hint)}>
    <div ref={surface} id={id} role="tooltip" className={cn(popupVariants({ kind: "tooltip" }), "pointer-events-none fixed z-[100] max-w-[min(320px,calc(100vw-16px))] whitespace-pre-wrap break-words px-2.5 py-1.5 text-xs")} style={position}>{hint?.text}</div>
  </PopupPresence>, document.body);
}
