import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(path.join(root, "scripts/module-size-baseline.json"), "utf8"));
const report = process.argv.includes("--report");
const violations = [];
const sizes = [];

async function inspect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await inspect(relative);
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name);
      const limit = policy.limits[extension];
      if (limit === undefined) continue;
      const source = await readFile(path.join(root, relative), "utf8");
      const lines = source.split("\n").length - Number(source.endsWith("\n"));
      const budget = policy.legacy[relative] ?? limit;
      sizes.push({ file: relative, lines, budget });
      if (lines > budget) {
        violations.push(`${relative}: ${lines} lines exceeds ${budget}; split by responsibility before adding more code.`);
      }
    }
  }
}

for (const directory of policy.roots) await inspect(directory);
if (report) {
  console.table(sizes.sort((a, b) => b.lines - a.lines).slice(0, 20));
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Module size check passed (${sizes.length} files). Existing oversized files may not grow; new TS/TSX files are limited to ${policy.limits[".ts"]} lines and Rust files to ${policy.limits[".rs"]}.`);
}
