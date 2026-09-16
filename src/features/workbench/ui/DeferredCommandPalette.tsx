import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actionEvents";
import { lazy, Suspense, useEffect, useState } from "react";

const CommandPalette = lazy(() =>
  import("@/components/workspace/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);

export function DeferredCommandPalette() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const requestMount = () => setMounted(true);
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, requestMount);
    window.addEventListener("oxide:command-palette-open", requestMount);
    return () => {
      window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, requestMount);
      window.removeEventListener("oxide:command-palette-open", requestMount);
    };
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette initiallyOpen />
    </Suspense>
  );
}
