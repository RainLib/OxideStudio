// Windows packaged acceptance: real WebView IPC, ephemeral minisign signatures,
// standard per-user NSIS packages, an external installer failure, then A -> B.
// All application, binary and registry names are unique to this invocation.
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { DatabaseSync } from "node:sqlite";
import { copySource, fixtureServer, nsisExecutableSha256, ownedBackupPath, sha256, waitFor, waitOwnedProcessExit } from "./lib/desktop-update-fixture.mjs";

if (process.platform !== "win32") throw new Error("Packaged NSIS acceptance requires Windows");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resumeIndex = process.argv.indexOf("--resume");
const resume = resumeIndex >= 0;
const directory = resume ? await fs.realpath(process.argv[resumeIndex + 1] ?? "") : await fs.mkdtemp(path.join(os.tmpdir(), "oxide-updater-acceptance-"));
if (resume && (path.dirname(directory).toLowerCase() !== (await fs.realpath(os.tmpdir())).toLowerCase() || !/^oxide-updater-acceptance-[a-z0-9]+$/i.test(path.basename(directory)))) {
  throw new Error("Only an owned temporary updater acceptance directory can be resumed");
}
const snapshot = path.join(directory, "source");
const originalTarget = path.resolve(process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri/target"));
const target = path.resolve(process.env.OXIDE_UPDATER_TARGET_DIR || path.join(originalTarget, "updater-acceptance"));
const sharedTarget = target.toLowerCase() === originalTarget.toLowerCase();
const savedConfig = resume ? JSON.parse(await fs.readFile(path.join(snapshot, "src-tauri/tauri.conf.json"), "utf8")) : null;
const runId = resume ? savedConfig.identifier.replace(/^com\.houshuai\.oxide-updater-fixture-/, "") : randomUUID();
if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Invalid isolated updater identity");
const binaryName = `oxide-updater-${runId}`;
const productName = `OxideUpdateFixture-${runId}`;
const identifier = `com.houshuai.oxide-updater-fixture-${runId}`;
const profile = process.argv.includes("--debug") ? "debug" : "release";
if (resume && (savedConfig.productName !== productName || savedConfig.mainBinaryName !== binaryName || savedConfig.identifier !== identifier)) throw new Error("Cached fixture identity changed");
if (profile === "debug" && !process.argv.includes("--prepare-only")) {
  throw new Error("Debug console binaries may only be prepared; installation acceptance uses the Windows GUI release subsystem");
}
const installDirectory = path.join(directory, "installed");
const installed = path.join(installDirectory, `${binaryName}.exe`);
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const versionSource = await fs.readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
const versionMatch = versionSource.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)[^"]*"/m);
if (!versionMatch) throw new Error("Cannot identify the current package version");
const fromVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
const toVersion = `${versionMatch[1]}.${versionMatch[2]}.${BigInt(versionMatch[3]) + 1n}`;
const environment = { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "0", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4" };
environment.NO_PROXY = [environment.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
// Exercise release conditional paths and the GUI subsystem. Optimization is
// disabled for this acceptance fixture; it is not performance evidence.
Object.assign(environment, { CARGO_PROFILE_RELEASE_OPT_LEVEL: "0", CARGO_PROFILE_RELEASE_DEBUG: "0", CARGO_PROFILE_RELEASE_LTO: "false", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "256" });
for (const key of Object.keys(environment)) {
  if (/^(TAURI_SIGNING_|OXIDE_UPDATER_|WINDOWS_CERTIFICATE)/.test(key) || key === "TAURI_CONFIG") delete environment[key];
}

async function launch(program, args, name, options = {}) {
  const file = path.join(directory, `${name}.log`);
  const output = createWriteStream(file);
  const child = spawn(program, args, { cwd: snapshot, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { output.end(); resolve({ code, signal }); });
  });
  return { child, completion, file };
}

async function run(program, args, name, options) {
  process.stdout.write(`Packaged updater: ${name}\n`);
  const command = await launch(program, args, name, options);
  const result = await command.completion;
  if (result.code !== 0) throw new Error(`${name} failed (${result.code ?? result.signal}); inspect ${command.file}`);
}

const server = await fixtureServer({ directory, runId, identifier, fromVersion, toVersion,
  endpoint: savedConfig?.plugins.updater.endpoints[0].replace(/\/latest\.json$/, ""),
});
let recoveringCached = false;
let updatedCached = null;
if (resume) {
  const previous = (await fs.readFile(path.join(directory, "events.ndjson"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const hello = previous.find((event) => event.stage === "webview-ready");
  if (hello && path.basename(path.resolve(hello.data)) === identifier) {
    server.state.data = path.resolve(hello.data); server.state.config = path.resolve(hello.config);
    const disk = await server.snapshot();
    recoveringCached = disk?.control?.installation?.phase === "committed";
    updatedCached = previous.findLast((event) => event.stage === "updated" && event.version === toVersion) ?? null;
    if (updatedCached && (disk?.control?.installation || !disk.schedules.runs.every((run) => run.status === "success"))) throw new Error("The cached completed update no longer matches its stored queue");
    if (recoveringCached) {
      server.state.plans = disk.schedules.schedules.map((plan) => plan.id);
      server.state.phase = "recovery"; server.state.mode = "success";
      server.state.events = previous;
    }
    if (updatedCached) server.state.events = previous;
  }
}
let outputsChanged = false;
let installedByTest = false;
let running;
let completed = false;
try {
  let a, success, failure, hashA, hashB;
  const executableA = path.join(directory, "application-a-main.exe");
  const executableB = path.join(directory, "application-b-main.exe");
  const marker = path.join(directory, "failing-installer-process.txt");
  if (resume) {
    const artifact = async (name) => ({ name: `${name}.exe`, file: path.join(directory, `${name}.exe`), signature: (await fs.readFile(path.join(directory, `${name}.exe.sig`), "utf8")).trim() });
    a = await artifact("application-a"); success = await artifact("application-b"); failure = await artifact("external-installer-failure");
    hashA = await nsisExecutableSha256(executableA); hashB = await nsisExecutableSha256(executableB);
    if (!recoveringCached && !updatedCached) await fs.writeFile(path.join(directory, "events.ndjson"), "");
  } else {
  await copySource(root, snapshot);
  const keys = path.join(directory, "fixture-signing.key");
  await run(process.execPath, [cli, "signer", "generate", "--ci", "-p", "", "-w", keys], "generate-ephemeral-key");
  environment.TAURI_SIGNING_PRIVATE_KEY = keys;
  environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  const publicKey = (await fs.readFile(`${keys}.pub`, "utf8")).trim();
  const dist = path.join(snapshot, "fixture-dist");
  await viteBuild({ root, configFile: false, resolve: { alias: { "@": path.join(root, "src") } },
    define: { __OXIDE_UPDATE_FIXTURE_ENDPOINT__: JSON.stringify(server.url) },
    build: { outDir: dist, emptyOutDir: true, minify: false,
      lib: { entry: path.join(root, "scripts/fixtures/desktop-update-client.mjs"), formats: ["es"], fileName: () => "client.js" },
      rollupOptions: { output: { inlineDynamicImports: true } } },
  });
  await fs.writeFile(path.join(dist, "index.html"), '<!doctype html><html><head><title>Isolated updater acceptance</title></head><body><script type="module" src="./client.js"></script></body></html>');
  const configuration = JSON.parse(await fs.readFile(path.join(snapshot, "src-tauri/tauri.conf.json"), "utf8"));
  Object.assign(configuration, { productName, identifier, mainBinaryName: binaryName, version: fromVersion });
  configuration.build = { features: ["desktop"], beforeBuildCommand: "", frontendDist: "../fixture-dist" };
  configuration.app.windows = [{ label: "main", title: productName, width: 1200, height: 800, visible: false }];
  configuration.app.security.csp = `default-src 'self'; connect-src ipc: http://ipc.localhost ${server.origin}; style-src 'self' 'unsafe-inline'; script-src 'self'`;
  configuration.bundle = { active: true, targets: ["nsis"], createUpdaterArtifacts: true, publisher: "OxideStudio isolated acceptance", icon: ["icons/icon.ico"], resources: {}, externalBin: [],
    windows: { webviewInstallMode: { type: "skip" }, nsis: { installMode: "currentUser", compression: "zlib", languages: ["English"] } } };
  configuration.plugins.updater = { endpoints: [`${server.url}/latest.json`], pubkey: publicKey, dangerousInsecureTransportProtocol: true, windows: { installMode: "quiet", installerArgs: ["/NS"] } };
  const configFile = path.join(snapshot, "src-tauri/tauri.conf.json");
  await fs.writeFile(configFile, JSON.stringify(configuration, null, 2));
  outputsChanged = true;
  const bundleRoot = path.join(target, profile, "bundle/nsis");
  async function packageVersion(version, label, bundleOnly = false) {
    configuration.version = version;
    await fs.writeFile(configFile, JSON.stringify(configuration, null, 2));
    await fs.writeFile(path.join(snapshot, "src-tauri/Cargo.toml"), versionSource.replace(versionMatch[0], `version = "${version}"`));
    const pkg = JSON.parse(await fs.readFile(path.join(snapshot, "package.json"), "utf8")); pkg.version = version;
    await fs.writeFile(path.join(snapshot, "package.json"), JSON.stringify(pkg, null, 2));
    await run(process.execPath, [cli, bundleOnly ? "bundle" : "build", ...(profile === "debug" ? ["--debug"] : []), "--ci", "--bundles", "nsis", ...(bundleOnly ? [] : ["--", "--offline"])], label);
    const files = (await fs.readdir(bundleRoot)).filter((name) => name.startsWith(`${productName}_${version}_`) && name.endsWith("-setup.exe"));
    if (files.length !== 1) throw new Error(`Expected one ${label} NSIS artifact, got ${files.length}`);
    const destination = path.join(directory, `${label}.exe`);
    await fs.copyFile(path.join(bundleRoot, files[0]), destination);
    await fs.copyFile(path.join(bundleRoot, `${files[0]}.sig`), `${destination}.sig`);
    return { file: destination, signature: (await fs.readFile(`${destination}.sig`, "utf8")).trim(), name: `${label}.exe` };
  }
  a = await packageVersion(fromVersion, "application-a");
  await fs.copyFile(path.join(target, profile, `${binaryName}.exe`), executableA);
  hashA = await nsisExecutableSha256(executableA);
  success = await packageVersion(toVersion, "application-b");
  await fs.copyFile(path.join(target, profile, `${binaryName}.exe`), executableB);
  hashB = await nsisExecutableSha256(executableB);
  const hook = path.join(directory, "failing-installer.nsh");
  const nsisString = (value) => value.replaceAll("$", "$$").replaceAll('"', '$\\"');
  await fs.writeFile(hook, `!macro NSIS_HOOK_PREINSTALL\n  System::Call 'kernel32::GetCurrentProcessId()i.r1'\n  FileOpen $R0 "${nsisString(marker)}" w\n  FileWriteUTF16LE $R0 "$1$\\r$\\n$EXEPATH$\\r$\\n"\n  FileClose $R0\n  Sleep 2000\n  SetErrorLevel 123\n  Quit\n!macroend\n`);
  configuration.bundle.windows.nsis.installerHooks = hook;
  failure = await packageVersion(toVersion, "external-installer-failure", true);
  // Inspect the generated script before allowing an installer to run. In
  // particular its process-name checks must never target oxide-studio.exe.
  const candidates = await fs.readdir(path.join(target, profile, "nsis"), { recursive: true });
  const installerScripts = candidates.filter((name) => name.endsWith("installer.nsi"));
  const installerScript = await fs.readFile(path.join(target, profile, "nsis", installerScripts[0] ?? "missing"), "utf8");
  if (!installerScript.includes(`!define MAINBINARYNAME "${binaryName}"`) || !installerScript.includes(`!define PRODUCTNAME "${productName}"`) || !installerScript.includes(`!define BUNDLEID "${identifier}"`)) {
    throw new Error("The generated NSIS script does not use this invocation's unique application and process names");
  }
  await fs.writeFile(path.join(directory, "generated-installer.nsi"), installerScript);
  }
  server.state.artifacts = { success, failure };
  if (process.argv.includes("--prepare-only")) {
    process.stdout.write(`Signed installers prepared for review: ${directory}\n`);
  } else {
    const image = await fs.readFile(executableA);
    if (image.readUInt16LE(image.readUInt32LE(0x3c) + 24 + 68) !== 2) throw new Error("The fixture must use the Windows GUI subsystem before running an installer");
    if (path.resolve(installDirectory).startsWith(`${path.resolve(directory)}${path.sep}`) === false) throw new Error("The fixture install directory escaped its temporary root");
    let updated = updatedCached;
    if (!updatedCached) {
    if (!resume) await run(a.file, ["/S", "/NS", `/D=${installDirectory}`], "install-isolated-a", { windowsVerbatimArguments: true });
    installedByTest = true;
    if (await sha256(installed) !== hashA) throw new Error("The initial installer did not install the exact A executable");
    if (!recoveringCached) {
      running = await launch(installed, [], "webview-a");
      const signature = await server.waitEvent("signature-rejected");
      if (signature.status.phase !== "idle") throw new Error("An invalid signature created an installation barrier");
    }
    async function releaseBlockedCopy(stage) {
      await server.waitEvent(stage);
      const disk = await waitFor(async () => {
        const value = await server.snapshot();
        return value?.control?.installation?.phase === "preparing" && value;
      }, "the durable preparation barrier");
      if (disk.schedules.backgroundEnabled || disk.schedules.runs.filter((item) => item.status === "running").length !== 1 || disk.schedules.runs.filter((item) => item.status === "queued").length !== 1) {
        throw new Error("Installation preparation changed the preference or lost its blocked/queued pair");
      }
      if (await sha256(installed) !== hashA) throw new Error("The installer replaced the application before the running backup finished");
      server.unblock();
    }
    if (!recoveringCached) await releaseBlockedCopy("failure-preparing");
    const [installerPid, installerPath] = await waitFor(async () => {
      const text = await fs.readFile(marker, "utf16le").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
      const fields = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
      return fields.length === 2 && /^\d+$/.test(fields[0]) && path.isAbsolute(fields[1]) && text.endsWith("\n") && fields;
    }, "the real failing installer process marker");
    const failureHash = await sha256(failure.file);
    await waitOwnedProcessExit(installerPath, failureHash, installerPid);
    if (running) await running.completion;
    if (await sha256(installed) !== hashA) throw new Error("The failing preinstall hook replaced or removed application A");
    const paused = await server.snapshot();
    if (paused.control.installation?.phase !== "committed" || paused.schedules.runs.filter((item) => item.status === "queued").length !== 1) throw new Error("External installer failure did not preserve a committed barrier and queue");
    server.state.phase = "recovery"; server.state.installerExited = true;
    running = await launch(installed, [], "webview-a-recovery");
    await server.waitEvent("failure-recovered");
    await releaseBlockedCopy("success-preparing");
    updated = await server.waitEvent("updated");
    if (updated.version !== toVersion || await sha256(installed) !== hashB) throw new Error("The successful installer did not run the actual B executable");
    await running.completion;
    }
    if (await sha256(installed) !== hashB) throw new Error("The installed image no longer matches the actual B executable");
    installedByTest = true;
    await waitOwnedProcessExit(installed, hashB);
    for (const item of updated.runs) {
      const file = await ownedBackupPath(path.join(directory, "backups"), item.filePath);
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" || db.prepare("SELECT id FROM sample").get().id !== 42) throw new Error("The installed updater lost SQLite backup contents");
      } finally { db.close(); }
    }
    const proof = { runId, identifier, productName, binaryName, fromVersion, toVersion, hashA, hashB, profile: server.state.data, signatureRejected: true,
      signatureError: server.state.events.find((event) => event.stage === "signature-rejected")?.signatureError ?? null,
      externalFailureRecovered: true, successfulUpdate: true, backupCount: updated.runs.length };
    await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(proof, null, 2));
    completed = true;
    const uninstaller = path.join(installDirectory, "uninstall.exe");
    await run(uninstaller, ["/S"], "uninstall-owned-fixture");
    await waitFor(async () => {
      try { await fs.stat(installed); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; }
    }, "the fixture uninstaller to remove its owned application");
    installedByTest = false;
    process.stdout.write(`Packaged updater acceptance passed; evidence: ${directory}\n`);
  }
} finally {
  server.state.phase = "shutdown";
  if (running && !completed) {
    await Promise.race([running.completion, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  await server.close();
  if (outputsChanged && sharedTarget) {
    await run("cargo", ["build", "--offline", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--bins"], "restore-original-binaries", {
      cwd: root, env: { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "0", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", TAURI_CONFIG: '{"bundle":{"externalBin":[]}}' },
    });
    if (profile === "release") {
      await run("cargo", ["build", "--offline", "--release", "--features", "tauri/custom-protocol", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--bins"], "restore-original-release-binaries", {
        cwd: root, env: { ...process.env, CARGO_TARGET_DIR: originalTarget, CARGO_INCREMENTAL: "0", STATIC_VCRUNTIME: "true", CARGO_PROFILE_RELEASE_OPT_LEVEL: "0", CARGO_PROFILE_RELEASE_DEBUG: "0", CARGO_PROFILE_RELEASE_LTO: "false", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "256", TAURI_CONFIG: '{"bundle":{"externalBin":[]},"build":{"features":["desktop"]}}' },
      });
    }
  }
  if (installedByTest) process.stdout.write(`The isolated fixture remains installed at ${installDirectory}; its data and logs are retained for diagnosis.\n`);
  if (!completed) process.stdout.write(`Updater fixture retained for review: ${directory}\n`);
}
