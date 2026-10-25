use super::validate_capability_contract;
use crate::core::dialect::{
    database_capabilities_for_driver, DatabaseCapabilities, DatabaseConnectionMode,
};

#[test]
fn signed_file_query_formats_do_not_follow_query_or_legacy_capabilities() {
    let mut caps = database_capabilities_for_driver("sqlite").unwrap();
    let mut legacy = serde_json::to_value(&caps).unwrap();
    legacy.as_object_mut().unwrap().remove("fileQueryFormats");
    assert!(serde_json::from_value::<DatabaseCapabilities>(legacy)
        .unwrap()
        .file_query_formats
        .is_empty());
    caps.file_query_formats = vec![
        "csv".into(),
        "json".into(),
        "jsonl".into(),
        "parquet".into(),
    ];
    validate_capability_contract("sqlite", &caps).unwrap();
    for formats in [
        vec!["csv", "csv"],
        vec!["CSV"],
        vec!["sqlite"],
        vec![" csv"],
    ] {
        let mut invalid = caps.clone();
        invalid.file_query_formats = formats.into_iter().map(str::to_string).collect();
        assert!(validate_capability_contract("sqlite", &invalid).is_err());
    }
    caps.connection_mode = DatabaseConnectionMode::Network;
    assert!(validate_capability_contract("sqlite", &caps).is_err());
    caps.connection_mode = DatabaseConnectionMode::File;
    caps.supports_sql_query = false;
    assert!(validate_capability_contract("sqlite", &caps).is_err());
}
