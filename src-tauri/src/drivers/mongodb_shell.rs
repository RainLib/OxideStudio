use serde_json::{json, Map, Value};

const DEFAULT_FIND_LIMIT: i64 = 100;
const MAX_FIND_LIMIT: i64 = 10_000;

pub(super) fn looks_like_shell_command(input: &str) -> bool {
    let source = trim_outer_comments(input).trim_end_matches(';').trim();
    source
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("db."))
}

pub(super) fn parse_read_commands(input: &str) -> Result<Vec<Value>, String> {
    split_shell_statements(input)?
        .into_iter()
        .map(parse_read_command)
        .collect()
}

/// Parse the executable, read-only Mongo shell subset exposed by the editor.
/// This is a structural parser, not JavaScript evaluation: computed values,
/// arbitrary functions and mutating aggregation stages are rejected.
pub(super) fn parse_read_command(input: &str) -> Result<Value, String> {
    let source = trim_outer_comments(input).trim_end_matches(';').trim();
    let (collection, prefix_end) = parse_collection_prefix(source)?;

    if let Some((args, tail)) = method_call(source, prefix_end, "find") {
        if args.len() > 2 {
            return Err("MongoDB find() accepts at most filter and projection arguments.".into());
        }
        let filter = object_argument(args.first(), "find filter")?;
        let projection = optional_object_argument(args.get(1), "find projection")?;
        let mut sort = None;
        let mut skip = 0_i64;
        let mut limit = DEFAULT_FIND_LIMIT;
        for (name, call_args) in chained_calls(&tail)? {
            match name.as_str() {
                "sort" => sort = Some(required_object_argument(&call_args, "sort")?),
                "skip" => skip = bounded_integer(&call_args, "skip", 0, i64::MAX)?,
                "limit" => limit = bounded_integer(&call_args, "limit", 1, MAX_FIND_LIMIT)?,
                _ => return Err(format!("Unsupported MongoDB find() chain: {name}()")),
            }
        }
        let mut command = Map::from_iter([
            ("collection".to_string(), Value::String(collection)),
            ("find".to_string(), Value::Object(filter)),
            ("skip".to_string(), json!(skip)),
            ("limit".to_string(), json!(limit)),
        ]);
        if let Some(projection) = projection {
            command.insert("projection".to_string(), Value::Object(projection));
        }
        if let Some(sort) = sort {
            command.insert("sort".to_string(), Value::Object(sort));
        }
        return Ok(Value::Object(command));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "findOne") {
        if !tail.is_empty() || args.len() > 2 {
            return Err(
                "MongoDB findOne() accepts at most filter and projection arguments.".into(),
            );
        }
        let filter = object_argument(args.first(), "findOne filter")?;
        let projection = optional_object_argument(args.get(1), "findOne projection")?;
        let mut command = Map::from_iter([
            ("collection".to_string(), Value::String(collection)),
            ("find".to_string(), Value::Object(filter)),
            ("limit".to_string(), json!(1)),
        ]);
        if let Some(projection) = projection {
            command.insert("projection".to_string(), Value::Object(projection));
        }
        return Ok(Value::Object(command));
    }

    for method in ["countDocuments", "count"] {
        if let Some((args, tail)) = method_call(source, prefix_end, method) {
            if !tail.is_empty() || args.len() > 1 {
                return Err(format!("MongoDB {method}() accepts at most one filter."));
            }
            return Ok(json!({
                "collection": collection,
                "countDocuments": Value::Object(object_argument(args.first(), "count filter")?),
            }));
        }
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "aggregate") {
        if !tail.is_empty() || args.len() != 1 {
            return Err("MongoDB aggregate() requires exactly one pipeline array.".into());
        }
        let pipeline = normalized_value(&args[0])?;
        let Value::Array(pipeline) = pipeline else {
            return Err("MongoDB aggregate() requires a pipeline array.".into());
        };
        if pipeline.iter().any(|stage| {
            stage.as_object().is_some_and(|stage| {
                stage
                    .keys()
                    .any(|key| matches!(key.as_str(), "$out" | "$merge"))
            })
        }) {
            return Err(
                "MongoDB read-only shell aggregation cannot contain $out or $merge.".into(),
            );
        }
        return Ok(json!({ "collection": collection, "aggregate": pipeline }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "distinct") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err("MongoDB distinct() requires a field and optional filter.".into());
        }
        let field = string_argument(&args[0])?;
        let query = object_argument(args.get(1), "distinct filter")?;
        return Ok(json!({
            "command": { "distinct": collection, "key": field, "query": query }
        }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "getIndexes") {
        if !tail.is_empty() || !args.is_empty() {
            return Err("MongoDB getIndexes() does not accept arguments.".into());
        }
        return Ok(json!({ "command": { "listIndexes": collection } }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "stats") {
        if !tail.is_empty() || args.len() > 1 {
            return Err("MongoDB stats() accepts at most one positive scale.".into());
        }
        let mut command = json!({ "collStats": collection });
        if let Some(scale) = args.first().filter(|value| !value.trim().is_empty()) {
            let scale = scale
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite() && *value > 0.0)
                .ok_or_else(|| "MongoDB stats() scale must be positive.".to_string())?;
            command
                .as_object_mut()
                .expect("collStats command is an object")
                .insert("scale".to_string(), json!(scale));
        }
        return Ok(json!({ "command": command }));
    }

    Err(
        "Unsupported MongoDB shell command. Use a supported read method or native JSON command."
            .into(),
    )
}

fn parse_collection_prefix(source: &str) -> Result<(String, usize), String> {
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

fn method_call(source: &str, prefix_end: usize, method: &str) -> Option<(Vec<String>, String)> {
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

fn chained_calls(chain: &str) -> Result<Vec<(String, Vec<String>)>, String> {
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

fn object_argument(value: Option<&String>, label: &str) -> Result<Map<String, Value>, String> {
    let value = value.map(String::as_str).unwrap_or("{}");
    normalized_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("MongoDB {label} must be a document."))
}

fn optional_object_argument(
    value: Option<&String>,
    label: &str,
) -> Result<Option<Map<String, Value>>, String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| object_argument(Some(value), label))
        .transpose()
}

fn required_object_argument(args: &[String], label: &str) -> Result<Map<String, Value>, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one document."));
    }
    object_argument(args.first(), label)
}

fn bounded_integer(
    args: &[String],
    label: &str,
    minimum: i64,
    maximum: i64,
) -> Result<i64, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one integer."));
    }
    let value = args[0]
        .trim()
        .parse::<i64>()
        .map_err(|_| format!("MongoDB {label}() requires an integer."))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "MongoDB {label}() must be between {minimum} and {maximum}."
        ));
    }
    Ok(value)
}

