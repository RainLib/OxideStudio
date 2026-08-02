# Database Driver Conformance Runner

`scripts/run-driver-conformance.mjs` is the only supported producer of a
catalog conformance-evidence record. It launches one exact package entrypoint,
verifies its digest, and exercises the versioned sidecar protocol against a
fixture.

The runner is intentionally separate from the desktop application: it can run
in release CI against real database versions without putting test credentials,
SQL text, or result rows into the Driver Manager catalog.

## Contracts

- Fixture schema: [database-driver-conformance-fixture.schema.json](database-driver-conformance-fixture.schema.json)
- Evidence-report schema: [database-driver-conformance-evidence.schema.json](database-driver-conformance-evidence.schema.json)
- Signed catalog schema: [database-driver-catalog.schema.json](database-driver-catalog.schema.json)

Every fixture must prove all of the following before it can claim `query`
coverage:

1. Handshake identity and protocol-major compatibility.
2. Connect, ping and a non-empty server version.
3. Parameter binding with at least one bound value.
4. A classified error response for an invalid query.
5. Requested metadata assertions.

The protocol has a deliberate casing boundary: top-level `DriverRequest` enum
variant fields use the Rust wire names (`connection_id`, `transaction_id`,
`query_id`), while nested protocol objects such as handshake and query context
use camelCase. The runner encodes this contract directly and treats an id-zero
`INVALID_REQUEST` response as a wire-compatibility failure. A sidecar must
preserve the originating request id for all successfully parsed driver errors,
so error mapping never degrades into a timeout.

When the package declares transactions, row mutation, or table transfer, the
runner also refuses a handshake that does not declare runtime transactions. A
fixture may additionally prove a begin/mutate/rollback/post-rollback sequence.
Host-level schema migration and multi-connection data-transfer fixtures remain
separate semantic conformance suites; they must not be inferred from one
sidecar query test.

## Run a fixture

Build and package a target first. The following writes only temporary/release
artifacts; it never modifies a source manifest.

```powershell
npm run driver:conformance -- `
  --manifest artifacts/drivers/duckdb/0.1.0/x86_64-pc-windows-msvc/manifest.json `
  --fixture tests/driver-conformance/duckdb-core-v1.json `
  --out artifacts/conformance/duckdb-1.3.2-win-x64.json `
  --target x86_64-pc-windows-msvc `
  --reference-out artifacts/conformance/duckdb-1.3.2-win-x64.catalog.json `
  --report-url https://drivers.example.invalid/evidence/duckdb-1.3.2-win-x64.json
```

`--reference-out` is accepted only with an HTTPS `--report-url`. Its JSON is a
fragment for the matching signed catalog entry's `conformance.evidence` list.
The catalog validator rejects a declared operation/version if no evidence
record matches its driver id, package version, target, server version and
operation. Package installation additionally rejects an evidence entry whose
entrypoint digest does not match the imported manifest.

## Privacy and release rules

The report contains fixture and binary hashes, server version, operation/check
ids and timestamps only. It deliberately excludes connection URLs, credentials,
statement text, parameters, result values and sidecar stderr. Use environment
variable names in fixtures for live connection inputs; do not commit a real URL
or password.

A passing report is release evidence, not an execution permission. Production
still requires the catalog signature, archive digest (for direct install),
package manifest signature, target compatibility, package handshake, and the
runtime capability contract.
