use anyhow::{ensure, Result};
use sqlx::{Executor, MySqlConnection};

pub(super) async fn capture(c: &mut MySqlConnection) -> Result<()> {
    sqlx::query(
        "SET @oxide_transfer_mode=@@SESSION.sql_mode,@oxide_transfer_zone=@@SESSION.time_zone",
    )
    .execute(c)
    .await?;
    Ok(())
}
pub(super) async fn native_settings(c: &mut MySqlConnection) -> Result<(String, String)> {
    Ok(sqlx::query_as("SELECT CAST(@oxide_transfer_mode AS CHAR CHARACTER SET utf8mb4),CAST(@oxide_transfer_zone AS CHAR CHARACTER SET utf8mb4)").fetch_one(c).await?)
}
pub(super) async fn normalize(c: &mut MySqlConnection) -> Result<()> {
    let (mode, _) = native_settings(c).await?;
    let canonical = mode
        .split(',')
        .filter(|mode| !matches!(*mode, "ANSI_QUOTES" | "NO_BACKSLASH_ESCAPES"))
        .collect::<Vec<_>>()
        .join(",");
    sqlx::query("SET SESSION sql_mode=?,SESSION time_zone='+00:00',SESSION sql_quote_show_create=ON,SESSION foreign_key_checks=ON,SESSION unique_checks=ON").bind(canonical).execute(c).await?;
    Ok(())
}
pub(super) async fn native_write(c: &mut MySqlConnection) -> Result<()> {
    let (mut mode, zone) = native_settings(c).await?;
    if !mode.split(',').any(|part| part == "NO_AUTO_VALUE_ON_ZERO") {
        if !mode.is_empty() {
            mode.push(',');
        }
        mode.push_str("NO_AUTO_VALUE_ON_ZERO");
    }
    sqlx::query("SET SESSION sql_mode=?,SESSION time_zone=?")
        .bind(mode)
        .bind(zone)
        .execute(c)
        .await?;
    Ok(())
}
pub(super) async fn require_clean_diagnostics(c: &mut MySqlConnection) -> Result<()> {
    // SHOW WARNINGS is not supported by MySQL's prepared-statement protocol.
    let rows = c.fetch_all("SHOW WARNINGS").await?;
    ensure!(
        rows.is_empty(),
        "MySQL publication produced a conversion or execution diagnostic"
    );
    Ok(())
}
