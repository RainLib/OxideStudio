use super::constants::MAX_EXTERNAL_MIGRATION_SESSIONS;
use oxide_driver_protocol::SchemaMigrationMode;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Default)]
pub struct ExternalSchemaMigrationSessionState {
    sessions: Mutex<HashMap<String, ExternalSchemaMigrationSession>>,
}

#[derive(Clone)]
pub(super) struct ExternalSchemaMigrationSession {
    pub(super) host_plan_id: String,
    pub(super) sidecar_plan_id: String,
    pub(super) plan_token: String,
    pub(super) connection_id: String,
    pub(super) runtime_process_id: u32,
    pub(super) source_fingerprint: String,
    pub(super) target_fingerprint: String,
    pub(super) mode: SchemaMigrationMode,
    pub(super) change_count: u32,
    pub(super) blocked_change_count: u32,
    pub(super) requires_review: bool,
    pub(super) requires_destructive: bool,
    pub(super) expires_at: Instant,
}

impl ExternalSchemaMigrationSessionState {
    pub(super) fn insert(&self, session: ExternalSchemaMigrationSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        let now = Instant::now();
        sessions.retain(|_, candidate| candidate.expires_at > now);
        if sessions.len() >= MAX_EXTERNAL_MIGRATION_SESSIONS {
            let oldest = sessions
                .iter()
                .min_by_key(|(_, candidate)| candidate.expires_at)
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(session.host_plan_id.clone(), session);
        Ok(())
    }

    pub(super) fn get(&self, plan_id: &str) -> Result<ExternalSchemaMigrationSession, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        let now = Instant::now();
        sessions.retain(|_, candidate| candidate.expires_at > now);
        sessions
            .get(plan_id)
            .cloned()
            .ok_or_else(|| {
                "The target-owned migration session expired or belongs to another application process; compare the snapshots again"
                    .to_string()
            })
    }

    pub(super) fn consume(&self, plan_id: &str) -> Result<ExternalSchemaMigrationSession, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        sessions.remove(plan_id).ok_or_else(|| {
            "The target-owned migration session was already consumed; compare the snapshots again"
                .to_string()
        })
    }
}
