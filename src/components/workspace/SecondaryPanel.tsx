import { cn } from "@/lib/utils";
import { AssistantSidebar } from "./AssistantSidebar";
import { ProjectFilesSidebar } from "./ProjectFilesSidebar";

export type SecondaryPanelView = "assistant" | "files";

interface SecondaryPanelProps {
  view: SecondaryPanelView;
}

export function SecondaryPanel({ view }: SecondaryPanelProps) {
  return (
    <div className="relative h-full min-h-0">
      <div
        id="secondary-panel-assistant"
        aria-label="AI Assistant"
        className={cn("absolute inset-0", view !== "assistant" && "hidden")}
      >
        <AssistantSidebar />
      </div>
      <div
        id="secondary-panel-files"
        aria-label="Project Files"
        className={cn("absolute inset-0", view !== "files" && "hidden")}
      >
        <ProjectFilesSidebar />
      </div>
    </div>
  );
}
