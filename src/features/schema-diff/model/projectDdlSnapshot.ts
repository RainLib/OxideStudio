export { detectProjectDdlDialect } from "@/features/schema-diff/model/project-ddl/dialect";
export { parseProjectDdl } from "@/features/schema-diff/model/project-ddl/parseProjectDdl";
export {
  createProjectDdlSnapshot,
  isProjectDdlSnapshot,
  projectDdlSnapshotSources,
} from "@/features/schema-diff/model/project-ddl/snapshot";
export type {
  ProjectDdlDialect,
  ProjectDdlDialectDetection,
  ProjectDdlParseResult,
  ProjectDdlSnapshotIdentity,
} from "@/features/schema-diff/model/project-ddl/types";
