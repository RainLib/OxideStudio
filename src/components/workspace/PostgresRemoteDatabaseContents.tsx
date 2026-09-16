import { useRemoteCatalogLoading } from "@/features/database-explorer/hooks/useRemoteCatalogLoading";
import { useRemoteCatalogReveal } from "@/features/database-explorer/hooks/useRemoteCatalogReveal";
import { useRemoteCatalogTreeState } from "@/features/database-explorer/hooks/useRemoteCatalogTreeState";
import { type PostgresRemoteDatabaseContentsProps } from "@/features/database-explorer/model/remoteCatalogTypes";
import { RemoteCatalogSchemas } from "@/features/database-explorer/ui/RemoteCatalogSchemas";

export function PostgresRemoteDatabaseContents({
  explorerScopeId,
  connectionId,
  driver = "postgres",
  database,
  schemas,
  refreshRequest,
  filterText = "",
  matchesFilter,
  activationMode = "single",
  onTablesLoaded,
  onOpenSchemaSnapshots,
  onOpenSchemaObjects,
  renderQueryContextMenu,
  onOpenSchemaDataTransfer,
  onOpenSchemaDataCompare,
  onOpenTableSchemaSnapshots,
  onOpenTableDataTransfer,
  onOpenTableDataCompare,
  onOpenTableMaintenance,
  onImportSqlScript,
  includeIndexes = true,
  includeConstraints = true,
  onOpenTable,
}: PostgresRemoteDatabaseContentsProps) {
  const {
    expandedSchemas,
    setExpandedSchemas,
    expandedGroups,
    setExpandedGroups,
    expandedTables,
    setExpandedTables,
    expandedObjectKeys,
    setExpandedObjectKeys,
    selectedNodeIds,
    explorerTreeRowHeight,
    selectNode,
  } = useRemoteCatalogTreeState({
    explorerScopeId,
    connectionId,
    database,
  });

  const {
    objectMemberLoads,
    schemaLoads,
    loadTables,
    toggleSchema,
    toggleGroup,
    toggleTable,
    toggleObjectMembers,
  } = useRemoteCatalogLoading({
    connectionId,
    database,
    onTablesLoaded,
    expandedSchemas,
    setExpandedSchemas,
    setExpandedGroups,
    setExpandedTables,
    expandedObjectKeys,
    setExpandedObjectKeys,
  });

  useRemoteCatalogReveal({
    refreshRequest,
    expandedSchemas,
    schemas,
    loadTables,
    connectionId,
    database,
    setExpandedSchemas,
    schemaLoads,
  });

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const visibleSchemas = normalizedFilter
    ? schemas.filter(
        (schema) =>
          (matchesFilter
            ? matchesFilter(schema)
            : schema.toLocaleLowerCase().includes(normalizedFilter)) ||
          schemaLoads[schema]?.tables.some((table) =>
            matchesFilter
              ? matchesFilter(table.name, table.comment)
              : table.name.toLocaleLowerCase().includes(normalizedFilter),
          ),
      )
    : schemas;

  if (schemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas found
      </div>
    );
  }

  if (visibleSchemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas match “{filterText.trim()}”
      </div>
    );
  }

  return (
    <RemoteCatalogSchemas
      database={database}
      visibleSchemas={visibleSchemas}
      expandedSchemas={expandedSchemas}
      connectionId={connectionId}
      selectedNodeIds={selectedNodeIds}
      schemaLoads={schemaLoads}
      matchesFilter={matchesFilter}
      normalizedFilter={normalizedFilter}
      expandedTables={expandedTables}
      selectNode={selectNode}
      toggleTable={toggleTable}
      activationMode={activationMode}
      onOpenTable={onOpenTable}
      renderQueryContextMenu={renderQueryContextMenu}
      onOpenTableSchemaSnapshots={onOpenTableSchemaSnapshots}
      onOpenTableDataTransfer={onOpenTableDataTransfer}
      onOpenTableDataCompare={onOpenTableDataCompare}
      onOpenTableMaintenance={onOpenTableMaintenance}
      onImportSqlScript={onImportSqlScript}
      driver={driver}
      includeIndexes={includeIndexes}
      includeConstraints={includeConstraints}
      expandedObjectKeys={expandedObjectKeys}
      objectMemberLoads={objectMemberLoads}
      toggleObjectMembers={toggleObjectMembers}
      toggleSchema={toggleSchema}
      onOpenSchemaObjects={onOpenSchemaObjects}
      onOpenSchemaSnapshots={onOpenSchemaSnapshots}
      onOpenSchemaDataTransfer={onOpenSchemaDataTransfer}
      onOpenSchemaDataCompare={onOpenSchemaDataCompare}
      loadTables={loadTables}
      expandedGroups={expandedGroups}
      toggleGroup={toggleGroup}
      explorerTreeRowHeight={explorerTreeRowHeight}
    />
  );
}
