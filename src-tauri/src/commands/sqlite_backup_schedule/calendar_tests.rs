use super::calendar::{schedule_next_run, validate_time_zone};
use super::models::{SaveSqliteBackupScheduleRequest, SqliteBackupScheduleFrequency};
use super::tests::schedule;
use chrono::{DateTime, Datelike, Local, Utc};

fn next(zone: &str, time: &str, after: &str, weekday: Option<u8>) -> String {
    let mut plan = schedule(std::path::Path::new("unused"));
    plan.frequency = if weekday.is_some() {
        SqliteBackupScheduleFrequency::Weekly
    } else {
        SqliteBackupScheduleFrequency::Daily
    };
    plan.time_zone = Some(zone.to_string());
    plan.time_of_day = time.to_string();
    plan.weekday = weekday.unwrap_or(0);
    schedule_next_run(&plan, after.parse::<DateTime<Utc>>().unwrap())
        .unwrap()
        .to_rfc3339()
}

#[test]
fn daily_named_zones_keep_their_wall_time_and_fractional_offsets() {
    assert_eq!(
        next("Asia/Shanghai", "02:00", "2026-10-21T12:00:00Z", None),
        "2026-10-21T18:00:00+00:00"
    );
    assert_eq!(
        next("Asia/Kathmandu", "02:00", "2026-10-21T12:00:00Z", None),
        "2026-10-21T20:15:00+00:00"
    );
    assert_eq!(
        next("America/New_York", "09:00", "2026-03-07T14:00:00Z", None),
        "2026-03-08T13:00:00+00:00"
    );
    assert_eq!(
        next("America/New_York", "09:00", "2026-10-31T13:00:00Z", None),
        "2026-11-01T14:00:00+00:00"
    );
}

#[test]
fn spring_gap_skips_the_occurrence_and_weekly_keeps_the_same_weekday() {
    assert_eq!(
        next("America/New_York", "02:30", "2026-03-08T00:00:00Z", None),
        "2026-03-09T06:30:00+00:00"
    );
    // The next Sunday is a gap. The old 8-day search incorrectly fell back
    // to Monday; searching the following week must find Sunday March 15.
    assert_eq!(
        next("America/New_York", "02:30", "2026-03-02T12:00:00Z", Some(0)),
        "2026-03-15T06:30:00+00:00"
    );
}

#[test]
fn autumn_fold_runs_only_the_first_occurrence_even_after_a_restart() {
    assert_eq!(
        next("America/New_York", "01:30", "2026-11-01T04:00:00Z", None),
        "2026-11-01T05:30:00+00:00"
    );
    for after in [
        "2026-11-01T05:30:00Z",
        "2026-11-01T06:00:00Z",
        "2026-11-01T06:30:00Z",
    ] {
        assert_eq!(
            next("America/New_York", "01:30", after, None),
            "2026-11-02T06:30:00+00:00"
        );
        assert_eq!(
            next("America/New_York", "01:30", after, Some(0)),
            "2026-11-08T06:30:00+00:00"
        );
    }
}

#[test]
fn half_hour_transitions_and_skipped_civil_days_are_supported() {
    assert_eq!(
        next("Australia/Lord_Howe", "02:15", "2026-10-03T12:00:00Z", None),
        "2026-10-04T15:15:00+00:00"
    );
    assert_eq!(
        next("Australia/Lord_Howe", "01:45", "2026-04-04T14:45:00Z", None),
        "2026-04-05T15:15:00+00:00"
    );
    assert_eq!(
        next("Pacific/Apia", "12:00", "2011-12-29T23:00:00Z", None),
        "2011-12-30T22:00:00+00:00"
    );
}

#[test]
fn invalid_zones_and_calendar_fields_never_fall_back_to_a_different_time() {
    assert_eq!(
        validate_time_zone(" Asia/Shanghai ").unwrap().as_deref(),
        Some("Asia/Shanghai")
    );
    assert_eq!(validate_time_zone("system").unwrap(), None);
    for zone in [
        "",
        "Asia/DoesNotExist",
        "UTC+08:00",
        "../etc/localtime",
        "/etc/localtime",
        "Etc/Unknown",
        "Asia/Shanghai\0",
    ] {
        assert!(validate_time_zone(zone).is_err(), "accepted {zone:?}");
    }
    let mut plan = schedule(std::path::Path::new("unused"));
    let now = "2026-10-21T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
    plan.time_zone = Some("Bad/Zone".to_string());
    assert!(schedule_next_run(&plan, now).is_err());
    plan.time_zone = Some("UTC".to_string());
    plan.interval_hours = 0;
    assert!(schedule_next_run(&plan, now).is_err());
    plan.frequency = SqliteBackupScheduleFrequency::Daily;
    plan.time_of_day = "25:99".to_string();
    assert!(schedule_next_run(&plan, now).is_err());
    plan.time_of_day = "02:00".to_string();
    plan.weekday = 7;
    assert!(schedule_next_run(&plan, now).is_err());
}

#[test]
fn hourly_intervals_use_elapsed_hours_across_zone_transitions() {
    let mut plan = schedule(std::path::Path::new("unused"));
    plan.interval_hours = 6;
    let after = "2026-03-08T04:00:00Z".parse::<DateTime<Utc>>().unwrap();
    for zone in ["UTC", "America/New_York", "Australia/Lord_Howe"] {
        plan.time_zone = Some(zone.to_string());
        assert_eq!(
            schedule_next_run(&plan, after).unwrap().to_rfc3339(),
            "2026-03-08T10:00:00+00:00"
        );
    }
}

#[test]
fn legacy_plans_follow_local_time_and_pausing_does_not_assign_a_new_zone() {
    let mut plan = schedule(std::path::Path::new("unused"));
    let mut json = serde_json::to_value(&plan).unwrap();
    json.as_object_mut().unwrap().remove("timeZone");
    plan = serde_json::from_value(json).unwrap();
    assert!(plan.time_zone.is_none());
    plan.frequency = SqliteBackupScheduleFrequency::Weekly;
    let after = "2026-10-21T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
    assert_eq!(
        schedule_next_run(&plan, after)
            .unwrap()
            .with_timezone(&Local)
            .weekday()
            .num_days_from_sunday(),
        u32::from(plan.weekday)
    );
    let mut request_json = serde_json::to_value(&plan).unwrap();
    request_json["enabled"] = false.into();
    let mut request: SaveSqliteBackupScheduleRequest =
        serde_json::from_value(request_json).unwrap();
    assert!(plan.is_pause_request(&request));
    request.time_zone = Some("system".to_string());
    assert!(plan.is_pause_request(&request));
    request.time_zone = Some("Asia/Shanghai".to_string());
    assert!(!plan.is_pause_request(&request));
    plan.time_zone = Some("Asia/Shanghai".to_string());
    assert!(plan.is_pause_request(&request));
    request.time_zone = None;
    assert!(plan.is_pause_request(&request));
    request.time_zone = Some("system".to_string());
    assert!(!plan.is_pause_request(&request));
}
