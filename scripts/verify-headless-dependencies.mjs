import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = execFileSync(process.platform === "win32" ? "cargo.exe" : "cargo", [
  "tree", "--offline", "--locked", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"),
  "--no-default-features", "--edges", "normal,build", "--prefix", "none", "--format", "{p}",
], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
const packages = new Set(graph.split(/\r?\n/).map((line) => line.match(/^(\S+) v[^ ]+/)?.[1]).filter(Boolean));
if (!packages.has("oxide-studio") || !packages.has("sqlx")) throw new Error("The headless dependency graph is incomplete");
const forbidden = [...packages].filter((name) => /^(?:tauri(?:-.+)?|tao|wry|gtk(?:-.+)?|webkit2gtk(?:-.+)?|webview2-com(?:-.+)?|keyring|tonic-prost-build)$/.test(name));
if (forbidden.length) throw new Error(`Headless CLI still requires desktop or protobuf build dependencies: ${forbidden.join(", ")}`);
console.log(`Headless dependencies verified: ${packages.size} normal/build packages; no Tauri, WebView, desktop keyring or protoc build dependency.`);
