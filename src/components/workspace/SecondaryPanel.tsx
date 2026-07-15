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

export type SecondaryPanelView = "assistant" | "files";

interface SecondaryPanelProps {
  view: SecondaryPanelView;
}

export function SecondaryPanel({ view }: SecondaryPanelProps) {
  return (
    <div className="relative h-full min-h-0">
      <Suspense fallback={<SecondaryPanelSkeleton />}>
        {view === "assistant" ? (
          <div
            id="secondary-panel-assistant"
            className="absolute inset-0"
            aria-label="AI Assistant"
          >
            <AssistantSidebar />
          </div>
        ) : (
          <div
            id="secondary-panel-files"
            className="absolute inset-0"
            aria-label="Project Files"
          >
            <ProjectFilesSidebar />
          </div>
        )}
      </Suspense>
    </div>
  );
}

function SecondaryPanelSkeleton() {
  return (
    <div
      className="absolute inset-0 bg-[hsl(var(--wb-panel))]"
      aria-hidden="true"
    >
      <div className="h-8 border-b border-[hsl(var(--wb-border-subtle))]" />
    </div>
  );
}
