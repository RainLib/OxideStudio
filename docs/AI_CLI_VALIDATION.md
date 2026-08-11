# Codex CLI / CodeBuddy CLI validation checklist

Updated: 2026-08-11

This checklist distinguishes logic validation from real database/driver certification. Real database validation remains intentionally deferred until the provider and tool logic is complete.

## Automated logic coverage

- [x] Provider migration keeps separate Assistant and inline-completion channels.
- [x] Old connections migrate to `unclassified`; AI writes require explicit development/staging classification.
- [x] CLI environment names reject reserved Oxide/bridge/credential variables; values stay in Rust private storage.
- [x] Codex and CodeBuddy executable discovery, custom paths, Windows npm shim/Node entry handling and model/effort discovery are implemented.
- [x] Fake CLI JSONL covers streaming events, bounded stderr, timeout and cancellation.
- [x] Codex and CodeBuddy dialect parsers cover text, tools, usage, terminal errors and authentication/MCP classification.
- [x] Raw reasoning text is discarded; only a bounded provider activity label reaches React.
- [x] Private bridge rejects missing/wrong tokens and does not change the public read-only MCP contract.
- [x] Tool broker binds frozen turn context, canonical input digest, target, policy, expiry and single-use approval lease.
- [x] `query.executeApproved` covers Agent-only visibility, one-operation input, transaction-control rejection, DDL phrase confirmation and production/unclassified/protected-target blocking.
- [x] CLI cancellation/crash never auto-replays a turn; an in-flight approved mutation is marked for manual verification.
- [x] Selecting a CLI Assistant Provider does not change the independent OpenAI-compatible inline completion Provider.

## Build gates

- [x] `npm test` — 243 test files and 1290 tests passed.
- [x] `npm run build`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --no-run` — all Rust unit and integration test executables compile.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — execution on the current Windows image stops before the first test at the local loader error `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`; rerun after repairing the machine's test runtime.
- [x] `npm run tauri build` — release application, MSI and NSIS bundles completed after removing the duplicate Cargo/external-bin registration for `oxide-agent`.

## Deferred real-environment certification

- [ ] Codex CLI authenticated smoke test on Windows, macOS and Linux.
- [ ] CodeBuddy / `cbc` authenticated smoke test on Windows, macOS and Linux.
- [ ] Windows nvm/npm variants and macOS/Linux login-shell PATH matrix on clean machines.
- [ ] Real PostgreSQL/MySQL/SQLite/MongoDB/Redis/Elasticsearch approved mutation and cancellation receipts.
- [ ] 70+ driver metadata, read-only query, recommendations and EXPLAIN matrix.
- [ ] Reviewed mutation-adapter matrix; drivers without a trusted adapter must remain read-only.
- [ ] Production/unclassified/protected database destructive tests against disposable fixtures.

No unchecked item in the deferred section may be described as certified support. The implemented boundary is fail-closed: unavailable or unreviewed mutation adapters retain metadata and read-only analysis but do not expose AI writes.
