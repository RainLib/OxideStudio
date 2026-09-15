#!/usr/bin/env node
import {
  X509Certificate,
  createHash,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { targetBinding } from "./print-enterprise-target-binding.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY_DIRECTORY = join(ROOT, "enterprise", "deploy");
const RUNTIME_DIRECTORY = join(DEPLOY_DIRECTORY, ".local-runtime");
const COMPOSE_FILE = join(DEPLOY_DIRECTORY, "compose.yaml");
const ENV_FILE = join(DEPLOY_DIRECTORY, ".env");
const DEFAULT_ORGANIZATION_ID = "386f9632-7ac7-4fd3-974c-58716b66e988";
const LOCAL_PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const LOCAL_SOURCE_ID = "40000000-0000-4000-8000-000000000001";
const LOCAL_GRANT_ID = "70000000-0000-4000-8000-000000000201";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export function defaultDesktopConfigDirectory(environment = process.env, platform = process.platform) {
  if (platform === "win32" && environment.APPDATA) {
    return win32.join(environment.APPDATA, "com.houshuai.oxide-studio", "enterprise");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.houshuai.oxide-studio", "enterprise");
  }
  return join(
    environment.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "com.houshuai.oxide-studio",
    "enterprise",
  );
}

export function parseArguments(args) {
  const options = {
    organizationId: DEFAULT_ORGANIZATION_ID,
    configDirectory: defaultDesktopConfigDirectory(),
    resetCertificates: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--reset-certificates") {
      options.resetCertificates = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--organization-id") options.organizationId = value;
    else if (argument === "--desktop-config-directory") options.configDirectory = resolve(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  for (const [label, value] of [["organization", options.organizationId]]) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${label} id must be a UUID`);
  }
  return options;
}

function run(command, args, { input, quiet = false, cwd = ROOT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: [input === undefined ? "ignore" : "pipe", quiet ? "pipe" : "inherit", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => {
      stderr.push(chunk);
      if (!quiet) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(
        new Error(
          `${command} exited with ${code}${stderr.length ? `: ${Buffer.concat(stderr).toString("utf8").trim()}` : ""}`,
        ),
      );
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function compose(args, options) {
  return run("docker", [
    "compose", "-p", "oxide-enterprise-local",
    "--env-file", ENV_FILE, "-f", COMPOSE_FILE, ...args,
  ], options);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writePrivate(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function resolveOpenSsl(pkiDirectory) {
  try {
    await run("openssl", ["version"], { quiet: true });
    return (args) => run("openssl", args, { cwd: pkiDirectory });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error;
    process.stdout.write("Host OpenSSL was not found; using the Docker OpenSSL image.\n");
    return (args) => run("docker", [
      "run", "--rm", "-v", `${pkiDirectory}:/work`, "-w", "/work",
      "alpine/openssl", ...args,
    ]);
  }
}

async function createCertificateAuthority(pkiDirectory, openssl) {
  const key = join(pkiDirectory, "ca.key");
  const certificate = join(pkiDirectory, "ca.crt");
  await openssl([
    "req", "-x509", "-newkey", "rsa:3072", "-sha256", "-nodes", "-days", "3650",
    "-keyout", "ca.key", "-out", "ca.crt",
    "-subj", "/CN=OxideStudio Local Development CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  return { key, certificate };
}

async function createSignedCertificate({
  pkiDirectory,
  ca,
  name,
  commonName,
  extendedKeyUsage,
  subjectAlternativeName,
  openssl,
}) {
  const key = join(pkiDirectory, `${name}.key`);
  const request = join(pkiDirectory, `${name}.csr`);
  const certificate = join(pkiDirectory, `${name}.crt`);
  const extensions = join(pkiDirectory, `${name}.ext`);
  const lines = [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    `extendedKeyUsage=${extendedKeyUsage}`,
  ];
  if (subjectAlternativeName) lines.push(`subjectAltName=${subjectAlternativeName}`);
  await writeFile(extensions, `${lines.join("\n")}\n`);
  await openssl([
    "req", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${commonName}`,
  ]);
  await openssl([
    "x509", "-req", "-sha256", "-days", "825",
    "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key",
    "-CAcreateserial", "-out", `${name}.crt`, "-extfile", `${name}.ext`,
  ]);
  return { key, certificate };
}

async function ensurePki(resetCertificates) {
  const pkiDirectory = join(RUNTIME_DIRECTORY, "pki");
  const gatewayDirectory = join(RUNTIME_DIRECTORY, "gateway");
  const gatewayTlsDirectory = join(gatewayDirectory, "tls");
  const gatewaySecretDirectory = join(gatewayDirectory, "secrets");
  const desktopDirectory = join(RUNTIME_DIRECTORY, "desktop");
  const required = [
    join(gatewayTlsDirectory, "ca.crt"),
    join(gatewayTlsDirectory, "gateway.crt"),
    join(gatewayTlsDirectory, "gateway.key"),
    join(desktopDirectory, "ca.crt"),
    join(desktopDirectory, "client.crt"),
    join(desktopDirectory, "client.key"),
    join(gatewaySecretDirectory, "enrollment-signing-key"),
    join(gatewaySecretDirectory, "enrollment-public-key"),
  ];
  if (resetCertificates || !(await Promise.all(required.map(exists))).every(Boolean)) {
    if (!RUNTIME_DIRECTORY.startsWith(DEPLOY_DIRECTORY)) {
      throw new Error("refusing to reset a runtime directory outside enterprise/deploy");
    }
    await rm(RUNTIME_DIRECTORY, { recursive: true, force: true });
    await mkdir(pkiDirectory, { recursive: true });
    await mkdir(gatewayTlsDirectory, { recursive: true });
    await mkdir(gatewaySecretDirectory, { recursive: true });
    await mkdir(desktopDirectory, { recursive: true });
    const openssl = await resolveOpenSsl(pkiDirectory);
    const ca = await createCertificateAuthority(pkiDirectory, openssl);
    const gateway = await createSignedCertificate({
      pkiDirectory,
      ca,
      name: "gateway",
      commonName: "localhost",
      extendedKeyUsage: "serverAuth",
      subjectAlternativeName: "DNS:localhost,DNS:gateway,IP:127.0.0.1",
      openssl,
    });
    const client = await createSignedCertificate({
      pkiDirectory,
      ca,
      name: "client",
      commonName: "OxideStudio Local Desktop",
      extendedKeyUsage: "clientAuth",
      openssl,
    });
    await Promise.all([
      copyFile(ca.certificate, join(gatewayTlsDirectory, "ca.crt")),
      copyFile(gateway.certificate, join(gatewayTlsDirectory, "gateway.crt")),
      copyFile(gateway.key, join(gatewayTlsDirectory, "gateway.key")),
      copyFile(ca.certificate, join(desktopDirectory, "ca.crt")),
      copyFile(client.certificate, join(desktopDirectory, "client.crt")),
      copyFile(client.key, join(desktopDirectory, "client.key")),
    ]);
    const pair = generateKeyPairSync("ed25519");
    const privateDer = pair.privateKey.export({ type: "pkcs8", format: "der" });
    const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
    const privateSeed = privateDer.subarray(privateDer.length - 32);
    const publicKey = publicDer.subarray(publicDer.length - 32);
    if (privateSeed.length !== 32 || publicKey.length !== 32) {
      throw new Error("could not export the local Gateway Ed25519 identity");
    }
    await writePrivate(
      join(gatewaySecretDirectory, "enrollment-signing-key"),
      `${privateSeed.toString("base64")}\n`,
    );
    await writeFile(
      join(gatewaySecretDirectory, "enrollment-public-key"),
      `${publicKey.toString("base64")}\n`,
    );
  }
  return {
    gatewayDirectory,
    desktopDirectory,
    gatewayCertificate: join(gatewayTlsDirectory, "gateway.crt"),
    clientCertificate: join(desktopDirectory, "client.crt"),
    clientPrivateKey: join(desktopDirectory, "client.key"),
    caCertificate: join(desktopDirectory, "ca.crt"),
    enrollmentPublicKey: join(gatewaySecretDirectory, "enrollment-public-key"),
  };
}

function certificateFingerprint(pem) {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("hex");
}

async function waitFor(url, label, seconds = 90) {
  const deadline = Date.now() + seconds * 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || "timeout"}`);
}

async function configureDesktop(configDirectory, env, pki) {
  await mkdir(configDirectory, { recursive: true });
  const accountPath = join(configDirectory, "account.json");
  let current = {};
  if (await exists(accountPath)) {
    current = JSON.parse(await readFile(accountPath, "utf8"));
  }
  const config = {
    ...current,
    controlPlaneUrl: current.controlPlaneUrl || env.OXIDE_CONTROL_PLANE_PUBLIC_URL || "http://localhost:8787",
    oidcIssuer: current.oidcIssuer || env.CASDOOR_PUBLIC_URL || "http://localhost:8000",
    oidcClientId: current.oidcClientId || env.CASDOOR_CLIENT_ID,
    gatewayCaCertificatePath: pki.caCertificate,
    gatewayClientCertificatePath: pki.clientCertificate,
    gatewayClientPrivateKeyPath: pki.clientPrivateKey,
  };
  if (!config.oidcClientId || config.oidcClientId.startsWith("replace-with-")) {
    throw new Error("CASDOOR_CLIENT_ID must be configured before bootstrapping enterprise access");
  }
  await writePrivate(accountPath, `${JSON.stringify(config, null, 2)}\n`);
  const devicePath = join(configDirectory, "device-id");
  const deviceId = (await exists(devicePath))
    ? (await readFile(devicePath, "utf8")).trim()
    : randomUUID();
  if (!UUID_PATTERN.test(deviceId)) throw new Error("desktop enterprise device-id is invalid");
  await writePrivate(devicePath, `${deviceId}\n`);
  return { deviceId, accountPath };
}

export function localDatabaseUrl(env) {
  const configured = env.OXIDE_GATEWAY_DATA_SOURCE_URL?.trim();
  if (
    configured &&
    !configured.includes("replace-me") &&
    !configured.includes("database.internal")
  ) {
    return configured;
  }
  const password = env.POSTGRES_PASSWORD?.trim();
  if (!password || password.startsWith("replace-with-")) {
    throw new Error("POSTGRES_PASSWORD must be configured in enterprise/deploy/.env");
  }
  // Keep the database port explicit in the Gateway-local URL. Besides making
  // the generated source self-describing, this prevents different URL
  // libraries from disagreeing about defaults for non-HTTP schemes while the
  // target binding is verified at the data-plane boundary.
  return `postgres://oxide:${encodeURIComponent(password)}@postgres:5432/oxide_enterprise?sslmode=disable`;
}

