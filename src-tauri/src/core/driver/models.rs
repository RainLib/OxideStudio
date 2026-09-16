use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc,
};

#[derive(Debug, Clone, Copy)]
pub struct DocumentPageRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub cursor: Option<&'a str>,
    pub limit: usize,
    pub filter: Option<&'a str>,
    pub sort: Option<&'a str>,
}

/// A bounded, stable-order source batch used exclusively for native document
/// collection transfers. Documents cross the desktop boundary as canonical
/// Extended JSON so MongoDB values such as ObjectId, Date, Decimal128 and
/// binary data can be restored by a compatible native driver without a lossy
/// JSON conversion.
#[derive(Debug, Clone, Copy)]
pub struct DocumentTransferReadRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub offset: u64,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentTransferBatch {
    pub documents: Vec<serde_json::Value>,
    pub total: u64,
}

/// Target-side write for one reviewed document-transfer batch. Drivers must
/// parse the canonical representation into their own native value model;
/// generic JSON query execution is deliberately not a fallback.
#[derive(Debug, Clone, Copy)]
pub struct DocumentTransferWriteRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub documents: &'a [serde_json::Value],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTransferWriteReceipt {
    pub inserted_count: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct DocumentTransferClearRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTransferClearReceipt {
    pub deleted_count: u64,
}

/// One reviewed clone of a native document. `source_id` is the stable
/// database identity selected by the user; `draft_document` is omitted for
/// the initial source load and supplied after the editor has a JSON draft.
#[derive(Debug, Clone, Copy)]
pub struct DocumentCloneRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub source_id: &'a serde_json::Value,
    pub draft_document: Option<&'a serde_json::Value>,
}

/// Driver-owned clone preparation. Native drivers keep the original document
/// in their native value model, derive the edited-field set, and return only
/// canonical JSON views across the desktop boundary.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedDocumentClone {
    pub source_digest: String,
    pub source_document: serde_json::Value,
    pub draft_document: serde_json::Value,
    pub cloned_document: serde_json::Value,
    pub edited_fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentCloneReceipt {
    pub inserted_id: serde_json::Value,
}

/// One reviewed replacement of an existing native document. The editable
/// draft deliberately excludes `_id`; identity remains owned by the source
/// document selected in the database.
#[derive(Debug, Clone, Copy)]
pub struct DocumentEditRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub source_id: &'a serde_json::Value,
    pub draft_document: Option<&'a serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedDocumentEdit {
    pub source_digest: String,
    pub source_document: serde_json::Value,
    pub draft_document: serde_json::Value,
    pub updated_document: serde_json::Value,
    pub edited_fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentEditReceipt {
    pub matched_count: u64,
    pub modified_count: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct DocumentDeleteRequest<'a> {
    pub namespace: &'a str,
    pub collection: &'a str,
    pub source_id: &'a serde_json::Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedDocumentDelete {
    pub source_digest: String,
    pub source_document: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentDeleteReceipt {
    pub deleted_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalDatabaseFileReceipt {
    pub byte_len: u64,
    pub integrity_check: String,
}

/// Receipt for one Host-reviewed SQLite table rebuild. The driver owns the
/// backup, foreign-key suspension, transaction, integrity check, and pragma
/// restoration boundary so callers cannot accidentally split those steps
/// across pooled connections.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqliteRebuildReceipt {
    pub backup: LocalDatabaseFileReceipt,
    pub statements_applied: usize,
}

/// Process-local control shared by a scheduled backup command and the native
/// driver. It contains no path, SQL, or credentials and only exposes bounded
/// progress plus cooperative cancellation.
#[derive(Debug, Clone, Default)]
pub struct LocalDatabaseBackupControl {
    cancelled: Arc<AtomicBool>,
    progress_percent: Arc<AtomicU8>,
}

impl LocalDatabaseBackupControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn set_progress_percent(&self, value: u8) {
        self.progress_percent
            .store(value.min(100), Ordering::Release);
    }

    pub fn progress_percent(&self) -> u8 {
        self.progress_percent.load(Ordering::Acquire)
    }
}
