interface CreateExplorerConnectionRemovalContext {
  pendingDataSourceRemoval: { id: string; name: string } | null;
  isRemovingDataSource: boolean;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setDataSourceRemovalError: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setIsRemovingDataSource: React.Dispatch<React.SetStateAction<boolean>>;
  removeConnection: (id: string) => Promise<void>;
  forgetConnectionMetadata: (connectionId: string) => Promise<void>;
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setPendingDataSourceRemoval: React.Dispatch<
    React.SetStateAction<{ id: string; name: string } | null>
  >;
}

export function createExplorerConnectionRemoval({
  pendingDataSourceRemoval,
  isRemovingDataSource,
  setNamespaceError,
  setDataSourceRemovalError,
  setIsRemovingDataSource,
  removeConnection,
  forgetConnectionMetadata,
  setExpandedConnectionIds,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
  setPendingDataSourceRemoval,
}: CreateExplorerConnectionRemovalContext) {
  const handleRemoveDataSource = async () => {
    if (!pendingDataSourceRemoval || isRemovingDataSource) return;
    const { id: connectionId } = pendingDataSourceRemoval;
    setNamespaceError(null);
    setDataSourceRemovalError(null);
    setIsRemovingDataSource(true);
    try {
      await removeConnection(connectionId);
      try {
        await forgetConnectionMetadata(connectionId);
      } catch (error) {
        console.warn("Failed to clear removed data source metadata:", error);
      }
      setExpandedConnectionIds((ids) =>
        ids.filter((id) => id !== connectionId),
      );
      setExpandedSchemaKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`)),
      );
      setExpandedObjectGroupKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`)),
      );
      setPendingDataSourceRemoval(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamespaceError(message);
      setDataSourceRemovalError(message);
    } finally {
      setIsRemovingDataSource(false);
    }
  };

  return { handleRemoveDataSource };
}
