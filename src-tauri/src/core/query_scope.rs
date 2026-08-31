use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::LazyLock,
};

use regex::Regex;

use super::statement::StatementScanDialect;

const IDENTIFIER_PATTERN: &str = r"[A-Za-z0-9_@$#-]*[A-Za-z_@$#][A-Za-z0-9_@$#-]*";
const TARGET_NAME_PATTERN: &str = r"[A-Za-z0-9_@$#-]*[A-Za-z_@$#][A-Za-z0-9_@$#-]*(?:\s*\.\s*(?:\*|[A-Za-z0-9_@$#-]*[A-Za-z_@$#][A-Za-z0-9_@$#-]*)){0,3}";

static RELATION_TARGET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"(?is)\b(?:FROM|JOIN)\s+({TARGET_NAME_PATTERN})"))
        .expect("valid relation target regex")
});
static APPLY_TARGET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?is)\b(?:CROSS|OUTER)\s+APPLY\s+({TARGET_NAME_PATTERN})"
    ))
    .expect("valid APPLY target regex")
});
static APPLY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\b(?:CROSS|OUTER)\s+APPLY\b").expect("valid APPLY regex"));
static FROM_CLAUSE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?is)\bFROM\s+(.+?)(?:\b(?:WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|FETCH|FOR|UNION|EXCEPT|INTERSECT|JOIN)\b|$)",
    )
    .expect("valid FROM clause regex")
});
static LEADING_TARGET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?is)^\s*({TARGET_NAME_PATTERN})(?:\s+(?:AS\s+)?{IDENTIFIER_PATTERN})?\s*$"
    ))
    .expect("valid leading relation target regex")
});

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DatabaseReferenceAssessment {
    pub databases: BTreeSet<String>,
    pub uncertain: bool,
}

#[derive(Default)]
struct SqlScopeText {
    text: String,
    quoted_identifiers: HashMap<String, String>,
}

/// Inspect database-qualified relation references in read-only SQL.
///
/// This deliberately remains a scope scanner rather than a SQL validator.
/// Callers must first apply the normal read-only statement gate. Every
/// relation found through FROM, JOIN, comma-separated FROM factors, and SQL
/// Server APPLY contributes a normalized database. Unsupported relation
/// shapes are marked uncertain so a restricted caller can fail closed.
pub fn assess_sql_database_references(
    sql: &str,
    dialect: StatementScanDialect,
    active_database: &str,
) -> DatabaseReferenceAssessment {
    let cleaned = sql_scope_text(sql);
    let current_database = normalize_database_name(active_database);
    let mut assessment = DatabaseReferenceAssessment::default();

    for statement in cleaned
        .text
        .split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
    {
        collect_pattern_databases(
            statement,
            dialect,
            &cleaned.quoted_identifiers,
            &current_database,
            &mut assessment,
            &RELATION_TARGET_RE,
        );
        collect_pattern_databases(
            statement,
            dialect,
            &cleaned.quoted_identifiers,
            &current_database,
            &mut assessment,
            &APPLY_TARGET_RE,
        );
        assessment.uncertain |= collect_comma_separated_from_databases(
            statement,
            dialect,
            &cleaned.quoted_identifiers,
            &current_database,
            &mut assessment.databases,
        );
        assessment.uncertain |= APPLY_RE.find_iter(statement).count()
            != APPLY_TARGET_RE.captures_iter(statement).count();
    }

    assessment
}

/// Return true when SQL escapes a database allowlist or cannot be classified
/// with confidence. Database names are compared case-insensitively after
/// removing ordinary SQL identifier quotes.
pub fn sql_references_disallowed_database(
    sql: &str,
    dialect: StatementScanDialect,
    active_database: &str,
    allowed_databases: &[String],
) -> bool {
    let allowed = allowed_databases
        .iter()
        .map(|database| normalize_database_name(database))
        .filter(|database| !database.is_empty())
        .collect::<HashSet<_>>();
    let assessment = assess_sql_database_references(sql, dialect, active_database);
    assessment.uncertain
        || assessment
            .databases
            .iter()
            .any(|database| !allowed.contains(database))
}

