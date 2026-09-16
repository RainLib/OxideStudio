import { resolveInitialTransferTableSelection } from "@/features/database-explorer/model/tableTransferSelection";
import {
  buildTransferObjectInventory,
  transferObjectKey,
} from "@/features/table-transfer/model/transferPolicy";
import { schemaService } from "@/services/tauri";
import type {
  FunctionInfo,
  SchemaObjectInfo,
  TableDataTransferEndpoint,
  TableDataTransferObjectSelection,
} from "@/services/tauri/types";
import { ensureConnectionReady } from "@/store/useConnectionStore";
import { useEffect, useState } from "react";

interface TransferSourceInventoryOptions {
  open: boolean;
  sourceSupportsTransfer: boolean;
  source: TableDataTransferEndpoint;
  activeSourceSchema: string;
  setSourceTables: React.Dispatch<React.SetStateAction<string[]>>;
  setSourceTransferObjects: React.Dispatch<
    React.SetStateAction<TableDataTransferObjectSelection[]>
  >;
  setSelectedTransferObjectKeys: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  setSelectedSourceTables: React.Dispatch<React.SetStateAction<Set<string>>>;
  initialSourceScope: "table" | "schema" | "database";
  initialSourceTables: string[] | undefined;
}

export function useTransferSourceInventory({
  open,
  sourceSupportsTransfer,
  source,
  activeSourceSchema,
  setSourceTables,
  setSourceTransferObjects,
  setSelectedTransferObjectKeys,
  setSelectedSourceTables,
  initialSourceScope,
  initialSourceTables,
}: TransferSourceInventoryOptions) {
  const [isSourceObjectsLoading, setIsSourceObjectsLoading] = useState(false);

  useEffect(() => {
    if (!open || !sourceSupportsTransfer) return;
    let cancelled = false;
    setIsSourceObjectsLoading(true);
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(source.connectionId);
        if (readiness.status !== "ready" || cancelled) return;
        const relationRequest = source.database
          ? schemaService.getDatabaseTables(
              source.connectionId,
              source.database,
              activeSourceSchema,
            )
          : schemaService.getTables(source.connectionId, activeSourceSchema);
        const routineRequest =
          source.database &&
          typeof schemaService.getDatabaseFunctions === "function"
            ? schemaService
                .getDatabaseFunctions(
                  source.connectionId,
                  source.database,
                  activeSourceSchema,
                )
                .catch(() => [])
            : typeof schemaService.getFunctions === "function"
              ? schemaService
                  .getFunctions(source.connectionId, activeSourceSchema)
                  .catch(() => [])
              : Promise.resolve([] as FunctionInfo[]);
        const descriptorRequest =
          source.database &&
          typeof schemaService.getDatabaseSchemaObjects === "function"
            ? schemaService
                .getDatabaseSchemaObjects(
                  source.connectionId,
                  source.database,
                  activeSourceSchema,
                )
                .catch(() => [])
            : typeof schemaService.getSchemaObjects === "function"
              ? schemaService
                  .getSchemaObjects(source.connectionId, activeSourceSchema)
                  .catch(() => [])
              : Promise.resolve([] as SchemaObjectInfo[]);
        const [items, routines, descriptors] = await Promise.all([
          relationRequest,
          routineRequest,
          descriptorRequest,
        ]);
        if (cancelled) return;
        const names = items
          .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
          .map((item) => item.name)
          .sort((left, right) => left.localeCompare(right));
        const initialTable =
          activeSourceSchema === source.schema && names.includes(source.table)
            ? source.table
            : names[0];
        setSourceTables(names);
        const nextObjects = buildTransferObjectInventory(
          items,
          routines,
          descriptors,
        );
        setSourceTransferObjects(nextObjects);
        setSelectedTransferObjectKeys((current) => {
          const available = new Set(nextObjects.map(transferObjectKey));
          return new Set([...current].filter((key) => available.has(key)));
        });
        setSelectedSourceTables((current) => {
          return resolveInitialTransferTableSelection({
            availableTables: names,
            sourceTable: initialTable || source.table,
            sourceSchemaMatches: activeSourceSchema === source.schema,
            initialScope: initialSourceScope,
            requestedTables: initialSourceTables,
            currentSelection: current,
          });
        });
      } catch {
        // The active source remains usable for a single-table transfer even
        // when the optional multi-select inventory could not be refreshed.
        if (!cancelled && activeSourceSchema === source.schema) {
          setSourceTables([source.table]);
          setSelectedSourceTables(new Set([source.table]));
          setSourceTransferObjects([]);
          setSelectedTransferObjectKeys(new Set());
        }
      } finally {
        if (!cancelled) setIsSourceObjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSourceSchema,
    initialSourceScope,
    initialSourceTables,
    open,
    source,
    sourceSupportsTransfer,
  ]);

  return { isSourceObjectsLoading };
}
