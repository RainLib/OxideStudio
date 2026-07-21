import { lazy, Suspense, useEffect } from "react";
import { readStartupConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
import { StartupWorkbenchShell } from "@/startup/StartupWorkbenchShell";
import { markWorkspaceShellInteractive } from "@/startup/startupProgress";

const WorkspaceRuntime = lazy(() =>
  import("@/pages/workspaceRuntime").then((module) => ({
    default: module.WorkspaceRuntime,
  })),
);

export function WorkspacePage() {
  const cachedDataSources = readStartupConnectionDisplayCache();

  useEffect(() => {
    markWorkspaceShellInteractive();
  }, []);

  return (
    <Suspense
      fallback={
        <StartupWorkbenchShell
          cachedDataSources={cachedDataSources ?? []}
          hasDataSourceCache={cachedDataSources !== null}
        />
      }
    >
      <WorkspaceRuntime />
    </Suspense>
  );
}
