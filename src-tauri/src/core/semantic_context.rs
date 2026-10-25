//! Local driver-operation provenance, independent of SQL parsing and Desktop.
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;
use uuid::Uuid;

const MAX_REVISION: u64 = 9_007_199_254_740_991;
const CLOSED_LIMIT: usize = 128;
const TRANSACTION_LIMIT: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSemanticState {
    pub connection_id: String,
    pub session: String,
    pub revision: u64,
    pub active_operations: u32,
    pub open_transactions: u32,
    pub connected: bool,
    /// A dropped future does not prove the engine stopped or restored context.
    /// Only replacing this driver session can remove this uncertainty.
    pub uncertain: bool,
}

struct State {
    revision: u64,
    entries: HashMap<String, ConnectionSemanticState>,
    transactions: HashMap<String, HashSet<String>>,
}
fn trim_closed(state: &mut State) {
    let mut closed = state
        .entries
        .values()
        .filter(|entry| !entry.connected)
        .map(|entry| (entry.revision, entry.connection_id.clone()))
        .collect::<Vec<_>>();
    closed.sort_unstable();
    let excess = closed.len().saturating_sub(CLOSED_LIMIT);
    for (_, id) in closed.into_iter().take(excess) {
        state.entries.remove(&id);
        state.transactions.remove(&id);
    }
}
struct Inner {
    state: Mutex<State>,
    events: broadcast::Sender<ConnectionSemanticState>,
}
#[derive(Clone)]
pub struct ConnectionSemanticTracker(Arc<Inner>);

impl Default for ConnectionSemanticTracker {
    fn default() -> Self {
        let (events, _) = broadcast::channel(256);
        Self(Arc::new(Inner {
            state: Mutex::new(State {
                revision: 0,
                entries: HashMap::new(),
                transactions: HashMap::new(),
            }),
            events,
        }))
    }
}

impl ConnectionSemanticTracker {
    fn change<T>(
        &self,
        action: impl FnOnce(&mut State, u64) -> (T, Option<ConnectionSemanticState>),
    ) -> T {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.revision = state.revision.saturating_add(1).min(MAX_REVISION);
        let revision = state.revision;
        let (result, event) = action(&mut state, revision);
        if let Some(event) = event {
            // Send while holding the same short lock so subscriptions see the
            // same order as snapshots; no driver I/O occurs inside this lock.
            let _ = self.0.events.send(event);
        }
        result
    }

    pub fn open(&self, id: &str) -> String {
        self.open_internal(id, 0)
    }

    pub fn open_observed(&self, id: &str) -> (String, SemanticOperation) {
        let session = self.open_internal(id, 1);
        let operation = SemanticOperation {
            tracker: self.clone(),
            id: id.into(),
            session: session.clone(),
            completed: false,
            transaction: None,
        };
        (session, operation)
    }

    fn open_internal(&self, id: &str, active_operations: u32) -> String {
        self.change(|state, revision| {
            let session = Uuid::new_v4().to_string();
            let next = ConnectionSemanticState {
                connection_id: id.into(),
                session: session.clone(),
                revision,
                active_operations,
                open_transactions: 0,
                connected: true,
                uncertain: revision == MAX_REVISION,
            };
            state.entries.insert(id.into(), next.clone());
            state.transactions.remove(id);
            trim_closed(state);
            (session, Some(next))
        })
    }

    pub fn close(&self, id: &str, session: &str) {
        self.change(|state, revision| {
            let Some(entry) = state
                .entries
                .get_mut(id)
                .filter(|entry| entry.session == session)
            else {
                return ((), None);
            };
            entry.connected = false;
            entry.revision = revision;
            let event = entry.clone();
            state.transactions.remove(id);
            trim_closed(state);
            ((), Some(event))
        });
    }

