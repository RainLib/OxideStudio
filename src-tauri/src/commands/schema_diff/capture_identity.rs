pub(super) fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn schema_object_definition_key(parent_name: Option<&str>, name: &str) -> String {
    format!("{}\u{1f}{}", parent_name.unwrap_or_default(), name)
}
