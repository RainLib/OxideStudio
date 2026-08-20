//! Canonical parsing for the narrow managed Redis read-only surface.
//!
//! The desktop derives an access-ticket resource path before sending a native
//! Redis request, and the Gateway validates the same request again before
//! execution. Keeping the tokenizer here prevents quoted keys from resolving
//! to different authorization targets on the two sides of that boundary.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RedisCommandParseError {
    #[error("managed Redis accepts exactly one command")]
    MultipleCommands,
    #[error("Redis command has an unterminated quoted argument")]
    UnterminatedQuote,
}

/// Tokenizes one Redis command without interpreting command semantics.
///
/// Both single and double quotes are supported, as are the conventional
/// `\\n`, `\\r`, and `\\t` escapes. Command validation (allowlist, key count,
/// and authorization) stays with the Gateway.
pub fn tokenize_native_redis_command(payload: &str) -> Result<Vec<String>, RedisCommandParseError> {
    if payload.contains(['\n', '\r', ';']) {
        return Err(RedisCommandParseError::MultipleCommands);
    }

    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in payload.trim().chars() {
        if escaped {
            current.push(match character {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if let Some(end) = quote {
            if character == end {
                quote = None;
            } else {
                current.push(character);
            }
        } else if matches!(character, '\'' | '"') {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }

    if quote.is_some() {
        return Err(RedisCommandParseError::UnterminatedQuote);
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_quoted_key_and_escaped_argument_boundaries() {
        assert_eq!(
            tokenize_native_redis_command(r#"HGET "user profile:42" display\ name"#).unwrap(),
            ["HGET", "user profile:42", "display name"]
        );
    }

    #[test]
    fn rejects_multiple_or_unterminated_commands() {
        assert!(matches!(
            tokenize_native_redis_command("GET user:42; DEL user:42"),
            Err(RedisCommandParseError::MultipleCommands)
        ));
        assert!(matches!(
            tokenize_native_redis_command("GET 'user:42"),
            Err(RedisCommandParseError::UnterminatedQuote)
        ));
    }
}
