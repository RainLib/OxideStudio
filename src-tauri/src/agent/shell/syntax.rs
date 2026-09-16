use super::types::{ParsedCommand, ShellSyntax};

pub(super) fn parse_shell_syntax(command_text: &str) -> ShellSyntax {
    let mut parser = tree_sitter::Parser::new();
    if parser.set_language(&tree_sitter_bash::language()).is_err() {
        return ShellSyntax {
            has_error: true,
            ..ShellSyntax::default()
        };
    }
    let Some(tree) = parser.parse(command_text, None) else {
        return ShellSyntax {
            has_error: true,
            ..ShellSyntax::default()
        };
    };
    let root = tree.root_node();
    let mut syntax = ShellSyntax {
        has_error: root.has_error(),
        ..ShellSyntax::default()
    };
    collect_shell_nodes(root, command_text.as_bytes(), &mut syntax);
    if syntax.commands.is_empty() && !command_text.trim().is_empty() {
        syntax.commands.extend(
            split_shell_statements(command_text)
                .into_iter()
                .map(parsed_command),
        );
    }
    syntax
}

pub(super) fn collect_shell_nodes(
    node: tree_sitter::Node<'_>,
    source: &[u8],
    syntax: &mut ShellSyntax,
) {
    match node.kind() {
        "command_substitution" => syntax.has_command_substitution = true,
        "process_substitution" => syntax.has_process_substitution = true,
        "command" | "redirected_statement" => {
            if let Ok(text) = node.utf8_text(source) {
                syntax.commands.push(parsed_command(text));
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_shell_nodes(child, source, syntax);
    }
}

pub(super) fn parsed_command(text: &str) -> ParsedCommand {
    let (tokens, dynamic) = shell_tokens(text);
    let executable = resolved_executable(&tokens);
    ParsedCommand {
        text: text.trim().to_string(),
        tokens,
        executable,
        dynamic,
    }
}

pub(super) fn split_shell_statements(value: &str) -> Vec<&str> {
    value
        .split([';', '\n', '|'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect()
}

pub(super) fn shell_tokens(value: &str) -> (Vec<String>, bool) {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut dynamic = false;
    for character in value.chars() {
        if escaped {
            token.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                if active_quote != '\'' && matches!(character, '$' | '`') {
                    dynamic = true;
                }
                token.push(character);
            }
            continue;
        }
        match character {
            '\'' | '"' => quote = Some(character),
            '$' | '`' => {
                dynamic = true;
                token.push(character);
            }
            ' ' | '\t' | '\r' | '\n' => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
            }
            ';' | '|' | '&' => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
                break;
            }
            '>' | '<' => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
                tokens.push(character.to_string());
            }
            _ => token.push(character),
        }
    }
    if escaped || quote.is_some() {
        dynamic = true;
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    (tokens, dynamic)
}

pub(super) fn resolved_executable(tokens: &[String]) -> Option<String> {
    let mut index = 0;
    while index < tokens.len() && is_environment_assignment(&tokens[index]) {
        index += 1;
    }
    loop {
        let executable = tokens.get(index)?;
        if executable.contains('$') || executable.contains('`') {
            return None;
        }
        let basename = executable_basename(executable);
        if !matches!(
            basename.as_str(),
            "env" | "command" | "builtin" | "nohup" | "time" | "nice"
        ) {
            return Some(executable.clone());
        }
        index += 1;
        while let Some(token) = tokens.get(index) {
            if token.starts_with('-') || is_environment_assignment(token) {
                index += 1;
            } else {
                break;
            }
        }
    }
}

pub(super) fn is_environment_assignment(token: &str) -> bool {
    let Some((name, _)) = token.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && name.chars().enumerate().all(|(index, character)| {
            character == '_'
                || character.is_ascii_alphanumeric() && (index > 0 || !character.is_ascii_digit())
        })
}

pub(super) fn executable_basename(value: &str) -> String {
    value
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(value)
        .trim_matches('"')
        .to_ascii_lowercase()
}

pub(super) fn command_arguments(command: &ParsedCommand) -> Vec<String> {
    let Some(executable) = command.executable.as_deref() else {
        return Vec::new();
    };
    let position = command
        .tokens
        .iter()
        .position(|token| token == executable)
        .unwrap_or(0);
    command.tokens.iter().skip(position + 1).cloned().collect()
}
