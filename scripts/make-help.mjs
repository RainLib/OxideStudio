import { readFileSync } from "node:fs";

const makefile = process.argv[2] ?? "Makefile";
const targets = readFileSync(makefile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^([a-zA-Z0-9_-]+):.*?##\s*(.+)$/))
  .filter(Boolean)
  .map((match) => ({ name: match[1], description: match[2] }));

const width = Math.max(20, ...targets.map(({ name }) => name.length));
const boldBlue = "\x1b[1m\x1b[34m";
const green = "\x1b[32m";
const reset = "\x1b[0m";

console.log(`${boldBlue}OxideStudio project commands${reset}\n`);
console.log("Usage: make <target>\n");
for (const { name, description } of targets) {
  console.log(`  ${green}${name.padEnd(width)}${reset} ${description}`);
}
