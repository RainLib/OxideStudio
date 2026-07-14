import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const verifier = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-frontend-bundle.mjs",
);

async function bundleFixture(files) {
  const root = await mkdtemp(join(tmpdir(), "oxide-frontend-bundle-"));
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(
    join(root, "index.html"),
    '<script type="module" src="/assets/index.js"></script>',
    "utf8",
  );
  await Promise.all(
    Object.entries(files).map(([name, source]) =>
      writeFile(join(assets, name), source, "utf8"),
    ),
  );
  return root;
}

test("accepts an acyclic React startup bundle", async () => {
  const root = await bundleFixture({
    "index.js": 'import "./react.js"; ReactDOM.createRoot(root);',
    "react.js": "export const ReactDOM = {};",
  });
  try {
    const result = await execFileAsync(process.execPath, [verifier, root]);
    assert.match(result.stdout, /no static import cycles/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects circular imports in the startup bundle", async () => {
  const root = await bundleFixture({
    "index.js": 'import "./vendor.js"; ReactDOM.createRoot(root);',
    "vendor.js": 'import "./react.js";',
    "react.js": 'import "./vendor.js";',
  });
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [verifier, root]),
      /Circular static imports in startup bundle/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
