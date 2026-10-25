# Database Driver Conformance Runner

`scripts/run-driver-conformance.mjs` is the only supported producer of a
catalog conformance-evidence record. It launches one exact package entrypoint,
verifies its package files and digests, and exercises the versioned sidecar protocol against a
fixture.

Runner version **1.3.0** checks both the entrypoint and every Java classpath
dependency, including when tests supply a launch override. Paths must remain
inside the package and name regular files; parent traversal, absolute paths,
symbolic links and Windows junctions are rejected before launching a process.

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

Packages that declare `supportsDatabaseCatalogs` must additionally provide a
`databaseScope` query with an explicit `context.database`. The handshake must
advertise `databaseScopedQueries`, and the returned value must prove that the
query actually ran in that catalog. Catalog capability is therefore not
inferred from metadata enumeration alone.

### SQL lookup context

A runtime advertising `sqlLookupContext: true` must provide a dedicated
`sqlLookupContext` fixture; generic schema/table enumeration is insufficient.
Conversely, a fixture requesting this proof requires both runtime
`sqlLookupContext` and `metadata`. These checks happen before connection inputs
are sent to the sidecar.

The fixture declares `current` (database/defaultSchema), one to eight distinct
other contexts in `databases`, and `currentQuery`. The runner checks the current
metadata, each scoped lookup, and restoration to the original metadata after
each scope. An independent query must also return the original database and
default schema, so a metadata implementation cannot conceal a leaked session
context. `currentQuery` must be read-only, must not select a database or schema
in its query context, and must expect exactly the original two values.

The resulting `metadata` operation records only `sqlLookupCurrent`,
`sqlLookupScoped`, `sqlLookupRestored` and `sqlLookupQueryRestored` check ids.
Context names, SQL and result rows remain outside the report. This proof does
not establish metadata completeness, missing-object visibility, or every
role/session transition.

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

An optional `migration` fixture exercises the sidecar-owned semantic
`plan → preflight → token-bound apply → verify` protocol. It is accepted only
when the signed manifest contains `schemaMigration` and the runtime handshake
contains `semanticSchemaMigration: true`. Snapshots are descriptor-only: the
runner recursively rejects `sql`, `ddl`, `statement` and `statements` keys, and
the apply request carries only opaque plan/preflight tokens, fingerprints and
explicit approvals. A passing migration operation can therefore become
`conformance.migration` evidence, but it is never inferred from query, generic
DDL, mutation or transaction coverage. Multi-connection data transfer remains
a separate semantic conformance suite.

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
runtime capability contract. Transactional migration additionally requires a
signed transaction capability; non-transactional migration must be declared as
such and explicitly acknowledged by the caller.

## Disposable SQL Server lookup test

`tests/driver-conformance/sqlserver-lookup-v1.json` targets SQL Server 16.x with
different default schemas in two databases. It checks a parameterized CTE and
window query, scoped execution, metadata, error mapping and lookup restoration.
It contains no setup commands for an arbitrary external server.

`scripts/test-sqlserver-lookup.mjs` can prepare these databases only inside a
new, owned SQL Server Developer container. Review the candidate manifest and
Microsoft's [container license requirement](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver16)
before explicitly accepting it:

```powershell
node scripts/test-sqlserver-lookup.mjs `
  --manifest <review-package/manifest.json> `
  --java <java21-binary> `
  --out <new-evidence.json> `
  --accept-eula
```

Without `--accept-eula`, the launcher rejects the request before issuing any
Docker command. It uses a pinned MCR image digest, limits the container to
3 GiB and two CPUs, binds a random loopback port, and mounts no persistent
data volume. Random passwords are passed through child environments or stdin,
never command arguments or reports. Cleanup verifies the unique ownership
label and removes only that container id; evidence is written only after a
passing conformance run and verified cleanup. Control-flow unit tests use fake
Docker callbacks and are not evidence of real SQL Server execution.

An unsigned review package may be tested locally. Passing this test does not
sign, install or publish it, and does not bypass the production release rules.
