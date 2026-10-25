//! Parse without preparing user SQL: duckdb-rs prepare executes intermediate
//! statements. The engine AST establishes one SELECT/DESCRIBE/SHOW statement
//! and identifies dynamic SQL calls, including escaped identifiers.
use super::*;

pub(super) fn validate(connection: &Connection, sql: &str) -> Result<(), DriverProtocolError> {
    let parsed_sql = explained_query(sql);
    let ast: String = connection
        .query_row(
            "SELECT json_serialize_sql(?::VARCHAR)",
            [parsed_sql],
            |row| row.get(0),
        )
        .map_err(|error| protocol_error("READ_ONLY_REJECTED", error.to_string()))?;
    let ast: Value = serde_json::from_str(&ast)
        .map_err(|error| protocol_error("READ_ONLY_REJECTED", error.to_string()))?;
    let statements = ast.get("statements").and_then(Value::as_array);
    if ast.get("error").and_then(Value::as_bool) != Some(false)
        || statements.is_none_or(|items| items.len() != 1)
        || contains_dynamic_call(&ast)
    {
        return Err(protocol_error(
            "READ_ONLY_REJECTED",
            "Use one SELECT, WITH, DESCRIBE, SHOW or EXPLAIN query. Dynamic SQL is unavailable.",
        ));
    }
    Ok(())
}

fn contains_dynamic_call(node: &Value) -> bool {
    match node {
        Value::Object(object) => {
            (object.get("class").and_then(Value::as_str) == Some("FUNCTION")
                && object
                    .get("function_name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| {
                        name.eq_ignore_ascii_case("query")
                            || name.eq_ignore_ascii_case("query_table")
                    }))
                || object.values().any(contains_dynamic_call)
        }
        Value::Array(items) => items.iter().any(contains_dynamic_call),
        _ => false,
    }
}

fn explained_query(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let start = trivia(&chars, 0);
    let end = word_end(&chars, start);
    if !chars[start..end]
        .iter()
        .collect::<String>()
        .eq_ignore_ascii_case("explain")
    {
        return sql.into();
    }
    let mut start = trivia(&chars, end);
    let end = word_end(&chars, start);
    if chars[start..end]
        .iter()
        .collect::<String>()
        .eq_ignore_ascii_case("analyze")
    {
        start = trivia(&chars, end);
    }
    chars[start..].iter().collect()
}

fn word_end(chars: &[char], mut i: usize) -> usize {
    while chars.get(i).is_some_and(|ch| ch.is_ascii_alphabetic()) {
        i += 1;
    }
    i
}

fn trivia(chars: &[char], mut i: usize) -> usize {
    loop {
        while chars.get(i).is_some_and(|ch| ch.is_whitespace()) {
            i += 1;
        }
        if chars.get(i..i + 2) == Some(&['-', '-']) {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars.get(i..i + 2) == Some(&['/', '*']) {
            i += 2;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                if chars.get(i..i + 2) == Some(&['/', '*']) {
                    depth += 1;
                    i += 2;
                } else if chars.get(i..i + 2) == Some(&['*', '/']) {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
        } else {
            return i;
        }
    }
}
