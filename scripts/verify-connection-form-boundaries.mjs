import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const formPath = "src/components/connection/ConnectionForm.tsx";
const generalPath = "src/features/connections/ui/ConnectionGeneralFields.tsx";
const owners = {
  authentication: {
    path: "src/features/connections/ui/ConnectionAuthenticationFields.tsx",
    component: "ConnectionAuthenticationFields",
    symbols: [
      'id="connection-mongodb-oidc"',
      'id="connection-influx-version"',
      'id="connection-victoriametrics-api-path"',
      "setStatus(null)",
      "EyeOff",
    ],
  },
  database: {
    path: "src/features/connections/ui/ConnectionDatabaseField.tsx",
    component: "ConnectionDatabaseField",
    symbols: ['id="connection-database"', "defaultDatabaseName"],
  },
  driverPackages: {
    path: "src/features/connections/ui/ConnectionDriverPackageFields.tsx",
    component: "ConnectionDriverPackageFields",
    symbols: [
      'id="connection-driver-package"',
      "ACTIVE_DRIVER_PACKAGE_VALUE",
      "signed Java runtime",
    ],
  },
  elasticsearch: {
    path: "src/features/connections/ui/ConnectionElasticsearchFields.tsx",
    component: "ConnectionElasticsearchFields",
    symbols: [
      'id="connection-elasticsearch-mode"',
      'id="connection-elasticsearch-check-path"',
      'id="connection-elasticsearch-index-grouping"',
      "Skip Elasticsearch connectivity check",
    ],
  },
  host: {
    path: "src/features/connections/ui/ConnectionHostField.tsx",
    component: "ConnectionHostField",
    symbols: [
      'id="connection-host"',
      "Choose database file…",
      "defaultDatabasePort",
    ],
  },
  notes: {
    path: "src/features/connections/ui/ConnectionNotesField.tsx",
    component: "ConnectionNotesField",
    symbols: [
      'id="connection-note"',
      "Show in Explorer",
      "useSettingsStore.getState()",
      "showConnectionNotes: checked",
    ],
  },
  rocketMq: {
    path: "src/features/connections/ui/ConnectionRocketMqFields.tsx",
    component: "ConnectionRocketMqFields",
    symbols: [
      'id="rocketmq-namesrv"',
      'id="rocketmq-cluster"',
      'id="rocketmq-access-key"',
      'id="rocketmq-secret-key"',
    ],
  },
  url: {
    path: "src/features/connections/ui/ConnectionUrlField.tsx",
    component: "ConnectionUrlField",
    symbols: [
      'id="connection-url"',
      "Rebuild URL from fields",
      "connectionUrlTemplate",
      "isRemoteSqlite",
    ],
    forbiddenSymbols: ['id="connection-url"', "Rebuild URL from fields"],
  },
};
const form = read(formPath);
const general = read(generalPath);

for (const required of [
  "<ConnectionGeneralFields",
  "showConnectionNotes={showConnectionNotes}",
  "updateSettings={updateSettings}",
]) {
  if (!form.includes(required)) {
    throw new Error(`Connection form must continue passing ${required}.`);
  }
}
for (const owner of Object.values(owners)) {
  const { path: ownerPath, component, symbols } = owner;
  const source = read(ownerPath);
  const importPath = ownerPath.replace(/^src\//, "@/").replace(/\.tsx$/, "");
  for (const required of [
    `import { ${component} } from "${importPath}";`,
    `<${component}`,
  ]) {
    if (!general.includes(required)) {
      throw new Error(`General connection fields must compose ${required}.`);
    }
  }
  for (const symbol of [`export function ${component}`, ...symbols]) {
    if (!source.includes(symbol)) {
      throw new Error(`${component} must retain ${symbol}.`);
    }
  }
  for (const symbol of owner.forbiddenSymbols ?? symbols) {
    if (general.includes(symbol)) {
      throw new Error(`General connection fields must not retain ${symbol}.`);
    }
  }
}

const base = "src/features/connections/ui";
const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === formPath) {
      throw new Error(
        `${file} imports ${specifier}; connection field owners must not depend on the form composition.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Connection form fields");
console.log(
  `Connection form boundaries verified: ${Object.keys(owners).length} focused field owners and an acyclic composition.`,
);
