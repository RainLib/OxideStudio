use anyhow::Result;
use sqlx::PgConnection;

pub(super) async fn capture(connection: &mut PgConnection) -> Result<()> {
    sqlx::query(
        "SELECT pg_catalog.set_config('oxide.transfer_native_settings',pg_catalog.jsonb_build_object(
            'search_path',pg_catalog.current_setting('search_path'),
            'DateStyle',pg_catalog.current_setting('DateStyle'),
            'IntervalStyle',pg_catalog.current_setting('IntervalStyle'),
            'TimeZone',pg_catalog.current_setting('TimeZone'),
            'extra_float_digits',pg_catalog.current_setting('extra_float_digits'),
            'bytea_output',pg_catalog.current_setting('bytea_output'))::text,false)",
    )
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn normalize(connection: &mut PgConnection) -> Result<()> {
    sqlx::query("SELECT pg_catalog.set_config('search_path','pg_catalog',false),pg_catalog.set_config('DateStyle','ISO, YMD',false),pg_catalog.set_config('IntervalStyle','postgres',false),pg_catalog.set_config('TimeZone','UTC',false),pg_catalog.set_config('extra_float_digits','3',false),pg_catalog.set_config('bytea_output','hex',false),pg_catalog.set_config('client_encoding','UTF8',false),pg_catalog.set_config('lock_timeout','5s',false),pg_catalog.set_config('statement_timeout','30min',false),pg_catalog.set_config('idle_in_transaction_session_timeout','5min',false)")
        .execute(connection).await?;
    Ok(())
}

// All callers run inside the owning read/publication transaction. Native type
// functions may resolve user objects; internal catalog queries stay pinned.
pub(super) async fn native_path(connection: &mut PgConnection) -> Result<()> {
    sqlx::query("SELECT pg_catalog.set_config('search_path',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'search_path',true)")
        .execute(connection).await?;
    Ok(())
}

pub(super) async fn native_write(connection: &mut PgConnection) -> Result<()> {
    sqlx::query(
        "SELECT
          pg_catalog.set_config('search_path',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'search_path',true),
          pg_catalog.set_config('DateStyle',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'DateStyle',true),
          pg_catalog.set_config('IntervalStyle',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'IntervalStyle',true),
          pg_catalog.set_config('TimeZone',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'TimeZone',true),
          pg_catalog.set_config('extra_float_digits',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'extra_float_digits',true),
          pg_catalog.set_config('bytea_output',pg_catalog.current_setting('oxide.transfer_native_settings')::pg_catalog.jsonb->>'bytea_output',true)",
    )
    .execute(connection)
    .await?;
    Ok(())
}
