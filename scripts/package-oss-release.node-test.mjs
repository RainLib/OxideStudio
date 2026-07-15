import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { packageOssRelease } from "./package-oss-release.mjs";
import {
  normalizeReleaseBaseUrl,
  resolveReleaseBaseUrl,
  writeReleaseConfig,
} from "./write-tauri-release-config.mjs";
import {
  assertPlatformSigningPolicy,
  resolvePlatformSigning,
} from "./resolve-platform-signing.mjs";
import {
  verifyOssRelease,
  verifyVersionedOssRelease,
} from "./verify-oss-release.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "oxide-release-"));
  const input = join(root, "release-input");
  const output = join(root, "release-output");
  const assets = {
    "macos-aarch64": [
      "OxideStudio.app.tar.gz",
      "OxideStudio_0.1.1_aarch64.dmg",
      "oxide-agent-aarch64-apple-darwin",
    ],
    "macos-x86_64": [
      "OxideStudio.app.tar.gz",
      "OxideStudio_0.1.1_x64.dmg",
      "oxide-agent-x86_64-apple-darwin",
    ],
    "linux-x86_64": [
      "OxideStudio_0.1.1_amd64.AppImage",
      "OxideStudio_0.1.1_amd64.deb",
      "oxide-agent-x86_64-unknown-linux-gnu",
    ],
    "windows-x86_64": [
      "OxideStudio_0.1.1_x64-setup.exe",
      "OxideStudio_0.1.1_x64_en-US.msi",
      "oxide-agent-x86_64-pc-windows-msvc.exe",
    ],
  };

  for (const [artifactId, names] of Object.entries(assets)) {
    const directory = join(input, `tauri-bundle-${artifactId}`);
    await mkdir(directory, { recursive: true });
    for (const name of names) {
      const path = join(directory, name);
      await writeFile(path, `${artifactId}:${name}`, "utf8");
      if (/\.app\.tar\.gz$|\.AppImage$|-setup\.exe$/i.test(name)) {
        await writeFile(`${path}.sig`, `signature:${artifactId}`, "utf8");
      }
    }
  }

  for (const directory of ["appimage/resources", "deb/data/usr/lib/oxide-studio"]) {
    const resources = join(input, "tauri-bundle-linux-x86_64", directory);
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "sql-lsp.exe"), "bundled resource", "utf8");
    await writeFile(
      join(resources, "oxide-agent-host-x86_64-unknown-linux-gnu"),
      "bundled sidecar",
      "utf8"
    );
  }

  return { root, input, output };
}

async function versionVerificationFixture() {
  const root = await mkdtemp(join(tmpdir(), "oxide-public-release-"));
  const baseUrl = "https://downloads.example.com/releases";
  const version = "0.1.2";
  const names = {
    "darwin-aarch64": "OxideStudio-arm.app.tar.gz",
    "darwin-x86_64": "OxideStudio-intel.app.tar.gz",
    "linux-x86_64": "OxideStudio.AppImage",
    "windows-x86_64": "OxideStudio-setup.exe",
  };
  const contents = new Map();
  const files = Object.entries(names).map(([target, name]) => {
    const body = Buffer.from(`immutable:${target}:${name}`, "utf8");
    const url = `${baseUrl}/v${version}/${target}/${encodeURIComponent(name)}`;
    contents.set(url, body);
    return {
      target,
      platform: target.startsWith("darwin")
        ? "macos"
        : target.startsWith("windows")
          ? "windows"
          : "linux",
      name,
      size: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      url,
    };
  });
  const release = {
    version,
    tag: `v${version}`,
    pub_date: "2026-07-15T00:00:00.000Z",
    files,
  };
  const latest = {
    version,
    platforms: Object.fromEntries(
      files.map((file) => [
        file.target,
        { signature: `signature:${file.target}`, url: file.url },
      ])
    ),
  };
  const expectedReleaseIndexPath = join(root, "release.json");
  await writeFile(
    expectedReleaseIndexPath,
    `${JSON.stringify(release, null, 2)}\n`,
    "utf8"
  );
  return {
    root,
    baseUrl,
    version,
    release,
    latest,
    contents,
    expectedReleaseIndexPath,
  };
}

