import { useProjectSwitcher } from "../hooks/useProjectSwitcher";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ProjectMenu } from "./ProjectMenu";
export function ProjectSwitcher() {
  const project = useProjectSwitcher();
  return (
    <>
      <ProjectMenu {...project.menu} />
      <CreateProjectDialog {...project.createDialog} />
      <DeleteProjectDialog {...project.deleteDialog} />
    </>
  );
}
