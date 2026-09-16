use crate::core::protocol::QueryParameter;
use anyhow::{anyhow, Result};
use sqlx::postgres::types::{Oid, PgInterval, PgTimeTz};
use sqlx::postgres::{PgArguments, PgRow, PgTypeInfo, PgTypeKind, PgValueFormat};
use sqlx::query::Query;
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Postgres, Row, TypeInfo, ValueRef};

pub(super) const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

pub(super) fn json_i64(value: i64) -> serde_json::Value {
    if (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&value) {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

pub(super) fn json_u64(value: u64) -> serde_json::Value {
    if value <= JS_SAFE_INTEGER_MAX as u64 {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

pub(super) fn non_finite_float_text(value: f64) -> &'static str {
    if value.is_nan() {
        "NaN"
    } else if value.is_sign_positive() {
        "Infinity"
    } else {
        "-Infinity"
    }
}

pub(super) fn json_f32(value: f32) -> serde_json::Value {
    if value.is_finite() {
        value
            .to_string()
            .parse::<serde_json::Number>()
            .map(serde_json::Value::Number)
            .expect("finite f32 values always have a valid JSON representation")
    } else {
        serde_json::Value::String(non_finite_float_text(f64::from(value)).into())
    }
}

pub(super) fn json_f64(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or_else(|| serde_json::Value::String(non_finite_float_text(value).into()))
}

pub(super) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

pub(super) fn hex_decode(value: &str) -> Result<Vec<u8>> {
    let value = value
        .strip_prefix("\\x")
        .or_else(|| value.strip_prefix("0x"))
        .unwrap_or(value);
    if !value.len().is_multiple_of(2) {
        return Err(anyhow!(
            "Hex-encoded binary values must contain an even number of digits"
        ));
    }

    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).expect("hex pairs are always UTF-8");
            u8::from_str_radix(pair, 16)
                .map_err(|_| anyhow!("Invalid hex byte in binary value: {pair}"))
        })
        .collect()
}

pub(super) fn binary_json(bytes: &[u8]) -> serde_json::Value {
    serde_json::Value::String(format!("\\x{}", hex_encode(bytes)))
}

pub(super) fn pg_effective_type_name(type_info: &PgTypeInfo) -> String {
    match type_info.kind() {
        PgTypeKind::Domain(base) => pg_effective_type_name(base),
        PgTypeKind::Array(element) => format!("{}[]", pg_effective_type_name(element)),
        _ => type_info.name().to_ascii_uppercase(),
    }
}

pub(super) fn pg_type_is_enum(type_info: &PgTypeInfo) -> bool {
    match type_info.kind() {
        PgTypeKind::Enum(_) => true,
        PgTypeKind::Domain(base) => pg_type_is_enum(base),
        _ => false,
    }
}

pub(super) fn pg_array_element_is_enum(type_info: &PgTypeInfo) -> bool {
    match type_info.kind() {
        PgTypeKind::Array(element) => pg_type_is_enum(element),
        PgTypeKind::Domain(base) => pg_array_element_is_enum(base),
        _ => false,
    }
}

pub(super) fn pg_interval_text(value: PgInterval) -> String {
    format!(
        "{} mons {} days {} microseconds",
        value.months, value.days, value.microseconds
    )
}

pub(super) fn pg_timetz_text(value: PgTimeTz) -> String {
    format!("{}{}", value.time, value.offset)
}

pub(super) fn optional_values_to_json<T>(
    values: Vec<Option<T>>,
    map: impl Fn(T) -> serde_json::Value,
) -> serde_json::Value {
    serde_json::Value::Array(
        values
            .into_iter()
            .map(|value| value.map(&map).unwrap_or(serde_json::Value::Null))
            .collect(),
    )
}

pub(super) fn pg_numeric_scale(bytes: &[u8]) -> Option<i64> {
    let scale = u16::from_be_bytes([*bytes.get(6)?, *bytes.get(7)?]);
    Some(i64::from(scale))
}

