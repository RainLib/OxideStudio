export * from "./definition/table";
export * from "./definition/columns";
export * from "./definition/indexes";
export * from "./definition/constraints";
export * from "./definition/views";
export * from "./definition/sources";

import { tableDefinitionColumnService } from "./definition/columns";
import { tableDefinitionConstraintService } from "./definition/constraints";
import { tableDefinitionIndexService } from "./definition/indexes";
import { tableDefinitionSourceService } from "./definition/sources";
import { tableDefinitionTableService } from "./definition/table";
import { tableDefinitionViewService } from "./definition/views";

/** Stable table-definition client composed from specific command owners. */
export const tableDefinitionService = {
  ...tableDefinitionTableService,
  ...tableDefinitionColumnService,
  ...tableDefinitionIndexService,
  ...tableDefinitionConstraintService,
  ...tableDefinitionViewService,
  ...tableDefinitionSourceService,
};
