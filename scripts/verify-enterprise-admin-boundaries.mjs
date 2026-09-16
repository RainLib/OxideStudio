import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "enterprise/admin-web/src";
const feature = `${base}/features/admin`;
const entry = `${base}/App.tsx`;
const files = [...listTypeScriptModules(root, base)];
const graph = new Map();
const isModel = (file) =>
  file?.startsWith(`${feature}/model/`) ||
  file?.startsWith(`${feature}/runtime/`);
const isHook = (file) => file?.startsWith(`${feature}/hooks/`);
const isUi = (file) => file?.startsWith(`${feature}/ui/`) || file === entry;
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (file.startsWith(feature + "/") && resolved === entry) {
      throw new Error(
        `${file} imports ${specifier}; enterprise admin implementations must not depend on the workspace entry.`,
      );
    }
    if ((isModel(file) || isHook(file)) && isUi(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; enterprise admin models/runtime and lifecycle modules must not depend on UI components.`,
      );
    }
    if (isModel(file) && isHook(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; enterprise admin models/runtime must not depend on React lifecycle modules.`,
      );
    }
    if (
      ["api.ts", "auth.ts", "config.ts", "i18n.ts"].some(
        (name) => file === `${base}/${name}`,
      ) &&
      resolved?.startsWith(feature + "/")
    ) {
      throw new Error(
        `${file} imports ${specifier}; admin services and configuration must not depend on feature composition.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Enterprise admin");
console.log(
  `Enterprise admin boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