fn string_argument(value: &str) -> Result<String, String> {
    normalized_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "MongoDB argument must be a string.".into())
}

fn normalized_value(input: &str) -> Result<Value, String> {
    let transformed = transform_shell_constructors(input.trim())?;
    json5::from_str(&transformed).map_err(|error| format!("Invalid MongoDB argument: {error}"))
}

fn transform_shell_constructors(input: &str) -> Result<String, String> {
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    let mut quote = None;
    let mut escaped = false;
    while index < input.len() {
        let rest = &input[index..];
        let character = rest.chars().next().ok_or("Invalid MongoDB argument.")?;
        if let Some(delimiter) = quote {
            output.push(character);
            index += character.len_utf8();
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            output.push(character);
            index += character.len_utf8();
            continue;
        }
        let constructor = if rest.starts_with("ObjectId(") {
            Some(("ObjectId(", "$oid"))
        } else if rest.starts_with("ISODate(") {
            Some(("ISODate(", "$date"))
        } else {
            None
        };
        let Some((constructor, key)) = constructor else {
            output.push(character);
            index += character.len_utf8();
            continue;
        };
        let open = index + constructor.len() - 1;
        let close = matching_paren(input, open).ok_or("Unclosed MongoDB value constructor.")?;
        let value: Value = json5::from_str(input[open + 1..close].trim())
            .map_err(|_| format!("MongoDB {constructor} requires one string."))?;
        let value = value
            .as_str()
            .ok_or_else(|| format!("MongoDB {constructor} requires one string."))?;
        output.push_str(&format!("{{\"{key}\":{}}}", json!(value)));
        index = close + 1;
    }
    Ok(output)
}

fn matching_paren(source: &str, open: usize) -> Option<usize> {
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

fn split_top_level(source: &str) -> Vec<String> {
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

fn split_shell_statements(source: &str) -> Result<Vec<&str>, String> {
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

fn trim_outer_comments(mut source: &str) -> &str {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_read_shell_find_chain_and_extended_json() {
        let value = parse_read_command(
            "db.products.find({_id: ObjectId('507f1f77bcf86cd799439011')}, {name: 1}).sort({name: 1}).skip(2).limit(5)",
        )
        .unwrap();
        assert_eq!(value["collection"], "products");
        assert_eq!(value["find"]["_id"]["$oid"], "507f1f77bcf86cd799439011");
        assert_eq!(value["projection"]["name"], 1);
        assert_eq!(value["sort"]["name"], 1);
        assert_eq!(value["skip"], 2);
        assert_eq!(value["limit"], 5);

        let literal = parse_read_command(
            r#"db.products.find({note: "ObjectId('not-a-constructor')"}) // read only"#,
        )
        .unwrap();
        assert_eq!(literal["find"]["note"], "ObjectId('not-a-constructor')");
    }

    #[test]
    fn parses_dotted_collection_and_read_helpers() {
        let value = parse_read_command(
            "db.getCollection('audit.logs').distinct('tenant.id', {active: true})",
        )
        .unwrap();
        assert_eq!(value["command"]["distinct"], "audit.logs");
        assert_eq!(value["command"]["key"], "tenant.id");
        assert_eq!(value["command"]["query"]["active"], true);

        let indexes = parse_read_command("db.users.getIndexes()").unwrap();
        assert_eq!(indexes["command"]["listIndexes"], "users");
    }

    #[test]
    fn keeps_shell_reads_bounded_and_rejects_mutating_aggregation() {
        let find = parse_read_command("db.users.find({active: true})").unwrap();
        assert_eq!(find["limit"], DEFAULT_FIND_LIMIT);
        assert!(parse_read_command("db.users.find({}).limit(0)").is_err());
        assert!(parse_read_command("db.users.find({}).limit(10001)").is_err());
        assert!(parse_read_command("db.users.aggregate([{$out: 'backup'}])").is_err());
        assert!(parse_read_command("db.users.deleteMany({})").is_err());
    }

    #[test]
    fn splits_multiple_shell_reads_without_splitting_literals() {
        let commands = parse_read_commands(
            "db.users.find({note: 'a;b'}).limit(5); db.orders.count({active: true});",
        )
        .unwrap();
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0]["find"]["note"], "a;b");
        assert_eq!(commands[1]["collection"], "orders");
    }
}
