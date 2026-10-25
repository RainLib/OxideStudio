# OxideStudio DuckDB driver package

This is a separate executable, not a Tauri dependency. It is the first
reference implementation for the independently updateable driver contract.

## Current contract

- Supports file and in-memory DuckDB connections.
- Agent connections set the protocol option `readOnly: "true"`. This opens an
  existing file with DuckDB's engine read-only access mode, disables external
  access and extension autoloading, and rejects missing files without creating
  them. The handshake advertises both `readOnlyEnforcement` for queries and
  `readOnlyConnections` for opening files. Older query-only packages are refused
  by the Agent before receiving connection configuration.
- Supports query execution, server version, attached database/schema/table/column metadata (catalog scoped, not merged), catalog-scoped editor/table queries and explicit transactions.
- Exposes table indexes and constraints as read-only Explorer/LSP/schema-snapshot metadata. Schema differences are review-only until a dedicated DuckDB migration planner is covered. Row mutation, DDL editing and cancellation remain unavailable until their dedicated protocol paths are covered.
- Supports server-side reverse foreign-key lookup for relationship navigation. It deliberately does not advertise database creation: DuckDB catalogs are selected by opening or attaching files, not created as server namespaces from a connected session.
- Binds protocol JSON values through DuckDB's native parameter API; strings and JSON values are never interpolated into SQL text. Scalar type hints are accepted for protocol compatibility; server-side casts remain the authority for vendor-specific types.
- Catalog/schema context is applied for one request and restored on both success
  and query error. Native cursor paging and object-source methods remain
  explicitly unsupported; their handshake flags stay false.

The access-mode settings follow the pinned client's
[Config API](https://docs.rs/duckdb/1.10505.0/duckdb/struct.Config.html).

## Build

An internal `fileQueries` runtime mode supports CSV/JSON/JSONL/Parquet
snapshots exposed as the read-only `data` view. JSON/Parquet are statically
linked, without relying on a user's extension cache. The Host requires signed
`fileQueryFormats`, both file runtime flags and both read-only flags; it owns
the workspace, deadlines and process cleanup. `hostManagedFileQueries` binds
the launch-only workspace environment, driver lease and Host-EOF watchdog.
The two Desktop UI entry points remain pending; Agent tools keep their existing
read-only connection boundary. See
[file-session evidence and remaining work](../../../docs/FILE_QUERY_SESSIONS.md).

```sh
cargo build --release --manifest-path src-tauri/crates/oxide-driver-duckdb/Cargo.toml
node scripts/package-duckdb-driver.mjs --target aarch64-apple-darwin
```

The packaging script creates an immutable, manifest-bound directory and
calculates the executable SHA-256. The release process must then sign exactly
`manifest.json` with the official driver key as `manifest.json.minisig`. An
unsigned development package is deliberately shown as untrusted and cannot run
in a production build.

## Manifest capability baseline

```json
{
  "driver": "duckdb",
  "displayName": "DuckDB",
  "dataModel": "relational",
  "connectionMode": "file",
  "lspLanguageId": "duckdb",
  "namespaceLabel": "schema",
  "identifierQuote": "\"",
  "defaultPort": 0,
  "supportsSqlQuery": true,
  "fileQueryFormats": ["csv", "json", "jsonl", "parquet"],
  "supportsTableBrowsing": true,
  "supportsTableRowMutation": false,
  "supportsTableDdl": false,
  "supportsCollectionBrowsing": false,
  "supportsKeyValueBrowsing": false,
  "supportsSchemas": true,
  "supportsDatabaseCatalogs": true,
  "supportsCreateDatabase": false,
  "supportsCreateDatabaseCharset": false,
  "supportsColumnComments": false,
  "supportsInlineColumnComments": false,
  "supportsRenameDatabase": false,
  "supportsViews": true,
  "supportsReplaceView": false,
  "supportsMaterializedViews": false,
  "supportsTableIndexes": true,
  "supportsTableConstraints": true,
  "supportsForeignKeys": true,
  "supportsCheckConstraints": true,
  "supportsFunctions": false,
  "supportsTransactions": true,
  "supportsQueryCancellation": false,
  "supportsExplainPlan": false,
  "defaultPrimaryKeyType": "BIGINT",
  "commonDataTypes": ["BOOLEAN", "TINYINT", "INTEGER", "BIGINT", "REAL", "DOUBLE", "DECIMAL", "VARCHAR", "DATE", "TIMESTAMP", "JSON"]
}
```
