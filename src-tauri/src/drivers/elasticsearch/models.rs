use regex::Regex;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use tokio::sync::Mutex;

pub struct ElasticsearchDriver {
    pub(super) base_url: Url,
    pub(super) client: Client,
    pub(super) auth: Option<(String, String)>,
    pub(super) transport_mode: ElasticsearchTransportMode,
    pub(super) connectivity_check_path: String,
    pub(super) connectivity_check_disabled: bool,
    pub(super) server_info: Mutex<Option<ElasticsearchServerInfo>>,
    pub(super) mapping_types: Mutex<HashMap<String, String>>,
    pub(super) active_index: Mutex<Option<String>>,
    pub(super) connected: Mutex<bool>,
    pub(super) pit_shard_doc_supported: AtomicBool,
    pub(super) index_grouping: Option<Regex>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ElasticsearchTransportMode {
    Direct,
    KibanaProxy,
}

#[derive(Debug)]
pub(super) struct ElasticsearchConnectionOptions {
    pub(super) transport_mode: ElasticsearchTransportMode,
    pub(super) kibana_base_path: String,
    pub(super) connectivity_check_path: String,
    pub(super) connectivity_check_disabled: bool,
    pub(super) index_grouping: Option<Regex>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ElasticsearchServerInfo {
    pub(super) version: String,
    pub(super) major: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ElasticsearchRequest {
    pub(super) method: Method,
    pub(super) path: String,
    pub(super) body: Option<String>,
}

pub(super) const ELASTICSEARCH_PIT_KEEP_ALIVE: &str = "1m";
pub(super) const ELASTICSEARCH_MAX_RESULT_WINDOW: usize = 10_000;
pub(super) const ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES: usize = 64 * 1024;
pub(super) const KIBANA_PROXY_STATUS_HEADER: &str = "x-console-proxy-status-code";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum ElasticsearchDocumentCursor {
    Pit {
        pit_id: String,
        index: String,
        search_after: Vec<Value>,
        sort: Vec<Value>,
        limit: usize,
        filter: Option<Value>,
    },
    Offset {
        index: String,
        offset: usize,
        sort: Vec<Value>,
        limit: usize,
        filter: Option<Value>,
    },
}
