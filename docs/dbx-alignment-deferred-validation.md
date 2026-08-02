# DBX alignment: deferred validation queue

Implementation work is intentionally being completed before these checks run.
Do not mark a capability as production-ready or count it toward the 70+
database target until its relevant queue entries pass.

## Multi-table data transfer

- Exercise parent-to-child FK ordering against PostgreSQL, MySQL/MariaDB, and
  SQLite with empty tables, non-empty tables, and a selected subset that omits
  a referenced parent.
- Prove that one target transaction spans all selected tables: inject a write
  failure and a cancellation in a later table, then verify no earlier table
  has committed rows or overwrite deletes.
- Verify confirmation rejection after changes to FK metadata, source/target
  column mapping, target overwrite row count, row limit, or batch size.
- Verify that FK cycles are rejected until a driver explicitly supplies a
  reviewed defer/disable-constraints capability.
- Verify per-table terminal reports contain only endpoint identifiers,
  counts, status, and plan digests; they must never persist credentials, URLs,
  SQL, bound parameters, or row values.
- Verify progress totals, cancellation propagation to the source query, and
  Explorer batch-selection behavior (including a target schema with one
  missing same-named table and a selection changed after preview).

## Existing transfer and migration work

- Verify PostgreSQL serial and identity reseed previews against empty/non-empty
  targets, a target without owned generators, rollback after a reseed failure,
  and stale-token rejection when the reseed option changes. Confirm reseed SQL
  runs before the copy transaction commits.
- Run append baseline and overwrite post-commit verification tests under
  concurrent target writers; append must remain `needs review` until a stable
  baseline is implemented.
- Test identity/sequence reseed planning and schema-object transfer only after
  a product-specific capability contract and source-DDL conformance fixture
  exist.

## Connection configuration import

- Validate DataGrip, DBeaver, and Navicat XML/NCX fixtures containing quoted
  attribute values, IPv6 endpoints, unsupported products, duplicate names,
  encrypted/opaque password fields, folder/group metadata, and sensitive URL
  parameters. Imported objects must contain no credential, token, SSH-key, or
  local-driver-path material.
- Define and verify an explicit duplicate-connection merge policy before
  enabling automatic merge; until then imported candidates must remain a
  user-reviewed set with deterministic renamed local entries.

## External driver runtime telemetry

- Verify launch and observed-exit counters with a controlled sidecar crash,
  reconnect, connection replacement, and normal disconnect. Counters must be
  package/version scoped, deduplicate repeated polling of the same exited
  sidecar, and never expose connection identifiers, stderr, SQL, or secrets.

## Driver, LSP, and SQL-editor alignment

- Run driver conformance for every signed package/server-version pair,
  including connect, metadata, query, parameter binding, cancellation, and
  normalized error mapping. The catalog must remain candidate-only without
  evidence.
- With a live external sidecar, verify the Driver Manager refreshes its
  process-health summary after an unexpected sidecar exit without exposing
  connection names, URLs, stderr, SQL, or credentials.
- Run the SQL semantic corpus across the bundled LSP and Monaco fallback for
  CTE shadowing, correlated subqueries, table functions, dialect quoting, and
  INSERT value hints.
- Exercise Monaco command-palette SQL intentions for quoted identifiers,
  escaped identifiers, malformed selections, clipboard permission denial, and
  IN-list values containing quotes, NULLs, numbers, and a 1,000-value bound.
- Repeat those intention cases with multiple selections, including one invalid
  selection; the all-or-nothing edit must leave the entire document unchanged.
- Validate the generic JDBC agent against H2 plus vendor packages after a JDK
  and signed vendor jars are available; record results as conformance evidence
  rather than local claims.

## Explorer schema object descriptors

- Verify PostgreSQL sequence, non-internal trigger, domain, enum type,
  extension and partition discovery across schemas, quoted names, comments,
  trigger/partition parents, empty schemas, permission errors,
  connection/schema switches, and refreshes. Descriptors must remain read-only
  and must not enable table data editing, generated DDL, or migration actions.

## Schema snapshot descriptor drift

- Capture two PostgreSQL snapshots containing sequence, non-internal trigger,
  domain, enum type, extension and partition descriptors. Verify additions,
  removals, parent/comment changes, deterministic fingerprints, and old
  snapshots without `schemaObjects` remain readable.
- Verify descriptor catalog permission failure is retained as a snapshot
  warning while relation/routine capture continues. Descriptor drift must
  always be manual-review, contain no SQL/preflight commands, and block
  automatic migration execution.

## Database administration metrics

- Verify the fixed read-only PostgreSQL metric query against ordinary and
  restricted roles: connections, active queries, shared-buffer hit rate,
  commit/rollback counters, and current-database size must either be accurate
  or fail as a visible permission/capability error; no missing counter may be
  presented as zero.
- Verify MySQL/MariaDB connections, active non-idle queries, and current
  schema allocated bytes across supported server versions. Explicitly record
  that cache and transaction counters remain unavailable until a
  product-specific, privilege-safe semantic metrics protocol is introduced.
- Confirm that metrics are only available for native PostgreSQL/MySQL/MariaDB
  connections, refresh without retaining historical server values, and never
  expose SQL text, credentials, connection URLs, or process stderr.
