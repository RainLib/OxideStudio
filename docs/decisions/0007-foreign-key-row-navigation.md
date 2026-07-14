# ADR-0007: Catalog-backed foreign-key row navigation

- Status: Accepted
- Date: 2026-07-15
- Scope: DG-P0/P1 Data Editor relationship navigation

## Context

Table metadata already includes foreign keys owned by the current relation, but that only supports navigation from a referencing row to its parent. DataGrip-style data work also needs the reverse direction: from a parent row to rows in any relation that reference it. Loading every table and scanning every constraint in the frontend would make opening a table proportional to the size of the whole schema, duplicate driver logic, and become stale when Explorer cache scope changes.

A relationship can contain several ordered columns. Treating one clicked cell as a complete key can return unrelated rows, especially in multi-tenant schemas where `(tenant_id, id)` is common. SQL foreign keys containing a NULL component do not identify a referenced row. Navigation must also preserve the tab's exact connection, PostgreSQL database, and schema instead of falling back to the globally active connection.

## Decision

PostgreSQL and MySQL drivers expose a reverse foreign-key catalog query keyed by the referenced schema and relation. PostgreSQL queries `pg_constraint`/`pg_class`/`pg_namespace`; MySQL queries `information_schema.key_column_usage`. The result includes the owning schema/table, ordered owning columns, and ordered referenced columns. PostgreSQL also implements the existing explicit-database pool route, so remote database tabs never use the connection's configured database by accident.

The frontend converts outgoing constraints and incoming catalog references into a pure `ForeignKeyNavigationPlan`. A plan:

- is offered only when the clicked column participates in the relationship;
- requires equal, non-empty source/target column lists;
- reads every component from the current displayed row, including staged cell edits;
- is omitted when any component is NULL, undefined, or missing;
- creates ordered, structured `equals` filters rather than concatenating SQL;
- carries only schema/table/filter data; connection and database scope come from the source table tab.

Selecting a plan finds or creates the target table tab, changes its filter UI to the same structured filters, and loads page zero through the existing parameterized table preview command. Reusing a target tab still passes through the existing unsaved-draft confirmation. Multiple relationships remain separate and show the constraint name; the context menu scrolls when the list is long.

## Consequences

- Reverse discovery is a bounded catalog lookup rather than an O(number of tables) frontend scan.
- Composite keys are atomic, so a single coincidentally equal column cannot cause a false navigation result.
- Database values remain query parameters and identifier validation/quoting stays in the Rust table service.
- Self-referencing and cross-schema foreign keys work; PostgreSQL cross-database foreign keys remain impossible by database design.
- The current implementation covers PostgreSQL and MySQL, whose capabilities advertise relational foreign keys. Other drivers return no navigation action until they implement an equivalent relation model.
- Navigation currently starts from persisted result rows. Unsaved newly inserted rows do not expose a relationship action because they do not yet have a stable database identity.
