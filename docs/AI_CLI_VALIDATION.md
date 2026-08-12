# Codex CLI / CodeBuddy CLI validation checklist

Updated: 2026-08-11

This checklist distinguishes logic validation from real database/driver certification. Real database validation remains intentionally deferred until the provider and tool logic is complete.

## Automated logic coverage

- [x] Provider migration keeps separate Assistant and inline-completion channels.
- [x] Old connections migrate to `unclassified`; AI writes require explicit development/staging classification.
- [x] CLI environment names reject reserved Oxide/bridge/credential variables; values stay in Rust private storage.
- [x] Codex and CodeBuddy executable discovery, custom paths, Windows npm shim/Node entry handling and model/effort discovery are implemented.
- [x] Windows Node/npm discovery covers PATH, `NVM_HOME`, `NVM_SYMLINK`, nvm-windows version directories and the common `C:\nvm4w\nodejs` symlink.
- [x] Codex readiness requires `codex login status` plus native model discovery; a model catalog alone never counts as authentication.
- [x] CodeBuddy readiness requires a real ACP `_codebuddy.ai/getUserInfo` account plus successful `session/new`; `apiKeySource` and a public model catalog never count as authentication.
- [x] Codex authentication uses app-server `account/login/start`, opens the returned browser URL, waits for the matching `account/login/completed`, supports cancellation, and verifies the returned account.
- [x] CodeBuddy authentication discovers all advertised ACP methods, opens `_codebuddy.ai/authUrl` in the browser, waits for the provider callback, and verifies the returned account without exposing its token.
- [x] Codex Assistant turns use the app-server `thread/start` / `turn/start` lifecycle, streamed item events, token usage, `turn/interrupt`, and ephemeral isolated threads rather than `codex exec`.
- [x] CLI timeouts are inactivity-based, renew on valid provider events, use a five-minute minimum for legacy 30-second settings, and retain a two-hour hard ceiling.
- [x] Assistant model and reasoning controls use the live Codex model catalog or CodeBuddy ACP config options, including provider-added effort values.
- [x] Typing `/` in the Assistant loads Codex embedded commands or CodeBuddy `available_commands_update`; terminal-only and unsafe workspace/remote-control commands are filtered out.
- [x] Assistant first-run and provider switching use one shell with provider-specific setup, modes, starter actions and encrypted conversation snapshots.
- [x] CLI provider revalidation keeps the conversation surface mounted; setup replaces it only after a confirmed missing installation or authentication requirement.
- [x] Missing Codex/CodeBuddy installations can be installed into the OxideStudio application-data directory through fixed npm package and registry arguments; installation is never silent or global.
- [x] CLI authentication has explicit starting/browser/callback/verifying/succeeded/failed/cancelled/expired states and never infers success from a closed terminal or a model list.
- [x] Fake CLI JSONL covers streaming events, bounded stderr, timeout and cancellation.
- [x] Codex and CodeBuddy dialect parsers cover text, tools, usage, terminal errors and authentication/MCP classification.
- [x] Raw reasoning text is discarded; only a bounded provider activity label reaches React.
- [x] Private bridge rejects missing/wrong tokens and does not change the public read-only MCP contract.
- [x] Tool broker binds frozen turn context, canonical input digest, target, policy, expiry and single-use approval lease.
- [x] `query.executeApproved` covers Agent-only visibility, one-operation input, transaction-control rejection, DDL phrase confirmation and production/unclassified/protected-target blocking.
- [x] CLI cancellation/crash never auto-replays a turn; an in-flight approved mutation is marked for manual verification.
- [x] Selecting a CLI Assistant Provider does not change the independent OpenAI-compatible inline completion Provider.

## Build gates

- [x] `npm test -- --pool=threads --maxWorkers=1` — 246 test files and 1310 tests passed. The single-worker gate avoids Windows process/virtual-memory exhaustion in the full suite.
- [x] `npm run build`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --no-run -j 1` — all Rust unit and integration test executables compile. Executing the desktop test binary on this workstation still exits before the harness with Windows `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`.
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