function bootstrapSql({ organizationId, gatewayId, gatewayFingerprint, publicKey, target, deviceId, clientFingerprint }) {
  for (const value of [organizationId, gatewayId, LOCAL_PROJECT_ID, LOCAL_SOURCE_ID, LOCAL_GRANT_ID, deviceId]) {
    if (!UUID_PATTERN.test(value)) throw new Error("local bootstrap contains an invalid UUID");
  }
  for (const value of [gatewayFingerprint, target, clientFingerprint]) {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("local bootstrap contains an invalid fingerprint");
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) throw new Error("Gateway public key is invalid");
  return `\\set ON_ERROR_STOP on
DO $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT m.user_id INTO owner_id
  FROM organization_memberships m
  WHERE m.organization_id = '${organizationId}'
    AND m.status = 'active' AND m.organization_role = 'owner'
  ORDER BY m.created_at LIMIT 1;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Local enterprise organization has no active owner. Sign in and create the organization first.';
  END IF;

  INSERT INTO managed_projects (id, organization_id, display_name, policy_revision)
  VALUES ('${LOCAL_PROJECT_ID}', '${organizationId}', 'Local Enterprise', 'local-dev-1')
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id,
    display_name = EXCLUDED.display_name, policy_revision = EXCLUDED.policy_revision, updated_at = now();

  INSERT INTO gateways
    (id, organization_id, display_name, direct_endpoint, status, last_seen_at,
     certificate_fingerprint, enrollment_public_key, enrollment_token_hash,
     enrollment_expires_at, activated_at)
  VALUES ('${gatewayId}', '${organizationId}', 'Local Development Gateway',
    'https://localhost:8790', 'active', now(), '${gatewayFingerprint}', '${publicKey}',
    NULL, NULL, now())
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id,
    display_name = EXCLUDED.display_name, direct_endpoint = EXCLUDED.direct_endpoint,
    status = 'active', last_seen_at = now(), certificate_fingerprint = EXCLUDED.certificate_fingerprint,
    enrollment_public_key = EXCLUDED.enrollment_public_key, enrollment_token_hash = NULL,
    enrollment_expires_at = NULL, activated_at = now(),
    pending_certificate_fingerprint = NULL, certificate_rotation_token_hash = NULL,
    certificate_rotation_expires_at = NULL;

  INSERT INTO data_sources
    (id, organization_id, project_id, gateway_id, driver, display_name,
     capabilities, allowed_resource_summary, policy_revision, target_binding)
  VALUES ('${LOCAL_SOURCE_ID}', '${organizationId}', '${LOCAL_PROJECT_ID}', '${gatewayId}',
    'postgres', 'Local Enterprise PostgreSQL',
    '["resource.discover","metadata.read","query.read"]', '["oxide_enterprise"]',
    'local-dev-1', '${target}')
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id,
    project_id = EXCLUDED.project_id, gateway_id = EXCLUDED.gateway_id,
    driver = EXCLUDED.driver, display_name = EXCLUDED.display_name,
    capabilities = EXCLUDED.capabilities, allowed_resource_summary = EXCLUDED.allowed_resource_summary,
    policy_revision = EXCLUDED.policy_revision, target_binding = EXCLUDED.target_binding, updated_at = now();

  INSERT INTO project_assignments (project_id, principal_kind, principal_id)
  VALUES ('${LOCAL_PROJECT_ID}', 'user', owner_id) ON CONFLICT DO NOTHING;

  INSERT INTO managed_devices
    (organization_id, user_id, device_id, certificate_fingerprint, display_name,
     status, enrolled_by, enrolled_at)
  VALUES ('${organizationId}', owner_id, '${deviceId}', '${clientFingerprint}',
    'Local OxideStudio Desktop', 'active', owner_id, now())
  ON CONFLICT (organization_id, user_id, device_id) DO UPDATE SET
    certificate_fingerprint = EXCLUDED.certificate_fingerprint,
    display_name = EXCLUDED.display_name, status = 'active', revoked_at = NULL,
    enrolled_by = EXCLUDED.enrolled_by, enrolled_at = now();

  INSERT INTO access_grants
    (id, organization_id, project_id, principal_kind, principal_id,
     data_source_id, resource_path, actions, effect)
  VALUES ('${LOCAL_GRANT_ID}', '${organizationId}', '${LOCAL_PROJECT_ID}', 'user', owner_id,
    '${LOCAL_SOURCE_ID}', '["oxide_enterprise"]',
    '["resource.discover","metadata.read","query.read"]', 'permit')
  ON CONFLICT (id) DO UPDATE SET principal_id = EXCLUDED.principal_id,
    resource_path = EXCLUDED.resource_path, actions = EXCLUDED.actions, effect = 'permit';
END $$;
`;
}

