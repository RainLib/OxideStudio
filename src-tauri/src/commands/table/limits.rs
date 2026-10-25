//! Limits for table operations.

use crate::core::protocol::DEFAULT_QUERY_RESULT_ROW_LIMIT;

pub(super) const DEFAULT_PAGE_SIZE: u32 = 500;

pub(super) const MAX_PAGE_SIZE: u32 = 5_000;

pub(super) const MAX_JSON_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;

pub(super) const MAX_XLSX_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;

pub(super) const MAX_JSON_LINES_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;

/// CSV records are parsed incrementally and written through a single explicit
/// transaction. JSON documents and JSONL use bounded parser/queue/batch
/// budgets as well; XLSX also streams cells and indexes shared strings on disk.
pub(super) const MAX_CSV_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;

/// The desktop CSV review UI intentionally reads only a bounded prefix.  The
/// actual import remains streaming and is allowed to use the larger import
/// budget above.  Keeping this separate prevents a preview from turning a
/// 512 MiB import into a renderer-memory allocation.
pub(super) const MAX_CSV_IMPORT_PREVIEW_BYTES: usize = 32 * 1024 * 1024;

/// JSON imports use a structured review rather than copying arbitrary file
/// bytes into the renderer. Keep both the number of records and nested values
/// bounded so selecting a valid-but-large JSON document cannot create a UI
/// memory spike before the user confirms the transaction.
pub(super) const MAX_JSON_IMPORT_PREVIEW_ROWS: usize = 50;

pub(super) const MAX_JSON_IMPORT_PREVIEW_COLUMNS: usize = 256;

pub(super) const MAX_JSON_IMPORT_PREVIEW_STRING_CHARS: usize = 1_024;

pub(super) const MAX_JSON_IMPORT_PREVIEW_ARRAY_ITEMS: usize = 32;

pub(super) const MAX_JSON_IMPORT_PREVIEW_OBJECT_FIELDS: usize = 32;

pub(super) const IMPORT_BATCH_SIZE: usize = 500;
pub(super) const STRUCTURED_IMPORT_BATCH_BYTES: usize = 2 * 1024 * 1024;
pub(super) const STRUCTURED_IMPORT_QUEUE_BATCHES: usize = 2;

pub(super) const XLSX_MAX_ROWS: u64 = 1_048_576;

pub(super) const XLSX_MAX_COLUMNS: usize = 16_384;

pub(super) const XLSX_MAX_CELL_CHARS: usize = 32_767;

/// A database-to-database copy is intentionally bounded.  It is a reviewed
/// table-data transfer, not an unbounded background replication feature.
pub(super) const DEFAULT_TRANSFER_ROWS: u32 = 1_000;

pub(super) const MAX_TRANSFER_ROWS: u32 = 10_000;

/// A copy can legitimately use a one-row batch for incompatible or very wide
/// targets. Do not let that turn one transfer into thousands of renderer
/// events; terminal state is always emitted separately and never throttled.
pub(super) const TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL: u64 = 4;

/// Progress is informational and must never make a transfer wait on renderer
/// event delivery. Keep a small relay so a slow WebView cannot apply
/// backpressure to database reads/writes; terminal progress is sent reliably.
pub(super) const TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY: usize = 16;

pub(super) const DEFAULT_TRANSFER_BATCH_SIZE: u32 = 250;

pub(super) const MAX_TRANSFER_BATCH_SIZE: u32 = 500;

pub(super) const MAX_TRANSFER_OVERWRITE_ROWS: u64 = 100_000;

pub(super) const MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS: usize = 256;

pub(super) const MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES: usize = 4 * 1024 * 1024;

/// A full table compare can inspect up to 100,000 rows per side, but its IPC
/// response must not materialize every difference in the renderer. Totals are
/// always exact; this only bounds the row-level preview returned to the UI.
pub(super) const MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS: usize = 1_000;

pub(super) const DEFAULT_FULL_DATA_COMPARE_MAX_ROWS: u64 = 100_000;

pub(super) const MAX_FULL_DATA_COMPARE_ROWS: u64 = 100_000;

pub(super) const DEFAULT_SAMPLED_DATA_COMPARE_MAX_ROWS: u64 = 10_000_000;

pub(super) const MAX_SAMPLED_DATA_COMPARE_MAX_ROWS: u64 = 10_000_000;

pub(super) const DEFAULT_DATA_COMPARE_SAMPLE_SIZE: u32 = 10_000;

pub(super) const MAX_DATA_COMPARE_SAMPLE_SIZE: u32 = 10_000;

pub(super) const MAX_DATA_COMPARE_SYNC_OPERATIONS: usize =
    MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS * 3;

pub(super) const MAX_DATA_COMPARE_SYNC_SQL_BYTES: usize = 4 * 1024 * 1024;

