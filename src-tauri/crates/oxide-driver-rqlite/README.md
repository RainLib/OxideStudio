# RQLite external driver

This sidecar is the network, SQLite-compatible reference package for the
OxideStudio external-driver protocol. It is intentionally not linked into the
Tauri binary.

## Implemented boundary

- HTTP(S) connect, `readyz` ping and status-based version discovery.
- JSON parameter binding; values are never interpolated into SQL text.
- Query result and database-error mapping for RQLite's `/db/query` and
  `/db/request` APIs.
- The Agent `readOnly` context always uses `/db/query`, so RQLite's own
  read-only SQLite connection remains the final execution authority.
- SQLite `main` schema metadata for relations, columns, indexes, constraints,
  and reverse foreign keys.

The package deliberately does **not** claim interactive transactions, query
cancellation, database creation, Grid mutation, or table DDL. RQLite exposes
request-scoped transactions instead of a durable `BEGIN`/`COMMIT` session, so
mapping it to OxideStudio's interactive transaction protocol would be unsafe.

## Release flow

1. Build with `cargo build --release --manifest-path src-tauri/crates/oxide-driver-rqlite/Cargo.toml`.
   For a cross-target release, include `--target <target>` in this command and
   pass the same `--target <target>` to the packaging script.
2. Prepare the manifest with `node scripts/package-rqlite-driver.mjs --target <target>`.
3. Sign the exact generated `manifest.json` as `manifest.json.minisig` using
   the official driver release key.
4. Import the directory through Settings → Database → Drivers. Production
   builds reject unsigned packages.

The connection form uses `rqlite://host:4001` as a neutral driver URL and the
sidecar normalizes it to HTTP. A pasted `http://` or `https://` endpoint also
works. Enabling the shared SSL mode upgrades the neutral URL to HTTPS. RQLite
has one database per endpoint, so its signed capability contract hides the
unrelated database URL field.

The HTTP request contract test is intentionally marked ignored because some
managed test sandboxes prohibit loopback listeners. Run it in release CI or a
normal development shell with `cargo test --manifest-path
src-tauri/crates/oxide-driver-rqlite/Cargo.toml -- --ignored`.
