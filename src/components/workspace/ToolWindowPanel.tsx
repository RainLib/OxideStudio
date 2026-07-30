import type { SideToolWindowId } from "@/lib/appSettings";
import { lazy, Suspense } from "react";

const AssistantSidebar = lazy(() =>
  import("./AssistantSidebar").then((module) => ({
    default: module.AssistantSidebar,
  })),
);
const ProjectFilesSidebar = lazy(() =>
  import("./ProjectFilesSidebar").then((module) => ({
    default: module.ProjectFilesSidebar,
  })),
);
const CommitPanel = lazy(() =>
  import("./git/CommitPanel").then((module) => ({ default: module.CommitPanel })),
);
const VersionControlPanel = lazy(() =>
  import("./git/VersionControlPanel").then((module) => ({
    default: module.VersionControlPanel,
  })),
);

export function ToolWindowPanel({ id }: { id: Exclude<SideToolWindowId, "databaseExplorer"> }) {
  return (
    <div className="relative h-full min-h-0">
      <Suspense fallback={<ToolWindowPanelSkeleton />}>
        <div className="absolute inset-0" data-tool-window-content={id}>
          {id === "assistant" ? (
            <AssistantSidebar />
          ) : id === "projectFiles" ? (
            <ProjectFilesSidebar />
          ) : id === "commit" ? (
            <CommitPanel />
          ) : (
            <VersionControlPanel />
          )}
        </div>
      </Suspense>
    </div>
  );
}

function ToolWindowPanelSkeleton() {
  return (
    <div className="absolute inset-0 bg-[hsl(var(--wb-panel))]" aria-hidden="true">
      <div className="h-9 border-b border-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}