pub(super) fn pg_numeric_array_scales(row: &PgRow, index: usize) -> Vec<Option<i64>> {
    let Ok(raw) = row.try_get_raw(index) else {
        return Vec::new();
    };
    if raw.format() != PgValueFormat::Binary {
        return Vec::new();
    }
    let Ok(bytes) = raw.as_bytes() else {
        return Vec::new();
    };
    let Some(ndim_bytes) = bytes.get(0..4) else {
        return Vec::new();
    };
    let ndim = i32::from_be_bytes(ndim_bytes.try_into().expect("four-byte slice"));
    let Ok(ndim) = usize::try_from(ndim) else {
        return Vec::new();
    };
    let Some(mut offset) = 12usize.checked_add(ndim.saturating_mul(8)) else {
        return Vec::new();
    };
    if offset > bytes.len() {
        return Vec::new();
    }

    let mut scales = Vec::new();
    while let Some(length_bytes) = bytes.get(offset..offset + 4) {
        let length = i32::from_be_bytes(length_bytes.try_into().expect("four-byte slice"));
        offset += 4;
        if length == -1 {
            scales.push(None);
            continue;
        }
        let Ok(length) = usize::try_from(length) else {
            return Vec::new();
        };
        let Some(end) = offset.checked_add(length) else {
            return Vec::new();
        };
        let Some(value) = bytes.get(offset..end) else {
            return Vec::new();
        };
        scales.push(pg_numeric_scale(value));
        offset = end;
    }
    scales
}

pub(super) fn pg_numeric_text(value: BigDecimal, scale: Option<i64>) -> serde_json::Value {
    let value = scale.map_or(value.clone(), |scale| value.with_scale(scale));
    serde_json::Value::String(value.to_plain_string())
}

pub(super) fn pg_fallback_value(
    row: &PgRow,
    index: usize,
    type_info: &PgTypeInfo,
) -> serde_json::Value {
    let Ok(raw) = row.try_get_raw(index) else {
        return serde_json::Value::String(format!(
            "<unreadable PostgreSQL {} value>",
            type_info.name()
        ));
    };
    if raw.is_null() {
        return serde_json::Value::Null;
    }

    if raw.format() == PgValueFormat::Text || pg_type_is_enum(type_info) {
        if let Ok(value) = raw.as_str() {
            return serde_json::Value::String(value.to_string());
        }
    }

    raw.as_bytes().map(binary_json).unwrap_or_else(|_| {
        serde_json::Value::String(format!(
            "<unreadable PostgreSQL {} value>",
            type_info.name()
        ))
    })
}

