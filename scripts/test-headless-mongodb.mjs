// Run the public document tool against a private native MongoDB process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-mongodb-acceptance-"));
const version = "7.0.45";
// Official release metadata: https://downloads.mongodb.org/current.json
// Pin both the archive and digest; downloads never install a system service.
const releases = {
  win32: { name: `mongodb-windows-x86_64-${version}`, directory: `mongodb-win32-x86_64-windows-${version}`, extension: "zip", sha256: "7e3a435fa86e36e8ca4f2618fb41de06d75c28009c63725a20f9badd36eec6f6", base: "windows" },
  linux: { name: `mongodb-linux-x86_64-ubuntu2204-${version}`, extension: "tgz", sha256: "c2eec1e4aaee967838430ac57fc7d46c22f566c718eda6033e32add80d506f8b", base: "linux" },
};
let executable = process.env.OXIDE_MONGOD?.trim();
try {
  if (!executable) {
    assert.equal(process.arch, "x64", "Set OXIDE_MONGOD for a native server on this architecture");
    const release = releases[process.platform];
    assert.ok(release, "Set OXIDE_MONGOD for a native server on this platform");
    if (process.platform === "linux") {
      const releaseInfo = await fs.readFile("/etc/os-release", "utf8");
      assert.match(releaseInfo, /^ID=ubuntu$/m, "Automatic archive selection supports Ubuntu 22.04; otherwise set OXIDE_MONGOD");
      assert.match(releaseInfo, /^VERSION_ID="22\.04"$/m, "Automatic archive selection supports Ubuntu 22.04; otherwise set OXIDE_MONGOD");
    }
    const archive = path.join(directory, `mongodb.${release.extension}`);
    process.stdout.write(`Downloading pinned MongoDB ${version}; acceptance directory: ${directory}\n`);
    const response = await fetch(`https://fastdl.mongodb.org/${release.base}/${release.name}.${release.extension}`, { signal: AbortSignal.timeout(30 * 60_000) });
    assert.ok(response.ok && response.body, `MongoDB download returned ${response.status}`);
    const digest = createHash("sha256");
    let bytes = 0, reported = 0;
    const progress = new Transform({ transform(chunk, _, callback) {
      digest.update(chunk); bytes += chunk.length;
      if (bytes - reported > 32 * 1024 * 1024) { reported = bytes; process.stdout.write(`MongoDB archive received: ${Math.floor(bytes / 1024 / 1024)} MiB\n`); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(archive));
    assert.equal(digest.digest("hex"), release.sha256, "Official MongoDB archive digest mismatch");
    const extracted = path.join(directory, "extracted"); await fs.mkdir(extracted);
    execFileSync(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", archive, "-C", extracted], { windowsHide: true });
    executable = path.join(extracted, release.directory || release.name, "bin", process.platform === "win32" ? "mongod.exe" : "mongod");
  }
  executable = path.resolve(executable);
  const serverVersion = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/, 1)[0];
  process.stdout.write(`MongoDB acceptance server: ${serverVersion}\n`);
  const logPath = path.join(directory, "run.log"), log = createWriteStream(logPath);
  const child = spawn(process.platform === "win32" ? "cargo.exe" : "cargo", ["test", "--locked", "--offline", "--no-default-features", "--manifest-path", "src-tauri/Cargo.toml", "--test", "headless_mongodb", "--", "--ignored", "--nocapture"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OXIDE_MONGOD: executable, CARGO_INCREMENTAL: "0", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", PROTOC: "oxide-headless-must-not-require-protoc", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4" },
  });
  let lines = "";
  child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); lines += chunk; });
  child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk); });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  await new Promise((resolve) => log.end(resolve));
  assert.equal(code, 0, `Native MongoDB acceptance failed; inspect ${logPath}`);
  const fixture = lines.match(/MongoDB acceptance passed; evidence:\s*([^\r\n]+)/)?.[1]?.trim();
  assert.ok(fixture, "The actual native fixture must report completed evidence");
  await fs.copyFile(path.join(fixture, "evidence.json"), path.join(directory, "evidence.json"));
  process.stdout.write(`MongoDB document acceptance passed; evidence: ${directory}\n`);
} finally {
  process.stdout.write(`MongoDB acceptance runner retained: ${directory}\n`);
}
