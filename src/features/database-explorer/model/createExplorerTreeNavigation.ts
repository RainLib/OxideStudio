interface CreateExplorerTreeNavigationContext {
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  activeConnectionId: string | null;
  hydrateConnectionMetadataFromCache: (
    connectionId: string,
  ) => Promise<boolean>;
  explorerConnectionGroupIds: Record<string, string>;
}

export function createExplorerTreeNavigation({
  setExpandedConnectionIds,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
  activeConnectionId,
  hydrateConnectionMetadataFromCache,
  explorerConnectionGroupIds,
}: CreateExplorerTreeNavigationContext) {
  const handleCollapseAll = () => {
    setExpandedConnectionIds([]);
    setExpandedSchemaKeys([]);
    setExpandedObjectGroupKeys([]);
  };

  const handleExpandActiveConnection = () => {
    if (!activeConnectionId) return;
    void hydrateConnectionMetadataFromCache(activeConnectionId);
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
  };

  const handleRevealActiveConnection = () => {
    handleExpandActiveConnection();
    window.requestAnimationFrame(() => {
      document
        .getElementById(`database-connection-${activeConnectionId}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  return {
    handleCollapseAll,
    handleExpandActiveConnection,
    handleRevealActiveConnection,
  };
}
