import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oxide-import-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test("ignores erased type imports and resolves alias and relative runtime exports", (t) => {
  const root = fixture(t, {
    "src/types.ts": "export type Shape = { value: string };",
    "src/value.ts": "export const value = 1;",
    "src/nested/index.ts": "export const nested = 2;",
    "src/entry.ts":
      'import type { Shape } from "./types"; export type Result = Shape; export { value } from "@/value"; export { nested } from "./nested";',
  });
  assert.deepEqual(readRuntimeImports(root, "src/entry.ts"), [
    { specifier: "@/value", resolved: "src/value.ts" },
    { specifier: "./nested", resolved: "src/nested/index.ts" },
  ]);
});

test("follows literal dynamic imports only when requested and rejects computed paths", (t) => {
  const root = fixture(t, {
    "src/value.ts": "export const value = 1;",
    "src/literal.ts": 'export const load = () => import("./value");',
    "src/computed.ts": "export const load = (name: string) => import(name);",
  });
  assert.deepEqual(readRuntimeImports(root, "src/literal.ts"), []);
  assert.deepEqual(
    readRuntimeImports(root, "src/literal.ts", { includeDynamic: true }),
    [{ specifier: "./value", resolved: "src/value.ts" }],
  );
  assert.throws(
    () => readRuntimeImports(root, "src/computed.ts", { includeDynamic: true }),
    /literal path/,
  );
});

test("discovers implementation files and preserves external imports for caller policy", (t) => {
  const root = fixture(t, {
    "src/entry.tsx": 'import "react"; export const node = <span />;',
    "src/entry.test.ts": "export {};",
    "src/entry.spec.tsx": "export {};",
    "src/global.d.ts": "declare const thing: string;",
    "src/nested/value.ts": "export {};",
  });
  assert.deepEqual(listTypeScriptModules(root, "src").sort(), [
    "src/entry.tsx",
    "src/nested/value.ts",
  ]);
  const imports = readRuntimeImports(root, "src/entry.tsx");
  assert.ok(
    imports.some(
      (entry) => entry.specifier === "react" && entry.resolved === null,
    ),
  );
  assert.ok(
    imports.some(
      (entry) =>
        entry.specifier === "react/jsx-runtime" && entry.resolved === null,
    ),
  );
});

test("accepts shared leaves and reports disconnected cycles", () => {
  assert.doesNotThrow(() =>
    assertAcyclic(
      new Map([
        ["a", new Set(["shared"])],
        ["b", new Set(["shared"])],
        ["shared", new Set()],
      ]),
      "Fixture",
    ),
  );
  assert.throws(
    () =>
      assertAcyclic(
        new Map([
          ["entry", new Set()],
          ["a", new Set(["b"])],
          ["b", new Set(["a"])],
        ]),
        "Fixture",
      ),
    /Fixture dependency cycle: a -> b -> a/,
  );
});

test("resolves NodeNext JavaScript specifiers back to TypeScript sources", (t) => {
  const root = fixture(t, {
    "src/value.ts": "export const value = 1;",
    "src/panel.tsx": "export const panel = 2;",
    "src/types.ts": "export type Shape = { value: string };",
    "src/entry.ts":
      'import type { Shape } from "./types.js"; export type Result = Shape; export { value } from "./value.js"; export const load = () => import("./panel.js");',
  });
  assert.deepEqual(
    readRuntimeImports(root, "src/entry.ts", { includeDynamic: true }),
    [
      { specifier: "./value.js", resolved: "src/value.ts" },
      { specifier: "./panel.js", resolved: "src/panel.tsx" },
    ],
  );
});
