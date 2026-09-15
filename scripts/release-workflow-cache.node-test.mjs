import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const releaseWorkflowPath = join(repositoryRoot, ".github", "workflows", "release.yml");
const ciWorkflowPath = join(repositoryRoot, ".github", "workflows", "ci.yml");

function workflowJob(source, name, nextName) {
  const startMarker = `  ${name}:\n`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `release workflow is missing the ${name} job`);
  const end = nextName ? source.indexOf(`  ${nextName}:\n`, start + startMarker.length) : source.length;
  assert.notEqual(end, -1, `release workflow is missing the ${nextName} job boundary`);
  return source.slice(start, end);
}

test("release Rust jobs use bounded sccache instead of restoring target trees", async () => {
  const source = (await readFile(releaseWorkflowPath, "utf8")).replace(/\r\n/gu, "\n");
  const quality = workflowJob(source, "quality", "build");
  const build = workflowJob(source, "build", "publish");

  for (const [name, job] of [
    ["quality", quality],
    ["build", build],
  ]) {
    assert.match(job, /CARGO_INCREMENTAL: "0"/u, `${name} must disable incremental artifacts`);
    assert.match(job, /RUSTC_WRAPPER: sccache/u, `${name} must compile through sccache`);
    assert.match(job, /SCCACHE_GHA_ENABLED: "true"/u, `${name} must use the GitHub cache backend`);
    assert.match(
      job,
      /mozilla-actions\/sccache-action@9e7fa8a12102821edf02ca5dbea1acd0f89a2696/u,
      `${name} must pin the sccache action by commit`,
    );
    assert.match(job, /version: "v0\.10\.0"/u, `${name} must pin the sccache binary`);
    assert.match(job, /run: sccache --show-stats/u, `${name} must expose cache effectiveness`);
  }

  assert.match(
    build,
    /uses: swatinem\/rust-cache@v2[\s\S]*?cache-targets: false/u,
    "release matrix must not restore large target directories alongside sccache",
  );
  assert.doesNotMatch(
    quality + build,
    /SCCACHE_(?:S3|AZURE|REDIS)|AWS_(?:ACCESS|SECRET)/u,
    "release compilation cache must not require repository credentials",
  );
});

test("tag CI reuses the same credential-free Rust compilation cache", async () => {
  const source = (await readFile(ciWorkflowPath, "utf8")).replace(/\r\n/gu, "\n");
  const rust = workflowJob(source, "rust");

  assert.match(rust, /CARGO_INCREMENTAL: "0"/u);
  assert.match(rust, /RUSTC_WRAPPER: sccache/u);
  assert.match(rust, /SCCACHE_GHA_ENABLED: "true"/u);
  assert.match(
    rust,
    /mozilla-actions\/sccache-action@9e7fa8a12102821edf02ca5dbea1acd0f89a2696/u,
  );
  assert.match(rust, /version: "v0\.10\.0"/u);
  assert.match(rust, /cache-targets: false/u);
  assert.match(rust, /run: sccache --show-stats/u);
  assert.doesNotMatch(rust, /SCCACHE_(?:S3|AZURE|REDIS)|AWS_(?:ACCESS|SECRET)/u);
});

test("release readiness outputs do not reuse secret-shaped boolean values", async () => {
  const source = (await readFile(releaseWorkflowPath, "utf8")).replace(/\r\n/gu, "\n");

  for (const readinessValue of [
    "ready-oss-publish-v1",
    "ready-apple-signing-v1",
    "ready-windows-signing-v1",
  ]) {
    assert.match(source, new RegExp(readinessValue, "u"));
  }
  assert.doesNotMatch(
    source,
    /(?:apple_signing_enabled|windows_signing_enabled|oss_enabled)[^\n]*== 'true'/u,
    "job outputs must not equal the ALIYUN_OSS_ENABLED secret value, or GitHub masks them",
  );
});
