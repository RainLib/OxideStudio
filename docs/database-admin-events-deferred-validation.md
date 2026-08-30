# Database Scheduled Events Deferred Validation

The MySQL/MariaDB EVENT workflow is implemented with a closed Host-side planner and unit/UI contract coverage. Real server validation remains deferred to the consolidated database matrix.

- MySQL 5.7/8.0/8.4 and supported MariaDB versions: list empty and populated `information_schema.EVENTS`, including one-time and recurring schedules, UTC/system/named time zones, comments, disabled events, and null last-execution values.
- Repeat with a low-privilege account that can view no events, view its own events, and lacks `EVENT` privilege. Confirm permission errors are actionable and never include generated SQL or connection credentials.
- Validate `event_scheduler` values `ON`, `OFF`, and `DISABLED`. Creation may succeed while execution is off; the UI must preserve server status rather than claiming future runs are active.
- Create once and interval events across DST transitions and non-UTC server time zones. Compare `EXECUTE_AT`, `STARTS`, `ENDS`, and `LAST_EXECUTED` with server semantics after refresh.
- Change, delete, or execute an event between preview and confirmation. Confirm the metadata-bound plan is rejected and requires a fresh review.
- Validate INSERT, UPDATE, DELETE, REPLACE, and CALL bodies containing quoted semicolons, Unicode identifiers, backticks, comments, and large but bounded text. Confirm a second statement, DDL, transaction control, SELECT, and `BEGIN...END` are rejected before reaching the server.
- Enable, disable, and delete an event while it is executing. Record server behavior and ensure the completion message describes only the DDL result, not cancellation of an already running body.
- Disconnect/reconnect during preview and execution. Confirm driver identity/version changes invalidate the plan and external/managed packages without the semantic capability remain blocked.
- Dameng Job remains excluded until a signed sidecar protocol declares the exact `SYSJOB` procedure/version contract, structured step/schedule payloads, transaction behavior, cancellation, and terminal receipts.
