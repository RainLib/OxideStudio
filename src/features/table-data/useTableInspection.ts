import { useCallback, useEffect } from "react";
import { useScopedAsyncResource } from "@/hooks/useScopedAsyncResource";
import { ensureConnectionReady } from "@/store/useConnectionStore";
import { schemaService } from "@/services/tauri";
import { loadTableDdl, loadTableMetadata, type TableMetadataIdentity, type TableMetadataSnapshot } from "@/services/tableMetadataCache";
import type { ForeignKeyReferenceInfo } from "@/services/tauri/types";

interface InspectionOptions {
  identity: TableMetadataIdentity | null;
  tabId?: string;
  objectType?: string;
  includeIndexes: boolean;
  includeConstraints: boolean;
  includeForeignKeys: boolean;
  onMetadata: (tabId: string, metadata: TableMetadataSnapshot) => void;
}

/** Table inspection owns loading and identity; the view owns dialogs and mutations. */
export function useTableInspection(options: InspectionOptions) {
  const key = options.identity && JSON.stringify({ ...options, onMetadata: undefined });
  const metadata = useScopedAsyncResource<TableMetadataSnapshot>(key);
  const foreignKeys = useScopedAsyncResource<ForeignKeyReferenceInfo[]>(key);
  const ddl = useScopedAsyncResource<string>(key);
  const { run: runMetadata } = metadata;
  const { run: runForeignKeys } = foreignKeys;
  const { run: runDdl } = ddl;
  const onMetadata = options.onMetadata;

  const refreshStructure = useCallback(async (force = false) => {
    if (!key) return;
    const scope = JSON.parse(key) as Omit<InspectionOptions, "onMetadata">;
    const identity = scope.identity!;
    const ready = async () => {
      const result = await ensureConnectionReady(identity.connectionId);
      if (result.status === "error") throw new Error(result.message);
      return result.status !== "cancelled";
    };
    // Optional reverse references must not delay usable columns/indexes.
    const readiness = ready();
    await Promise.all([
      runMetadata(async () => await readiness ? loadTableMetadata({
        ...identity, includeIndexes: scope.includeIndexes,
        includeConstraints: scope.includeConstraints, force,
      }) : null, (snapshot) => {
        if (scope.tabId) onMetadata(scope.tabId, snapshot);
      }),
      runForeignKeys(async () => {
        if (!scope.includeForeignKeys || !await readiness) return [];
        return identity.databaseName
          ? schemaService.getDatabaseReferencingForeignKeys(identity.connectionId,
            identity.databaseName, identity.schema, identity.table)
          : schemaService.getReferencingForeignKeys(identity.connectionId, identity.schema, identity.table);
      }),
    ]);
  }, [key, onMetadata, runForeignKeys, runMetadata]);

  const refreshDdl = useCallback(async (force = false) => {
    if (!key) return;
    const scope = JSON.parse(key) as Omit<InspectionOptions, "onMetadata">;
    await runDdl(() => loadTableDdl(scope.identity!, scope.objectType, force));
  }, [key, runDdl]);

  useEffect(() => { void refreshStructure(); }, [refreshStructure]);

  return {
    metadata: metadata.state.value,
    metadataError: metadata.state.error,
    isMetadataLoading: metadata.state.phase === "loading",
    referencingForeignKeys: foreignKeys.state.value ?? [],
    referencesError: foreignKeys.state.error,
    tableDdl: ddl.state.value ?? metadata.state.value?.ddl ?? "",
    ddlError: ddl.state.error,
    isDdlLoading: ddl.state.phase === "loading",
    refreshStructure,
    refreshDdl,
  };
}
