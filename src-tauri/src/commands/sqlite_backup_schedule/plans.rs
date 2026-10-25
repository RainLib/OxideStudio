use super::calendar::{schedule_next_run, validate_time_zone};
use super::models::{SaveSqliteBackupScheduleRequest, SqliteBackupSchedule, MAX_SCHEDULES};
use super::source::saved_source;
use super::state::SqliteBackupScheduleState;
use super::validation::{
    canonical_destination, require_destination_identity, validate_identity, validate_schedule_name,
    validate_time_of_day,
};
use chrono::Utc;

impl SqliteBackupScheduleState {
    pub async fn save_schedule(
        &self,
        request: SaveSqliteBackupScheduleRequest,
    ) -> Result<SqliteBackupSchedule, String> {
        let state = self;
        let connection_id = validate_identity(&request.connection_id, "connection identity")?;
        let project_id = validate_identity(&request.project_id, "project identity")?;
        // Pausing an unchanged reviewed plan performs no file operation. It
        // must remain possible when its source or destination is unavailable.
        {
            let mut data = state.lock_data().await?;
            if let Some(schedule) = data
                .schedules
                .iter_mut()
                .find(|schedule| schedule.is_pause_request(&request))
            {
                schedule.enabled = false;
                schedule.updated_at = Utc::now().to_rfc3339();
                let paused = schedule.clone();
                state.persist(&data)?;
                return Ok(paused);
            }
        }
        saved_source(state, &project_id, &connection_id).await?;
        let name = validate_schedule_name(&request.name)?;
        let destination = canonical_destination(&request.destination_directory)?;
        let destination_identity = require_destination_identity(&destination)?;
        let time_of_day = validate_time_of_day(&request.time_of_day)?;
        if !(1..=168).contains(&request.interval_hours) {
            return Err("Hourly backup interval must be from 1 to 168 hours".to_string());
        }
        if request.weekday > 6 {
            return Err("Weekly backup day must be from Sunday through Saturday".to_string());
        }
        if !(1..=100).contains(&request.retention_count) {
            return Err("Backup retention must keep from 1 to 100 runs".to_string());
        }
        let now = Utc::now();
        let mut data = state.lock_data().await?;
        if let Some(id) = request.id.as_deref() {
            let id = validate_identity(id, "backup schedule identity")?;
            if data
                .runs
                .iter()
                .any(|run| run.schedule_id == id && run.status.is_active())
            {
                return Err("A running or queued backup schedule cannot be changed".to_string());
            }
            if !data.schedules.iter().any(|schedule| schedule.id == id) {
                return Err("The SQLite backup schedule no longer exists".to_string());
            }
        }
        let existing_index = request
            .id
            .as_deref()
            .and_then(|id| data.schedules.iter().position(|schedule| schedule.id == id));
        if existing_index.is_none() && data.schedules.len() >= MAX_SCHEDULES {
            return Err("SQLite backup schedule limit reached".to_string());
        }
        let id = match request.id {
            Some(id) => validate_identity(&id, "backup schedule identity")?,
            None => uuid::Uuid::new_v4().to_string(),
        };
        let created_at = existing_index
            .map(|index| data.schedules[index].created_at.clone())
            .unwrap_or_else(|| now.to_rfc3339());
        let time_zone = match request.time_zone.as_deref() {
            Some(zone) => validate_time_zone(zone)?,
            None => existing_index.and_then(|index| data.schedules[index].time_zone.clone()),
        };
        let mut schedule = SqliteBackupSchedule {
            id,
            name,
            project_id,
            connection_id,
            destination_directory: destination.to_string_lossy().into_owned(),
            destination_identity: Some(destination_identity),
            frequency: request.frequency,
            interval_hours: request.interval_hours,
            time_of_day,
            time_zone,
            scheduling_error: None,
            weekday: request.weekday,
            retention_count: request.retention_count,
            compression: request.compression,
            enabled: request.enabled,
            created_at,
            updated_at: now.to_rfc3339(),
            next_run_at: String::new(),
            last_run_at: existing_index.and_then(|index| data.schedules[index].last_run_at.clone()),
            last_run_status: existing_index.and_then(|index| data.schedules[index].last_run_status),
        };
        schedule.next_run_at = schedule_next_run(&schedule, now)?.to_rfc3339();
        if let Some(index) = existing_index {
            data.schedules[index] = schedule.clone();
        } else {
            data.schedules.push(schedule.clone());
        }
        data.schedules
            .sort_by(|left, right| left.name.cmp(&right.name));
        state.persist(&data)?;
        Ok(schedule)
    }
}
