export * from "./project-files/contracts";
export * from "./project-files/path";

import { projectContextService } from "./project-files/context";
import { projectFileTreeService } from "./project-files/files";
import { projectGitService } from "./project-files/git";

export const projectFilesService = {
  ...projectGitService,
  ...projectContextService,
  ...projectFileTreeService,
};
