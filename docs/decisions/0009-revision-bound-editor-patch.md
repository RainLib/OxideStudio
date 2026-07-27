# ADR-0009: Revision-bound AI editor patch preview

- Status: Accepted
- Date: 2026-07-15
- Scope: AI Agent / SQL editor integration

## Context

Natural-language SQL generation, error fixing, and query optimization all need to propose editor changes. Applying model text directly is unsafe: the user may continue typing while the model is running, a stale attachment may be clicked later, or a model-generated range may not describe the content shown in a diff. A database approval dialog is also the wrong boundary because editing SQL is not database execution, while previewing a patch must not imply that it has been applied.

## Decision

`editor.proposePatch` is registered as a read-only AI tool. The host, not the model, resolves the writable active query tab and captures a one-based Monaco range, the exact original text in that range, and a revision derived from the current document. The model supplies the replacement, title, and rationale. If no explicit range is supplied, the host uses the current non-empty selection and otherwise the full document.

The tool returns an immutable patch artifact and does not update the tab. Attachment generation binds `editor.previewPatch` to the artifact's project, tab, range, original text, and document revision. The UI action checks the issued revision and confirms that the range still contains the captured original text before opening a two-column before/after panel.

Apply is a direct user action in that panel. The tab store independently verifies the whole-document revision and original range contents immediately before replacing text. A mismatch returns a stale result and preserves the current document. Successful Apply marks the tab dirty, clears the preview, and reveals the applied range; it never executes the SQL.

Patch `originalText` and replacement are each limited to 50,000 characters. Empty values remain valid to support insertion and deletion. Binary/project image previews are rejected. The lightweight document hash is an optimistic-concurrency identity, not a cryptographic trust boundary; exact range-content comparison is still required.

## Consequences

- AI-generated SQL can participate in page interactions without silently overwriting concurrent edits.
- Preview and Apply are distinct, observable states; neither implies query execution or database mutation approval.
- Selection and CRLF documents use the same one-based UTF-16 coordinate convention as Monaco.
- Whole-file rewrites above the content budget require a narrower selection or a future streaming/file patch artifact.
- Patch Preview exposes an explicit, non-executing vendor syntax check. It builds the virtual post-patch document, parses it in Rust with the PostgreSQL or MySQL dialect, and returns bounded structured diagnostics; no connection or transaction is opened. LSP diagnostics continue to refresh after Apply.
- When the complete virtual post-patch document is one read-only query and a supported data source is connected, a separate explicit **Plans** action requests before/after `EXPLAIN estimate` plans. The service never explains an isolated replacement fragment: it compares the current complete document with the complete virtual document. The backend still enforces single-statement read-only SQL, never uses `ANALYZE`, and preserves database/schema routing. Closing the preview or making the document stale cancels the active request. The compact comparison reports planner cost, estimated rows and node count plus at most three bounded facts about relation access, full scans, index usage or the highest-cost node. It warns that the database was contacted and planner cost is not proof of runtime improvement.
- **Actual** is a separate, explicit two-step action. It first opens an inline warning and only invokes `EXPLAIN ANALYZE` after the user selects **Run actual**. The same backend gate requires one read-only query and executes it in a read-only transaction with cancellation. The panel reports actual execution time, root rows/loops, up to three slowest reported nodes and material estimated-versus-actual row mismatches. It never runs automatically, and it states that cache and load affect timings.
