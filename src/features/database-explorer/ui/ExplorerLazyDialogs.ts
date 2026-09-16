import { lazy } from "react";

export const DataSourceDialog = lazy(() =>
  import("@/components/workspace/DataSourceDialog").then((module) => ({
    default: module.DataSourceDialog,
  })),
);

export const SchemaSnapshotDialog = lazy(() =>
  import("@/components/workspace/SchemaSnapshotDialog").then((module) => ({
    default: module.SchemaSnapshotDialog,
  })),
);

export const CreateDatabaseDialog = lazy(() =>
  import("@/components/workspace/CreateDatabaseDialog").then((module) => ({
    default: module.CreateDatabaseDialog,
  })),
);

export const RenameTableDialog = lazy(() =>
  import("@/components/workspace/RenameTableDialog").then((module) => ({
    default: module.RenameTableDialog,
  })),
);

export const DdlViewerDialog = lazy(() =>
  import("@/components/workspace/DdlViewerDialog").then((module) => ({
    default: module.DdlViewerDialog,
  })),
);

export const EditColumnsDialog = lazy(() =>
  import("@/components/workspace/EditColumnsDialog").then((module) => ({
    default: module.EditColumnsDialog,
  })),
);

export const CreateViewDialog = lazy(() =>
  import("@/components/workspace/CreateViewDialog").then((module) => ({
    default: module.CreateViewDialog,
  })),
);

export const RedisKeyDialog = lazy(() =>
  import("@/components/workspace/RedisKeyDialog").then((module) => ({
    default: module.RedisKeyDialog,
  })),
);

export const DatabaseAdministrationDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.DatabaseAdministrationDialog,
  })),
);

export const ElasticsearchIndexMetadataDialog = lazy(() =>
  import(
    "@/features/database-explorer/ui/ElasticsearchIndexMetadataDialog"
  ).then((module) => ({
    default: module.ElasticsearchIndexMetadataDialog,
  })),
);

export const ElasticsearchIndexClearDialog = lazy(() =>
  import("@/features/database-explorer/ui/ElasticsearchIndexClearDialog").then(
    (module) => ({
      default: module.ElasticsearchIndexClearDialog,
    }),
  ),
);

export const DatabaseMaintenanceDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.DatabaseMaintenanceDialog,
  })),
);

export const SqliteBackupDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.SqliteBackupDialog,
  })),
);

export const TableDataTransferDialog = lazy(() =>
  import("@/components/workspace/TableDataTransferDialog").then((module) => ({
    default: module.TableDataTransferDialog,
  })),
);

export const MongoCollectionTransferDialog = lazy(() =>
  import("@/components/workspace/MongoCollectionTransferDialog").then(
    (module) => ({
      default: module.MongoCollectionTransferDialog,
    }),
  ),
);

export const TableDataCompareDialog = lazy(() =>
  import("@/components/workspace/TableDataCompareDialog").then((module) => ({
    default: module.TableDataCompareDialog,
  })),
);

export const NacosConfigTransferDialog = lazy(() =>
  import("@/components/workspace/NacosConfigTransferDialog").then((module) => ({
    default: module.NacosConfigTransferDialog,
  })),
);