test("builds signed updater metadata for every desktop target", async () => {
  const files = await fixture();
  try {
    const result = await packageOssRelease({
      input: files.input,
      output: files.output,
      version: "0.1.1",
      baseUrl: "https://downloads.example.com/",
      objectPrefix: "oxide-studio/releases",
      pubDate: "2026-07-14T00:00:00.000Z",
    });

    assert.equal(result.latest.version, "0.1.1");
    assert.deepEqual(Object.keys(result.latest.platforms).sort(), [
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.notEqual(
      result.latest.platforms["darwin-aarch64"].url,
      result.latest.platforms["darwin-x86_64"].url
    );
    assert.notEqual(
      result.latest.platforms["darwin-aarch64"].signature,
      result.latest.platforms["darwin-x86_64"].signature
    );
    assert.match(
      result.latest.platforms["darwin-aarch64"].url,
      /oxide-studio\/releases\/v0\.1\.1\/darwin-aarch64\/OxideStudio\.app\.tar\.gz$/
    );
    assert.match(
      result.latest.platforms["darwin-x86_64"].url,
      /oxide-studio\/releases\/v0\.1\.1\/darwin-x86_64\/OxideStudio\.app\.tar\.gz$/
    );
    assert.match(
      result.latest.platforms["windows-x86_64"].url,
      /oxide-studio\/releases\/v0\.1\.1\/windows-x86_64\/OxideStudio_0\.1\.1_x64-setup\.exe$/
    );
    assert.equal(result.release.files.length, 16);
    assert.ok(result.release.files.every((file) => file.target));
    assert.equal(
      result.release.files.some((file) => file.name === "sql-lsp.exe"),
      false
    );
    assert.equal(
      result.release.files.some((file) => file.name.startsWith("oxide-agent-host")),
      false
    );
    assert.equal(
      result.release.files.filter((file) => /^oxide-agent-(?!host)/u.test(file.name))
        .length,
      4
    );

    const manifest = JSON.parse(
      await readFile(join(files.output, "latest.json"), "utf8")
    );
    assert.equal(
      manifest.platforms["linux-x86_64"].signature,
      "signature:linux-x86_64"
    );
    assert.match(
      await readFile(
        join(files.output, "v0.1.1", "checksums.sha256"),
        "utf8"
      ),
      /linux-x86_64\/OxideStudio_0\.1\.1_amd64\.AppImage/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("rejects updater artifacts without a matching signature", async () => {
  const files = await fixture();
  try {
    await rm(
      join(
        files.input,
        "tauri-bundle-windows-x86_64",
        "OxideStudio_0.1.1_x64-setup.exe.sig"
      )
    );
    await assert.rejects(
      packageOssRelease({
        input: files.input,
        output: files.output,
        version: "0.1.1",
        baseUrl: "https://downloads.example.com/oxide-studio",
      }),
      /Missing updater signature/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("requires a standalone oxide-agent CLI for every release target", async () => {
  const files = await fixture();
  try {
    await rm(
      join(
        files.input,
        "tauri-bundle-macos-aarch64",
        "oxide-agent-aarch64-apple-darwin"
      )
    );
    await assert.rejects(
      packageOssRelease({
        input: files.input,
        output: files.output,
        version: "0.1.1",
        baseUrl: "https://downloads.example.com/oxide-studio",
      }),
      /Expected exactly one standalone oxide-agent CLI for darwin-aarch64/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("rejects a release when any desktop target is missing", async () => {
  const files = await fixture();
  try {
    await rm(join(files.input, "tauri-bundle-macos-x86_64"), {
      recursive: true,
      force: true,
    });
    await assert.rejects(
      packageOssRelease({
        input: files.input,
        output: files.output,
        version: "0.1.1",
        baseUrl: "https://downloads.example.com/oxide-studio",
      }),
      /No release assets found for darwin-x86_64/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("rejects identical updater signatures for the two macOS architectures", async () => {
  const files = await fixture();
  try {
    await writeFile(
      join(
        files.input,
        "tauri-bundle-macos-x86_64",
        "OxideStudio.app.tar.gz.sig"
      ),
      "signature:macos-aarch64",
      "utf8"
    );
    await assert.rejects(
      packageOssRelease({
        input: files.input,
        output: files.output,
        version: "0.1.1",
        baseUrl: "https://downloads.example.com/oxide-studio",
      }),
      /macOS updater signatures must be different/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("rejects multiple updater artifacts for the same target", async () => {
  const files = await fixture();
  try {
    const duplicate = join(
      files.input,
      "tauri-bundle-macos-aarch64",
      "OxideStudio-copy.app.tar.gz"
    );
    await writeFile(duplicate, "duplicate updater", "utf8");
    await writeFile(`${duplicate}.sig`, "signature:duplicate", "utf8");
    await assert.rejects(
      packageOssRelease({
        input: files.input,
        output: files.output,
        version: "0.1.1",
        baseUrl: "https://downloads.example.com/oxide-studio",
      }),
      /Expected exactly one updater artifact for darwin-aarch64, found 2/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("requires a clean HTTPS release base URL", () => {
  assert.equal(
    normalizeReleaseBaseUrl("https://downloads.example.com/releases///"),
    "https://downloads.example.com/releases"
  );
  assert.throws(
    () => normalizeReleaseBaseUrl("http://downloads.example.com/releases"),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizeReleaseBaseUrl("https://user@example.com/releases"),
    /cannot contain credentials/
  );
  assert.equal(
    resolveReleaseBaseUrl(
      "https://downloads.example.com",
      "/oxide-studio/releases/"
    ),
    "https://downloads.example.com/oxide-studio/releases"
  );
  assert.equal(
    resolveReleaseBaseUrl(
      "https://downloads.example.com/oxide-studio/releases",
      "oxide-studio/releases"
    ),
    "https://downloads.example.com/oxide-studio/releases"
  );
});

test("writes the updater endpoint and verification key into release config", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxide-release-config-"));
  try {
    const output = join(root, "tauri.release.conf.json");
    await writeReleaseConfig({
      baseUrl: "https://downloads.example.com/",
      objectPrefix: "releases",
      publicKey: "  updater-public-key  ",
      output,
    });
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(config.plugins.updater, {
      endpoints: ["https://downloads.example.com/releases/latest.json"],
      pubkey: "updater-public-key",
    });
    assert.equal(config.bundle.createUpdaterArtifacts, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes optional Windows Authenticode configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxide-windows-signing-config-"));
  try {
    const output = join(root, "tauri.release.conf.json");
    await writeReleaseConfig({
      baseUrl: "https://downloads.example.com/releases",
      publicKey: "updater-public-key",
      output,
      windowsCertificateThumbprint:
        "01 23 45 67 89 ab cd ef 01 23 45 67 89 ab cd ef 01 23 45 67",
      windowsTimestampUrl: "https://timestamp.example.com",
    });
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.bundle.createUpdaterArtifacts, true);
    assert.deepEqual(config.bundle.windows, {
      certificateThumbprint: "0123456789ABCDEF0123456789ABCDEF01234567",
      digestAlgorithm: "sha256",
      timestampUrl: "https://timestamp.example.com/",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retries the public manifest after an OSS or CDN propagation delay", async () => {
  const releaseBase =
    "https://downloads.example.com/oxide-studio/releases/v0.1.2";
  const updateFor = (target, name) => ({
    signature: `signature:${target}`,
    url: `${releaseBase}/${target}/${name}`,
  });
  const payload = {
    version: "0.1.2",
    platforms: {
      "darwin-aarch64": updateFor(
        "darwin-aarch64",
        "OxideStudio.app.tar.gz"
      ),
      "darwin-x86_64": updateFor(
        "darwin-x86_64",
        "OxideStudio.app.tar.gz"
      ),
      "linux-x86_64": updateFor("linux-x86_64", "app.AppImage"),
      "windows-x86_64": updateFor(
        "windows-x86_64",
        "OxideStudio-setup.exe"
      ),
    },
  };
  let manifestAttempts = 0;
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "HEAD") return new Response(null, { status: 200 });
    manifestAttempts += 1;
    if (manifestAttempts === 1) {
      return new Response("not ready", { status: 404 });
    }
    return Response.json(payload);
  };

  const result = await verifyOssRelease({
    manifestUrl: "https://downloads.example.com/oxide-studio/releases/latest.json",
    version: "0.1.2",
    baseUrl: "https://downloads.example.com",
    objectPrefix: "oxide-studio/releases",
    fetchImpl,
    retryDelayMs: 0,
    waitImpl: async () => {},
  });

  assert.equal(result.version, "0.1.2");
  assert.equal(manifestAttempts, 2);
});

test("rejects a public manifest that reuses a macOS updater", async () => {
  const sharedMacUpdate = {
    signature: "signature:shared",
    url: "https://downloads.example.com/releases/v0.1.2/darwin-aarch64/OxideStudio.app.tar.gz",
  };
  const payload = {
    version: "0.1.2",
    platforms: {
      "darwin-aarch64": sharedMacUpdate,
      "darwin-x86_64": sharedMacUpdate,
      "linux-x86_64": {
        signature: "signature:linux",
        url: "https://downloads.example.com/releases/v0.1.2/linux-x86_64/app.AppImage",
      },
      "windows-x86_64": {
        signature: "signature:windows",
        url: "https://downloads.example.com/releases/v0.1.2/windows-x86_64/OxideStudio-setup.exe",
      },
    },
  };
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "HEAD") return new Response(null, { status: 200 });
    return Response.json(payload);
  };

  await assert.rejects(
    verifyOssRelease({
      manifestUrl: "https://downloads.example.com/releases/latest.json",
      version: "0.1.2",
      baseUrl: "https://downloads.example.com/releases",
      fetchImpl,
      retryDelayMs: 0,
      waitImpl: async () => {},
    }),
    /Invalid updater URL for darwin-x86_64|Updater URL is shared/
  );
});

test("rejects a public manifest that does not contain exactly four targets", async () => {
  const payload = {
    version: "0.1.2",
    platforms: {
      "darwin-aarch64": {
        signature: "signature:macos-arm64",
        url: "https://downloads.example.com/releases/v0.1.2/darwin-aarch64/OxideStudio.app.tar.gz",
      },
      "darwin-x86_64": {
        signature: "signature:macos-x64",
        url: "https://downloads.example.com/releases/v0.1.2/darwin-x86_64/OxideStudio.app.tar.gz",
      },
      "linux-x86_64": {
        signature: "signature:linux",
        url: "https://downloads.example.com/releases/v0.1.2/linux-x86_64/app.AppImage",
      },
    },
  };

  await assert.rejects(
    verifyOssRelease({
      manifestUrl: "https://downloads.example.com/releases/latest.json",
      version: "0.1.2",
      baseUrl: "https://downloads.example.com/releases",
      fetchImpl: async () => Response.json(payload),
      retryDelayMs: 0,
      waitImpl: async () => {},
    }),
    /target mismatch; missing: windows-x86_64/
  );
});

test("verifies immutable OSS asset size and SHA-256 before latest publication", async () => {
  const files = await versionVerificationFixture();
  try {
    const fetchImpl = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/v${files.version}/release.json`)) {
        return Response.json(files.release);
      }
      if (url.pathname.endsWith(`/v${files.version}/latest.json`)) {
        return Response.json(files.latest);
      }
      const canonical = `${url.origin}${url.pathname}`;
      const body = files.contents.get(canonical);
      if (!body) return new Response("missing", { status: 404 });
      if (options.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(body.length) },
        });
      }
      return new Response(body, { status: 200 });
    };

    const published = await verifyVersionedOssRelease({
      version: files.version,
      baseUrl: files.baseUrl,
      expectedReleaseIndexPath: files.expectedReleaseIndexPath,
      fetchImpl,
      retryDelayMs: 0,
      waitImpl: async () => {},
    });
    assert.equal(published.files.length, 4);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("rejects a public immutable asset whose bytes do not match the release index", async () => {
  const files = await versionVerificationFixture();
  try {
    const corruptedUrl = files.release.files[0].url;
    const fetchImpl = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/v${files.version}/release.json`)) {
        return Response.json(files.release);
      }
      if (url.pathname.endsWith(`/v${files.version}/latest.json`)) {
        return Response.json(files.latest);
      }
      const canonical = `${url.origin}${url.pathname}`;
      const expected = files.contents.get(canonical);
      if (!expected) return new Response("missing", { status: 404 });
      if (options.method === "HEAD") return new Response(null, { status: 200 });
      if (canonical === corruptedUrl) {
        const corrupted = Buffer.from(expected);
        corrupted[0] ^= 0xff;
        return new Response(corrupted, { status: 200 });
      }
      return new Response(expected, { status: 200 });
    };

    await assert.rejects(
      verifyVersionedOssRelease({
        version: files.version,
        baseUrl: files.baseUrl,
        expectedReleaseIndexPath: files.expectedReleaseIndexPath,
        fetchImpl,
        retryDelayMs: 0,
        waitImpl: async () => {},
      }),
      /SHA-256 mismatch/
    );
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("skips platform signing only when each secret group is entirely absent", () => {
  const unsignedGroups = resolvePlatformSigning({});
  assert.deepEqual(
    unsignedGroups.map(({ output, enabled }) => ({
      output,
      enabled,
    })),
    [
      { output: "apple_signing_enabled", enabled: false },
      { output: "windows_signing_enabled", enabled: false },
    ]
  );
  assert.throws(
    () => assertPlatformSigningPolicy(unsignedGroups, {}),
    /Production releases require platform signing/
  );
  assert.doesNotThrow(() =>
    assertPlatformSigningPolicy(unsignedGroups, {
      ALLOW_UNSIGNED_RELEASE: "true",
    })
  );

  assert.throws(
    () => resolvePlatformSigning({ APPLE_ID: "developer@example.com" }),
    /macOS Developer ID signing is partially configured/
  );
  assert.throws(
    () =>
      resolvePlatformSigning({
        WINDOWS_CERTIFICATE: "certificate",
        WINDOWS_CERTIFICATE_PASSWORD: "password",
      }),
    /Windows Authenticode signing is partially configured.*WINDOWS_CERTIFICATE_THUMBPRINT/
  );

  const environment = {
    APPLE_CERTIFICATE: "certificate",
    APPLE_CERTIFICATE_PASSWORD: "password",
    APPLE_ID: "developer@example.com",
    APPLE_PASSWORD: "app-password",
    APPLE_TEAM_ID: "TEAM123456",
    KEYCHAIN_PASSWORD: "keychain-password",
    WINDOWS_CERTIFICATE: "certificate",
    WINDOWS_CERTIFICATE_PASSWORD: "password",
    WINDOWS_CERTIFICATE_THUMBPRINT: "0123456789ABCDEF0123456789ABCDEF01234567",
  };
  const signedGroups = resolvePlatformSigning(environment);
  assert.ok(signedGroups.every((group) => group.enabled));
  assert.doesNotThrow(() => assertPlatformSigningPolicy(signedGroups, environment));
});

test("rejects release config without an updater verification key", async () => {
  await assert.rejects(
    writeReleaseConfig({
      baseUrl: "https://downloads.example.com/releases",
      publicKey: " ",
      output: join(tmpdir(), "unused-tauri-release.conf.json"),
    }),
    /Missing OXIDE_UPDATER_PUBLIC_KEY/
  );
});
