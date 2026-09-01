# Desktop Updates and Aliyun OSS Releases

OxideStudio uses the signed Tauri v2 updater. Official desktop builds are
produced by `.github/workflows/release.yml`, signed on GitHub-hosted runners,
and published to Aliyun OSS. The application checks and downloads updates from
the HTTPS URL configured by `OXIDE_RELEASE_BASE_URL`; GitHub Releases are not an
update or download dependency.

When a user accepts an available update, the package downloads in the
background and the dialog may be closed without cancelling it. The title bar
keeps a progress/ready indicator that reopens the same operation. Download
progress is coalesced before updating React state. Installation and restart
are refused while any Workbench task is `running` or `waiting`; the downloaded
package remains ready until queries, transfers, imports, exports, or Agent
approval work reaches a terminal state.

The repository's base `tauri.conf.json` intentionally contains no updater
endpoint or verification key. The release workflow writes both the public key
and Aliyun endpoint into a temporary Tauri config before every build, which
prevents local or unsigned builds from accidentally trusting an unconfigured
release service.

## Release layout

The workflow uploads immutable versioned objects first and publishes
`latest.json` last:

```text
<OSS prefix>/
├── latest.json
└── v0.1.1/
    ├── latest.json
    ├── release.json
    ├── checksums.sha256
    ├── macos/
    │   ├── *.dmg
    │   ├── *.app.tar.gz
    │   └── *.app.tar.gz.sig
    ├── linux/
    │   ├── *.AppImage
    │   ├── *.AppImage.sig
    │   ├── *.deb
    │   └── *.rpm
    └── windows/
        ├── *-setup.exe
        ├── *-setup.exe.sig
        ├── *.msi
        └── *.msi.sig
```

Version directories receive
`Cache-Control: public,max-age=31536000,immutable`. The root `latest.json` is
uploaded atomically after all bundles and receives
`Cache-Control: no-cache,no-store,must-revalidate`.

The static updater manifest contains these Tauri platform keys:

- `darwin-aarch64` and `darwin-x86_64`, both pointing to the universal macOS
  updater archive.
- `linux-x86_64`, pointing to the AppImage.
- `windows-x86_64`, pointing to the NSIS installer.

Every manifest signature is the contents of the matching Tauri `.sig` file,
not a path to the signature.

## Remote SQLite worker releases

The remote SQLite worker is released independently by
`.github/workflows/publish-sqlite-worker.yml`. The workflow accepts only the
exact version declared by the worker crate, builds static Linux musl binaries
for x86_64 and aarch64, packages a manifest plus binary, signs the manifest
with the driver Minisign key, and uploads immutable objects to:

```text
<OSS prefix>/workers/sqlite/<worker version>/<platform>/package.tar.gz
```

Use the crate version shown in
`src-tauri/crates/oxide-sqlite-worker/Cargo.toml` when manually dispatching the
workflow. Do not reuse the desktop tag as an assumed worker version.

Official desktop builds require `DRIVER_MINISIGN_PUBLIC_KEY_B64`; the release
workflow decodes that public key into the build environment so the installed
application can verify both external driver packages and remote SQLite worker
manifests. When the connection-level source is blank, official builds derive
the worker URL from `OXIDE_RELEASE_BASE_URL` and `ALIYUN_OSS_PREFIX`. A custom
source must be credential-free HTTPS and cannot contain query credentials or a
fragment.

## One-time Tauri signing setup

Generate the updater key pair on a trusted machine:

```bash
npm run tauri signer generate -- -w ~/.tauri/oxide-studio.key
```

Add the following GitHub Actions secrets to `RainLib/OxideStudio`:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the generated private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Private-key password |
| `TAURI_UPDATER_PUBKEY` | Base64 public key emitted by the Tauri signer |

Never store the private key in the repository or OSS. Do not rotate or lose it
without a separate key-migration release: installed clients only trust the
public key compiled into their build.

## Operating-system trust and installer warnings

The Tauri updater signature above protects update integrity, but it does not
establish an operating-system publisher identity. Distributable builds need a
second, platform-native signature. Do not disable Gatekeeper, SmartScreen, or
endpoint protection on user machines.

### macOS Developer ID signing and notarization

