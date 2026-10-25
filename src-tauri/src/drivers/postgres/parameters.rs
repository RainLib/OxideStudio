use crate::core::protocol::FunctionParameterInfo;

// Hide SQL literals/quoted identifiers and comments without shifting byte
// offsets. Catalog argument defaults can contain commas, brackets and dollars.
fn argument_mask(source: &str) -> Vec<u8> {
    let bytes = source.as_bytes();
    let mut result = bytes.to_vec();
    let mut index = 0;
    while index < bytes.len() {
        let start = index;
        if bytes[index..].starts_with(b"--") {
            while index < bytes.len() && !matches!(bytes[index], b'\r' | b'\n') {
                index += 1;
            }
        } else if bytes[index..].starts_with(b"/*") {
            index += 2;
            let mut depth = 1;
            while index < bytes.len() && depth > 0 {
                if bytes[index..].starts_with(b"/*") {
                    depth += 1;
                    index += 2;
                } else if bytes[index..].starts_with(b"*/") {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
        } else if matches!(bytes[index], b'\'' | b'"') {
            let quote = bytes[index];
            let escape = quote == b'\''
                && index > 0
                && matches!(bytes[index - 1], b'E' | b'e')
                && (index == 1
                    || !(bytes[index - 2].is_ascii_alphanumeric()
                        || matches!(bytes[index - 2], b'_' | b'$')
                        || bytes[index - 2] >= 128));
            index += 1;
            while index < bytes.len() {
                if escape && bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                } else if bytes[index] == quote {
                    index += 1;
                    if bytes.get(index) == Some(&quote) {
                        index += 1;
                    } else {
                        break;
                    }
                } else {
                    index += 1;
                }
            }
        } else if bytes[index] == b'$'
            && (index == 0
                || !(bytes[index - 1].is_ascii_alphanumeric()
                    || matches!(bytes[index - 1], b'_' | b'$')
                    || bytes[index - 1] >= 128))
        {
            let mut end = index + 1;
            while bytes
                .get(end)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
            {
                end += 1;
            }
            if bytes.get(end) == Some(&b'$')
                && (end == index + 1 || !bytes[index + 1].is_ascii_digit())
            {
                let tag = &source[index..=end];
                let body = end + 1;
                index = source[body..]
                    .find(tag)
                    .map(|at| body + at + tag.len())
                    .unwrap_or(bytes.len());
            } else {
                index += 1;
                continue;
            }
        } else {
            index += 1;
            continue;
        }
        for byte in &mut result[start..index] {
            if !matches!(*byte, b'\n' | b'\r') {
                *byte = b' ';
            }
        }
    }
    result
}

pub(super) fn split_postgres_arguments(arguments: &str) -> Vec<String> {
    let mask = argument_mask(arguments);
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0u32;
    for (index, byte) in mask.iter().enumerate() {
        match byte {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                let part = arguments[start..index].trim();
                if !part.is_empty() {
                    parts.push(part.into());
                }
                start = index + 1;
            }
            _ => {}
        }
    }
    let part = arguments[start..].trim();
    if !part.is_empty() {
        parts.push(part.into());
    }
    parts
}

pub(super) fn strip_default_expression(argument: &str) -> (&str, bool) {
    let mask = argument_mask(argument);
    let mut depth = 0u32;
    for (index, byte) in mask.iter().enumerate() {
        match byte {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b'=' if depth == 0 => return (argument[..index].trim(), true),
            _ => {}
        }
        if depth == 0
            && mask[index..]
                .get(..7)
                .is_some_and(|word| word.eq_ignore_ascii_case(b"DEFAULT"))
            && (index == 0 || mask[index - 1].is_ascii_whitespace())
            && mask.get(index + 7).is_none_or(u8::is_ascii_whitespace)
        {
            return (argument[..index].trim(), true);
        }
    }
    (argument.trim(), false)
}

fn first_atom(argument: &str) -> (&str, &str) {
    let mut quote = false;
    let mut depth = 0u32;
    let mut chars = argument.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if ch == '"' {
            if quote && chars.peek().is_some_and(|(_, next)| *next == '"') {
                chars.next();
            } else {
                quote = !quote;
            }
        } else if !quote {
            match ch {
                '(' | '[' => depth += 1,
                ')' | ']' => depth = depth.saturating_sub(1),
                _ if ch.is_whitespace() && depth == 0 => {
                    return (&argument[..index], argument[index..].trim_start())
                }
                _ => {}
            }
        }
    }
    (argument, "")
}

fn unnamed_type(first: &str, rest: &str) -> bool {
    if rest.is_empty() {
        return true;
    }
    let lower = first.to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower);
    let rest = rest.to_ascii_lowercase();
    match base {
        "double" => rest == "precision" || rest.starts_with("precision["),
        "character" | "bit" => {
            rest == "varying" || rest.starts_with("varying(") || rest.starts_with("varying[")
        }
        "time" | "timestamp" => {
            rest == "with time zone"
                || rest == "without time zone"
                || rest.starts_with("with time zone[")
                || rest.starts_with("without time zone[")
        }
        "interval" => ["year", "month", "day", "hour", "minute", "second"]
            .iter()
            .any(|unit| {
                rest == *unit
                    || rest.starts_with(&format!("{unit} "))
                    || rest.starts_with(&format!("{unit}("))
            }),
        _ => false,
    }
}

pub(super) fn parse_postgres_function_parameters(arguments: &str) -> Vec<FunctionParameterInfo> {
    split_postgres_arguments(arguments)
        .into_iter()
        .enumerate()
        .filter_map(|(index, argument)| {
            let (argument, optional) = strip_default_expression(&argument);
            let (first, rest) = first_atom(argument);
            let mode = match first.to_ascii_uppercase().as_str() {
                "IN" => Some("IN"),
                "OUT" => Some("OUT"),
                "INOUT" => Some("INOUT"),
                "VARIADIC" => Some("VARIADIC"),
                _ => None,
            };
            let argument = if mode.is_some() { rest } else { argument };
            if argument.is_empty() {
                return None;
            }
            let (first, rest) = first_atom(argument);
            let (name, data_type) = if unnamed_type(first, rest) {
                (format!("arg{}", index + 1), argument.into())
            } else {
                (
                    first
                        .strip_prefix('"')
                        .and_then(|name| name.strip_suffix('"'))
                        .map(|name| name.replace("\"\"", "\""))
                        .unwrap_or_else(|| first.into()),
                    rest.into(),
                )
            };
            Some(FunctionParameterInfo {
                name,
                data_type,
                optional,
                mode: mode.map(str::to_string),
            })
        })
        .collect()
}
