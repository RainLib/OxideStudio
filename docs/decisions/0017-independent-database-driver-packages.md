# ADR-0017: Independently updateable database drivers use versioned sidecar packages

## Status

Accepted, implementation in progress. Inventory, manifest v1 validation,
installed-package discovery, target/protocol compatibility, digest and detached
Minisign verification, signed offline directory import, atomic
activation/rollback, per-connection package pins, a versioned RPC contract,
manifest-bound handshake validation and the Settings status surface are
implemented. Connection-scoped sidecars now own the selected connection only,
multiplex requests by protocol id, drain stderr without persisting it, and route
query, parameter, metadata, transaction and cancellation operations through the
same verified process. Builds without a trusted driver public key display
external packages as untrusted and cannot execute them.

The public standalone CLI/MCP now uses the same signed registry, exact pins and
selected-package rules. A corrupt activation marker or missing selected version
is an execution error; only an absent selection permits the bundled channel.
Exact-version resolution inspects its own directory instead of scanning and
hashing other installed versions. Runtime target checks accept the actual Cargo
target triple as well as the existing OS/architecture aliases; the ABI is not
guessed from the operating system name.

Agent-owned sidecars must advertise `readOnlyEnforcement` before receiving
connection configuration. File packages additionally need `readOnlyConnections`;
the Host passes `readOnly: "true"` and rejects older query-only file runtimes.
The DuckDB implementation opens the existing file with the engine's read-only
mode, disables external access/autoloading and restores catalog/schema context
after each query. This contract does not grant public mutation tools. Native
sidecar builds and the isolated signed-package acceptance are covered by the
CI configuration; remote jobs have not yet been run for this change.

The Driver Store location can now be migrated from Settings. Migration copies the
entire store to a fresh absolute destination, rejects links/special files and
oversized trees, re-reads the staged package layout, atomically publishes the
copy, and persists a restart-applied pointer. It refuses while an external
sidecar connection is live and deliberately keeps the old store for recovery.

## Context

OxideStudio currently links SQLx, the MongoDB Rust client, the Redis Rust client,
and the Elasticsearch HTTP adapter into the Tauri process. `Cargo.lock` therefore
selects the client versions, and updating any of them requires rebuilding and
releasing the whole application. The connection manager controls live connection
instances; it is not a driver installer or updater.

Database server compatibility is a separate concern. OxideStudio can detect a
server version at connection time and adapt requests (for example Elasticsearch
6/7/8 behavior), but that does not make the compiled client independently
replaceable.

## Decision

- Keep the current native drivers as a recovery-compatible bundled channel.
- Introduce external database drivers as child-process sidecars, not Rust dynamic
  libraries. Rust has no stable cross-release ABI, and in-process libraries would
  weaken crash isolation and application signing boundaries.
- Give every driver package a signed manifest containing driver id, package
  version, client-library version, protocol version, supported OS/architecture,
  server-version range, download digest, capabilities (including network/file
  connection mode), and entrypoint. The exact
  `manifest.json` bytes are signed in `manifest.json.minisig`; the trusted public
  key is compiled into official builds with `OXIDE_DRIVER_SIGNING_PUBLIC_KEY`.
- Let a package optionally carry a signed connection URL template for dialects
  whose syntax cannot be rendered as generic `scheme://host/database`. The
  template is restricted to five scalar placeholders and is a form-prefill
  aid only; JDBC and vendor prefixes are preserved when a pinned package is
  launched, and the sidecar receives the final URL as an opaque credential
  transport value.
- Use a versioned local RPC protocol for connect, ping, metadata, query,
  cancellation, transactions, and shutdown. Credentials are delivered only to a
  launched process over its private IPC channel and are never stored in the
  package manifest.
- For JDBC-only vendors, allow a signed `runtime.kind: "java"` package form:
  Java 21, a fixed main class and every dependency JAR's SHA-256 are part of the
  detached-signed manifest. The Host resolves Java only from a managed runtime
  under the driver registry, never from PATH or a package-supplied launcher. The
  runtime has its own signed `runtime.json`, per-target activation record and
  entrypoint digest. It is re-verified at each sidecar launch.
