import { useEffect } from "react";

interface UseExplorerActiveConnectionRevealContext {
  activeConnectionId: string | null;
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  explorerConnectionGroupIds: Record<string, string>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useExplorerActiveConnectionReveal({
  activeConnectionId,
  setExpandedConnectionIds,
  explorerConnectionGroupIds,
  setExpandedObjectGroupKeys,
}: UseExplorerActiveConnectionRevealContext) {
  // Programmatic activation (startup cache, Search Everywhere, AI navigation)
  // should expose the same tree state as a direct row click. Paint cached
  // metadata immediately while the remote session is still connecting.
  useEffect(() => {
    if (!activeConnectionId) return;
    setExpandedConnectionIds((current) =>
      current.includes(activeConnectionId)
        ? current
        : [...current, activeConnectionId],
    );
    const groupId = explorerConnectionGroupIds[activeConnectionId];
    if (groupId) {
      setExpandedObjectGroupKeys((current) =>
        current.includes(groupId) ? current : [...current, groupId],
      );
    }
  }, [
    activeConnectionId,
    explorerConnectionGroupIds,
    setExpandedConnectionIds,
    setExpandedObjectGroupKeys,
  ]);
}
