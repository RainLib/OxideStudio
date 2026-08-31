import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const stylesheetPath = join(repositoryRoot, "src", "index.css");

test("limits Tailwind content detection to the application source tree", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");

  assert.match(stylesheet, /@import\s+"tailwindcss"\s+source\(none\);/);
  assert.match(stylesheet, /@source\s+"\.";/);
  assert.doesNotMatch(stylesheet, /@tailwind\s+(?:base|components|utilities)/);
});
