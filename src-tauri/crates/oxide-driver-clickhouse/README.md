# OxideStudio ClickHouse driver package

This independently updateable sidecar implements the signed Oxide driver protocol over ClickHouse's HTTP interface.

It provides HTTP health checks, Basic Auth, connection-level database selection, JSON query results and metadata for databases, tables, columns and data-skipping indexes. The package deliberately does **not** expose grid row mutation, generic DDL, interactive transactions, cancellation, reverse foreign-key navigation or positional parameter interpolation.

For Agent-owned reads, the sidecar sends a GET HTTP query. ClickHouse documents GET query requests as read-only; the package refuses `FORMAT` clauses for those requests so its JSON result contract remains unambiguous.

Release a package with:

```sh
cargo build --release --manifest-path src-tauri/crates/oxide-driver-clickhouse/Cargo.toml
node scripts/package-clickhouse-driver.mjs
```

Sign the exact generated `manifest.json` as `manifest.json.minisig` with the official release key before importing it in Settings → Drivers. Production imports reject unsigned payloads.
