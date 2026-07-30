# ADR-0016: Project Git integration uses system Git and the official GitHub CLI

## Status

Accepted.

## Context

OxideStudio needs a DataGrip-style project VCS workflow, Git URL cloning, and authenticated GitHub repository discovery. Reimplementing Git object storage, credential helpers, SSH, and hosted-provider authentication inside the application would create a large security and maintenance surface.

## Decision

- Use the installed `git` executable for repository operations and the official `gh` executable for GitHub authentication, search, and private-repository clone.
- Execute fixed argument arrays directly from Rust. Never construct a shell command.
- Bind repository operations to the canonical root stored for the active project and optionally recheck the root supplied by the WebView.
- Reject absolute/traversing file paths, local/ext helper clone protocols, embedded HTTPS credentials, NUL bytes, oversized inputs, and non-empty clone destinations.
- Disable terminal and credential-manager prompts. Remote operations fail with a structured retryable error instead of hanging the desktop application.
- Bound process duration and stdout/stderr. GitHub tokens are accepted only for one `gh auth login --with-token` stdin call, are not persisted by OxideStudio, and the temporary byte buffer is overwritten afterward.
- Run `git apply --check` before applying or reversing patches. Hunk staging updates only the Git index and leaves the working file unchanged.
- Use Monaco DiffEditor for file review, with HEAD/index/working contents read under the same project-root and size constraints.

## Consequences

OxideStudio inherits mature Git transports, SSH agents, credential helpers, and GitHub authentication from maintained upstream tools without embedding credentials in project configuration. Git and `gh` remain explicit runtime dependencies for the relevant features. The first version intentionally omits changelists, stash, blame, merge/rebase conflict resolution, and pull-request management; these can be layered on the same bounded command boundary.
