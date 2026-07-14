# Desktop Updates and Aliyun OSS Releases

OxideStudio uses the signed Tauri v2 updater. Official desktop builds are
produced by `.github/workflows/release.yml`, signed on GitHub-hosted runners,
and published to Aliyun OSS. The application checks and downloads updates from
the HTTPS URL configured by `OXIDE_RELEASE_BASE_URL`; GitHub Releases are not an
update or download dependency.

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
| `ALIYUN_OSS_PUBLIC_BASE_URL` | `https://download.example.com/oxide-studio/releases` | Public HTTPS base URL compiled into the app and written into manifests |

`ALIYUN_OSS_PUBLIC_BASE_URL` may use an OSS public domain or an Aliyun CDN
custom domain. It must map exactly to the bucket and prefix above. For a
private bucket, configure CDN origin authentication; clients still need
anonymous HTTPS read access through the public base URL. The updater does not
require browser CORS, but the endpoint must support normal GET/HEAD requests
and redirects.

`TAURI_UPDATER_ENDPOINT` is intentionally not used. The workflow derives the
only trusted endpoint as `<ALIYUN_OSS_PUBLIC_BASE_URL>/latest.json`, preventing
the build configuration and published manifest from drifting apart.

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
  `minisign`.
- Downloads a pinned ossutil 2.3.0 archive and verifies its official SHA-256.
- Uploads versioned files with the dedicated RAM user AccessKey.
- Retrieves the public manifest and verifies that every platform URL is served
  from `ALIYUN_OSS_PUBLIC_BASE_URL` and is downloadable.

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
- [Alibaba Cloud ossutil 2.0](https://help.aliyun.com/en/oss/developer-reference/ossutil-overview/)
- [Use a RAM user AccessKey to access OSS](https://www.alibabacloud.com/help/en/oss/developer-reference/use-the-accesskey-pair-of-a-ram-user-to-initiate-a-request)
- [Alibaba Cloud identity and access best practices](https://www.alibabacloud.com/help/en/ram/product-overview/best-practices-for-identity-and-access-control)
