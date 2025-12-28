use serde::{Deserialize, Serialize};
use tree_sitter::Parser;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionType {
    Table,
    Column,
    Keyword,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionContext {
    pub suggestion_type: SuggestionType,
    pub relevant_table: Option<String>,
    #[serde(default)]
    pub candidates: Vec<String>,
    #[serde(default)]
    pub match_string: Option<String>,
}

const KEYWORDS: &[&str] = &[
    "SELECT",
    "FROM",
    "WHERE",
    "INSERT",
    "INTO",
    "VALUES",
    "UPDATE",
    "SET",
    "DELETE",
    "JOIN",
    "INNER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "ON",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "AND",
    "OR",
    "NOT",
    "NULL",
    "IS",
    "CREATE",
    "TABLE",
    "DROP",
    "ALTER",
    "VIEW",
    "INDEX",
    "PRIMARY KEY",
    "FOREIGN KEY",
    "REFERENCES",
    "CONSTRAINT",
    "DEFAULT",
    "CHECK",
    "UNIQUE",
    "AS",
    "DISTINCT",
    "ALL",
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "EXISTS",
    "BETWEEN",
    "LIKE",
    "IN",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
];

pub struct SqlParser {
    parser: Parser,
}

impl SqlParser {
    pub fn new() -> Self {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_sql::language())
            .expect("Error loading SQL grammar");
        Self { parser }
    }
}

// Revised implementation with source code access
impl SqlParser {
    pub fn parse_and_get_context(&mut self, sql: &str, cursor_idx: usize) -> CompletionContext {
        let tree = self.parser.parse(sql, None).unwrap();
        let root_node = tree.root_node();

        let search_pos = if cursor_idx > 0 { cursor_idx - 1 } else { 0 };
        let node = root_node
            .descendant_for_byte_range(search_pos, cursor_idx)
            .unwrap_or(root_node);

        let chars: Vec<char> = sql.chars().collect();
        let prefix = self.get_prefix(&chars, cursor_idx);

        let mut candidates = vec![];

        // If we are in a keyword context (or generic), filter specific keywords
        if !prefix.is_empty() {
            candidates = KEYWORDS
                .iter()
                .filter(|k| k.starts_with(&prefix.to_uppercase()))
                .map(|s| s.to_string())
                .collect();
        } else {
            // If no prefix, maybe don't suggest all keywords? Or do?
            // Usually completion on empty space suggests keywords appropriate for context.
            // But for now, let's just return all if empty - user complained about unrelated when typing 's'.
            candidates = KEYWORDS.iter().map(|s| s.to_string()).collect();
        }

        // Basic heuristics
        // 1. Check if we are in a place expecting a table
        if self.is_table_context(node, sql) {
            return CompletionContext {
                suggestion_type: SuggestionType::Table,
                relevant_table: None,
                candidates: vec![],
                match_string: Some(prefix),
            };
        }

        // 2. Check if we are in a place expecting a column
        if self.is_column_context(node, sql) {
            let table = self.extract_table_from_scope(node, sql);
            return CompletionContext {
                suggestion_type: SuggestionType::Column,
                relevant_table: table,
                candidates: vec![],
                match_string: Some(prefix),
            };
        }

        CompletionContext {
            suggestion_type: SuggestionType::Keyword,
            relevant_table: None,
            candidates,
            match_string: Some(prefix),
        }
    }

    fn get_prefix(&self, chars: &[char], cursor_idx: usize) -> String {
        if cursor_idx == 0 {
            return String::new();
        }
        let mut end = cursor_idx;
        if end > chars.len() {
            end = chars.len();
        }

        let mut start = end;
        while start > 0 {
            let c = chars[start - 1];
            if c.is_alphanumeric() || c == '_' {
                start -= 1;
            } else {
                break;
            }
        }

        if start < end {
            return chars[start..end].iter().collect();
        }
        String::new()
    }

    fn is_table_context(&self, node: tree_sitter::Node, _sql: &str) -> bool {
        let kind = node.kind();
        let parent = node.parent();
        let parent_kind = parent.map(|p| p.kind()).unwrap_or("");

        // FROM clause
        if parent_kind == "from_clause" || kind == "from_clause" {
            return true;
        }
        // JOIN clause
        if parent_kind.contains("join") || kind.contains("join") {
            return true;
        }
        // UPDATE clause
        if parent_kind == "update_statement" && kind == "identifier" {
            // This is simplistic, it depends on child index
            return true;
        }
        false
    }

    fn is_column_context(&self, node: tree_sitter::Node, _sql: &str) -> bool {
        let kind = node.kind();
        let parent = node.parent();
        let parent_kind = parent.map(|p| p.kind()).unwrap_or("");

        if parent_kind == "select_list" || kind == "select_list" {
            return true;
        }
        if parent_kind == "where_clause" || kind == "where_clause" {
            return true;
        }
        if parent_kind == "order_by_clause" {
            return true;
        }
        if parent_kind == "group_by_clause" {
            return true;
        }
        false
    }

    fn extract_table_from_scope(&self, node: tree_sitter::Node, sql: &str) -> Option<String> {
        let mut curr = Some(node);
        while let Some(n) = curr {
            if n.kind() == "select_statement" {
                // Find FROM clause
                let mut cursor = n.walk();
                for child in n.children(&mut cursor) {
                    if child.kind() == "from_clause" {
                        // (from_clause (table_reference (identifier)))
                        // Getting text is easy since we have `sql`
                        // We need to drill down to the identifier
                        // Often "FROM users" -> "users"
                        // child is "FROM users" range usually? No, node in AST corresponds to grammar rule.
                        // from_clause usually has children: keyword FROM, and table_expression.

                        // Let's try to get the table_reference
                        let mut inner_cursor = child.walk();
                        for grand_child in child.children(&mut inner_cursor) {
                            if grand_child.kind() == "table_expression"
                                || grand_child.kind() == "table_reference"
                                || grand_child.kind() == "identifier"
                            {
                                if let Ok(text) = grand_child.utf8_text(sql.as_bytes()) {
                                    // It might be "FROM users", we want "users"
                                    // Actually `tree-sitter-sql` structure for `from_clause`:
                                    // (from_clause (table_reference ...))
                                    // If we just grab the text of the first table ref, it's a good start.
                                    return Some(text.to_string());
                                }
                            }
                        }

                        // Fallback: just get the whole from clause text and strip FROM?
                        // Too hacky.
                        // Too hacky.
                        // Let's iterate kids again and skip keywords
                        let mut inner_cursor2 = child.walk();
                        for sub in child.children(&mut inner_cursor2) {
                            if !sub.is_named() {
                                continue;
                            } // skip keywords like FROM
                            if let Ok(text) = sub.utf8_text(sql.as_bytes()) {
                                return Some(text.to_string());
                            }
                        }
                    }
                }
            }
            curr = n.parent();
        }
        None
    }
}
