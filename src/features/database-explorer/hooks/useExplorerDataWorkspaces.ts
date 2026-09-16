import type { ConnectionConfig } from "@/features/connections/model/types";
import { createExplorerDataCompareAction } from "@/features/database-explorer/model/createExplorerDataCompareAction";
import { createExplorerDataTransferAction } from "@/features/database-explorer/model/createExplorerDataTransferAction";
import { createExplorerSchemaDiagramAction } from "@/features/database-explorer/model/createExplorerSchemaDiagramAction";
import {
  type ExplorerDataCompareRequest,
  type ExplorerDataTransferRequest,
  type ExplorerMongoCollectionTransferRequest,
  type ExplorerNacosConfigTransferRequest,
} from "@/features/database-explorer/model/explorerSidebarTypes";
import { type SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { useState } from "react";
interface UseExplorerDataWorkspacesContext {
  connections: ConnectionConfig[];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveConnection: (id: string) => Promise<string | null>;
  currentSchema: string | null;
  openSchemaDiagramTab: (snapshot: SchemaSnapshot) => string;
}
export function useExplorerDataWorkspaces({
  connections,
  setNamespaceError,
  setActiveConnection,
  currentSchema,
  openSchemaDiagramTab,
}: UseExplorerDataWorkspacesContext) {
  const [schemaSnapshotIdentity, setSchemaSnapshotIdentity] =
    useState<SchemaSnapshotIdentity | null>(null);

  const [schemaDiagramLoadingKey, setSchemaDiagramLoadingKey] = useState<
    string | null
  >(null);

  const [dataTransferRequest, setDataTransferRequest] =
    useState<ExplorerDataTransferRequest | null>(null);

  const [mongoCollectionTransferRequest, setMongoCollectionTransferRequest] =
    useState<ExplorerMongoCollectionTransferRequest | null>(null);

  const [dataCompareRequest, setDataCompareRequest] =
    useState<ExplorerDataCompareRequest | null>(null);

  const [nacosConfigTransferRequest, setNacosConfigTransferRequest] =
    useState<ExplorerNacosConfigTransferRequest | null>(null);

  const { handleOpenDataTransfer } = createExplorerDataTransferAction({
    connections,
    setNamespaceError,
    setActiveConnection,
    currentSchema,
    setDataTransferRequest,
  });

  const { handleOpenSchemaDiagram } = createExplorerSchemaDiagramAction({
    schemaDiagramLoadingKey,
    setSchemaDiagramLoadingKey,
    setNamespaceError,
    setActiveConnection,
    openSchemaDiagramTab,
  });

  const { handleOpenDataCompare } = createExplorerDataCompareAction({
    connections,
    setNamespaceError,
    setActiveConnection,
    currentSchema,
    setDataCompareRequest,
  });
  return {
    schemaSnapshotIdentity,
    setSchemaSnapshotIdentity,
    schemaDiagramLoadingKey,
    dataTransferRequest,
    setDataTransferRequest,
    mongoCollectionTransferRequest,
    setMongoCollectionTransferRequest,
    dataCompareRequest,
    setDataCompareRequest,
    nacosConfigTransferRequest,
    setNacosConfigTransferRequest,
    handleOpenDataTransfer,
    handleOpenSchemaDiagram,
    handleOpenDataCompare,
  };
}
