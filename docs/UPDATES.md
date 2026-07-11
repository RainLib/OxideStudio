# Desktop Updates

OxideStudio uses the signed Tauri updater. The application checks the latest
GitHub Release in the background, shows a notification in the Settings menu,
and only downloads or installs an update after an explicit user action.

## One-time signing setup

Generate the updater key pair on a trusted machine:

```bash
npm run tauri signer generate -- -w ~/.tauri/oxide-studio.key
```

Keep the private key and password outside the repository. Add these GitHub
Actions secrets to `RainLib/OxideStudio`:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of the generated private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password used to generate the key
- `OXIDE_UPDATER_PUBLIC_KEY`: public key printed by the signer command

The public key is compiled into release builds through
`OXIDE_UPDATER_PUBLIC_KEY`. Builds without that value can run, but cannot trust
or install remote updates.

## Publish a release

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`.
2. Commit the version change.
3. Push a matching tag, such as `v0.2.0`, or run the Release Build workflow
   manually with that tag.

The workflow rejects a tag that does not match `package.json`. A successful run
publishes installers, updater signatures, and `latest.json` to a non-draft
GitHub Release. Do not rotate the signing key without a separate migration plan:
installed clients only trust the public key compiled into their build.
