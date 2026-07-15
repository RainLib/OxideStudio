import { access, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const outputDirectory = resolve(process.argv[2] ?? "dist");
const indexPath = resolve(outputDirectory, "index.html");

function staticImports(source) {
  const imports = new Set();
  const fromPattern =
    /\b(?:import|export)(?!\s*\()[^"'`;]*?\bfrom\s*["']([^"']+)["']/g;
  const sideEffectPattern = /\bimport\s*["']([^"']+)["']/g;

  for (const pattern of [fromPattern, sideEffectPattern]) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }

  return [...imports];
}

function dynamicImports(source) {
  return [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1],
  );
}

function resolveAsset(importer, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return undefined;
  }

  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  return specifier.startsWith("/")
    ? resolve(outputDirectory, `.${cleanSpecifier}`)
    : resolve(dirname(importer), cleanSpecifier);
}

async function buildStaticGraph(entryPath) {
  const graph = new Map();
  const pending = [entryPath];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || graph.has(modulePath)) continue;

    const source = await readFile(modulePath, "utf8");
    const dependencies = staticImports(source)
      .map((specifier) => resolveAsset(modulePath, specifier))
      .filter((dependency) => dependency?.endsWith(".js"));

    for (const dependency of dependencies) {
      await access(dependency);
      pending.push(dependency);
    }
    graph.set(modulePath, dependencies);
  }

  return graph;
}

async function findReactBootstrap(entryPath) {
  const pending = [entryPath];
  const visited = new Set();

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || visited.has(modulePath)) continue;
    visited.add(modulePath);

    const source = await readFile(modulePath, "utf8");
    if (source.includes(".createRoot(")) return modulePath;

    const dependencies = [...staticImports(source), ...dynamicImports(source)]
      .map((specifier) => resolveAsset(modulePath, specifier))
      .filter((dependency) => dependency?.endsWith(".js"));
    for (const dependency of dependencies) {
      await access(dependency);
      pending.push(dependency);
    }
  }

  return undefined;
}

function findCycle(graph) {
  const visited = new Set();
  const active = new Set();
  const path = [];

  function visit(modulePath) {
    if (active.has(modulePath)) {
      return [...path.slice(path.indexOf(modulePath)), modulePath];
    }
    if (visited.has(modulePath)) return undefined;

    visited.add(modulePath);
    active.add(modulePath);
    path.push(modulePath);

    for (const dependency of graph.get(modulePath) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }

    path.pop();
    active.delete(modulePath);
    return undefined;
  }

  for (const modulePath of graph.keys()) {
    const cycle = visit(modulePath);
    if (cycle) return cycle;
  }

  return undefined;
}

const indexSource = await readFile(indexPath, "utf8");
const entryMatch = indexSource.match(
  /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
);
if (!entryMatch) {
  throw new Error(
    "Production index.html does not contain a module entry script.",
  );
}

const entryPath = resolveAsset(indexPath, entryMatch[1]);
if (!entryPath) {
  throw new Error(`Unsupported frontend entry path: ${entryMatch[1]}`);
}

const reactBootstrap = await findReactBootstrap(entryPath);
if (!reactBootstrap) {
  throw new Error(
    "Production entry cannot reach the React createRoot bootstrap through local imports.",
  );
}

const graph = await buildStaticGraph(entryPath);
const cycle = findCycle(graph);
if (cycle) {
  const formattedCycle = cycle
    .map((modulePath) => relative(outputDirectory, modulePath))
    .join(" -> ");
  throw new Error(
    `Circular static imports in startup bundle: ${formattedCycle}`,
  );
}

console.log(
  `Frontend bundle verified: ${graph.size} startup module${graph.size === 1 ? "" : "s"}, no static import cycles.`,
);
