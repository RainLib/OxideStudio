use chrono::{DateTime, Datelike, Duration, Local, LocalResult, TimeZone, Utc};

use super::models::{SqliteBackupSchedule, SqliteBackupScheduleFrequency};

pub(super) fn schedule_next_run(
    schedule: &SqliteBackupSchedule,
    after: DateTime<Utc>,
) -> DateTime<Utc> {
    if schedule.frequency == SqliteBackupScheduleFrequency::Hourly {
        return after + Duration::hours(i64::from(schedule.interval_hours.clamp(1, 168)));
    }
    let (hour, minute) = schedule
        .time_of_day
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<u32>().ok()?, minute.parse::<u32>().ok()?)))
        .unwrap_or((2, 0));
    let local_after = after.with_timezone(&Local);
    for offset in 0..=8_i64 {
        let date = local_after.date_naive() + Duration::days(offset);
        if schedule.frequency == SqliteBackupScheduleFrequency::Weekly
            && date.weekday().num_days_from_sunday() != u32::from(schedule.weekday.min(6))
        {
            continue;
        }
        let Some(candidate) = date.and_hms_opt(hour, minute, 0) else {
            continue;
        };
        let local = match Local.from_local_datetime(&candidate) {
            LocalResult::Single(value) => value,
            LocalResult::Ambiguous(first, _) => first,
            LocalResult::None => continue,
        };
        let utc = local.with_timezone(&Utc);
        if utc > after {
            return utc;
        }
    }
    after + Duration::days(1)
}

pub(super) fn schedule_is_due(schedule: &SqliteBackupSchedule, now: DateTime<Utc>) -> bool {
    schedule.enabled
        && DateTime::parse_from_rfc3339(&schedule.next_run_at)
            .is_ok_and(|next| next.with_timezone(&Utc) <= now)
}
