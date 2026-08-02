# Oxide JDBC Agent

The agent is a JDK 21-only, portable implementation of the Oxide driver protocol. It contains no vendor JDBC client. A vendor package is assembled with `scripts/package-jdbc-driver.mjs`; the signed manifest binds the agent, every vendor JAR, its protocol identity and UI capability declaration.

The desktop Host launches Java packages exclusively through a managed Java 21 runtime inside the driver registry. It never executes a package launcher or resolves `java` from `PATH`.

The generic agent supports one in-flight JDBC statement per connection and maps the
driver protocol's query id to `Statement.cancel()`, so a long query can be
cancelled without waiting for its result. It intentionally reports no Agent
read-only enforcement and no interactive transaction capability. A vendor-specific
package may gain those only after implementing and testing an engine-side safety
boundary.

The packager accepts only `dataModel: "relational"` for this Agent. It cannot
be used to relabel JDBC metadata as a document, graph, time-series, coordination,
or queue workspace; those products require a dedicated sidecar and their own
Explorer/editor safety contract.

The Agent can execute the bounded semantic `createDatabase` request for packages that declare namespace creation and label the namespace as `schema` or `database`. It quotes the name through JDBC metadata and rejects owner, charset and collation options; engines requiring those variations must provide a dedicated sidecar implementation.

`package-jdbc-driver.mjs` enforces the same boundary before a package can be
signed: a generic JDBC package cannot claim interactive transactions, Grid row
mutation, table-to-table transfer, bounded Table Editor DDL, or namespace options it cannot execute.
Those capabilities require a vendor-specific sidecar and conformance fixtures.

Start a package authoring flow with a conservative capability file rather than
copying a previous driver manifest:

```sh
node scripts/create-jdbc-driver-capabilities.mjs \
  --driver trino --display-name Trino --out ./trino-capabilities.json \
  --dialect-profile hive --default-port 8080
```

The generated file enables only query, metadata, LSP and cancellation. It is
then passed to `package-jdbc-driver.mjs` together with the JDBC Agent and
vendor JARs; the resulting package still needs a trusted manifest signature.
`generic`、`postgres`、`mysql`、`sqlserver`、`oracle`、`h2` 与 `hive` profiles
only provide connection/editor defaults. A profile never grants vendor DDL,
Grid writing, transfer, or server-version compatibility by itself.

For relational packages, the agent reads the portable JDBC `DatabaseMetaData` APIs for catalogs, catalog-scoped schemas, tables, columns, indexes, primary/imported keys, exported keys, procedures and functions. This enables Explorer constraint, reverse-foreign-key and routine navigation when the signed package declares those capabilities. Check constraints and unique-constraint definitions remain dialect-specific because JDBC does not expose them consistently across engines. If a package declares a server-version range, the Host checks the banner returned by this Agent before publishing the connection.

Query responses preserve JSON-safe JDBC scalar values (`BOOLEAN`, integral values,
finite floating-point values and `DECIMAL`) so result grids can sort and edit
typed data correctly. Temporal, binary, LOB and vendor-specific values remain
bounded display values until a package supplies an explicit type adapter. The
H2 protocol fixture exercises connection, parameter binding, typed results,
schema creation and Explorer metadata without promoting H2 to a shipped package.
