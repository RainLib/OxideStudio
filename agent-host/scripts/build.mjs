import { chmod, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const outfile = fileURLToPath(
  new URL("../dist/oxide-agent-host.cjs", import.meta.url),
);

await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  define: {
    "process.env.LANGCHAIN_TRACING_V2": '"false"',
    "process.env.LANGSMITH_TRACING": '"false"',
    // ws treats these native modules as optional accelerators. The sidecar does
    // not install them, so compile the JavaScript fallbacks into the single-file
    // bundle instead of leaving dynamic requires for pkg to discover at runtime.
    "process.env.WS_NO_BUFFER_UTIL": '"1"',
    "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
  },
});

const bundle = await readFile(outfile, "utf8");
if (!bundle.startsWith("#!/usr/bin/env node\n") || bundle.startsWith("#!", 20)) {
  throw new Error("Agent host bundle must contain exactly one leading Node shebang");
}
await chmod(outfile, 0o755);
process.stderr.write(`[agent-host] bundled ${outfile}\n`);
