use crate::core::protocol::QueryParameter;
use anyhow::{anyhow, Result};
use sqlx::mysql::types::MySqlTime;
use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::query::Query;
use sqlx::types::chrono::{NaiveDate, NaiveDateTime};
use sqlx::types::BigDecimal;
use sqlx::{Column, MySql, Row, TypeInfo};

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
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("\\x"))
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
    serde_json::Value::String(format!("0x{}", hex_encode(bytes)))
}

pub(super) fn mysql_fallback_value(
    row: &MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    if let Ok(value) = row.try_get_unchecked::<String, _>(index) {
        return serde_json::Value::String(value);
    }
    if let Ok(value) = row.try_get_unchecked::<Vec<u8>, _>(index) {
        return binary_json(&value);
    }

    serde_json::Value::String(format!("<unreadable MySQL {type_name} value>"))
}

pub(super) fn decode_mysql_value(row: &MySqlRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_name = col.type_info().name();

    macro_rules! decode {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<Option<$ty>, _>(index)
                .map(|value| value.map($map).unwrap_or(serde_json::Value::Null))
                .unwrap_or_else(|_| mysql_fallback_value(row, index, type_name))
        };
    }

    match type_name {
        "BOOLEAN" | "BOOL" => decode!(bool, serde_json::Value::Bool),
        "TINYINT" => decode!(i8, |value| json_i64(i64::from(value))),
        "TINYINT UNSIGNED" => decode!(u8, |value| json_u64(u64::from(value))),
        "SMALLINT" => decode!(i16, |value| json_i64(i64::from(value))),
        "SMALLINT UNSIGNED" => decode!(u16, |value| json_u64(u64::from(value))),
        "INT" | "INTEGER" | "MEDIUMINT" => {
            decode!(i32, |value| json_i64(i64::from(value)))
        }
        "INT UNSIGNED" | "INTEGER UNSIGNED" | "MEDIUMINT UNSIGNED" => {
            decode!(u32, |value| json_u64(u64::from(value)))
        }
        "BIGINT" => decode!(i64, json_i64),
        "BIGINT UNSIGNED" => decode!(u64, json_u64),
        "YEAR" => decode!(u16, |value| json_u64(u64::from(value))),
        "BIT" => decode!(u64, json_u64),
        "FLOAT" => decode!(f32, json_f32),
        "DOUBLE" => decode!(f64, json_f64),
        "DECIMAL" => decode!(BigDecimal, |value| serde_json::Value::String(
            value.to_string()
        )),
        "VARCHAR" | "CHAR" | "TEXT" | "LONGTEXT" | "MEDIUMTEXT" | "TINYTEXT" | "ENUM" | "SET" => {
            decode!(String, serde_json::Value::String)
        }
        "JSON" => decode!(serde_json::Value, |value| value),
        "DATE" => decode!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP" | "DATETIME" => decode!(NaiveDateTime, |value| {
            serde_json::Value::String(value.to_string())
        }),
        "TIME" => decode!(MySqlTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "GEOMETRY" => {
            decode!(Vec<u8>, |value| binary_json(&value))
        }
        "NULL" => serde_json::Value::Null,
        _ => mysql_fallback_value(row, index, type_name),
    }
}

pub(super) fn is_mysql_binary_type(data_type: Option<&str>) -> bool {
    let Some(data_type) = data_type else {
        return false;
    };
    let normalized = data_type.to_ascii_lowercase();
    let base_type = normalized
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('(')
        .next()
        .unwrap_or("")
        .trim();
    matches!(
        base_type,
        "binary" | "varbinary" | "tinyblob" | "blob" | "mediumblob" | "longblob"
    )
}

pub(super) fn binary_parameter_bytes(value: &serde_json::Value) -> Result<Vec<u8>> {
    match value {
        serde_json::Value::String(value) if value.starts_with("0x") || value.starts_with("\\x") => {
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

pub(super) fn is_mysql_unsigned_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .split_whitespace()
            .any(|part| part.eq_ignore_ascii_case("unsigned"))
    })
}

pub(super) fn is_mysql_bit_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .trim()
            .split('(')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case("bit")
    })
}

pub(super) fn bind_mysql_parameter<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    param: &QueryParameter,
) -> Result<Query<'q, MySql, MySqlArguments>> {
    if param.value.is_null() {
        return Ok(query.bind(Option::<String>::None));
    }
    if is_mysql_binary_type(param.data_type.as_deref()) {
        return Ok(query.bind(binary_parameter_bytes(&param.value)?));
    }
    if is_mysql_bit_type(param.data_type.as_deref()) {
        let value = match &param.value {
            serde_json::Value::Number(value) => value.as_u64(),
            serde_json::Value::String(value) => value.parse::<u64>().ok(),
            _ => None,
        }
        .ok_or_else(|| anyhow!("MySQL BIT parameters must be unsigned integers"))?;
        return Ok(query.bind(value));
    }

    Ok(match &param.value {
        serde_json::Value::Null => unreachable!("NULL parameters return above"),
        serde_json::Value::Bool(value) => query.bind(*value),
        serde_json::Value::Number(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if is_mysql_unsigned_type(param.data_type.as_deref()) {
                    if let Some(value) = value.as_u64() {
                        query.bind(value)
                    } else {
                        query.bind(value.to_string())
                    }
                } else if let Some(value) = value.as_i64() {
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
        serde_json::Value::String(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if is_mysql_unsigned_type(param.data_type.as_deref()) {
                    if let Ok(value) = value.parse::<u64>() {
                        query.bind(value)
                    } else {
                        query.bind(value.clone())
                    }
                } else if let Ok(value) = value.parse::<i64>() {
                    query.bind(value)
                } else {
                    query.bind(value.clone())
                }
            } else {
                query.bind(value.clone())
            }
        }
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
    let base_type = normalized
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('(')
        .next()
        .unwrap_or("")
        .trim();
    matches!(
        base_type,
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "serial"
    )
}