fn collect_pattern_databases(
    statement: &str,
    dialect: StatementScanDialect,
    quoted_identifiers: &HashMap<String, String>,
    current_database: &str,
    assessment: &mut DatabaseReferenceAssessment,
    pattern: &Regex,
) {
    for capture in pattern.captures_iter(statement) {
        let Some(target) = capture.get(1) else {
            assessment.uncertain = true;
            continue;
        };
        match database_from_qualified_name(
            target.as_str(),
            dialect,
            quoted_identifiers,
            current_database,
        ) {
            Some(database) => {
                assessment.databases.insert(database);
            }
            None => assessment.uncertain = true,
        }
    }
}

fn collect_comma_separated_from_databases(
    statement: &str,
    dialect: StatementScanDialect,
    quoted_identifiers: &HashMap<String, String>,
    current_database: &str,
    databases: &mut BTreeSet<String>,
) -> bool {
    let mut uncertain = false;
    for capture in FROM_CLAUSE_RE.captures_iter(statement) {
        let Some(from_body) = capture.get(1).map(|value| value.as_str()) else {
            uncertain = true;
            continue;
        };
        let factors = split_top_level_comma_separated_targets(from_body);
        if factors.len() < 2 {
            continue;
        }
        for factor in factors {
            let database = LEADING_TARGET_RE
                .captures(factor)
                .and_then(|target| target.get(1))
                .and_then(|target| {
                    database_from_qualified_name(
                        target.as_str(),
                        dialect,
                        quoted_identifiers,
                        current_database,
                    )
                });
            match database {
                Some(database) => {
                    databases.insert(database);
                }
                None => uncertain = true,
            }
        }
    }
    uncertain
}

fn split_top_level_comma_separated_targets(value: &str) -> Vec<&str> {
    let mut targets = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (index, character) in value.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                targets.push(value[start..index].trim());
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    targets.push(value[start..].trim());
    targets
}

fn database_from_qualified_name(
    qualified_name: &str,
    dialect: StatementScanDialect,
    quoted_identifiers: &HashMap<String, String>,
    current_database: &str,
) -> Option<String> {
    let parts = qualified_name
        .split('.')
        .map(|part| normalize_target_database_name(part, quoted_identifiers))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return (!current_database.is_empty()).then(|| current_database.to_string());
    }
    match dialect {
        StatementScanDialect::Mysql => parts.first().cloned(),
        StatementScanDialect::SqlServer if parts.len() >= 4 => parts.get(1).cloned(),
        StatementScanDialect::SqlServer if parts.len() >= 3 => parts.first().cloned(),
        StatementScanDialect::SqlServer | StatementScanDialect::Postgres => {
            (!current_database.is_empty()).then(|| current_database.to_string())
        }
    }
}

fn normalize_target_database_name(
    value: &str,
    quoted_identifiers: &HashMap<String, String>,
) -> String {
    let normalized = normalize_database_name(value);
    quoted_identifiers
        .get(&normalized)
        .map(|quoted| normalize_database_name(quoted))
        .unwrap_or(normalized)
}

fn normalize_database_name(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character| matches!(character, '`' | '"' | '[' | ']'))
        .to_ascii_lowercase()
}

fn sql_scope_text(sql: &str) -> SqlScopeText {
    let characters = sql.chars().collect::<Vec<_>>();
    let mut result = SqlScopeText {
        text: String::with_capacity(sql.len()),
        quoted_identifiers: HashMap::new(),
    };
    append_sql_scope_text(&characters, &mut result);
    result
}

