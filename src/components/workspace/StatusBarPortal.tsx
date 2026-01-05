import { createPortal } from "react-dom";
import { ReactNode, useEffect, useState } from "react";

interface StatusBarPortalProps {
  children: ReactNode;
}

/**
 * Renders children into the main status bar slot (right side) at the bottom of the workspace.
 * Use this component in tab components to inject their status bar content.
 */
export function StatusBarPortal({ children }: StatusBarPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const slot = document.getElementById("status-bar-slot");
  if (!slot) return null;

  return createPortal(children, slot);
}

/**
 * Renders children into the left status bar slot at the bottom of the workspace.
 * Use this for sidebar/connection status info.
 */
export function StatusBarLeftPortal({ children }: StatusBarPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const slot = document.getElementById("status-bar-left");
  if (!slot) return null;

  return createPortal(children, slot);
}
