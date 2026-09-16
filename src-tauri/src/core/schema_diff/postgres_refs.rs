use crate::core::dialect::DatabaseKind;

pub(super) fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Rewrites only PostgreSQL identifier positions for an explicit one-schema
/// mapping. String literals and comments remain opaque, except for a
/// standalone `regclass` literal such as `nextval('old.seq'::regclass)`.
/// Dollar-quoted routine bodies are also preserved verbatim: their dynamic
/// SQL is outside the verified catalog positions this mapper may change.
/// The helper deliberately never attempts cross-database rewriting.
pub(super) fn rewrite_postgres_schema_qualified_references(
    input: &str,
    source_schema: &str,
    target_schema: &str,
) -> String {
    if source_schema.trim().is_empty() || source_schema == target_schema {
        return input.to_string();
    }
    let target_identifier = DatabaseKind::Postgres.quote_identifier(target_schema);
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut offset = 0;
    while offset < bytes.len() {
        if bytes[offset..].starts_with(b"--") {
            let end = bytes[offset..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|index| offset + index)
                .unwrap_or(bytes.len());
            output.push_str(&input[offset..end]);
            offset = end;
            continue;
        }
        if bytes[offset..].starts_with(b"/*") {
            let end = bytes[offset + 2..]
                .windows(2)
                .position(|window| window == b"*/")
                .map(|index| offset + index + 4)
                .unwrap_or(bytes.len());
            output.push_str(&input[offset..end]);
            offset = end;
            continue;
        }
        if bytes[offset] == b'\'' {
            let (end, content) = postgres_single_quoted_literal(input, offset);
            let after_literal = input[end..].trim_start();
            if after_literal.to_ascii_lowercase().starts_with("::regclass") {
                output.push('\'');
                output.push_str(&rewrite_postgres_regclass_literal(
                    content,
                    source_schema,
                    &target_identifier,
                ));
                output.push('\'');
            } else {
                output.push_str(&input[offset..end]);
            }
            offset = end;
            continue;
        }
        if bytes[offset] == b'$' {
            if let Some(end) = postgres_dollar_quoted_literal_end(input, offset) {
                output.push_str(&input[offset..end]);
                offset = end;
                continue;
            }
        }
        if bytes[offset] == b'"' {
            let (end, identifier) = postgres_quoted_identifier(input, offset);
            if identifier == source_schema && input[end..].starts_with('.') {
                output.push_str(&target_identifier);
            } else {
                output.push_str(&input[offset..end]);
            }
            offset = end;
            continue;
        }
        if is_postgres_unquoted_identifier_start(bytes[offset]) {
            let end = input[offset..]
                .bytes()
                .take_while(|byte| is_postgres_unquoted_identifier_continue(*byte))
                .count()
                + offset;
            let identifier = &input[offset..end];
            if identifier == source_schema && input[end..].starts_with('.') {
                output.push_str(&target_identifier);
            } else {
                output.push_str(identifier);
            }
            offset = end;
            continue;
        }
        let character = input[offset..].chars().next().expect("valid UTF-8 input");
        output.push(character);
        offset += character.len_utf8();
    }
    output
}

pub(super) fn postgres_single_quoted_literal(input: &str, start: usize) -> (usize, &str) {
    let bytes = input.as_bytes();
    let mut offset = start + 1;
    while offset < bytes.len() {
        if bytes[offset] == b'\'' {
            if bytes.get(offset + 1) == Some(&b'\'') {
                offset += 2;
                continue;
            }
            return (offset + 1, &input[start + 1..offset]);
        }
        let character = input[offset..].chars().next().expect("valid UTF-8 input");
        offset += character.len_utf8();
    }
    (input.len(), &input[start + 1..])
}

pub(super) fn postgres_quoted_identifier(input: &str, start: usize) -> (usize, &str) {
    let bytes = input.as_bytes();
    let mut offset = start + 1;
    while offset < bytes.len() {
        if bytes[offset] == b'"' {
            if bytes.get(offset + 1) == Some(&b'"') {
                offset += 2;
                continue;
            }
            return (offset + 1, &input[start + 1..offset]);
        }
        let character = input[offset..].chars().next().expect("valid UTF-8 input");
        offset += character.len_utf8();
    }
    (input.len(), &input[start + 1..])
}

pub(super) fn postgres_dollar_quoted_literal_end(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    debug_assert_eq!(bytes.get(start), Some(&b'$'));
    let mut delimiter_end = start + 1;
    if bytes.get(delimiter_end) == Some(&b'$') {
        delimiter_end += 1;
    } else {
        let tag_start = delimiter_end;
        while let Some(byte) = bytes.get(delimiter_end) {
            if !(byte.is_ascii_alphanumeric() || *byte == b'_') {
                break;
            }
            delimiter_end += 1;
        }
        if delimiter_end == tag_start
            || !is_postgres_unquoted_identifier_start(bytes[tag_start])
            || bytes.get(delimiter_end) != Some(&b'$')
        {
            return None;
        }
        delimiter_end += 1;
    }

    let delimiter = &input[start..delimiter_end];
    input[delimiter_end..]
        .find(delimiter)
        .map(|offset| delimiter_end + offset + delimiter.len())
}

pub(super) fn rewrite_postgres_regclass_literal(
    literal: &str,
    source_schema: &str,
    target_identifier: &str,
) -> String {
    let quoted_source = format!("\"{source_schema}\".");
    if let Some(rest) = literal.strip_prefix(&quoted_source) {
        return format!("{target_identifier}.{rest}");
    }
    if let Some(rest) = literal.strip_prefix(&format!("{source_schema}.")) {
        return format!("{target_identifier}.{rest}");
    }
    literal.to_string()
}

pub(super) fn is_postgres_unquoted_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

pub(super) fn is_postgres_unquoted_identifier_continue(byte: u8) -> bool {
    is_postgres_unquoted_identifier_start(byte) || byte.is_ascii_digit() || byte == b'$'
}