fn append_sql_scope_text(characters: &[char], result: &mut SqlScopeText) {
    let mut index = 0usize;
    while index < characters.len() {
        let character = characters[index];
        let next = characters.get(index + 1).copied();
        if character == '-' && next == Some('-') {
            index += 2;
            while index < characters.len() && characters[index] != '\n' && characters[index] != '\r'
            {
                index += 1;
            }
            result.text.push(' ');
            continue;
        }
        if character == '#' {
            index += 1;
            while index < characters.len() && characters[index] != '\n' && characters[index] != '\r'
            {
                index += 1;
            }
            result.text.push(' ');
            continue;
        }
        if character == '/' && next == Some('*') {
            if let Some((body, close_index)) = mysql_executable_comment_body(characters, index) {
                result.text.push(' ');
                append_sql_scope_text(&body.chars().collect::<Vec<_>>(), result);
                result.text.push(' ');
                index = close_index;
            } else {
                index += 2;
                while index + 1 < characters.len()
                    && !(characters[index] == '*' && characters[index + 1] == '/')
                {
                    index += 1;
                }
                index = (index + 2).min(characters.len());
                result.text.push(' ');
            }
            continue;
        }
        if let Some((tag, tag_len)) = dollar_quote_tag_at(characters, index) {
            index += tag_len;
            while index + tag_len <= characters.len()
                && characters[index..index + tag_len]
                    .iter()
                    .collect::<String>()
                    != tag
            {
                index += 1;
            }
            index = (index + tag_len).min(characters.len());
            result.text.push(' ');
            continue;
        }
        if character == '\'' {
            index = skip_string_literal(characters, index, '\'');
            result.text.push(' ');
            continue;
        }
        if matches!(character, '"' | '`' | '[') {
            let close = if character == '[' { ']' } else { character };
            index = append_quoted_identifier_token(characters, index, close, result);
            continue;
        }
        result.text.push(character);
        index += 1;
    }
}

fn mysql_executable_comment_body(characters: &[char], start: usize) -> Option<(String, usize)> {
    let mut index = start + 2;
    match characters.get(index).copied() {
        Some('!') => index += 1,
        Some('M') if characters.get(index + 1) == Some(&'!') => index += 2,
        _ => return None,
    }
    while matches!(characters.get(index), Some(character) if character.is_ascii_digit() || character.is_whitespace())
    {
        index += 1;
    }
    let body_start = index;
    while index + 1 < characters.len() {
        if characters[index] == '*' && characters[index + 1] == '/' {
            return Some((characters[body_start..index].iter().collect(), index + 2));
        }
        index += 1;
    }
    Some((characters[body_start..].iter().collect(), characters.len()))
}

fn dollar_quote_tag_at(characters: &[char], start: usize) -> Option<(String, usize)> {
    if characters.get(start) != Some(&'$') {
        return None;
    }
    let mut index = start + 1;
    if characters.get(index) == Some(&'$') {
        return Some(("$$".to_string(), 2));
    }
    if !matches!(characters.get(index), Some(character) if character.is_ascii_alphabetic() || *character == '_')
    {
        return None;
    }
    index += 1;
    while matches!(characters.get(index), Some(character) if character.is_ascii_alphanumeric() || *character == '_')
    {
        index += 1;
    }
    if characters.get(index) != Some(&'$') {
        return None;
    }
    let tag = characters[start..=index].iter().collect::<String>();
    Some((tag, index - start + 1))
}

