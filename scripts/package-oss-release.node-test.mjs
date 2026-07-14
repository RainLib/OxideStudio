import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { packageOssRelease } from "./package-oss-release.mjs";
import {
  normalizeReleaseBaseUrl,
  writeReleaseConfig,
} from "./write-tauri-release-config.mjs";
import { resolvePlatformSigning } from "./resolve-platform-signing.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "oxide-release-"));
  const input = join(root, "release-input");
  const output = join(root, "release-output");
  const assets = {
    macos: ["OxideStudio.app.tar.gz", "OxideStudio_0.1.1_universal.dmg"],
    linux: ["OxideStudio_0.1.1_amd64.AppImage", "OxideStudio_0.1.1_amd64.deb"],
    windows: [
      "OxideStudio_0.1.1_x64-setup.exe",
      "OxideStudio_0.1.1_x64_en-US.msi",
    ],
  };

  for (const [platform, names] of Object.entries(assets)) {
    const directory = join(input, `tauri-bundle-${platform}`);
    await mkdir(directory, { recursive: true });
    for (const name of names) {
      const path = join(directory, name);
      await writeFile(path, `${platform}:${name}`, "utf8");
      if (/\.app\.tar\.gz$|\.AppImage$|-setup\.exe$/i.test(name)) {
        await writeFile(`${path}.sig`, `signature:${platform}`, "utf8");
      }
    }
  }

  for (const directory of ["appimage/resources", "deb/data/usr/lib/oxide-studio"]) {
    const resources = join(input, "tauri-bundle-linux", directory);
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "sql-lsp.exe"), "bundled resource", "utf8");
  }

  return { root, input, output };
}

test("builds signed updater metadata for every desktop target", async () => {
  const files = await fixture();
  try {
    const result = await packageOssRelease({
      input: files.input,
      output: files.output,
      version: "0.1.1",
      baseUrl: "https://downloads.example.com/oxide-studio/",
      pubDate: "2026-07-14T00:00:00.000Z",
    });

    assert.equal(result.latest.version, "0.1.1");
    assert.deepEqual(Object.keys(result.latest.platforms).sort(), [
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.equal(
      result.latest.platforms["darwin-aarch64"].url,
      result.latest.platforms["darwin-x86_64"].url
    );
    assert.match(
      result.latest.platforms["windows-x86_64"].url,
      /v0\.1\.1\/windows\/OxideStudio_0\.1\.1_x64-setup\.exe$/
    );
    assert.equal(result.release.files.length, 9);
    assert.equal(
      result.release.files.some((file) => file.name === "sql-lsp.exe"),
      false
    );

    const manifest = JSON.parse(
      await readFile(join(files.output, "latest.json"), "utf8")
    );
    assert.equal(manifest.platforms["linux-x86_64"].signature, "signature:linux");
    assert.match(
      await readFile(
        join(files.output, "v0.1.1", "checksums.sha256"),
        "utf8"
      ),
      /linux\/OxideStudio_0\.1\.1_amd64\.AppImage/
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
        "tauri-bundle-windows",
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
});

test("writes the updater endpoint and verification key into release config", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxide-release-config-"));
  try {
    const output = join(root, "tauri.release.conf.json");
    await writeReleaseConfig({
      baseUrl: "https://downloads.example.com/releases/",
      publicKey: "  updater-public-key  ",
      output,
    });
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(config.plugins.updater, {
      endpoints: ["https://downloads.example.com/releases/latest.json"],
      pubkey: "updater-public-key",
    });
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
    assert.deepEqual(config.bundle.windows, {
      certificateThumbprint: "0123456789ABCDEF0123456789ABCDEF01234567",
      digestAlgorithm: "sha256",
      timestampUrl: "https://timestamp.example.com/",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skips platform signing only when each secret group is entirely absent", () => {
  assert.deepEqual(
    resolvePlatformSigning({}).map(({ output, enabled }) => ({
      output,
      enabled,
    })),
    [
      { output: "apple_signing_enabled", enabled: false },
      { output: "windows_signing_enabled", enabled: false },
    ]
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
  assert.ok(resolvePlatformSigning(environment).every((group) => group.enabled));
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
