/// `use <database>` changes the shell's selected database; it is not JavaScript
/// evaluation. Accept one bare, whitespace-free token only and let the native
/// driver apply its final server-compatible database-name validation.
pub(super) fn parse_use_database(source: &str) -> Option<&str> {
    let prefix = source.get(..3)?;
    if !prefix.eq_ignore_ascii_case("use") {
        return None;
    }
    let suffix = source.get(3..)?;
    if !suffix.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let database = suffix.trim();
    (!database.is_empty() && !database.chars().any(char::is_whitespace) && !database.contains(';'))
        .then_some(database)
}

pub(super) fn parse_collection_prefix(source: &str) -> Result<(String, usize), String> {
    if !source
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("db."))
    {
        return Err("MongoDB shell command must start with db.<collection>.".into());
    }
    let rest = &source[3..];
    if rest.starts_with("getCollection") {
        let open = rest
            .find('(')
            .ok_or("Invalid db.getCollection() command.")?;
        let close = matching_paren(rest, open).ok_or("Invalid db.getCollection() command.")?;
        let args = split_top_level(&rest[open + 1..close]);
        if args.len() != 1 {
            return Err("db.getCollection() requires one collection name.".into());
        }
        let collection = string_argument(&args[0])?;
        let end = 3 + close + 1;
        let suffix = &source[end..];
        let trimmed = suffix.trim_start();
        if !trimmed.starts_with('.') {
            return Err("MongoDB collection method is required.".into());
        }
        return Ok((collection, end + suffix.len() - trimmed.len()));
    }
    let collection_end = rest
        .char_indices()
        .find_map(|(index, character)| {
            (character == '.' || character.is_whitespace()).then_some(index)
        })
        .ok_or("MongoDB collection method is required.")?;
    let collection = &rest[..collection_end];
    if collection.is_empty()
        || !collection
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(
            "Invalid MongoDB collection name; use db.getCollection() for dotted names.".into(),
        );
    }
    let suffix = &rest[collection_end..];
    let dot = suffix
        .find('.')
        .ok_or("MongoDB collection method is required.")?;
    if !suffix[..dot].trim().is_empty() {
        return Err("Invalid MongoDB collection name.".into());
    }
    Ok((collection.to_string(), 3 + collection_end + dot))
}

fn string_argument(value: &str) -> Result<String, String> {
    json5::from_str::<serde_json::Value>(value.trim())
        .map_err(|error| format!("Invalid MongoDB argument: {error}"))?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "MongoDB argument must be a string.".into())
}

pub(super) fn method_call(
    source: &str,
    prefix_end: usize,
    method: &str,
) -> Option<(Vec<String>, String)> {
    let raw_suffix = &source[prefix_end..];
    let suffix = raw_suffix.trim_start();
    let whitespace = raw_suffix.len() - suffix.len();
    let expected = format!(".{method}");
    if !suffix.starts_with(&expected) || !suffix[expected.len()..].starts_with('(') {
        return None;
    }
    let open = prefix_end + whitespace + expected.len();
    let close = matching_paren(source, open)?;
    Some((
        split_top_level(&source[open + 1..close]),
        source[close + 1..].trim().to_string(),
    ))
}

pub(super) fn chained_calls(chain: &str) -> Result<Vec<(String, Vec<String>)>, String> {
    let mut rest = chain.trim();
    let mut calls = Vec::new();
    while !rest.is_empty() {
        let Some(after_dot) = rest.strip_prefix('.') else {
            return Err("Invalid MongoDB method chain.".into());
        };
        let open = after_dot.find('(').ok_or("Invalid MongoDB method chain.")?;
        let name = after_dot[..open].trim();
        if name.is_empty()
            || !name
                .chars()
                .all(|character| character.is_ascii_alphabetic())
        {
            return Err("Invalid MongoDB method chain.".into());
        }
        let close = matching_paren(after_dot, open).ok_or("Invalid MongoDB method chain.")?;
        calls.push((
            name.to_string(),
            split_top_level(&after_dot[open + 1..close]),
        ));
        rest = after_dot[close + 1..].trim();
    }
    Ok(calls)
}

pub(super) fn matching_paren(source: &str, open: usize) -> Option<usize> {
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, byte) in source.as_bytes().iter().enumerate().skip(open) {
        let character = *byte as char;
        if escaped {
            escaped = false;
            continue;
        }
        if let Some(delimiter) = quote {
            if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == '(' {
            depth += 1;
        } else if character == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

pub(super) fn split_top_level(source: &str) -> Vec<String> {
    if source.trim().is_empty() {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut start = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, byte) in source.as_bytes().iter().enumerate() {
        let character = *byte as char;
        if escaped {
            escaped = false;
            continue;
        }
        if let Some(delimiter) = quote {
            if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
        } else if character == ',' && depth == 0 {
            result.push(source[start..index].trim().to_string());
            start = index + 1;
        }
    }
    result.push(source[start..].trim().to_string());
    result
}

pub(super) fn split_shell_statements(source: &str) -> Result<Vec<&str>, String> {
    let mut statements = Vec::new();
    let mut start = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let bytes = source.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let character = bytes[index] as char;
        let next = bytes.get(index + 1).copied().map(char::from);
        if line_comment {
            if matches!(character, '\n' | '\r') {
                line_comment = false;
            }
            index += 1;
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            index += 1;
            continue;
        }
        if (character == '/' && next == Some('/')) || (character == '-' && next == Some('-')) {
            line_comment = true;
            index += 2;
            continue;
        }
        if character == '/' && next == Some('*') {
            block_comment = true;
            index += 2;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
            if depth < 0 {
                return Err("MongoDB shell command has unbalanced delimiters.".into());
            }
        } else if character == ';' && depth == 0 {
            let statement = source[start..index].trim();
            if !statement.is_empty() {
                statements.push(statement);
            }
            start = index + 1;
        }
        index += 1;
    }
    if quote.is_some() || block_comment || depth != 0 {
        return Err("MongoDB shell command has an unclosed string, comment, or delimiter.".into());
    }
    let statement = source[start..].trim();
    if !statement.is_empty() {
        statements.push(statement);
    }
    if statements.is_empty() {
        return Err("MongoDB shell command is required.".into());
    }
    Ok(statements)
}

pub(super) fn trim_outer_comments(mut source: &str) -> &str {
    loop {
        source = source.trim_start();
        if source.starts_with("//") || source.starts_with("--") {
            source = source
                .find(['\n', '\r'])
                .map(|index| &source[index + 1..])
                .unwrap_or("");
            continue;
        }
        if source.starts_with("/*") {
            let Some(end) = source.find("*/") else {
                return source;
            };
            source = &source[end + 2..];
            continue;
        }
        break;
    }

    let source = source.trim_end();
    let mut body_end = 0;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut characters = source.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        let next = characters.peek().map(|(_, character)| *character);
        if line_comment {
            if matches!(character, '\n' | '\r') {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                block_comment = false;
                characters.next();
            }
            continue;
        }
        if let Some(delimiter) = quote {
            body_end = index + character.len_utf8();
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if (character == '/' && next == Some('/')) || (character == '-' && next == Some('-')) {
            line_comment = true;
            characters.next();
            continue;
        }
        if character == '/' && next == Some('*') {
            block_comment = true;
            characters.next();
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        }
        if !character.is_whitespace() {
            body_end = index + character.len_utf8();
        }
    }
    source[..body_end].trim_end()
}
