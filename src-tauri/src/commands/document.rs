//! Native document command facade; protocol models, shared confirmation, MongoDB mutations, transfer, and Elasticsearch each have an owner.

pub mod elasticsearch;
mod models;
pub mod mongodb;
mod support;
pub mod transfer;

pub use elasticsearch::{
    execute_elasticsearch_index_clear, get_elasticsearch_index_metadata,
    preview_elasticsearch_index_clear,
};
pub use models::*;
pub use mongodb::{
    execute_mongodb_document_clone, execute_mongodb_document_delete, execute_mongodb_document_edit,
    preview_mongodb_document_clone, preview_mongodb_document_delete, preview_mongodb_document_edit,
};
pub use transfer::{execute_mongodb_collection_transfer, preview_mongodb_collection_transfer};

#[cfg(test)]
mod tests;