Public macOS builds must use a paid Apple Developer Program account, a
`Developer ID Application` certificate, and Apple notarization. Export the
certificate and private key from Keychain Access as a password-protected
`.p12`, then add these repository secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Single-line base64 of the exported `.p12` (`openssl base64 -A -in certificate.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_PASSWORD` | Apple ID app-specific password, not the normal login password |
| `APPLE_TEAM_ID` | Ten-character Apple Developer Team ID |
| `KEYCHAIN_PASSWORD` | Random CI-only password used for the ephemeral runner keychain |

When all six values are present, the macOS runner imports the certificate into
an ephemeral keychain, lets Tauri sign and notarize the universal app, and then
validates the Developer ID signature, stapled notarization ticket, and
Gatekeeper assessment before uploading any artifact. The bundled SQL LSP
executable is built for both Apple Silicon and Intel, merged with `lipo`, and
signed separately with hardened runtime before Tauri seals the application
bundle.

When none of the Apple secrets exist, macOS signing and notarization are
skipped and the unsigned/ad-hoc test bundle is still built. If only part of the
group is configured, validation fails and lists the missing names; this avoids
silently publishing a bundle that was expected to be signed.

An ad-hoc signature (`signingIdentity: "-"`) is only suitable for local tests.
It does not remove the Gatekeeper warning for downloaded software.

### Windows Authenticode and SmartScreen

Windows installer trust is separate from both Tauri updater signing and Apple
signing. The built-in workflow supports an exportable CA-backed Authenticode
certificate in PFX format. Add all three repository secrets:

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Single-line base64 of the `.pfx` certificate and private key |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password protecting the `.pfx` |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | 40-character SHA-1 certificate thumbprint; spaces are accepted |

The optional repository variable `WINDOWS_TIMESTAMP_URL` selects the RFC 3161
timestamp service and defaults to `http://timestamp.digicert.com`. When the
three secrets are present, the runner imports the certificate, signs the SQL
LSP executable, configures Tauri to sign the application and `.exe`/`.msi`
installers, timestamps them with SHA-256, and verifies every installer with
`signtool`.

When none of the Windows secrets exist, Authenticode is skipped and the
unsigned test bundle is still built. A partially configured group fails
validation. Certificates that cannot be exported to PFX, including many newer
hardware-backed certificates, require Azure Artifact Signing or the provider's
custom Tauri `bundle.windows.signCommand` instead. Self-signed certificates are
only appropriate for managed test machines.

Code signing displays a verified publisher and is required for a trustworthy
distribution path, but SmartScreen also evaluates download reputation. For a
new public binary, signing alone cannot guarantee that Microsoft shows no
warning. Microsoft Store distribution is the only deterministic no-SmartScreen
prompt path for consumer installs. Choose the signing provider before adding a
Windows `signCommand`; the credentials and command are provider-specific and
must not be stored in the repository.

## RAM user and AccessKey setup

The release workflow authenticates to OSS with a dedicated RAM user's
AccessKey stored in GitHub Actions secrets. It does not use GitHub OIDC, a RAM
role, or an STS session token. Never use an Alibaba Cloud account AccessKey.

1. Create a RAM user dedicated to OxideStudio releases. Do not enable console
   logon for this user.
2. Create one AccessKey pair for the RAM user.
3. Attach a least-privilege policy scoped to the release prefix. Replace the
   placeholders below before applying it:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:ListObjects",
        "oss:ListMultipartUploads"
      ],
      "Resource": [
        "acs:oss:*:*:<bucket>"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "oss:GetObject",
        "oss:PutObject",
        "oss:AbortMultipartUpload",
        "oss:ListParts"
      ],
      "Resource": [
        "acs:oss:*:*:<bucket>/<prefix>/*"
      ]
    }
  ]
}
```

The RAM user does not need delete, bucket administration, or wildcard account
permissions. Enable OSS bucket versioning as an additional recovery control.
Rotate the AccessKey periodically and immediately replace it if GitHub or
Alibaba Cloud reports possible exposure.

## Required GitHub repository secrets

Configure these under **Settings → Secrets and variables → Actions →
Secrets**:

| Secret | Example | Purpose |
| --- | --- | --- |
| `ALIYUN_OSS_ACCESS_KEY_ID` | RAM user AccessKey ID | OSS authentication |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | RAM user AccessKey secret | OSS authentication |
| `ALIYUN_OSS_BUCKET` | `oxide-studio-releases` | Destination bucket |
| `ALIYUN_OSS_ENABLED` | `true` | Explicit release safety switch |
| `ALIYUN_OSS_REGION` | `cn-hangzhou` | OSS Signature V4 region |
| `ALIYUN_OSS_ENDPOINT` | `oss-cn-hangzhou.aliyuncs.com` | Public OSS API endpoint used by GitHub runners |
| `ALIYUN_OSS_PREFIX` | `oxide-studio/releases` | Object prefix controlled by the RAM user |
| `ALIYUN_OSS_PUBLIC_BASE_URL` | `https://download.example.com` | Public HTTPS bucket/CDN base URL compiled into the app and written into manifests |

### Independent driver package release secrets

The **Publish signed driver packages** workflow builds ClickHouse, DuckDB, and
RQLite sidecars for Linux x64, Windows x64, and macOS arm64. Run it manually,
select one driver or `all`, and provide a new immutable package version. Each
target payload is manifest-bound, signed, locally verified, archived, SHA-256
hashed, and uploaded to:

