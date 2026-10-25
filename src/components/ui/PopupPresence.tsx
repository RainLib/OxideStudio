import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

/** Retains the last open content for the same exit timing as Radix popups. */
export function PopupPresence({ open, children, exitMs = 80 }: {
  open: boolean;
  children: ReactElement<{ "data-state"?: "open" | "closed" }>;
  exitMs?: number;
}) {
  const [present, setPresent] = useState(open);
  const previous = useRef(children);
  useLayoutEffect(() => { if (open) previous.current = children; }, [children, open]);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const reduced = document.documentElement.dataset.reduceMotion === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPresent(false), reduced ? 0 : exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  if (!open && !present) return null;
  return cloneElement(open ? children : previous.current, { "data-state": open ? "open" : "closed" });
}