- Store packages outside the application bundle. Import into a temporary
  directory, reject links/special files and oversized trees, verify signature and
  SHA-256 digest, then atomically activate a versioned package while retaining
  the previous package for rollback.
- Resolve a driver per connection using `driverId`, an update channel, and an
  optional pinned package version. Server version detection remains runtime data
  and must never be confused with the installed client version. When a signed
  package declares an explicit range (for example `>= 6 < 9`), the Host parses
  the detected server banner after connect and terminates the sidecar before it
  is published to the connection manager if the version is outside that range.
- Surface bundled/external origin, active package version, available update,
  compatibility status, and rollback state in Settings > Database > Drivers.
- Never allow a package update while that package owns active connections. Drain
  and reconnect those connections after an explicit user action.

## Security boundary

- Repository metadata must be fetched over HTTPS from a configured trusted
  source. Packages require both a trusted signature and the manifest digest.
- A driver process receives only the selected connection secret and a bounded
  configuration document. It does not receive AI provider credentials or other
  saved connections.
- The capability catalog resolves the same active or pinned package that a
  connection launches, even when that package reuses a bundled id such as
  `postgres` or `mysql`. A package can therefore reduce capability; it never
  inherits the bundled adapter's Grid, namespace or DDL permissions by name.
- Host-built namespace/table DDL, schema-migration plans and database-admin
  commands never cross into an external sidecar. Namespace creation uses the
  existing semantic request; destructive namespace/table/admin actions and
  migration apply remain unavailable until the protocol has separately
  declared semantic operations and their conformance fixtures.
- Driver stdout/stderr is bounded and redacted before persistence. Crashes are
  reported per connection and cannot terminate the Tauri process.
- Downgrades, unsigned local packages, and protocol-major mismatches require an
  explicit developer setting and are disabled by default.

## Migration sequence

1. Inventory: report exact bundled client versions and the current application
   update boundary. This is implemented.
2. Registry: manifest schema, installed-package discovery, platform/protocol
   compatibility, digest verification and active-version reporting. This is
   implemented; packages are not executable through this phase.
3. Runtime: the shared request/response protocol, verified resolver,
   manifest-bound handshake, staged installer, atomic activation/rollback and
   per-connection routing are implemented. A sidecar uses a cleared environment,
   bounded newline-framed messages, handshake timeout, multiplexed response
   routing, late-response isolation and kill-on-drop cleanup. Active package
   changes are blocked while live connections use the current version.
4. Pilot: move Elasticsearch to the external protocol first because its adapter
   already has an explicit server-version compatibility layer and HTTP boundary.
5. Migrate MongoDB and Redis, then PostgreSQL and MySQL. Keep bundled fallbacks
   until sidecar behavior, cancellation, SSH tunnels, and transaction semantics
   pass the same integration suites.

## Consequences

Independent security and compatibility updates become possible without replacing
the entire application, and one broken driver cannot crash all connections. The
the remaining work is resumable managed-download caching, package health/crash
telemetry, release-key rotation, formal sidecar conformance packs and migration
of each bundled family. Bundled drivers remain the recovery path only where no
active or pinned external package has been selected.

The catalog document is bounded to 256 entries and 512 KiB, must use HTTPS
without credentials, does not follow redirects, and has a detached
`<catalog>.minisig` signature verified by the same build-time key as package
manifests. Its public shape is defined in
[`database-driver-catalog.schema.json`](../database-driver-catalog.schema.json).
Catalog entries without `archiveSha256` are informational and stay on the
review-and-import path. An explicitly selected entry with that digest may
download one HTTPS tar.gz without redirects into a temporary bounded staging
directory. Oxide verifies the signed catalog digest before extracting only
regular files/directories, then rechecks the package signature, target, protocol
and entrypoint digest before activation. A verified archive is additionally
cached under the driver store by `driverId/packageVersion/archiveSha256`; it is
re-hashed before every reuse and a malformed cache entry is discarded. There is
no automatic update, redirect following, arbitrary URL execution, cache
retention policy or resumable download in this release.

Catalog releases may additionally publish signed conformance evidence separated
by connect, metadata, query, cancellation, mutation and migration server-version
fixtures. This improves pre-install transparency in Settings but is deliberately
not an execution permission: only the imported manifest and the launched
sidecar handshake can authorize a driver operation.
