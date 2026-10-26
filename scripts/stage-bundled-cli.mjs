import { copyFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exists = async path => access(path).then(() => true, () => false);

/** Cargo also builds the CLI with Desktop's feature set. Stage the separately
 * prepared headless CLI after that build so the auxiliary-bin bundle cannot
 * overwrite the canonical sidecar with Desktop's copy. */
export async function stageBundledCli({ root, target, targetDirectory, debug = false, host = target }) {
  const extension = target.includes("windows") ? ".exe" : "";
  const source = join(root, "src-tauri", "binaries", `oxide-agent-${target}${extension}`);
  if (!await exists(source)) throw new Error("Prepare the target's headless oxide-agent before bundling.");
  const profile = debug ? "debug" : "release";
  const directories = [
    ...(host === target ? [join(targetDirectory, profile)] : []),
    join(targetDirectory, target, profile),
  ];
  const staged = [];
  for (const directory of directories) {
    if (!await exists(join(directory, `oxide-studio${extension}`))) continue;
    const destination = join(directory, `oxide-agent${extension}`);
    await copyFile(source, destination);
    staged.push(destination);
  }
  if (!staged.length) throw new Error("Build the Desktop application before staging its bundled CLI.");
  return staged;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host:\s*(.+)$/mu)?.[1]?.trim();
  const target = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.TARGET?.trim() || host;
  if (!target) throw new Error("Unable to identify the bundle target.");
  const staged = await stageBundledCli({ root, target, host,
    targetDirectory: resolve(root, process.env.CARGO_TARGET_DIR || "src-tauri/target"),
    debug: process.env.TAURI_ENV_DEBUG === "true" });
  console.log(`[bundle] staged the prepared headless CLI in ${staged.length} application output director${staged.length === 1 ? "y" : "ies"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
