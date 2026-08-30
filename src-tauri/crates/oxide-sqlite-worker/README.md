# Oxide SQLite SSH worker

This crate builds the short-lived Linux worker used to access a SQLite file on
the final host of a verified SSH connection. It is not a general remote shell
or an independently selectable database driver.

Security and lifecycle rules:

- the desktop and worker negotiate protocol version `1` before opening a file;
- all database and transfer paths are absolute, control-character-free paths;
- SQL is sent as JSONL data, never interpolated into a shell command;
- query and execute parameters remain structured values;
- one request is executed at a time, responses are capped at 16 MiB, query
  rows are capped at 100,000 and BLOB previews at 512 KiB;
- cancellation binds to the active request ID and uses both SQLite's interrupt
  handle and a progress callback, including the race before execution starts;
- backups write a partial file, run integrity validation and only then publish
  the final remote path;
- release artifacts are static Linux musl binaries for amd64 and arm64. The
  packaging workflow binds the binary digest, platform, protocol and declared
  capabilities before Minisign signing and immutable OSS publication.

The desktop-side deployment, host-key-bound consent, temporary placement and
cleanup receipt live outside this crate so the remote process never receives
SSH credentials or application configuration.
