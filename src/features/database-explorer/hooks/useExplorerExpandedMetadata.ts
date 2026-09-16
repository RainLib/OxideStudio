import { schemaService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  SchemaObjectInfo,
} from "@/services/tauri/types";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useEffect, useState } from "react";

interface UseExplorerExpandedMetadataContext {
  shouldAutoIntrospect: boolean;
  isActiveConnectionReady: boolean;
  isLoading: boolean;
  activeConnectionId: string | null;
  currentSchema: string | null;
  isActiveNamespaceExpanded: boolean;
  canBrowseTables: boolean;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  activeCapabilities: DatabaseCapabilities;
  activeDriver: DatabaseDriver;
  hydrateSchemaObjectsFromCache: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  canBrowseCollections: boolean;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  collectionNamespace: string;
  explorerRegexSearch: boolean;
  filterText: string;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
}

export function useExplorerExpandedMetadata({
  shouldAutoIntrospect,
  isActiveConnectionReady,
  isLoading,
  activeConnectionId,
  currentSchema,
  isActiveNamespaceExpanded,
  canBrowseTables,
  loadTables,
  activeCapabilities,
  activeDriver,
  hydrateSchemaObjectsFromCache,
  canBrowseCollections,
  loadCollections,
  collectionNamespace,
  explorerRegexSearch,
  filterText,
  loadFunctions,
}: UseExplorerExpandedMetadataContext) {
  const [schemaObjectDescriptors, setSchemaObjectDescriptors] = useState<
    SchemaObjectInfo[]
  >([]);
  const [schemaObjectDescriptorScope, setSchemaObjectDescriptorScope] =
    useState<string | null>(null);
  const [
    isSchemaObjectDescriptorsLoading,
    setIsSchemaObjectDescriptorsLoading,
  ] = useState(false);

  useEffect(() => {
    if (
      shouldAutoIntrospect &&
      isActiveConnectionReady &&
      !isLoading &&
      activeConnectionId &&
      currentSchema &&
      isActiveNamespaceExpanded &&
      canBrowseTables
    ) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseTables,
    currentSchema,
    isActiveNamespaceExpanded,
    isActiveConnectionReady,
    isLoading,
    loadTables,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    // Descriptor objects are supplementary metadata. Built-in drivers that do
    // not expose them and older external sidecars both return an empty list,
    // while a newly capable package (for example Xugu types) can appear here
    // without adding another driver-name branch to the Explorer.
    const supportsDescriptors = activeCapabilities.dataModel === "relational";
    if (
      !shouldAutoIntrospect ||
      !isActiveConnectionReady ||
      !activeConnectionId ||
      !currentSchema ||
      !isActiveNamespaceExpanded ||
      !supportsDescriptors
    ) {
      setSchemaObjectDescriptors([]);
      setSchemaObjectDescriptorScope(null);
      setIsSchemaObjectDescriptorsLoading(false);
      return;
    }
    let cancelled = false;
    setIsSchemaObjectDescriptorsLoading(true);
    void schemaService
      .getSchemaObjects(activeConnectionId, currentSchema)
      .then((objects) => {
        if (!cancelled) {
          setSchemaObjectDescriptors(objects);
          setSchemaObjectDescriptorScope(
            `${activeConnectionId}:${currentSchema}`,
          );
        }
      })
      .catch(() => {
        // Object descriptors are supplementary metadata. A failure must not
        // hide relation metadata or promote an unsupported product to an
        // erroring Explorer state.
        if (!cancelled) {
          setSchemaObjectDescriptors([]);
          setSchemaObjectDescriptorScope(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSchemaObjectDescriptorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConnectionId,
    activeDriver,
    currentSchema,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      (shouldAutoIntrospect && isActiveConnectionReady) ||
      activeCapabilities.dataModel === "keyValue" ||
      !activeConnectionId ||
      !currentSchema ||
      !isActiveNamespaceExpanded
    )
      return;
    void hydrateSchemaObjectsFromCache(activeConnectionId, currentSchema);
  }, [
    activeConnectionId,
    activeCapabilities.dataModel,
    currentSchema,
    hydrateSchemaObjectsFromCache,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      shouldAutoIntrospect &&
      isActiveConnectionReady &&
      !isLoading &&
      activeConnectionId &&
      isActiveNamespaceExpanded &&
      canBrowseCollections &&
      activeCapabilities.dataModel !== "keyValue"
    ) {
      // Show the cached collection snapshot immediately, then refresh it in
      // the background so a previously empty MongoDB cache cannot become
      // permanently stale until the user clicks Refresh.
      void loadCollections(
        activeConnectionId,
        collectionNamespace,
        false,
        "",
        true,
      );
    }
  }, [
    activeConnectionId,
    activeCapabilities.dataModel,
    canBrowseCollections,
    collectionNamespace,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    isLoading,
    loadCollections,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      activeCapabilities.dataModel !== "keyValue" ||
      explorerRegexSearch ||
      !isActiveConnectionReady ||
      isLoading ||
      !activeConnectionId ||
      !isActiveNamespaceExpanded
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadCollections(
        activeConnectionId,
        collectionNamespace,
        true,
        filterText,
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    activeCapabilities.dataModel,
    activeConnectionId,
    collectionNamespace,
    explorerRegexSearch,
    filterText,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    isLoading,
    loadCollections,
  ]);

  useEffect(() => {
    if (
      activeConnectionId &&
      isActiveConnectionReady &&
      currentSchema &&
      isActiveNamespaceExpanded &&
      canBrowseTables &&
      activeCapabilities.supportsFunctions
    ) {
      loadFunctions(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseTables,
    currentSchema,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    activeCapabilities.supportsFunctions,
    loadFunctions,
  ]);

  return {
    setIsSchemaObjectDescriptorsLoading,
    setSchemaObjectDescriptors,
    setSchemaObjectDescriptorScope,
    schemaObjectDescriptors,
    schemaObjectDescriptorScope,
    isSchemaObjectDescriptorsLoading,
  };
}
