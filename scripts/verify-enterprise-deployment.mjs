#!/usr/bin/env node

const configuration = {
  casdoorUrl: normalizedUrl(
    process.env.CASDOOR_PUBLIC_URL || process.env.OXIDE_OIDC_ISSUER || "http://localhost:8000",
  ),
  controlPlaneUrl: normalizedUrl(
    process.env.OXIDE_CONTROL_PLANE_PUBLIC_URL || "http://localhost:8787",
  ),
  adminWebUrl: normalizedUrl(
    process.env.OXIDE_ADMIN_WEB_URL || "http://localhost:1430",
  ),
  clientId: usableValue(process.env.CASDOOR_CLIENT_ID),
  accessToken: usableValue(process.env.OXIDE_VERIFY_ACCESS_TOKEN),
  organizationId: usableValue(process.env.OXIDE_VERIFY_ORGANIZATION_ID),
  waitSeconds: positiveInteger(process.env.OXIDE_VERIFY_WAIT_SECONDS, 90),
};

const passed = [];

function normalizedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`expected an HTTP(S) URL, received ${value}`);
  }
  return url.href.replace(/\/$/, "");
}

function usableValue(value) {
  const trimmed = value?.trim();
  return trimmed && !trimmed.startsWith("replace-with-") ? trimmed : undefined;
}

function positiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received ${value}`);
  }
  return parsed;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(url, init = {}) {
  const signal = AbortSignal.timeout(10_000);
  return fetch(url, { redirect: "manual", ...init, signal });
}

async function eventually(label, check) {
  const deadline = Date.now() + configuration.waitSeconds * 1_000;
  let lastError;
  do {
    try {
      const value = await check();
      passed.push(label);
      return value;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } while (true);
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function jsonResponse(url, init) {
  const response = await request(url, init);
  invariant(response.ok, `${url} returned HTTP ${response.status}`);
  return { response, body: await response.json() };
}

async function verifyCasdoor() {
  const discoveryUrl = `${configuration.casdoorUrl}/.well-known/openid-configuration`;
  const discovery = await eventually("Casdoor OIDC discovery", async () => {
    const { body } = await jsonResponse(discoveryUrl);
    invariant(body.issuer === configuration.casdoorUrl, `issuer is ${body.issuer}`);
    invariant(typeof body.jwks_uri === "string", "jwks_uri is missing");
    invariant(typeof body.authorization_endpoint === "string", "authorization endpoint is missing");
    invariant(typeof body.token_endpoint === "string", "token endpoint is missing");
    invariant(
      Array.isArray(body.code_challenge_methods_supported) &&
        body.code_challenge_methods_supported.includes("S256"),
      "PKCE S256 is not advertised",
    );
    return body;
  });

  await eventually("Casdoor signing keys", async () => {
    const { body } = await jsonResponse(discovery.jwks_uri);
    invariant(Array.isArray(body.keys) && body.keys.length > 0, "JWKS contains no keys");
    invariant(
      body.keys.every((key) => typeof key.kid === "string" && typeof key.kty === "string"),
      "JWKS contains an unusable key",
    );
  });
}

async function verifyControlPlane() {
  await eventually("control-plane health", async () => {
    const response = await request(`${configuration.controlPlaneUrl}/healthz`);
    invariant(response.ok, `health endpoint returned HTTP ${response.status}`);
    invariant((await response.text()).trim() === "ok", "health endpoint did not return ok");
  });

  await eventually("control-plane authentication gate", async () => {
    const response = await request(`${configuration.controlPlaneUrl}/v1/me`);
    invariant(response.status === 401, `unauthenticated request returned HTTP ${response.status}`);
  });

  await eventually("control-plane CORS policy", async () => {
    const response = await request(`${configuration.controlPlaneUrl}/v1/me`, {
      method: "OPTIONS",
      headers: {
        origin: configuration.adminWebUrl,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    invariant(response.ok, `preflight returned HTTP ${response.status}`);
    invariant(
      response.headers.get("access-control-allow-origin") === configuration.adminWebUrl,
      "admin origin is not allowed",
    );
    invariant(
      response.headers.get("access-control-allow-headers")?.toLowerCase().includes("authorization"),
      "Authorization header is not allowed",
    );
  });
}

async function verifyAdminWeb() {
  await eventually("admin web bundle and security policy", async () => {
    const response = await request(`${configuration.adminWebUrl}/`);
    invariant(response.ok, `admin web returned HTTP ${response.status}`);
    invariant(response.headers.get("x-content-type-options") === "nosniff", "nosniff header is missing");
    invariant(response.headers.get("referrer-policy") === "no-referrer", "referrer policy is missing");
    const csp = response.headers.get("content-security-policy") || "";
    for (const endpoint of [configuration.casdoorUrl, configuration.controlPlaneUrl]) {
      const origin = new URL(endpoint);
      invariant(
        csp.includes(origin.protocol === "https:" ? "https:" : origin.origin),
        `CSP does not allow ${origin.origin}`,
      );
    }
    const html = await response.text();
    invariant(html.includes('id="root"'), "React mount point is missing");
    const runtimeConfigIndex = html.indexOf('src="/config.js"');
    const applicationBundleIndex = html.indexOf('src="/assets/');
    invariant(
      runtimeConfigIndex >= 0 &&
        applicationBundleIndex >= 0 &&
        runtimeConfigIndex < applicationBundleIndex,
      "runtime configuration is not loaded before the application bundle",
    );
    const runtimeConfigResponse = await request(`${configuration.adminWebUrl}/config.js`);
    invariant(runtimeConfigResponse.ok, `runtime config returned HTTP ${runtimeConfigResponse.status}`);
    const runtimeConfig = await runtimeConfigResponse.text();
    invariant(runtimeConfig.includes(configuration.casdoorUrl), "runtime config contains the wrong Casdoor issuer");
    invariant(
      runtimeConfig.includes(configuration.controlPlaneUrl),
      "runtime config contains the wrong control-plane URL",
    );
    if (configuration.clientId) {
      invariant(runtimeConfig.includes(configuration.clientId), "runtime config contains the wrong Casdoor Client ID");
    }
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    const moduleScripts = scripts.filter((source) => source !== "/config.js");
    invariant(moduleScripts.length > 0, "compiled JavaScript entry is missing");
    const bundle = await Promise.all(
      moduleScripts.map(async (source) => {
        const assetUrl = new URL(source, `${configuration.adminWebUrl}/`);
        const asset = await request(assetUrl);
        invariant(asset.ok, `${assetUrl} returned HTTP ${asset.status}`);
        return asset.text();
      }),
    );
    const source = bundle.join("\n");
    invariant(source.includes("config.js") || source.includes("__OXIDE_ENTERPRISE_CONFIG__"), "bundle does not consume runtime configuration");
  });
}

async function verifyAuthenticatedApi() {
  if (!configuration.accessToken) return;
  const headers = { authorization: `Bearer ${configuration.accessToken}` };
  await eventually("authenticated control-plane identity", async () => {
    const { body } = await jsonResponse(`${configuration.controlPlaneUrl}/v1/me`, { headers });
    invariant(body?.user?.id, "authenticated response does not contain a user");
    invariant(Array.isArray(body.memberships), "authenticated response does not contain memberships");
  });
  if (!configuration.organizationId) return;
  await eventually("authenticated organization overview", async () => {
    const { body } = await jsonResponse(
      `${configuration.controlPlaneUrl}/v1/admin/organizations/${encodeURIComponent(configuration.organizationId)}/overview`,
      { headers },
    );
    invariant(body?.organization?.id === configuration.organizationId, "organization response does not match");
  });
}

async function main() {
  await verifyCasdoor();
  await verifyControlPlane();
  await verifyAdminWeb();
  await verifyAuthenticatedApi();
  for (const check of passed) console.log(`PASS ${check}`);
  if (!configuration.accessToken) {
    console.log("SKIP authenticated API checks (set OXIDE_VERIFY_ACCESS_TOKEN to enable)");
  }
  console.log(`Verified Casdoor, control plane, and admin web (${passed.length} checks).`);
}

main().catch((error) => {
  console.error(`Enterprise deployment verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
