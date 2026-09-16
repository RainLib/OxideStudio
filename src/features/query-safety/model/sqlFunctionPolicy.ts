const DANGEROUS_SQL_FUNCTIONS = [
  "benchmark",
  "dblink_connect",
  "dblink_connect_u",
  "dblink_exec",
  "get_lock",
  "last_insert_id",
  "load_file",
  "lo_export",
  "master_pos_wait",
  "nextval",
  "pg_advisory_lock",
  "pg_advisory_unlock",
  "pg_advisory_unlock_all",
  "pg_advisory_xact_lock",
  "pg_backup_start",
  "pg_backup_stop",
  "pg_cancel_backend",
  "pg_create_restore_point",
  "pg_logical_emit_message",
  "pg_notify",
  "pg_promote",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_switch_wal",
  "pg_terminate_backend",
  "pg_try_advisory_lock",
  "pg_try_advisory_xact_lock",
  "pg_write_file",
  "release_all_locks",
  "release_lock",
  "set_config",
  "setval",
  "sleep",
  "source_pos_wait",
  "sys_eval",
  "sys_exec",
] as const;

const DESTRUCTIVE_SQL_FUNCTIONS = [
  "pg_promote",
  "pg_reload_conf",
  "pg_terminate_backend",
  "sys_exec",
] as const;

export function containsDangerousSqlFunction(sql: string) {
  return containsSqlFunctionName(sql, DANGEROUS_SQL_FUNCTIONS);
}

export function containsDestructiveSqlFunction(sql: string) {
  return containsSqlFunctionName(sql, DESTRUCTIVE_SQL_FUNCTIONS);
}

function containsSqlFunctionName(sql: string, names: readonly string[]) {
  const normalized = sql.toLowerCase();
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^a-z0-9_$])(?:[\"\`]?)${escaped}(?:[\"\`]?)\\s*\\(`,
    ).test(normalized);
  });
}