`oss://<ALIYUN_OSS_BUCKET>/<ALIYUN_OSS_PREFIX>/drivers/<driver>/<version>/<target>/package.tar.gz`

The workflow refuses to replace an existing version/target object. In addition
to the OSS secrets above, configure these base64-encoded Minisign key files:

| Secret | Purpose |
| --- | --- |
| `DRIVER_MINISIGN_SECRET_KEY_B64` | Unencrypted, dedicated driver-release Minisign secret key file. Scope it only to this workflow. |
| `DRIVER_MINISIGN_PUBLIC_KEY_B64` | Matching public key file, used to verify every generated detached manifest signature before upload. |

JDBC packages remain a separate controlled release flow: vendor JAR licensing
and provenance are product-specific, so this native-driver workflow never
downloads or redistributes third-party JARs implicitly.

The matching public key must also be compiled into official desktop builds as
`OXIDE_DRIVER_SIGNING_PUBLIC_KEY`; signing a package with an unrelated key does
not make it executable by production clients.

`ALIYUN_OSS_PUBLIC_BASE_URL` may use an OSS public domain or an Aliyun CDN
custom domain. It may point to the public bucket/CDN root, in which case the
workflow appends `ALIYUN_OSS_PREFIX`, or it may already include that exact
prefix; the resolver avoids duplicating it. The resulting URL must map to the
bucket and prefix above. For a private bucket, configure CDN origin
authentication; clients still need anonymous HTTPS read access through the
resolved public base URL. The updater does not require browser CORS, but the
endpoint must support normal GET/HEAD requests and redirects.

`TAURI_UPDATER_ENDPOINT` is intentionally not used. The workflow derives the
only trusted endpoint from `ALIYUN_OSS_PUBLIC_BASE_URL`, `ALIYUN_OSS_PREFIX`,
and `/latest.json`, preventing the upload path, build configuration, and
published manifest from drifting apart.

Do not use an OSS `-internal` endpoint in GitHub Actions because GitHub-hosted
runners are outside the Aliyun VPC.

## Publish a release

1. Set the same SemVer in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
   `src-tauri/tauri.conf.json`.
2. Run the validation commands listed below and commit the version change.
3. Push a matching tag, for example:

   ```bash
   git tag -a v0.1.1 -m "OxideStudio v0.1.1"
   git push origin main v0.1.1
   ```

4. Monitor **Release to Aliyun OSS** in GitHub Actions.

`workflow_dispatch` is intended for rebuilding or republishing an existing
version from a deliberately selected ref. Its `release_tag` must still match
the committed version.

The publish job performs these gates before updating `latest.json`:

- Builds signed universal macOS, Linux x86_64, and Windows x86_64 bundles.
- Generates `checksums.sha256`, `release.json`, and Tauri `latest.json`.
- Verifies every updater bundle against `TAURI_UPDATER_PUBKEY` with
  a checksum-pinned official `minisign` 0.12 binary.
- Downloads a pinned ossutil 2.3.0 archive and verifies its official SHA-256.
- Uploads versioned files with the dedicated RAM user AccessKey.
- Retrieves the public manifest and verifies that every platform URL is served
  from `ALIYUN_OSS_PUBLIC_BASE_URL` and is downloadable.

Independent driver publication applies the same immutable-version rule to
**every** release object. Before upload it rejects an existing archive or its
SHA-256 sidecar, and it never passes an overwrite flag to OSS. A failed or
partial publication must be investigated and released under a new package
version; it must not be retried by replacing files at the existing version
path.

## Local validation

```bash
npm run test:release
npm run build
npm test -- --run
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

To inspect manifest generation without real release bundles, run
`npm run test:release`. The tests create synthetic signed bundle layouts and
validate platform mapping, checksums, HTTPS URL handling, and missing-signature
failures.

## Failure and rollback behavior

- If any platform build, signature check, upload, or public download check
  fails, the workflow stops. `latest.json` is uploaded only after versioned
  objects are present.
- Never overwrite a released version directory with different bytes. Publish a
  higher patch version instead.
- To stop new update discovery during an incident, remove or deny public access
  to the root `latest.json`. Existing downloaded installers remain signed.
- The app disallows downgrades, so pointing `latest.json` at an older version is
  not a rollback mechanism. Ship a corrected higher version.

## References

- [Tauri v2 Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS code signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Apple Developer ID](https://developer.apple.com/support/developer-id/)
- [Microsoft SmartScreen reputation for app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [Alibaba Cloud ossutil 2.0](https://help.aliyun.com/en/oss/developer-reference/ossutil-overview/)
- [Use a RAM user AccessKey to access OSS](https://www.alibabacloud.com/help/en/oss/developer-reference/use-the-accesskey-pair-of-a-ram-user-to-initiate-a-request)
- [Alibaba Cloud identity and access best practices](https://www.alibabacloud.com/help/en/ram/product-overview/best-practices-for-identity-and-access-control)
