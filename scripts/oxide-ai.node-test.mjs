import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function launch(binary) {
  return spawnSync(process.execPath, ["scripts/oxide-ai.mjs", "tools", "list"], {
    cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true,
    env: { ...process.env, OXIDE_AGENT_BIN: binary },
  });
}

test("npm entry reports a missing native runtime without starting an empty MCP adapter", () => {
  const result = launch(join(tmpdir(), `oxide-agent-missing-${randomUUID()}.exe`));
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /cargo build --manifest-path src-tauri\/Cargo.toml --bin oxide-agent/);
});

test("npm entry rejects an executable that does not match the native tool version", () => {
  const result = launch(process.execPath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Native oxide-agent version does not match this checkout/);
});
