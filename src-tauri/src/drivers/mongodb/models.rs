use mongodb::Client;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

pub(super) const MONGODB_DATABASE_INITIALIZATION_COLLECTION: &str = "oxide_init";
/// Listing a document database with many collections must not turn one Explorer
/// expansion into an unbounded burst of count requests. This cap preserves the
/// optional count badge while keeping metadata discovery responsive and polite
/// to shared MongoDB deployments.
pub(super) const MONGODB_COLLECTION_COUNT_CONCURRENCY: usize = 8;

pub struct MongoDbDriver {
    pub(super) agent_owned: bool,
    pub(super) url: String,
    pub(super) default_database: String,
    pub(super) active_database: Mutex<String>,
    pub(super) client: Mutex<Option<Client>>,
    // `buildInfo` is sampled during connection setup and deliberately kept
    // separate from query execution. The LSP schema configuration can then
    // apply MongoDB's version-gated aggregation completions without issuing
    // another privileged command whenever an editor tab is opened.
    pub(super) server_version: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MongoCommandInput {
    pub(super) database: Option<String>,
    pub(super) use_database: Option<String>,
    pub(super) collection: Option<String>,
    pub(super) command: Option<Value>,
    pub(super) find: Option<Value>,
    pub(super) aggregate: Option<Vec<Value>>,
    pub(super) aggregate_options: Option<Value>,
    pub(super) count_documents: Option<Value>,
    pub(super) insert_one: Option<Value>,
    pub(super) insert_many: Option<Vec<Value>>,
    pub(super) update_one: Option<MongoUpdateInput>,
    pub(super) update_many: Option<MongoUpdateInput>,
    pub(super) delete_one: Option<Value>,
    pub(super) delete_many: Option<Value>,
    pub(super) limit: Option<i64>,
    pub(super) skip: Option<i64>,
    pub(super) sort: Option<Value>,
    pub(super) projection: Option<Value>,
    pub(super) collation: Option<Value>,
    pub(super) find_options: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MongoUpdateInput {
    pub(super) filter: Value,
    pub(super) update: Value,
    pub(super) upsert: Option<bool>,
}
