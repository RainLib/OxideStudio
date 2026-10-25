use anyhow::{ensure, Context, Result};
use sqlx::{Executor, MySqlConnection, Row};

fn identifier(input: &str) -> Option<(String, &str)> {
    let input = input.trim_start();
    if let Some(rest) = input.strip_prefix('*') {
        return Some(("*".into(), rest));
    }
    let mut chars = input.char_indices();
    if chars.next()?.1 != '`' {
        return None;
    }
    let mut value = String::new();
    while let Some((offset, ch)) = chars.next() {
        if ch == '`' {
            if chars.clone().next().is_some_and(|(_, ch)| ch == '`') {
                chars.next();
                value.push('`');
            } else {
                return Some((value, &input[offset + 1..]));
            }
        } else {
            value.push(ch);
        }
    }
    None
}
fn role_list(input: &str) -> Option<String> {
    if input == "NONE" {
        return Some(String::new());
    }
    let mut rest = input;
    let mut roles = Vec::new();
    while !rest.trim().is_empty() {
        let (role, next) = identifier(rest)?;
        let next = next.trim_start().strip_prefix('@')?;
        let (host, next) = identifier(next)?;
        roles.push(format!("{}@{}", super::quote(&role), super::quote(&host)));
        if roles.len() > 128 {
            return None;
        }
        rest = next.trim();
        if rest.is_empty() {
            break;
        }
        rest = rest.strip_prefix(',')?;
    }
    (!roles.is_empty()).then(|| roles.join(","))
}
fn on_keyword(input: &str) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut quoted = false;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            if quoted && bytes.get(index + 1) == Some(&b'`') {
                index += 2;
                continue;
            }
            quoted = !quoted;
        }
        if !quoted && bytes.get(index..index + 4) == Some(b" ON ") {
            return Some(index);
        }
        index += 1;
    }
    None
}
fn pattern_matches(pattern: &str, value: &str, fold: bool) -> bool {
    let pattern = if fold {
        pattern.to_lowercase()
    } else {
        pattern.into()
    };
    let value = if fold {
        value.to_lowercase()
    } else {
        value.into()
    };
    let value: Vec<char> = value.chars().collect();
    let mut states = vec![false; value.len() + 1];
    states[0] = true;
    let mut chars = pattern.chars();
    while let Some(ch) = chars.next() {
        let escaped = ch == '\\';
        let ch = if escaped {
            chars.next().unwrap_or('\\')
        } else {
            ch
        };
        let mut next = vec![false; states.len()];
        if ch == '%' && !escaped {
            next[0] = states[0];
            for i in 1..next.len() {
                next[i] = states[i] || next[i - 1];
            }
        } else {
            for i in 1..next.len() {
                next[i] = states[i - 1] && ((ch == '_' && !escaped) || ch == value[i - 1]);
            }
        }
        states = next;
    }
    states[value.len()]
}
fn permits_trigger(grant: &str, schema: &str, table: &str, fold: bool) -> bool {
    let Some(offset) = on_keyword(grant) else {
        return false;
    };
    let Some(privileges) = grant[..offset].strip_prefix("GRANT ") else {
        return false;
    };
    if !privileges
        .split(',')
        .any(|part| matches!(part.trim(), "ALL PRIVILEGES" | "TRIGGER"))
    {
        return false;
    }
    let scope = &grant[offset + 4..];
    let database_wildcard = scope.trim_start().starts_with('*');
    let Some((db, rest)) = identifier(scope) else {
        return false;
    };
    let Some(rest) = rest.trim_start().strip_prefix('.') else {
        return false;
    };
    let table_wildcard = rest.trim_start().starts_with('*');
    let Some((name, _)) = identifier(rest) else {
        return false;
    };
    (database_wildcard
        || if table_wildcard {
            pattern_matches(&db, schema, fold)
        } else if fold {
            db.to_lowercase() == schema.to_lowercase()
        } else {
            db == schema
        })
        && (table_wildcard
            || if fold {
                name.to_lowercase() == table.to_lowercase()
            } else {
                name == table
            })
}
pub(super) async fn require_trigger_visibility(
    c: &mut MySqlConnection,
    schema: &str,
    table: &str,
    fold: bool,
) -> Result<()> {
    let partial: i64 = sqlx::query_scalar("SELECT CAST(@@partial_revokes AS SIGNED)")
        .fetch_one(&mut *c)
        .await?;
    ensure!(
        partial == 0,
        "MySQL full transfers do not support servers with partial_revokes enabled"
    );
    let roles: String = sqlx::query_scalar("SELECT CURRENT_ROLE()")
        .fetch_one(&mut *c)
        .await?;
    ensure!(
        roles.len() <= 16 * 1024,
        "MySQL active-role metadata exceeds its budget"
    );
    let roles = role_list(&roles).context("MySQL active-role metadata is invalid")?;
    let command = if roles.is_empty() {
        "SHOW GRANTS FOR CURRENT_USER".into()
    } else {
        format!("SHOW GRANTS FOR CURRENT_USER USING {roles}")
    };
    let grants = c.fetch_all(command.as_str()).await?;
    ensure!(
        grants.len() <= 1024,
        "MySQL privilege metadata exceeds its budget"
    );
    let mut total = 0;
    let mut allowed = false;
    for row in grants {
        let grant: String = row.try_get(0)?;
        total += grant.len();
        ensure!(
            total <= 512 * 1024,
            "MySQL privilege metadata exceeds its budget"
        );
        allowed |= permits_trigger(&grant, schema, table, fold);
    }
    ensure!(
        allowed,
        "MySQL transfer requires TRIGGER visibility to authenticate all target triggers"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_privilege_scope_and_roles_are_not_inferred_from_names() {
        assert!(!permits_trigger(
            "GRANT TRIGGER ON `*`.`t` TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(!permits_trigger(
            "GRANT TRIGGER ON `db`.`*` TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(!permits_trigger(
            "GRANT TRIGGER ON `db_name`.`t` TO `x`@`%`",
            "dbxname",
            "t",
            false
        ));
        assert!(permits_trigger(
            "GRANT ALL PRIVILEGES ON *.* TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(permits_trigger(
            "GRANT SELECT, TRIGGER ON `db`.* TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(!permits_trigger(
            "GRANT SELECT (`TRIGGER`) ON `db`.* TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(!permits_trigger(
            "GRANT TRIGGER ON `other`.`t` TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(!permits_trigger(
            "GRANT TRIGGER ON `db`.`other` TO `x`@`%`",
            "db",
            "t",
            false
        ));
        assert!(pattern_matches(r"db\_%", "db_name", false));
        assert!(!pattern_matches(r"db\_%", "dbxname", false));
        assert_eq!(
            role_list("`a``b`@`%`,`reader`@`localhost`").as_deref(),
            Some("`a``b`@`%`,`reader`@`localhost`")
        );
        assert!(role_list("reader; DROP TABLE x").is_none());
    }
}
