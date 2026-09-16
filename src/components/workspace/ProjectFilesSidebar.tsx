import { useProjectFilesSidebarController } from "@/features/projects/hooks/useProjectFilesSidebarController";
import { ProjectFilesSidebarView } from "@/features/projects/ui/ProjectFilesSidebarView";

export function ProjectFilesSidebar() {
  return <ProjectFilesSidebarView {...useProjectFilesSidebarController()} />;
}
