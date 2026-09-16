import {
  DataSourceDialog,
  ElasticsearchIndexClearDialog,
  ElasticsearchIndexMetadataDialog,
  MongoCollectionTransferDialog,
  NacosConfigTransferDialog,
  SchemaSnapshotDialog,
  TableDataCompareDialog,
  TableDataTransferDialog,
} from "@/features/database-explorer/ui/ExplorerLazyDialogs";
import { Suspense } from "react";

interface ExplorerTransferDialogsContext {
  isDataSourceDialogOpen: boolean;
  setIsDataSourceDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  schemaSnapshotIdentity:
    | import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity
    | null;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  dataTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataTransferRequest
    | null;
  activeProjectId: string;
  connections: ReturnType<
    typeof import("@/store/useConnectionStore").useConnectionStore.getState
  >["connections"];
  setDataTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataTransferRequest
      | null
    >
  >;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  mongoCollectionTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerMongoCollectionTransferRequest
    | null;
  setMongoCollectionTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerMongoCollectionTransferRequest
      | null
    >
  >;
  activeConnectionId: ReturnType<
    typeof import("@/store/useConnectionStore").useConnectionStore.getState
  >["activeConnectionId"];
  refreshCollectionObjects: () => Promise<void>;
  dataCompareRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataCompareRequest
    | null;
  setDataCompareRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataCompareRequest
      | null
    >
  >;
  nacosConfigTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerNacosConfigTransferRequest
    | null;
  setNacosConfigTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerNacosConfigTransferRequest
      | null
    >
  >;
  elasticsearchMetadataTarget: {
    connectionId: string;
    driver: string;
    index: string;
    kind: import("@/services/tauri/types").SearchIndexMetadataKind;
  } | null;
  setElasticsearchMetadataTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      index: string;
      kind: import("@/services/tauri/types").SearchIndexMetadataKind;
    } | null>
  >;
  elasticsearchClearTarget: {
    connectionId: string;
    driver: string;
    schema: string;
    index: string;
  } | null;
  setElasticsearchClearTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      schema: string;
      index: string;
    } | null>
  >;
  handleElasticsearchIndexCleared: (
    _result: import("@/services/tauri/types").SearchIndexClearResult,
    clearedIndex: string,
  ) => Promise<void>;
}

export function ExplorerTransferDialogs({
  isDataSourceDialogOpen,
  setIsDataSourceDialogOpen,
  schemaSnapshotIdentity,
  setSchemaSnapshotIdentity,
  dataTransferRequest,
  activeProjectId,
  connections,
  setDataTransferRequest,
  handleRefreshSchema,
  mongoCollectionTransferRequest,
  setMongoCollectionTransferRequest,
  activeConnectionId,
  refreshCollectionObjects,
  dataCompareRequest,
  setDataCompareRequest,
  nacosConfigTransferRequest,
  setNacosConfigTransferRequest,
  elasticsearchMetadataTarget,
  setElasticsearchMetadataTarget,
  elasticsearchClearTarget,
  setElasticsearchClearTarget,
  handleElasticsearchIndexCleared,
}: ExplorerTransferDialogsContext) {
  return (
    <Suspense fallback={null}>
      {isDataSourceDialogOpen && (
        <DataSourceDialog open onOpenChange={setIsDataSourceDialogOpen} />
      )}
      {schemaSnapshotIdentity !== null && (
        <SchemaSnapshotDialog
          open
          identity={schemaSnapshotIdentity}
          onClose={() => setSchemaSnapshotIdentity(null)}
        />
      )}
      {dataTransferRequest !== null && (
        <TableDataTransferDialog
          open
          projectId={activeProjectId}
          source={dataTransferRequest.source}
          initialSourceScope={dataTransferRequest.initialSourceScope}
          initialSourceTables={dataTransferRequest.initialSourceTables}
          initialTarget={dataTransferRequest.initialTarget}
          sourceSchemas={dataTransferRequest.sourceSchemas}
          sourceCapabilities={dataTransferRequest.sourceCapabilities}
          connections={connections}
          onClose={() => setDataTransferRequest(null)}
          onTransferred={() => {
            const { connectionId, schema } = dataTransferRequest.source;
            void handleRefreshSchema(connectionId, schema);
          }}
        />
      )}
      {mongoCollectionTransferRequest !== null && (
        <MongoCollectionTransferDialog
          open
          sourceConnectionId={mongoCollectionTransferRequest.sourceConnectionId}
          sourceConnectionName={
            mongoCollectionTransferRequest.sourceConnectionName
          }
          sourceDatabase={mongoCollectionTransferRequest.sourceDatabase}
          sourceCollection={mongoCollectionTransferRequest.sourceCollection}
          connections={connections}
          onClose={() => setMongoCollectionTransferRequest(null)}
          onTransferred={(targetConnectionId) => {
            if (targetConnectionId === activeConnectionId) {
              void refreshCollectionObjects();
            }
          }}
        />
      )}
      {dataCompareRequest !== null && (
        <TableDataCompareDialog
          open
          source={dataCompareRequest.source}
          sourceTables={dataCompareRequest.sourceTables}
          connections={connections}
          onClose={() => setDataCompareRequest(null)}
          onTransferMissing={(tables, target) => {
            setDataTransferRequest({
              source: dataCompareRequest.source,
              sourceCapabilities: dataCompareRequest.sourceCapabilities,
              initialSourceScope: tables.length > 1 ? "schema" : "table",
              sourceSchemas: [dataCompareRequest.source.schema],
              initialSourceTables: tables,
              initialTarget: target,
            });
            setDataCompareRequest(null);
          }}
        />
      )}
      {nacosConfigTransferRequest !== null && (
        <NacosConfigTransferDialog
          open
          sourceConnectionId={nacosConfigTransferRequest.sourceConnectionId}
          sourceConnectionName={nacosConfigTransferRequest.sourceConnectionName}
          source={nacosConfigTransferRequest.source}
          connections={connections}
          onClose={() => setNacosConfigTransferRequest(null)}
          onTransferred={(targetConnectionId) => {
            if (targetConnectionId === activeConnectionId) {
              void refreshCollectionObjects();
            }
          }}
        />
      )}
      {elasticsearchMetadataTarget !== null && (
        <ElasticsearchIndexMetadataDialog
          open
          connectionId={elasticsearchMetadataTarget.connectionId}
          driver={elasticsearchMetadataTarget.driver}
          index={elasticsearchMetadataTarget.index}
          initialKind={elasticsearchMetadataTarget.kind}
          onClose={() => setElasticsearchMetadataTarget(null)}
        />
      )}
      {elasticsearchClearTarget !== null && (
        <ElasticsearchIndexClearDialog
          open
          connectionId={elasticsearchClearTarget.connectionId}
          driver={elasticsearchClearTarget.driver}
          index={elasticsearchClearTarget.index}
          onClose={() => setElasticsearchClearTarget(null)}
          onCleared={(result, index) =>
            void handleElasticsearchIndexCleared(result, index)
          }
        />
      )}
    </Suspense>
  );
}
