//! SQL statement scanning facade; lexing, soft boundaries, and safety policies stay separate.

mod filters;
mod read_only;
mod scanner;
mod soft_boundaries;
mod types;

pub use filters::validate_sql_filter_expression;
pub use read_only::validate_read_only_sql;
pub use scanner::{
    classify_statement, execution_mode, execution_statement_kind, split_leading_execution_hint,
    split_sql_statement_spans,
};
pub use soft_boundaries::{
    has_multiple_statements, split_sql_statement_spans_with_soft_boundaries, split_sql_statements,
};
pub use types::{QueryExecutionMode, SqlStatementSpan, StatementKind, StatementScanDialect};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use filters::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use read_only::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use scanner::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use soft_boundaries::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use types::*;

#[cfg(test)]
mod tests;
