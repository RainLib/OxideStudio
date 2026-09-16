#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryExecutionMode {
    ReturnsRows,
    AffectsRows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementScanDialect {
    Mysql,
    Postgres,
    /// T-SQL uses `[identifier]` quoting, including `]]` escapes. Keeping it
    /// separate from the generic/PostgreSQL scanner prevents a semicolon in a
    /// legal SQL Server identifier from changing the current-statement scope.
    SqlServer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqlStatementSpan<'a> {
    pub text: &'a str,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    Select,
    Insert,
    Update,
    Delete,
    Create,
    Alter,
    Drop,
    Truncate,
    Comment,
    Rename,
    Refresh,
    Set,
    Use,
    Show,
    Explain,
    Analyze,
    Vacuum,
    Describe,
    Values,
    With,
    Begin,
    Start,
    Commit,
    Rollback,
    Savepoint,
    Release,
    Other,
}

impl StatementKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Select => "SELECT",
            Self::Insert => "INSERT",
            Self::Update => "UPDATE",
            Self::Delete => "DELETE",
            Self::Create => "CREATE",
            Self::Alter => "ALTER",
            Self::Drop => "DROP",
            Self::Truncate => "TRUNCATE",
            Self::Comment => "COMMENT",
            Self::Rename => "RENAME",
            Self::Refresh => "REFRESH",
            Self::Set => "SET",
            Self::Use => "USE",
            Self::Show => "SHOW",
            Self::Explain => "EXPLAIN",
            Self::Analyze => "ANALYZE",
            Self::Vacuum => "VACUUM",
            Self::Describe => "DESCRIBE",
            Self::Values => "VALUES",
            Self::With => "WITH",
            Self::Begin => "BEGIN",
            Self::Start => "START",
            Self::Commit => "COMMIT",
            Self::Rollback => "ROLLBACK",
            Self::Savepoint => "SAVEPOINT",
            Self::Release => "RELEASE",
            Self::Other => "SQL",
        }
    }
}
