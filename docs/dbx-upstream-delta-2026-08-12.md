# DBX upstream alignment — 2026-08-12

## Audited baseline

- Reference checkout: `sources/dbx`
- DBX head: `1bba6fa09 fix(mysql): list logical ShardingSphere Proxy tables`
- Previous CLI baseline: `8482ef25e`
- Scope: product behavior and reusable logic only. `sources/` remains an untracked reference repository.

## Implemented from the current delta

| DBX change | DBX implementation | OxideStudio alignment |
| --- | --- | --- |
| Redis command autocomplete (`dbe337573`) | `apps/desktop/src/lib/redis/redisCommandDocs.ts`, `redisCommandTokenizer.ts`, `redisCompletion.ts`, and the Redis branch in `QueryEditor.vue`/connection store | Added `src/lib/redisCommandDocs.ts`, `redisCommandTokenizer.ts`, `redisCompletion.ts`, `redisCompletionSource.ts`; `QueryEditor.tsx` now discovers `COMMAND DOCS`/`COMMAND`, falls back safely, and recommends commands, subcommands, arguments and bounded existing keys for the selected logical DB. |
| Connection-level database browser (`fee3ed1d5`) | `apps/desktop/src/components/objects/DatabaseBrowser.vue`, `queryStore.openDatabaseBrowser`, `ContentArea.vue`, and connection-node actions in `SidebarTreeRuntimeHost.vue` | Added a reusable `database_browser` workspace tab, connection context-menu entry, metadata command and driver contract. PostgreSQL/MySQL return size/charset/collation/comment when permitted; other drivers return name-only rows. Search, sorting, resizable columns, list/grid views, refresh, and Explorer reveal are supported. |
| Ignore one updater version (`967084c49`) | `apps/desktop/src/composables/useAppUpdater.ts`, `UpdateDialog.vue`, and `settingsStore.ts` | Added persisted ignored-version state, semantic comparison that also suppresses older versions, automatic-check filtering, manual-force override, and an `Ignore <version>` action in the themed update dialog. |
| Keep create-table SQL preview visible (`ca303e555`) | DBX create-table editor preview state and its regression test | Added a non-executing `preview_create_table` command that reuses the same Rust dialect renderer as execution. The Create Table workspace keeps a visible, live SQL preview and remains themed in both light and dark modes. |
| Connection notes (`6ea009a58`) | `ConnectionDialog.vue`, `connectionNoteVisibilityDraft.ts`, and `ConnectionTree.vue` | Added a persisted optional note to the Rust/TypeScript connection contract, a bounded note editor with an Explorer visibility switch, note search, and compact connection-tree display. Legacy connections continue to deserialize with no note. |
| Quick-open ranking (`bce120f87`) | `useQuickOpen.ts` and its ranking fixtures | Ported the identifier-aware exact/initials/prefix/word-prefix/substring/fuzzy matcher, including snake_case, dotted paths, CamelCase, multi-token metadata fallback, primary-label priority, deterministic length/name tie-breaking, and bounded results. |
| Theme-consistent high-frequency dialogs | DBX object editors use shared background/border/input tokens | Converted Create Table, Create Constraint, Create View, and workspace create/edit/delete dialogs from fixed dark colors to Oxide workbench tokens. The migration dialog already uses the same token system and a compact single-column review layout. |

## Already covered or intentionally equivalent

- `b8f4386a6` editor tooltip/completion scoping: Oxide completion providers and LSP documents are already keyed to the active tab/model/connection and disposed on scope changes.
- `971871132` grid selection/detail synchronization: Oxide’s value editor and cell detail actions derive from the current grid selection; no separate stale DBX-style detail cache is used.
- `6700b32fb` foldable Mongo document preview: Oxide’s structured value editor already supplies a recursive foldable JSON tree plus formatted text mode.
- `7f405eacf` SQL Server cursor analysis and the listed Kingbase/Hive/GaussDB/Mycat/ShardingSphere compatibility fixes belong to product-specific driver adapters. Oxide’s signed external-driver protocol keeps those fixes in independently versioned packages rather than adding UI-side driver-name branches.
- `c72b42989` Qoder CLI is not migrated: the approved provider scope remains Oxide Assistant, Codex CLI, and CodeBuddy Code CLI.

## Remaining reference deltas

| Item | Status / boundary |
| --- | --- |
| Mongo shell statement separation (`9a16aeaf8`) and document preview polish (`6700b32fb`) | Core structured-value viewing is covered; product-specific shell parsing still belongs to the Mongo driver/runtime verification matrix. |
| Nacos/MQTT/RocketMQ product fixes | Retain as external-driver conformance work. No unverified SQL or network probing is added to the desktop host. |

## Deferred validation

- Real PostgreSQL/MySQL/Redis and the 70+ driver matrix are intentionally not run in this logic-completion phase.
- Database browser metadata must be checked with both privileged and restricted accounts.
- Redis `COMMAND DOCS` fallback must be checked on Redis-compatible products that disable `COMMAND`.
- Create-table preview/execution identity must be checked on bundled PostgreSQL, MySQL/MariaDB, SQLite and DuckDB.
- External compatibility items must be verified by signed driver fixtures and later real-product runs.