fn skip_string_literal(characters: &[char], start: usize, close: char) -> usize {
    let mut index = start + 1;
    while index < characters.len() {
        if characters[index] == '\\' {
            index += 2;
            continue;
        }
        if characters[index] == close {
            if characters.get(index + 1) == Some(&close) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    characters.len()
}

fn append_quoted_identifier_token(
    characters: &[char],
    start: usize,
    close: char,
    result: &mut SqlScopeText,
) -> usize {
    let mut index = start + 1;
    let mut identifier = String::new();
    while index < characters.len() {
        if characters[index] == close {
            if characters.get(index + 1) == Some(&close) {
                identifier.push(close);
                index += 2;
                continue;
            }
            return finish_quoted_identifier(result, identifier, index + 1);
        }
        identifier.push(if characters[index] == ';' {
            ' '
        } else {
            characters[index]
        });
        index += 1;
    }
    finish_quoted_identifier(result, identifier, characters.len())
}

fn finish_quoted_identifier(
    result: &mut SqlScopeText,
    identifier: String,
    next_index: usize,
) -> usize {
    let token = format!("__oxideq{}__", result.quoted_identifiers.len());
    result
        .quoted_identifiers
        .insert(token.to_ascii_lowercase(), identifier);
    result.text.push(' ');
    result.text.push_str(&token);
    result.text.push(' ');
    next_index
}

#[cfg(test)]
mod tests {
    use super::{assess_sql_database_references, sql_references_disallowed_database};
    use crate::core::statement::StatementScanDialect;

    fn allowed() -> Vec<String> {
        vec!["reporting".to_string()]
    }

    #[test]
    fn mysql_scope_covers_join_comma_and_quoted_relations() {
        for sql in [
            "SELECT * FROM reporting.users JOIN reporting.audit_log ON 1 = 1",
            "SELECT * FROM reporting.users AS users, reporting.audit_log AS audit_log",
            "SELECT * FROM `reporting`.`users`",
        ] {
            assert!(!sql_references_disallowed_database(
                sql,
                StatementScanDialect::Mysql,
                "reporting",
                &allowed(),
            ));
        }
        for sql in [
            "SELECT * FROM production.users",
            "SELECT * FROM reporting.users, production.secrets",
            "SELECT * FROM reporting.users JOIN production.audit_log ON 1 = 1",
        ] {
            assert!(sql_references_disallowed_database(
                sql,
                StatementScanDialect::Mysql,
                "reporting",
                &allowed(),
            ));
        }
    }

    #[test]
    fn derived_comma_relations_fail_closed() {
        let assessment = assess_sql_database_references(
            "SELECT * FROM (SELECT * FROM reporting.users) AS users, reporting.audit_log AS audit_log",
            StatementScanDialect::Mysql,
            "reporting",
        );
        assert!(assessment.uncertain);
        assert!(sql_references_disallowed_database(
            "SELECT * FROM (SELECT * FROM reporting.users) AS users, reporting.audit_log AS audit_log",
            StatementScanDialect::Mysql,
            "reporting",
            &allowed(),
        ));
    }

    #[test]
    fn sqlserver_scope_handles_three_four_part_and_apply_targets() {
        assert!(!sql_references_disallowed_database(
            "SELECT * FROM reporting.dbo.users AS users CROSS APPLY reporting.dbo.visible_data(users.id) AS data",
            StatementScanDialect::SqlServer,
            "reporting",
            &allowed(),
        ));
        assert!(sql_references_disallowed_database(
            "SELECT * FROM reporting.dbo.users AS users OUTER APPLY production.dbo.sensitive_data(users.id) AS data",
            StatementScanDialect::SqlServer,
            "reporting",
            &allowed(),
        ));
        assert!(sql_references_disallowed_database(
            "SELECT * FROM linked.production.dbo.users",
            StatementScanDialect::SqlServer,
            "reporting",
            &allowed(),
        ));
        assert!(!sql_references_disallowed_database(
            "SELECT * FROM dbo.users",
            StatementScanDialect::SqlServer,
            "reporting",
            &allowed(),
        ));
        assert!(sql_references_disallowed_database(
            "SELECT * FROM reporting.dbo.users CROSS APPLY (SELECT 1) AS nested",
            StatementScanDialect::SqlServer,
            "reporting",
            &allowed(),
        ));
    }

    #[test]
    fn comments_and_literals_cannot_smuggle_scope_targets() {
        let assessment = assess_sql_database_references(
            "SELECT 'FROM production.secrets' AS note FROM reporting.users -- JOIN production.audit\n",
            StatementScanDialect::Mysql,
            "reporting",
        );
        assert_eq!(assessment.databases, ["reporting".to_string()].into());
        assert!(!assessment.uncertain);
    }

    #[test]
    fn postgres_qualifiers_remain_schema_scoped() {
        assert!(!sql_references_disallowed_database(
            "SELECT * FROM private.users JOIN public.audit ON 1 = 1",
            StatementScanDialect::Postgres,
            "reporting",
            &allowed(),
        ));
    }
}
