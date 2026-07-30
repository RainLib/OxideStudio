# Shell policy and Git tool windows

OxideStudio evaluates every Agent `shell.execute` call before approval and again immediately before process creation. The one-time approval lease is bound to the Turn, call, tool input digest, and command-policy digest. A changed command or policy invalidates the approval.

Built-in rules cannot be weakened. Additional global rules live at `ai.shell.commandPolicy` in `settings.json`; project rules live in `.oxide/command-policy.json`. Both use [the version 1 schema](../command-policy.schema.json) and may only select `confirm` or `block`. Invalid policy documents fail closed. Policy findings are displayed in the approval prompt; high-risk commands require the generated `RUN XXXXXX` phrase.

Repository UI is split into independent `Commit` and `Version Control` tool windows. They share a per-project Git store and the bounded Rust Git command layer. Commit owns working-tree review, staging, hunk operations, and commit validation. Version Control owns log details, branches, remotes, synchronization, and patches. Both default to the right dock, participate in same-side mutual exclusion, preserve internal state, and can be moved from Settings or the command palette.