pub(super) fn decode_pg_value(row: &PgRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_info = col.type_info();
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(false)
    {
        return serde_json::Value::Null;
    }

    macro_rules! decode {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<$ty, _>(index)
                .map($map)
                .unwrap_or_else(|_| pg_fallback_value(row, index, type_info))
        };
    }

    macro_rules! decode_array {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<Vec<Option<$ty>>, _>(index)
                .map(|values| optional_values_to_json(values, $map))
                .unwrap_or_else(|_| pg_fallback_value(row, index, type_info))
        };
    }

    match pg_effective_type_name(type_info).as_str() {
        "BOOL" => decode!(bool, serde_json::Value::Bool),
        "CHAR" => decode!(i8, |value| json_i64(i64::from(value))),
        "INT2" => decode!(i16, |value| json_i64(i64::from(value))),
        "INT4" => decode!(i32, |value| json_i64(i64::from(value))),
        "INT8" => decode!(i64, json_i64),
        "OID" => decode!(Oid, |value| json_u64(u64::from(value.0))),
        "XID" | "CID" => decode!(i32, |value| json_u64(u64::from(value as u32))),
        "FLOAT4" => decode!(f32, json_f32),
        "FLOAT8" => decode!(f64, json_f64),
        "NUMERIC" => {
            let scale = row
                .try_get_raw(index)
                .ok()
                .filter(|raw| raw.format() == PgValueFormat::Binary)
                .and_then(|raw| raw.as_bytes().ok())
                .and_then(pg_numeric_scale);
            decode!(BigDecimal, |value| pg_numeric_text(value, scale))
        }
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "UNKNOWN" | "CITEXT" | "XML" => {
            decode!(String, serde_json::Value::String)
        }
        "JSON" | "JSONB" => decode!(serde_json::Value, |value| value),
        "UUID" => decode!(Uuid, |value| serde_json::Value::String(value.to_string())),
        "DATE" => decode!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIME" => decode!(NaiveTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP" => decode!(NaiveDateTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMPTZ" => decode!(DateTime<Utc>, |value| serde_json::Value::String(
            value.to_rfc3339()
        )),
        "TIMETZ" => decode!(PgTimeTz, |value| serde_json::Value::String(pg_timetz_text(
            value
        ))),
        "INTERVAL" => decode!(PgInterval, |value| serde_json::Value::String(
            pg_interval_text(value)
        )),
        "BYTEA" => decode!(Vec<u8>, |value| binary_json(&value)),
        "BOOL[]" => decode_array!(bool, serde_json::Value::Bool),
        "CHAR[]" => decode_array!(i8, |value| json_i64(i64::from(value))),
        "INT2[]" => decode_array!(i16, |value| json_i64(i64::from(value))),
        "INT4[]" => decode_array!(i32, |value| json_i64(i64::from(value))),
        "INT8[]" => decode_array!(i64, json_i64),
        "OID[]" => decode_array!(Oid, |value| json_u64(u64::from(value.0))),
        "XID[]" | "CID[]" => {
            decode_array!(i32, |value| json_u64(u64::from(value as u32)))
        }
        "FLOAT4[]" => decode_array!(f32, json_f32),
        "FLOAT8[]" => decode_array!(f64, json_f64),
        "NUMERIC[]" => row
            .try_get_unchecked::<Vec<Option<BigDecimal>>, _>(index)
            .map(|values| {
                let scales = pg_numeric_array_scales(row, index);
                serde_json::Value::Array(
                    values
                        .into_iter()
                        .enumerate()
                        .map(|(index, value)| {
                            value
                                .map(|value| {
                                    pg_numeric_text(value, scales.get(index).copied().flatten())
                                })
                                .unwrap_or(serde_json::Value::Null)
                        })
                        .collect(),
                )
            })
            .unwrap_or_else(|_| pg_fallback_value(row, index, type_info)),
        "TEXT[]" | "VARCHAR[]" | "BPCHAR[]" | "NAME[]" | "CITEXT[]" | "XML[]" => {
            decode_array!(String, serde_json::Value::String)
        }
        "JSON[]" | "JSONB[]" => decode_array!(serde_json::Value, |value| value),
        "UUID[]" => decode_array!(Uuid, |value| serde_json::Value::String(value.to_string())),
        "DATE[]" => decode_array!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIME[]" => decode_array!(NaiveTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP[]" => decode_array!(NaiveDateTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMPTZ[]" => decode_array!(DateTime<Utc>, |value| serde_json::Value::String(
            value.to_rfc3339()
        )),
        "TIMETZ[]" => decode_array!(PgTimeTz, |value| serde_json::Value::String(pg_timetz_text(
            value
        ))),
        "INTERVAL[]" => decode_array!(PgInterval, |value| serde_json::Value::String(
            pg_interval_text(value)
        )),
        "BYTEA[]" => decode_array!(Vec<u8>, |value| binary_json(&value)),
        _ if pg_type_is_enum(type_info) => {
            decode!(String, serde_json::Value::String)
        }
        _ if pg_array_element_is_enum(type_info) => {
            decode_array!(String, serde_json::Value::String)
        }
        _ => pg_fallback_value(row, index, type_info),
    }
}

