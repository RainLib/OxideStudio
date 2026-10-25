use duckdb::{
    arrow::{datatypes::DataType, temporal_conversions as temporal},
    types::TimeUnit,
};

pub(super) fn column_type(kind: &DataType) -> String {
    match kind {
        DataType::Boolean => "BOOLEAN".into(),
        DataType::Int8 => "TINYINT".into(),
        DataType::Int16 => "SMALLINT".into(),
        DataType::Int32 => "INTEGER".into(),
        DataType::Int64 => "BIGINT".into(),
        DataType::UInt8 => "UTINYINT".into(),
        DataType::UInt16 => "USMALLINT".into(),
        DataType::UInt32 => "UINTEGER".into(),
        DataType::UInt64 => "UBIGINT".into(),
        DataType::Float32 => "FLOAT".into(),
        DataType::Float64 => "DOUBLE".into(),
        DataType::Utf8 | DataType::LargeUtf8 => "VARCHAR".into(),
        DataType::Binary | DataType::LargeBinary => "BLOB".into(),
        DataType::Date32 | DataType::Date64 => "DATE".into(),
        DataType::Timestamp(_, zone) => if zone.is_some() {
            "TIMESTAMP WITH TIME ZONE"
        } else {
            "TIMESTAMP"
        }
        .into(),
        DataType::Time32(_) | DataType::Time64(_) => "TIME".into(),
        DataType::Decimal128(precision, scale) | DataType::Decimal256(precision, scale) => {
            format!("DECIMAL({precision},{scale})")
        }
        other => other.to_string(),
    }
}

pub(super) fn date(value: i32) -> String {
    match value {
        i32::MAX => "infinity".into(),
        value if value == -i32::MAX => "-infinity".into(),
        value => temporal::date32_to_datetime(value)
            .map(|date| date.date().to_string())
            .unwrap_or_else(|| format!("date32:{value}")),
    }
}

pub(super) fn timestamp(unit: TimeUnit, value: i64) -> String {
    if value == i64::MAX {
        return "infinity".into();
    }
    if value == -i64::MAX {
        return "-infinity".into();
    }
    let datetime = match unit {
        TimeUnit::Second => temporal::timestamp_s_to_datetime(value),
        TimeUnit::Millisecond => temporal::timestamp_ms_to_datetime(value),
        TimeUnit::Microsecond => temporal::timestamp_us_to_datetime(value),
        TimeUnit::Nanosecond => temporal::timestamp_ns_to_datetime(value),
    };
    datetime
        .map(|date| date.format("%Y-%m-%d %H:%M:%S%.f").to_string())
        .unwrap_or_else(|| format!("{unit:?}:{value}"))
}

pub(super) fn time(unit: TimeUnit, value: i64) -> String {
    let time = match unit {
        TimeUnit::Second => i32::try_from(value)
            .ok()
            .and_then(temporal::time32s_to_time),
        TimeUnit::Millisecond => i32::try_from(value)
            .ok()
            .and_then(temporal::time32ms_to_time),
        TimeUnit::Microsecond => temporal::time64us_to_time(value),
        TimeUnit::Nanosecond => temporal::time64ns_to_time(value),
    };
    time.map(|time| time.to_string())
        .unwrap_or_else(|| format!("{unit:?}:{value}"))
}

#[cfg(test)]
mod tests {
    use duckdb::Connection;
    use serde_json::json;

    #[test]
    fn result_values_preserve_large_integers_nonfinite_numbers_and_temporal_text() {
        let connection = Connection::open_in_memory().unwrap();
        let result = crate::query(&connection, "SELECT 9007199254740993::BIGINT AS id, 18446744073709551615::UBIGINT AS unsigned_id, DATE '2026-10-22' AS date_value, TIMESTAMP '2026-10-22 12:34:56.123456' AS timestamp_value, TIME '12:34:56.123456' AS time_value, 'NaN'::DOUBLE AS nan_value, 'Infinity'::DOUBLE AS infinity_value", &[]).unwrap();
        assert_eq!(
            result[0].rows,
            vec![vec![
                json!("9007199254740993"),
                json!("18446744073709551615"),
                json!("2026-10-22"),
                json!("2026-10-22 12:34:56.123456"),
                json!("12:34:56.123456"),
                json!("NaN"),
                json!("inf")
            ]]
        );
        assert_eq!(result[0].columns[0].data_type, "BIGINT");
        assert_eq!(result[0].columns[2].data_type, "DATE");
    }

    #[test]
    fn infinite_dates_and_timestamps_keep_the_engine_values() {
        let connection = Connection::open_in_memory().unwrap();
        let result = crate::query(
            &connection,
            "SELECT DATE 'infinity', DATE '-infinity', TIMESTAMP 'infinity', TIMESTAMP '-infinity'",
            &[],
        )
        .unwrap();
        assert_eq!(
            result[0].rows,
            vec![vec![
                json!("infinity"),
                json!("-infinity"),
                json!("infinity"),
                json!("-infinity")
            ]]
        );
    }
}