    pub fn snapshot(&self, id: &str) -> Option<ConnectionSemanticState> {
        self.0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entries
            .get(id)
            .cloned()
    }
    pub fn snapshots(&self) -> Vec<ConnectionSemanticState> {
        self.0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entries
            .values()
            .cloned()
            .collect()
    }
    pub fn subscribe(&self) -> broadcast::Receiver<ConnectionSemanticState> {
        self.0.events.subscribe()
    }

    pub fn begin(&self, id: &str, session: &str) -> Result<SemanticOperation> {
        self.change(|state, revision| {
            let Some(entry) = state
                .entries
                .get_mut(id)
                .filter(|entry| entry.connected && entry.session == session)
            else {
                return (
                    Err(anyhow!("Connection semantic session was replaced")),
                    None,
                );
            };
            entry.revision = revision;
            entry.uncertain |= revision == MAX_REVISION;
            let Some(active) = entry.active_operations.checked_add(1) else {
                entry.uncertain = true;
                return (
                    Err(anyhow!("Connection semantic operation limit exceeded")),
                    Some(entry.clone()),
                );
            };
            entry.active_operations = active;
            (
                Ok(SemanticOperation {
                    tracker: self.clone(),
                    id: id.into(),
                    session: session.into(),
                    completed: false,
                    transaction: None,
                }),
                Some(entry.clone()),
            )
        })
    }

    fn finish(
        &self,
        id: &str,
        session: &str,
        completed: bool,
        transaction: Option<&TransactionCompletion>,
    ) {
        self.change(|state, revision| {
            if !state
                .entries
                .get(id)
                .is_some_and(|entry| entry.connected && entry.session == session)
            {
                return ((), None);
            }
            let mut transaction_uncertain = false;
            if let Some(transaction) = transaction {
                if !transaction.succeeded {
                    transaction_uncertain = true;
                } else {
                    let ids = state.transactions.entry(id.into()).or_default();
                    if transaction.begin {
                        if ids.len() >= TRANSACTION_LIMIT && !ids.contains(&transaction.id) {
                            transaction_uncertain = true;
                        } else {
                            ids.insert(transaction.id.clone());
                        }
                    } else {
                        ids.remove(&transaction.id);
                    }
                }
            }
            let open_transactions = state.transactions.get(id).map_or(0, |ids| ids.len() as u32);
            let Some(entry) = state
                .entries
                .get_mut(id)
                .filter(|entry| entry.connected && entry.session == session)
            else {
                return ((), None);
            };
            entry.active_operations = entry.active_operations.saturating_sub(1);
            entry.revision = revision;
            entry.open_transactions = open_transactions;
            entry.uncertain |= !completed || transaction_uncertain || revision == MAX_REVISION;
            ((), Some(entry.clone()))
        });
    }
}

pub struct SemanticOperation {
    tracker: ConnectionSemanticTracker,
    id: String,
    session: String,
    completed: bool,
    transaction: Option<TransactionCompletion>,
}
struct TransactionCompletion {
    id: String,
    begin: bool,
    succeeded: bool,
}
impl SemanticOperation {
    /// A returned error still completes a dispatch and invalidates metadata.
    /// Dropping this future before its driver result instead remains uncertain.
    pub async fn run<T>(mut self, future: impl Future<Output = T>) -> T {
        let result = future.await;
        self.completed = true;
        result
    }
    pub async fn run_transaction<T>(
        mut self,
        id: &str,
        begin: bool,
        future: impl Future<Output = Result<T>>,
    ) -> Result<T> {
        let result = future.await;
        self.transaction = Some(TransactionCompletion {
            id: id.into(),
            begin,
            succeeded: result.is_ok(),
        });
        self.completed = true;
        result
    }
}
impl Drop for SemanticOperation {
    fn drop(&mut self) {
        self.tracker.finish(
            &self.id,
            &self.session,
            self.completed,
            self.transaction.as_ref(),
        );
    }
}

#[cfg(test)]
#[path = "semantic_context_tests.rs"]
mod tests;
