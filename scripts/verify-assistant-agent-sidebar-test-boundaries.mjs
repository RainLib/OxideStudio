import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "tests/frontend/assistant-agent-sidebar.test.tsx";
const directory = "tests/frontend/assistant-agent-sidebar";
const scenarios = ["identity", "lifecycle", "conversations", "composer", "cli", "cli-setup"];
const expectedImports = scenarios.map((name) => `./assistant-agent-sidebar/${name}`);
const entrySource = readSourceText(path.join(root, entry));
const actualImports = [...entrySource.matchAll(/import\s+["']([^"']+)["'];/g)].map(
  (match) => match[1],
);
if (
  entrySource.split(/\r?\n/).length > 20 ||
  actualImports.length !== expectedImports.length ||
  expectedImports.some((specifier, index) => actualImports[index] !== specifier)
) {
  throw new Error(`${entry}: retain the small test entry and ordered scenario imports.`);
}

const harness = `${directory}/harness.tsx`;
const harnessSource = readSourceText(path.join(root, harness));
for (const required of [
  "vi.hoisted",
  'vi.mock("@/services/tauri/agent-host.service"',
  'vi.mock("@/services/tauri/ai.service"',
  "export const fixture",
  "export const mocksForTests",
]) {
  if (!harnessSource.includes(required)) {
    throw new Error(`${harness}: missing shared ${required} test harness boundary.`);
  }
}

let testCount = 0;
for (const scenario of scenarios) {
  const file = `${directory}/${scenario}.tsx`;
  const source = readSourceText(path.join(root, file));
  if (!source.includes('from "./harness"')) {
    throw new Error(`${file}: scenarios must consume the shared harness.`);
  }
  if (/\bvi\.mock\(/.test(source)) {
    throw new Error(`${file}: mocks belong in the shared harness.`);
  }
  testCount += [...source.matchAll(/\bit\(/g)].length;
}
if (testCount !== 59) {
  throw new Error(`Expected 59 AssistantSidebar regression tests; found ${testCount}.`);
}

console.log(
  `AssistantSidebar test boundaries verified: ${scenarios.length} scenarios, 1 shared harness, ${testCount} tests.`,
);
