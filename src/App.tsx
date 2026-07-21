import { lazy, Suspense, useEffect } from "react";
import { ThemeProvider } from "@/theme";
import { AppPreferencesProvider } from "@/i18n";
import { readStartupConnectionDisplayCache } from "@/startup/dataSourceDisplayCache";
import { StartupWorkbenchShell } from "@/startup/StartupWorkbenchShell";
import {
  markReactShellReady,
  markWorkspaceModuleReady,
} from "@/startup/startupProgress";

// Start fetching the lightweight workspace entry as soon as the App module is
// evaluated. The entry paints an interactive shell before requesting the much
// larger editor/database runtime chunk.
void import("@/pages/workspace");
const WorkspacePage = lazy(() =>
  import("@/pages/workspace").then((module) => {
    markWorkspaceModuleReady();
    return {
      default: module.WorkspacePage,
    };
  }),
);

function App() {
  const cachedDataSources = readStartupConnectionDisplayCache();

  useEffect(() => {
    markReactShellReady();
    window.dispatchEvent(new Event("oxide:react-shell-ready"));
  }, []);

  return (
    <ThemeProvider>
      <AppPreferencesProvider>
        <Suspense
          fallback={
            <StartupWorkbenchShell
              cachedDataSources={cachedDataSources ?? []}
              hasDataSourceCache={cachedDataSources !== null}
            />
          }
        >
          <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
            <WorkspacePage />
          </div>
        </Suspense>
      </AppPreferencesProvider>
    </ThemeProvider>
  );
}

export { StartupWorkbenchShell } from "@/startup/StartupWorkbenchShell";
export default App;
