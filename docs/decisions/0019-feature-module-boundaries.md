# ADR-0019: Use incremental feature boundaries instead of a workspace component monolith

## Status

Accepted. New or substantially refactored work should follow this boundary;
existing files migrate incrementally.

## Context

The frontend is primarily organized by technical kind (`components`, `lib`,
`store`, and `services`). Mature workspace features now span all of those
directories, while several composition files also own domain behavior:

- `QueryEditor.tsx` owns the Monaco lifecycle, LSP providers, execution,
  parameters, statement decorations, search, drag/drop, and editor UI.
- `SchemaSidebar.tsx` owns tree projection, metadata loading, object actions,
  dialogs, and driver-specific routing.
- `DataGrid.tsx` and `TableDataView.tsx` combine presentation, editing, server
  query state, export, navigation, and aggregation.
- Git behavior is concentrated in two panel components.

The Rust side has the same pressure in `commands/table.rs`, `agent/host.rs`,
and other modules that combine transport validation, use cases, SQL building,
I/O, and serialization.

A repository-wide move would create a large, low-value diff and make current
feature work harder to review. Leaving the structure unchanged would continue
to grow the same files.

## Decision

Adopt incremental feature slices for all new work and for code extracted from
large workspace components:

```text
src/features/<feature>/
  ui/
  model/
  api/
  index.ts
```

The initial feature set is:

- `query-editor`
- `database-explorer`
- `data-grid`
- `driver-management`
- `version-control`
- `assistant`
- `database-admin`

Shared domain identities move toward `src/entities`; generic UI and pure
helpers move toward `src/shared`; Tauri transport moves toward
`src/platform/tauri`. Existing directories remain valid migration sources and
must not be mass-renamed.

Dependencies flow in one direction:

```text
app -> features -> entities -> shared/platform
```

Features expose a small public surface through `index.ts`. They must not import
another feature's internal file. Cross-feature workflows belong in the app
composition layer or an explicit use-case coordinator.

For Rust, first establish `interfaces`, `application`, `domain`, and
`infrastructure` modules inside the existing crate. Extract a workspace crate
only when its protocol is stable and Tauri-independent. The first intended
crates are the external driver protocol/runtime/registry and the shared SQL
statement-scope contract.

## First migration

The first extraction is SQL completion/statement-scope logic from
`QueryEditor.tsx` into `src/features/query-editor/model`. This is selected
because it fixes a user-visible multi-statement completion defect while proving
the boundary with isolated tests.

## Guardrails

- UI components do not call raw Tauri `invoke`.
- Driver availability is decided by capabilities, not UI-only driver checks.
- Pure model code cannot import React, Monaco instances, Zustand stores, or
  Tauri APIs.
- Feature stores expose selectors and commands; components do not coordinate
  multi-store transactions inline.
- Rust Tauri commands validate and map transport data, then call an application
  use case.
- Security checks, path canonicalization, SQL quoting, and mutation validation
  remain in the Rust trusted boundary.

## Consequences

Feature behavior becomes easier to test and delete, and large components can be
reduced without a one-time rewrite. During migration, old and new directory
styles coexist. Reviewers must reject deep imports that bypass a feature's
public surface, otherwise the new layout would only rename the same coupling.
