use anyhow::{anyhow, Result};
use oxide_driver_protocol::SqlLookupContext;

pub(super) fn validate_context(
    context: Option<SqlLookupContext>,
    database: Option<&str>,
) -> Result<Option<SqlLookupContext>> {
    let Some(context) = context else {
        return Ok(None);
    };
    let valid_name = |value: &str| {
        !value.trim().is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
    };
    if !valid_name(&context.database)
        || !valid_name(&context.default_schema)
        || database.is_some_and(|expected| expected != context.database)
    {
        return Err(anyhow!(
            "External driver returned an invalid SQL lookup context"
        ));
    }
    Ok(Some(context))
}

#[cfg(test)]
#[path = "lookup_context_tests.rs"]
mod tests;
