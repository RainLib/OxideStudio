# DBChart Alignment Matrix -- 2026-08-11

## Scope and evidence

This comparison uses DBChart `origin/main` at
`c24936a402bb3e24b4858f05282d69a04fcfe25b`. DBChart is a local-first schema
diagram application, not a live multi-database query client. Consequently its
DBML editor and diagram workflow are useful reference material, but do not
define the SQL LSP, driver, or data-transfer contract of OxideStudio.

| DBChart capability | DBChart evidence | OxideStudio status | Alignment decision |
| --- | --- | --- | --- |
| Context-aware DBML completion | `src/components/code-snippet/dbml/dbml-completion-provider.ts` wraps `@dbml/parse` and triggers on space, settings and reference operators. | DBML is parsed into review-only schema snapshots by `src/features/schema-diff/model/schemaDbmlImport.ts`; SQL Monaco has a full LSP, metadata, snippets and cached fallback path. | No SQL behavior to port. A dedicated editable DBML Monaco surface remains an optional future feature, not an LSP prerequisite. |
| DBML/DDL/JSON import detection | `src/lib/import-method/detect-import-method.ts` selects DBML before DDL, then JSON. | DBML import, SQL script import, CSV/JSON/XLSX row import and connection import are separate explicit routes. | Intentional difference: no ambiguous automatic mutation/import. |
| Deterministic SQL diagram export | `src/dialogs/export-sql-dialog/export-sql-dialog.tsx` chooses deterministic cross-dialect export, with optional AI fallback. | Table-data SQL INSERT export, PostgreSQL schema backup and review-first schema diff/migration are native and capability-gated. | Live-database paths are stronger; diagram-only cross-dialect DDL generation is not a substitute for reviewed migrations. |
| Diagram JSON export/import | `src/hooks/use-export-diagram.tsx`, `src/dialogs/import-diagram-dialog`. | Schema snapshots, DBML import/export, schema diagram canvas persistence, draft history and schema diff are present. | Covered for live-schema workflow; direct ChartDB JSON interchange is not implemented. |
| Diagram areas: move and auto-arrange | DBChart head `c24936a`, especially `lib/utils/area-utils.ts` and canvas context menus. | Schema diagram has persisted areas, selection and history (`src/lib/schemaDiagramAreas.ts`, `src/services/schemaDiagramCanvasStore.ts`). | Audit required only if a concrete area interaction is reported; the upstream feature is not an SQL/editor gap. |
| Metadata CSV quote repair | DBChart `3442936`, `src/lib/data/import-metadata/utils.ts`. | Rust CSV parser, bounded preview/preflight, mapping digest, streaming transaction importer and escaping tests in `src-tauri/src/commands/table.rs`. | Covered with a stronger table-data contract. |

## OxideStudio implementation status

| Requested capability | Current implementation | Evidence | Verification status |
| --- | --- | --- | --- |
| SQL editor intelligence | LSP model synchronization, cancellation/version guards, completion resolve, diagnostics, hover, signature help, selection ranges and metadata cache. | `src/components/workspace/QueryEditor.tsx`, `src/features/query-editor/hooks/`. | Unit/integration coverage exists; real database matrix deferred. |
| Code-block suggestions | Configurable snippets, case adaptation, product-scoped PostgreSQL/MySQL/Oracle/SQL Server/Db2/Dameng/Manticore/ClickHouse blocks. | `src/features/query-editor/model/sqlCommandSnippets.ts`. | Unit tested. |
| LSP recovery suggestions | Grammar completions at statement start and after SELECT/FROM, JOIN, WHERE/HAVING/ON, GROUP BY and ORDER BY. | `src/features/query-editor/model/sqlSyntaxFallback.ts`. | Unit tested. |
| Table exports | CSV and UTF-8 BOM, JSON, JSONL, TSV, Markdown, SQL INSERT, XLSX, Parquet and Arrow; query filter/sort/scope, cancellation and audit reports. | `src-tauri/src/commands/table.rs`, `src/components/workspace/TableDataView.tsx`. | Build/test coverage; real driver exports deferred. |
| Explorer export parity | Context menu now lists only capability-approved formats and includes every host encoder. | `src/components/workspace/SchemaSidebar.tsx`. | Frontend build passed. |
| Data migration | CSV/JSON/XLSX import, mapping/preflight, cross-connection transfer, table data compare and PostgreSQL schema SQL backup. | `TableDataTransferDialog.tsx`, `commands/table.rs`. | Real migration runs deferred. |
| Xugu type members from DBX | Protocol and metadata capability foundation exist; sidecar member request and lazy UI expander are pending. | `docs/dbx-upstream-delta-2026-08-11.md`. | Blocked only on sidecar implementation; no synthetic capability is exposed. |

## Remaining implementation work

1. Implement the Xugu sidecar `SchemaObjects` request and object-member
   request, then add an explicit keyboard-accessible lazy expander to the
   Explorer. This is the only confirmed fresh DBX functional delta.
2. Verify all registered external driver packages declare only their reviewed
   `tableExportFormats` and LSP dialects. This must use package fixtures and
   real-driver validation, not a UI assumption.
3. Run the deferred database matrix: import/export round trips, SQL restore,
   migration/transfer conflict policies, LSP metadata completion, snippets and
   cancellation across the supported live databases.
4. Consider a dedicated editable DBML Monaco document only if users need
   authoring parity with DBChart. It should remain review-first and never
   bypass migration planning or explicit database mutation approval.
