use crate::core::document_read::{validate_document_target, DocumentReadPage, DocumentReadRequest};
use anyhow::{anyhow, Context, Result};
use futures::TryStreamExt;
use mongodb::bson::{Bson, Document};
use serde_json::Value;

use super::commands::json_to_document;
use super::models::MongoDbDriver;

impl MongoDbDriver {
    pub(super) async fn read_only_documents(
        &self,
        request: DocumentReadRequest<'_>,
    ) -> Result<DocumentReadPage> {
        validate_document_target(request.database, request.collection)?;
        request.query.validate()?;
        if !(1..=1_000).contains(&request.max_rows)
            || !(512..=1_048_576).contains(&request.max_bytes)
            || request.timeout.is_zero()
        {
            return Err(anyhow!("document execution budget is invalid"));
        }
        let filter = json_to_document(&request.query.filter, "document filter")?;
        let projection = json_to_document(&request.query.projection, "document projection")?;
        let mut sort = Document::new();
        for field in &request.query.sort {
            sort.insert(&field.field, field.direction);
        }
        if !sort.contains_key("_id") {
            sort.insert("_id", 1);
        }
        let limit = request.query.limit.min(request.max_rows);
        let client = self.client().await?;
        // The SDK owns the cursor and sends killCursors when it is dropped.
        // Agent disconnect waits for that cleanup before shutting down its client.
        let mut cursor = client
            .database(request.database)
            .collection::<Document>(request.collection)
            .find(filter)
            .projection(projection)
            .sort(sort)
            .skip(request.query.offset)
            .limit((limit + 1) as i64)
            .batch_size((limit + 1).min(16) as u32)
            .max_time(request.timeout)
            .allow_disk_use(false)
            .await
            .context("read-only document find failed")?;
        let mut page = DocumentPageBuilder::new(limit, request.max_bytes, request.query.offset);
        while let Some(document) = cursor
            .try_next()
            .await
            .context("document cursor read failed")?
        {
            if page.full() {
                page.has_more = true;
                break;
            }
            let value = Bson::Document(document).into_canonical_extjson();
            if !page.push(value)? {
                break;
            }
        }
        Ok(page.finish())
    }
}

struct DocumentPageBuilder {
    documents: Vec<Value>,
    limit: usize,
    max_bytes: usize,
    bytes: usize,
    offset: u64,
    has_more: bool,
    byte_limited: bool,
}

impl DocumentPageBuilder {
    fn new(limit: usize, max_bytes: usize, offset: u64) -> Self {
        Self {
            documents: vec![],
            limit,
            max_bytes,
            bytes: 2,
            offset,
            has_more: false,
            byte_limited: false,
        }
    }
    fn full(&self) -> bool {
        self.documents.len() >= self.limit
    }
    fn push(&mut self, document: Value) -> Result<bool> {
        let bytes = serde_json::to_vec(&document)?.len() + usize::from(!self.documents.is_empty());
        if self.bytes.saturating_add(bytes) > self.max_bytes {
            if self.documents.is_empty() {
                return Err(anyhow!(
                    "one document exceeds the response budget; request a narrower field projection"
                ));
            }
            self.has_more = true;
            self.byte_limited = true;
            return Ok(false);
        }
        self.bytes += bytes;
        self.documents.push(document);
        Ok(true)
    }
    fn finish(self) -> DocumentReadPage {
        let next_offset = self
            .has_more
            .then_some(self.offset + self.documents.len() as u64);
        DocumentReadPage {
            documents: self.documents,
            has_more: self.has_more,
            next_offset,
            byte_limited: self.byte_limited,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::DocumentPageBuilder;
    use serde_json::json;

    #[test]
    fn byte_limited_pages_resume_before_the_omitted_document() {
        let mut page = DocumentPageBuilder::new(10, 90, 7);
        assert!(page
            .push(json!({"_id":{"$numberLong":"1"}, "value":"short"}))
            .unwrap());
        assert!(!page
            .push(json!({"_id":{"$numberLong":"2"}, "value":"x".repeat(100)}))
            .unwrap());
        let page = page.finish();
        assert!(page.byte_limited && page.has_more);
        assert_eq!(page.next_offset, Some(8));
        assert_eq!(page.documents.len(), 1);
    }

    #[test]
    fn oversized_first_document_fails_instead_of_advancing_or_returning_a_loop() {
        assert!(DocumentPageBuilder::new(10, 20, 0)
            .push(json!({"field":"x".repeat(40)}))
            .is_err());
    }

    #[test]
    fn exhausted_pages_preserve_complete_typed_documents() {
        let mut builder = DocumentPageBuilder::new(1, 100, 0);
        let document = json!({"_id":{"$oid":"507f1f77bcf86cd799439011"}});
        builder.push(document.clone()).unwrap();
        assert!(builder.full());
        let page = builder.finish();
        assert!(!page.has_more);
        assert_eq!(page.next_offset, None);
        assert_eq!(page.documents, vec![document]);
    }
}
