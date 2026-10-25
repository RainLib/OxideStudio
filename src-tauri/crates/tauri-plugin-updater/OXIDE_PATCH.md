# OxideStudio updater patch

This directory contains the crates.io source of `tauri-plugin-updater` 2.10.1.
Its Apache-2.0 and MIT licenses and copyright headers are retained.
The published crate records upstream commit `d6a3898001a4bcc659e045f9501498751b77dbe6`
at `plugins/updater` in its `.cargo_vcs_info.json`.
The crate archive SHA-256 is
`806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`,
matching the original Cargo.lock registry checksum.

The only production change is in Windows `Update::install_inner`: inspect the
`ShellExecuteW` result and return an I/O error for values at or below 32 before
exiting. This lets OxideStudio restore its backup scheduler if launching the
installer fails. Argument escaping, extraction, signature verification and
non-Windows installation behavior remain upstream implementations.

The same check exists on the upstream v2 branch:
https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs

Remove this patch when upgrading to an audited release containing that check.
This patch does not detect cancellation after an installer has started: the
persistent backup barrier requires the new application or explicit recovery.
