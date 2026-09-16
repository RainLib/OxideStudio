import { lazy } from "react";

export const DataGrid = lazy(() =>
  import("@/components/workspace/DataGrid").then((module) => ({
    default: module.DataGrid,
  })),
);

export const LeftPanel = lazy(() =>
  import("@/components/workspace/LeftPanel").then((module) => ({
    default: module.LeftPanel,
  })),
);

export const QueryEditor = lazy(() =>
  import("@/components/workspace/QueryEditor").then((module) => ({
    default: module.QueryEditor,
  })),
);

export const SplitEditor = lazy(() =>
  import("@/components/workspace/SplitEditor").then((module) => ({
    default: module.SplitEditor,
  })),
);

export const TableDataView = lazy(() =>
  import("@/components/workspace/TableDataView").then((module) => ({
    default: module.TableDataView,
  })),
);

export const CreateTableTab = lazy(() =>
  import("@/components/workspace/CreateTableTab").then((module) => ({
    default: module.CreateTableTab,
  })),
);

export const ExplainPlanView = lazy(() =>
  import("@/components/workspace/ExplainPlanView").then((module) => ({
    default: module.ExplainPlanView,
  })),
);

export const SchemaDiffView = lazy(() =>
  import("@/components/workspace/SchemaDiffView").then((module) => ({
    default: module.SchemaDiffView,
  })),
);

export const SchemaDiagramView = lazy(() =>
  import("@/components/workspace/SchemaDiagramView").then((module) => ({
    default: module.SchemaDiagramView,
  })),
);

export const DataCompareView = lazy(() =>
  import("@/components/workspace/DataCompareView").then((module) => ({
    default: module.DataCompareView,
  })),
);

export const DatabaseBrowser = lazy(() =>
  import("@/components/workspace/DatabaseBrowser").then((module) => ({
    default: module.DatabaseBrowser,
  })),
);

export const ObjectBrowser = lazy(() =>
  import("@/components/workspace/ObjectBrowser").then((module) => ({
    default: module.ObjectBrowser,
  })),
);

export const RocketMqWorkspace = lazy(() =>
  import("@/components/workspace/RocketMqWorkspace").then((module) => ({
    default: module.RocketMqWorkspace,
  })),
);

export const LspConnectionSyncer = lazy(() =>
  import("@/components/lsp/LspConnectionSyncer").then((module) => ({
    default: module.LspConnectionSyncer,
  })),
);
