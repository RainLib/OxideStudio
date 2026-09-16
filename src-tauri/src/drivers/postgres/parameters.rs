use crate::core::protocol::FunctionParameterInfo;

pub(super) fn split_postgres_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let chars: Vec<char> = arguments.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth -= 1;
            } else if ch == ',' && depth == 0 {
                let part = current.trim();
                if !part.is_empty() {
                    parts.push(part.to_string());
                }
                current.clear();
                index += 1;
                continue;
            }
        }

        current.push(ch);
        index += 1;
    }

    let part = current.trim();
    if !part.is_empty() {
        parts.push(part.to_string());
    }

    parts
}

pub(super) fn strip_default_expression(argument: &str) -> (&str, bool) {
    let upper = argument.to_ascii_uppercase();
    if let Some(index) = upper.find(" DEFAULT ") {
        return (argument[..index].trim(), true);
    }
    if let Some(index) = argument.find(" = ") {
        return (argument[..index].trim(), true);
    }
    (argument.trim(), false)
}

pub(super) fn parse_postgres_function_parameters(arguments: &str) -> Vec<FunctionParameterInfo> {
    split_postgres_arguments(arguments)
        .into_iter()
        .enumerate()
        .filter_map(|(index, argument)| {
            let (argument, optional) = strip_default_expression(&argument);
            let mut tokens = argument.split_whitespace().collect::<Vec<_>>();
            if tokens.is_empty() {
                return None;
            }

            if matches!(
                tokens[0].to_ascii_uppercase().as_str(),
                "IN" | "OUT" | "INOUT" | "VARIADIC"
            ) {
                tokens.remove(0);
            }

            if tokens.is_empty() {
                return None;
            }

            let (name, data_type) = if tokens.len() == 1 {
                (format!("arg{}", index + 1), tokens[0].to_string())
            } else {
                (tokens[0].to_string(), tokens[1..].join(" "))
            };

            Some(FunctionParameterInfo {
                name,
                data_type,
                optional,
            })
        })
        .collect()
}