pub(super) fn pg_array_element_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Array(values) => format!(
            "{{{}}}",
            values
                .iter()
                .map(pg_array_element_literal)
                .collect::<Vec<_>>()
                .join(",")
        ),
        serde_json::Value::String(value) => {
            format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
        }
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::Object(_) => {
            let value = serde_json::to_string(value).unwrap_or_default();
            format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
        }
    }
}

pub(super) fn pg_array_literal(value: &serde_json::Value) -> Result<String> {
    let parsed;
    let values = match value {
        serde_json::Value::Array(values) => values,
        serde_json::Value::String(value) if value.trim_start().starts_with('[') => {
            parsed = serde_json::from_str::<serde_json::Value>(value)
                .map_err(|error| anyhow!("Invalid JSON array value: {error}"))?;
            parsed
                .as_array()
                .ok_or_else(|| anyhow!("Expected a JSON array value"))?
        }
        serde_json::Value::String(value) if value.trim_start().starts_with('{') => {
            return Ok(value.clone());
        }
        _ => return Err(anyhow!("PostgreSQL array values must be JSON arrays")),
    };

    Ok(format!(
        "{{{}}}",
        values
            .iter()
            .map(pg_array_element_literal)
            .collect::<Vec<_>>()
            .join(",")
    ))
}

pub(super) fn is_pg_array_type(data_type: Option<&str>) -> bool {
    data_type
        .map(str::trim)
        .is_some_and(|data_type| data_type.ends_with("[]"))
}

pub(super) fn is_pg_binary_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .trim()
            .split('(')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case("bytea")
    })
}

pub(super) fn binary_parameter_bytes(value: &serde_json::Value) -> Result<Vec<u8>> {
    match value {
        serde_json::Value::String(value) if value.starts_with("\\x") || value.starts_with("0x") => {
            hex_decode(value)
        }
        serde_json::Value::String(value) => Ok(value.as_bytes().to_vec()),
        serde_json::Value::Array(values) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or_else(|| anyhow!("Binary byte arrays may only contain integers 0..255"))
            })
            .collect(),
        _ => Err(anyhow!(
            "Binary parameters must be hex strings, text, or byte arrays"
        )),
    }
}

pub(super) fn bind_pg_parameter<'q>(
    query: Query<'q, Postgres, PgArguments>,
    param: &QueryParameter,
) -> Result<Query<'q, Postgres, PgArguments>> {
    if param.value.is_null() {
        return Ok(query.bind(Option::<String>::None));
    }
    if is_pg_array_type(param.data_type.as_deref()) {
        return Ok(query.bind(pg_array_literal(&param.value)?));
    }
    if is_pg_binary_type(param.data_type.as_deref()) {
        return Ok(query.bind(binary_parameter_bytes(&param.value)?));
    }

    Ok(match &param.value {
        serde_json::Value::Null => unreachable!("NULL parameters return above"),
        serde_json::Value::Bool(value) => query.bind(*value),
        serde_json::Value::Number(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) =
                    value.as_u64().and_then(|value| i64::try_from(value).ok())
                {
                    query.bind(value)
                } else {
                    query.bind(value.to_string())
                }
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        serde_json::Value::String(value) => query.bind(value.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            query.bind(serde_json::to_string(&param.value)?)
        }
    })
}

pub(super) fn is_integral_type(data_type: Option<&str>) -> bool {
    let Some(data_type) = data_type else {
        return false;
    };
    let normalized = data_type.to_ascii_lowercase();
    let base_type = normalized.split('(').next().unwrap_or("").trim();
    matches!(
        base_type,
        "smallint"
            | "integer"
            | "int"
            | "int2"
            | "int4"
            | "bigint"
            | "int8"
            | "serial"
            | "bigserial"
    )
}
