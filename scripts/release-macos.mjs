import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateSigningEnvironment(environment) {
  const required = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_SIGNING_IDENTITY"];
  const missing = required.filter(name => !environment[name]?.trim());
  if (missing.length) throw new Error(`Complete ${missing.join(", ")} in the project root .env, then run npm run release:macos again.`);
  if (!environment.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application:")) {
    throw new Error("APPLE_SIGNING_IDENTITY must name a Developer ID Application certificate in your macOS Keychain.");
  }
  if (!environment.APPLE_SIGNING_IDENTITY.endsWith(`(${environment.APPLE_TEAM_ID})`)) {
    throw new Error("APPLE_TEAM_ID must match the selected Developer ID Application certificate.");
  }
}

function run(command, args, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} failed (${signal || `exit ${code}`}).`)));
  });
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function capture(command, args, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", rejectPromise);
    child.once("close", code => {
      if (code === 0) resolvePromise(stdout);
      else {
        const detail = `${stderr}\n${stdout}`.replaceAll(environment.APPLE_PASSWORD, "[REDACTED]");
        rejectPromise(new Error(`${command} failed (exit ${code}): ${detail}`));
      }
    });
  });
}

async function notarize(archive, label, output, environment) {
  // Credentials are passed directly to Apple's tool, never through a shell or logs.
  const auth = ["--apple-id", environment.APPLE_ID, "--password", environment.APPLE_PASSWORD, "--team-id", environment.APPLE_TEAM_ID];
  const submission = JSON.parse(await capture("xcrun", ["notarytool", "submit", archive, ...auth, "--output-format", "json"], environment));
  const reportPath = join(output, `notarization-${label}.json`);
  await writeFile(reportPath, `${JSON.stringify(submission, null, 2)}\n`);
  console.log(`[macOS release] ${label} submitted to Apple: ${submission.id}. Waiting for notarization.`);
  const result = JSON.parse(await capture("xcrun", ["notarytool", "wait", submission.id, ...auth, "--timeout", "30m", "--output-format", "json"], environment));
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "Accepted") {
    const log = await capture("xcrun", ["notarytool", "log", submission.id, ...auth], environment);
    await writeFile(join(output, `notarization-${label}-log.json`), log);
    throw new Error(`Apple notarization returned ${result.status}. Review ${reportPath} and the adjacent notarization log.`);
  }
  console.log(`[macOS release] Apple accepted ${label}.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run release:macos -- [--bundle-only] [--check] [--target <triple>]\n\nReads signing and notarization credentials from the project root .env.\n--bundle-only  Repackage an existing release build without recompiling.\n--check        Validate configuration and the local signing identity only.");
    return;
  }
  if (process.platform !== "darwin") throw new Error("Run this command on macOS with Xcode installed.");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--target" && args[i + 1]) { i += 1; continue; }
    if (!["--bundle-only", "--check"].includes(args[i])) throw new Error(`Unknown or incomplete option: ${args[i]}. Run npm run release:macos -- --help.`);
  }
  const envPath = join(root, ".env");
  await access(envPath).catch(() => { throw new Error("Copy .env.example to .env and fill in your local macOS release credentials."); });
  await chmod(envPath, 0o600);
  loadEnvFile(envPath);
  validateSigningEnvironment(process.env);
  const environment = { ...process.env };
  // This command uses the explicitly configured Apple ID authentication mode.
  for (const name of ["APPLE_API_KEY", "APPLE_API_KEY_PATH", "APPLE_API_ISSUER"]) delete environment[name];
  const rustDetails = execFileSync("rustc", ["-vV"], { env: environment, encoding: "utf8" });
  const host = rustDetails.match(/^host:\s*(.+)$/mu)?.[1]?.trim();
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] : host;
  if (!["x86_64-apple-darwin", "aarch64-apple-darwin"].includes(target)) throw new Error("Choose x86_64-apple-darwin or aarch64-apple-darwin as the macOS release target.");
  // SQL LSP preparation currently builds for the host architecture.
  if (target !== host) throw new Error("Build on a Mac matching the requested target so the SQL LSP and auxiliary programs have the correct architecture.");
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (!identities.includes(`"${environment.APPLE_SIGNING_IDENTITY}"`)) throw new Error("The configured Developer ID certificate and private key are not available in this Mac's Keychain.");
  console.log(`[macOS release] Signing configuration ready for ${target}. Credentials are not printed.`);
  if (args.includes("--check")) return;

  const tauri = join(root, "node_modules", ".bin", "tauri");
  if (!args.includes("--bundle-only")) await run(tauri, ["build", "--target", target, "--no-bundle"], environment);
  const release = join(resolve(root, environment.CARGO_TARGET_DIR || "src-tauri/target"), target, "release");
  await access(join(release, "oxide-studio"));
  await access(join(root, "dist", "index.html"));
  const config = JSON.parse(await readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const app = join(release, "bundle", "macos", `${config.productName}.app`);
  const output = join(root, "output", "macos-release", config.version, target);
  await mkdir(output, { recursive: true });
  // Sign the completed bundle inside out so Tauri cannot overwrite Node's
  // per-binary JIT entitlement or invalidate the SQL LSP integrity manifest.
  await run(tauri, ["bundle", "--target", target, "--bundles", "app", "--no-sign", "--ci"], environment);
  const contents = join(app, "Contents");
  const runtimePaths = [
    join(contents, "Resources", "sql-lsp"),
    ...["oxide-agent", "oxide-agent-host", "oxide-agent-rocketmq"].map(name => join(contents, "MacOS", name)),
  ];
  const architecture = target.startsWith("aarch64") ? "arm64" : "x86_64";
  await run("lipo", [join(contents, "MacOS", "oxide-studio"), "-verify_arch", architecture], environment);
  for (const binary of runtimePaths) {
    await run("lipo", [binary, "-verify_arch", architecture], environment);
    const signArgs = ["--force", "--options", "runtime", "--timestamp"];
    if (binary.endsWith("/oxide-agent-host")) signArgs.push("--entitlements", join(root, "src-tauri", "entitlements", "agent-host.plist"));
    await run("codesign", [...signArgs, "--sign", environment.APPLE_SIGNING_IDENTITY, binary], environment);
    await run("codesign", ["--verify", "--strict", binary], environment);
  }
  // Signing changes the resource bytes; keep the runtime integrity check valid.
  const manifestPath = join(contents, "Resources", "sql-lsp.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.sha256 = await digest(join(contents, "Resources", "sql-lsp"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await run("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", environment.APPLE_SIGNING_IDENTITY, app], environment);
  await run("codesign", ["--verify", "--deep", "--strict", app], environment);
  const entitlements = execFileSync("codesign", ["-d", "--entitlements", ":-", join(app, "Contents", "MacOS", "oxide-agent-host")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/u.test(entitlements)) throw new Error("The bundled Agent Host lost its required JIT entitlement. Release verification stopped.");
  if (!/<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>\s*<true\s*\/>/u.test(entitlements)) throw new Error("The bundled Agent Host lost its required V8 executable-memory entitlement. Release verification stopped.");
  const bundledLspHash = await digest(join(app, "Contents", "Resources", "sql-lsp"));
  const bundledManifest = JSON.parse(await readFile(join(app, "Contents", "Resources", "sql-lsp.manifest.json"), "utf8"));
  if (bundledLspHash !== bundledManifest.sha256) throw new Error("Bundled SQL LSP integrity verification failed after signing.");
  await run(process.execPath, ["scripts/smoke-agent-host.mjs", "--binary", join(app, "Contents", "MacOS", "oxide-agent-host")], environment);
  const zip = join(output, `${config.productName}.notarization.zip`);
  await run("ditto", ["-c", "-k", "--keepParent", "--sequesterRsrc", app, zip], environment);
  await notarize(zip, "app", output, environment);
  await run("xcrun", ["stapler", "staple", app], environment);
  await run("xcrun", ["stapler", "validate", app], environment);
  await run("spctl", ["--assess", "--type", "execute", "--verbose=2", app], environment);
  const dmgName = `${config.productName}_${config.version}_${architecture === "arm64" ? "aarch64" : "x64"}.dmg`;
  const dmg = join(output, dmgName);
  const staging = await mkdtemp(join(output, ".dmg-stage-"));
  try {
    await run("ditto", [app, join(staging, `${config.productName}.app`)], environment);
    await symlink("/Applications", join(staging, "Applications"));
    await run("hdiutil", ["create", "-volname", config.productName, "-srcfolder", staging, "-ov", "-format", "UDZO", dmg], environment);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await run("codesign", ["--force", "--timestamp", "--sign", environment.APPLE_SIGNING_IDENTITY, dmg], environment);
  await notarize(dmg, "dmg", output, environment);
  await run("xcrun", ["stapler", "staple", dmg], environment);
  await run("xcrun", ["stapler", "validate", dmg], environment);
  await run("codesign", ["--verify", "--verbose=2", dmg], environment);
  await run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg], environment);
  await run("hdiutil", ["verify", dmg], environment);
  await writeFile(join(output, `${dmgName}.sha256`), `${await digest(dmg)}  ${dmgName}\n`);
  console.log(`[macOS release] Verified signed and notarized installer: ${join(output, dmgName)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`[macOS release] ${error.message}`);
    process.exitCode = 1;
  });
}
