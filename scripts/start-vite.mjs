import { createServer } from "vite";

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const host = optionValue("--host");
const portValue = optionValue("--port");
const port =
  typeof portValue === "string" && Number.isFinite(Number(portValue))
    ? Number(portValue)
    : undefined;

const inlineConfig = {
  configFile: new URL("../vite.config.ts", import.meta.url).pathname,
  server: {
    ...(host !== undefined ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
  },
};

const server = await createServer(inlineConfig);

const depsOptimizer = server.environments.client.depsOptimizer;
if (depsOptimizer) {
  await depsOptimizer.init();
  const pendingOptimizations = Object.values(
    depsOptimizer.metadata.discovered,
  )
    .map((dependency) => dependency.processing)
    .filter(Boolean);
  await Promise.all(pendingOptimizations);
}

// Vite can report its HTTP endpoint as available before a cold dependency
// optimization has finished. Tauri then opens a WebView whose static shell
// appears ready while the first workspace module request blocks for seconds.
// Transform the critical route before listening so an opened desktop window
// never becomes the dependency optimizer's progress UI.
const criticalModules = [
  "/src/main.tsx",
  "/src/bootstrap.tsx",
  "/src/App.tsx",
  "/src/pages/workspace.tsx",
  "/src/pages/workspaceRuntime.tsx",
];

try {
  for (const url of criticalModules) {
    await server.warmupRequest(url);
  }
  await server.waitForRequestsIdle();

  // The first crawl can expand the optimized dependency set and therefore
  // rotate its browser hash. Any source transform cached during discovery then
  // points at the old hash and the WebView receives "504 Outdated Optimize
  // Dep" until a reload. Invalidate and warm once more after discovery so the
  // modules exposed to the first WebView all reference the finalized hash.
  server.moduleGraph.invalidateAll();
  for (const url of criticalModules) {
    await server.warmupRequest(url);
  }
  await server.waitForRequestsIdle();

  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} catch (error) {
  await server.close();
  throw error;
}

const close = async () => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
