use chrono::{DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone, Utc};
use jiff::{civil, tz::TimeZone as IanaZone, Timestamp};

use super::models::{SqliteBackupSchedule, SqliteBackupScheduleFrequency};
use super::validation::validate_time_of_day;

pub(super) fn validate_time_zone(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value == "system" {
        return Ok(None);
    }
    let zone = named_zone(value)?;
    Ok(Some(zone.iana_name().unwrap_or(value).to_string()))
}

fn named_zone(value: &str) -> Result<IanaZone, String> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err("Choose an IANA time zone such as Asia/Shanghai or UTC".to_string());
    }
    IanaZone::get(value)
        .ok()
        .filter(|zone| !zone.is_unknown())
        .ok_or_else(|| {
            "Unknown backup time zone; choose an IANA name such as Asia/Shanghai or UTC".to_string()
        })
}

pub(super) fn schedule_next_run(
    schedule: &SqliteBackupSchedule,
    after: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    // Validate even hourly plans so an invalid saved zone cannot be silently
    // accepted now and then change meaning when the frequency is edited.
    let zone = schedule.time_zone.as_deref().map(named_zone).transpose()?;
    if schedule.frequency == SqliteBackupScheduleFrequency::Hourly {
        if !(1..=168).contains(&schedule.interval_hours) {
            return Err("Hourly backup interval must be from 1 to 168 hours".to_string());
        }
        return after
            .checked_add_signed(Duration::hours(i64::from(schedule.interval_hours)))
            .ok_or_else(|| "Backup schedule exceeds the supported calendar range".to_string());
    }
    let time = validate_time_of_day(&schedule.time_of_day)?;
    let hour = time[..2].parse::<u32>().expect("validated hour");
    let minute = time[3..].parse::<u32>().expect("validated minute");
    if schedule.weekday > 6 {
        return Err("Weekly backup day must be from Sunday through Saturday".to_string());
    }
    let first_date = if let Some(zone) = &zone {
        let timestamp = Timestamp::new(after.timestamp(), after.timestamp_subsec_nanos() as i32)
            .map_err(|_| "Backup schedule exceeds the supported calendar range".to_string())?;
        let civil = zone.to_datetime(timestamp);
        NaiveDate::from_ymd_opt(
            i32::from(civil.year()),
            civil.month() as u32,
            civil.day() as u32,
        )
        .ok_or("Backup schedule exceeds the supported calendar range")?
    } else {
        // Preserve existing plans exactly until the user selects a named zone.
        after.with_timezone(&Local).date_naive()
    };
    // A weekly occurrence can fall in a DST gap. Search through the following
    // week too; never fall back to a different weekday or a UTC +24h guess.
    for offset in 0..=15_i64 {
        let date = first_date
            .checked_add_signed(Duration::days(offset))
            .ok_or("Backup schedule exceeds the supported calendar range")?;
        if schedule.frequency == SqliteBackupScheduleFrequency::Weekly
            && date.weekday().num_days_from_sunday() != u32::from(schedule.weekday)
        {
            continue;
        }
        let utc = if let Some(zone) = &zone {
            let year = i16::try_from(date.year())
                .map_err(|_| "Backup schedule exceeds the supported calendar range")?;
            let civil = civil::DateTime::new(
                year,
                date.month() as i8,
                date.day() as i8,
                hour as i8,
                minute as i8,
                0,
                0,
            )
            .map_err(|_| "Backup schedule exceeds the supported calendar range")?;
            let timestamp = zone
                .to_ambiguous_timestamp(civil)
                .earlier()
                .map_err(|_| "Backup schedule exceeds the supported calendar range")?;
            // Earlier selects the first repetition in a fold. In a gap it
            // maps to a different wall time, which must be skipped entirely.
            if zone.to_datetime(timestamp) != civil {
                continue;
            }
            DateTime::from_timestamp(timestamp.as_second(), timestamp.subsec_nanosecond() as u32)
                .ok_or("Backup schedule exceeds the supported calendar range")?
        } else {
            let candidate = date.and_hms_opt(hour, minute, 0).expect("validated time");
            match Local.from_local_datetime(&candidate) {
                LocalResult::Single(value) => value.with_timezone(&Utc),
                LocalResult::Ambiguous(first, second) => first.min(second).with_timezone(&Utc),
                LocalResult::None => continue,
            }
        };
        if utc > after {
            return Ok(utc);
        }
    }
    Err("No valid backup time in the next two weeks; review the schedule".to_string())
}

/// A completed file or recovery receipt must be persisted even if the time
/// zone can no longer be resolved. Pause that plan and expose the reason.
pub(super) fn advance_schedule(schedule: &mut SqliteBackupSchedule, after: DateTime<Utc>) {
    match schedule_next_run(schedule, after) {
        Ok(next) => {
            schedule.next_run_at = next.to_rfc3339();
            schedule.scheduling_error = None;
        }
        Err(error) => {
            schedule.enabled = false;
            schedule.scheduling_error = Some(error);
        }
    }
}

pub(super) fn schedule_is_due(schedule: &SqliteBackupSchedule, now: DateTime<Utc>) -> bool {
    schedule.enabled
        && DateTime::parse_from_rfc3339(&schedule.next_run_at)
            .is_ok_and(|next| next.with_timezone(&Utc) <= now)
}
