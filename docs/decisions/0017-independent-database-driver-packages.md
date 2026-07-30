# ADR-0017: Independently updateable database drivers use versioned sidecar packages

## Status

Proposed. The inventory API and Settings status surface are implemented; external
driver installation and activation are not yet implemented.

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
  server-version range, download digest, capabilities, and entrypoint.
- Use a versioned local RPC protocol for connect, ping, metadata, query,
  cancellation, transactions, and shutdown. Credentials are delivered only to a
  launched process over its private IPC channel and are never stored in the
  package manifest.
- Store packages outside the application bundle. Install into a temporary
  directory, verify signature and SHA-256 digest, health-check the package, then
  switch an atomic `current` pointer. Retain the previous package for rollback.
- Resolve a driver per connection using `driverId`, an update channel, and an
  optional pinned package version. Server version detection remains runtime data
  and must never be confused with the installed client version.
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
- Driver stdout/stderr is bounded and redacted before persistence. Crashes are
  reported per connection and cannot terminate the Tauri process.
- Downgrades, unsigned local packages, and protocol-major mismatches require an
  explicit developer setting and are disabled by default.

## Migration sequence

1. Inventory: report exact bundled client versions and the current application
   update boundary. This is implemented.
2. Runtime: implement the package registry, resolver, supervisor, protocol
   handshake, health checks, and atomic rollback.
3. Pilot: move Elasticsearch to the external protocol first because its adapter
   already has an explicit server-version compatibility layer and HTTP boundary.
4. Migrate MongoDB and Redis, then PostgreSQL and MySQL. Keep bundled fallbacks
   until sidecar behavior, cancellation, SSH tunnels, and transaction semantics
   pass the same integration suites.

## Consequences

Independent security and compatibility updates become possible without replacing
the entire application, and one broken driver cannot crash all connections. The
cost is a new package supply chain, cross-platform process supervision, protocol
compatibility testing, and temporary duplication while bundled fallbacks remain.
