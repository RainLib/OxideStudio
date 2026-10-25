/// MySQL character attributes belong to the column type, not the database's
/// current defaults. Keep rendering shared by migrations and table editing.
pub(crate) fn is_mysql_character_type(data_type: &str) -> bool {
    matches!(
        data_type.trim_start().split(|c: char| !c.is_ascii_alphabetic()).next(),
        Some(name) if matches!(name.to_ascii_lowercase().as_str(),
            "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set")
    )
}

pub(crate) fn render_mysql_character_clause(
    data_type: &str,
    character_set: Option<&str>,
    collation: Option<&str>,
) -> Result<String, String> {
    match (character_set, collation) {
        (None, None) => Ok(String::new()),
        (Some(charset), Some(collation)) => {
            let charset = charset.trim();
            let collation = collation.trim();
            let valid = |value: &str| {
                !value.is_empty()
                    && value.len() <= 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            };
            if !is_mysql_character_type(data_type) || !valid(charset) || !valid(collation) {
                return Err(
                    "Invalid character metadata; recapture the database definition".to_string(),
                );
            }
            Ok(format!(" CHARACTER SET {charset} COLLATE {collation}"))
        }
        _ => Err(
            "Incomplete character metadata; both character set and collation are required"
                .to_string(),
        ),
    }
}