async function waitForGatewayTls(pki, seconds = 90) {
  const tls = await import("node:tls");
  const options = {
    host: "localhost",
    port: 8790,
    servername: "localhost",
    ca: await readFile(pki.caCertificate),
    cert: await readFile(pki.clientCertificate),
    key: await readFile(pki.clientPrivateKey),
    ALPNProtocols: ["h2"],
    rejectUnauthorized: true,
  };
  const deadline = Date.now() + seconds * 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolvePromise, reject) => {
        const socket = tls.connect(options, () => {
          const authorized = socket.authorized && socket.alpnProtocol === "h2";
          socket.end();
          authorized ? resolvePromise() : reject(new Error(socket.authorizationError || "HTTP/2 was not negotiated"));
        });
        socket.setTimeout(5_000, () => socket.destroy(new Error("TLS timeout")));
        socket.once("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`Gateway mTLS did not become ready: ${lastError?.message || "timeout"}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const env = parseEnvFile(await readFile(ENV_FILE, "utf8"));
  const gatewayId = env.OXIDE_GATEWAY_ID?.trim();
  if (!gatewayId || !UUID_PATTERN.test(gatewayId)) {
    throw new Error("OXIDE_GATEWAY_ID must be a UUID in enterprise/deploy/.env");
  }
  await run("docker", ["version", "--format", "{{.Server.Version}}"], { quiet: true });
  const pki = await ensurePki(options.resetCertificates);
  const databaseUrl = localDatabaseUrl(env);
  const target = targetBinding("postgres", databaseUrl);
  await writePrivate(
    join(pki.gatewayDirectory, "gateway.env"),
    `OXIDE_SECRET_DEV_DATABASE=${databaseUrl}\n`,
  );
  await writeFile(
    join(pki.gatewayDirectory, "sources.json"),
    `${JSON.stringify([{
      id: LOCAL_SOURCE_ID,
      driver: "postgres",
      targetBinding: target,
      secretRef: "env:OXIDE_SECRET_DEV_DATABASE",
      connectionTemplate: null,
      allowInsecureTransport: true,
      capabilities: ["resource.discover", "metadata.read", "query.read"],
    }], null, 2)}\n`,
  );
  const desktop = await configureDesktop(options.configDirectory, env, pki);
  await compose(["up", "-d", "postgres", "casdoor", "control-plane", "admin-web"]);
  await waitFor(`${env.OXIDE_CONTROL_PLANE_PUBLIC_URL || "http://localhost:8787"}/healthz`, "control plane");
  const sql = bootstrapSql({
    organizationId: options.organizationId,
    gatewayId,
    gatewayFingerprint: certificateFingerprint(await readFile(pki.gatewayCertificate)),
    publicKey: (await readFile(pki.enrollmentPublicKey, "utf8")).trim(),
    target,
    deviceId: desktop.deviceId,
    clientFingerprint: certificateFingerprint(await readFile(pki.clientCertificate)),
  });
  await compose(["exec", "-T", "postgres", "psql", "-U", "oxide", "-d", "oxide_enterprise"], { input: sql });
  // Build the data plane explicitly. `compose up --build gateway` also rebuilds
  // build-backed dependencies such as the control plane, wasting several GB
  // and making the local bootstrap substantially slower.
  await compose(["--profile", "gateway", "build", "gateway"]);
  await compose(["--profile", "gateway", "up", "-d", "--no-build", "gateway"]);
  await waitForGatewayTls(pki);
  process.stdout.write("\nEnterprise local data plane is ready.\n");
  process.stdout.write(`Desktop account configuration: ${desktop.accountPath}\n`);
  process.stdout.write("Refresh enterprise projects in OxideStudio, then open Local Enterprise PostgreSQL.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Enterprise local bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