pub(super) const TABLE_DATA_COMPARE_SYNC_PLAN_TTL_MILLIS: i64 = 5 * 60 * 1_000;

pub(super) const MAX_ACTIVE_TABLE_DATA_COMPARE_SYNC_PLANS: usize = 8;

/// SQLite defaults to 999 bind variables and external PostgreSQL-compatible
/// packages may enforce similarly conservative limits. Keep sampled key lookup
/// batches below that boundary even for composite keys.
pub(super) const MAX_DATA_COMPARE_SAMPLE_QUERY_PARAMETERS: usize = 800;

/// Parameterized query drivers deliberately cap a result set at this value.
/// Keep full-compare pages within that contract so a 5,000-row request can
/// never be silently shortened by a driver and mistaken for the final page.
pub(super) const MAX_FULL_DATA_COMPARE_BATCH_SIZE: u32 = DEFAULT_QUERY_RESULT_ROW_LIMIT as u32;

pub const TABLE_DATA_TRANSFER_PROGRESS_EVENT: &str = "table-data-transfer://progress";

pub const TABLE_DATA_COMPARE_PROGRESS_EVENT: &str = "table-data-compare://progress";

pub const TABLE_EXPORT_PROGRESS_EVENT: &str = "table-export://progress";

pub const TABLE_IMPORT_PROGRESS_EVENT: &str = "table-import://progress";

pub(super) const TABLE_DATA_TRANSFER_CANCELLED: &str = "TABLE_DATA_TRANSFER_CANCELLED";

pub(super) const TABLE_DATA_COMPARE_CANCELLED: &str = "TABLE_DATA_COMPARE_CANCELLED";

pub(super) const TABLE_DATA_TRANSFER_REPORT_PARENT_ID: &str = "table-data-transfer-reports-v1";

pub(super) const TABLE_DATA_TRANSFER_REPORT_KIND: &str = "TABLE_DATA_TRANSFER_REPORT";

pub(super) const TABLE_DATA_TRANSFER_OBJECT_REPORT_PARENT_ID: &str =
    "table-data-transfer-object-reports-v1";

pub(super) const TABLE_DATA_TRANSFER_OBJECT_REPORT_KIND: &str = "TABLE_DATA_TRANSFER_OBJECT_REPORT";

pub(super) const TABLE_EXPORT_CANCELLED: &str = "TABLE_EXPORT_CANCELLED";

pub(super) const TABLE_IMPORT_CANCELLED: &str = "TABLE_IMPORT_CANCELLED";

pub(super) const TABLE_EXPORT_WRITER_CLOSED: &str = "TABLE_EXPORT_WRITER_CLOSED";

/// At most two database pages may wait for the blocking encoder/writer. This
/// keeps memory bounded while allowing one page to be fetched as the previous
/// page is encoded and flushed to the operating-system cache.
pub(super) const TABLE_EXPORT_BUFFERED_PAGES: usize = 2;

/// Keep SQL exports fast to replay without producing statements so large that
/// database clients or proxies commonly reject them. This mirrors DBX's
/// reviewed table-export row grouping while retaining a byte-size guard for
/// unusually wide rows.
pub(super) const SQL_EXPORT_INSERT_BATCH_ROWS: usize = 100;

pub(super) const SQL_EXPORT_MAX_INSERT_BATCH_ROWS: usize = 1_000;

pub(super) const SQL_EXPORT_TARGET_STATEMENT_BYTES: usize = 512 * 1024;

pub(super) const PARQUET_MAX_ROW_GROUP_ROWS: usize = 50_000;

pub(super) const PARQUET_MAX_ROW_GROUP_BYTES: usize = 64 * 1024 * 1024;

pub(super) const TABLE_EXPORT_REPORT_PARENT_ID: &str = "table-export-reports-v1";

pub(super) const TABLE_EXPORT_REPORT_KIND: &str = "TABLE_EXPORT_REPORT";

pub(super) const TABLE_IMPORT_REPORT_PARENT_ID: &str = "table-import-reports-v1";

pub(super) const TABLE_IMPORT_REPORT_KIND: &str = "TABLE_IMPORT_REPORT";

pub(super) const MAX_POSTGRES_ROUTINE_SOURCE_CHARS: usize = 262_144;

pub(super) const MAX_POSTGRES_ROUTINE_SOURCE_OVERLOADS: usize = 20;

/// Catalog defaults are included in a reviewed CREATE TABLE plan, never in an
/// unbounded renderer payload or unchecked SQL fragment.
pub(super) const MAX_DEFAULT_EXPRESSION_BYTES: usize = 16 * 1024;

/// A whole-schema backup must not silently truncate source definitions. Keep
/// routine discovery bounded, but fail the export if the schema exceeds this
/// reviewed host-owned limit instead of publishing a partial logical backup.
pub(super) const MAX_POSTGRES_BACKUP_ROUTINES: usize = 1_000;
