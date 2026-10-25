//! XLSX scalar/header semantics; formula expressions are never evaluated.
use super::limits::XLSX_MAX_CELL_CHARS;
use calamine::{Data, ExcelDateTime, ExcelDateTimeType};
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn xlsx_cell_value(cell: &Data) -> Value {
    match cell {
        Data::Empty => Value::Null,
        Data::Int(value) => (*value).into(),
        Data::Float(value) => serde_json::Number::from_f64(*value)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.to_string())),
        Data::String(value) | Data::DateTimeIso(value) | Data::DurationIso(value) => {
            Value::String(value.clone())
        }
        Data::Bool(value) => (*value).into(),
        Data::DateTime(value) => Value::String(value.to_string()),
        Data::Error(value) => Value::String(format!("Excel cell error: {value}")),
    }
}
pub(super) fn validate_xlsx_headers(headers: &[String]) -> Result<(), String> {
    if headers.is_empty() {
        return Err("The XLSX worksheet does not contain a header row".into());
    }
    let mut seen = HashSet::new();
    for header in headers {
        if header.trim().is_empty() {
            return Err("XLSX column names must not be empty".into());
        }
        if !seen.insert(header.trim().to_ascii_lowercase()) {
            return Err("XLSX column names must be unique".into());
        }
    }
    Ok(())
}
pub(super) fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > XLSX_MAX_CELL_CHARS * 4 || text.chars().count() > XLSX_MAX_CELL_CHARS {
        return Err("XLSX cell text exceeds 32,767 characters".into());
    }
    Ok(())
}
pub(super) fn scalar(
    kind: &str,
    raw: Option<&str>,
    date: bool,
    date1904: bool,
) -> Result<Value, String> {
    let Some(raw) = raw else {
        return Ok(Value::Null);
    };
    validate_text(raw)?;
    match kind {
        "inlineStr" | "str" | "d" => Ok(Value::String(raw.to_owned())),
        "b" => match raw {
            "1" | "true" => Ok(Value::Bool(true)),
            "0" | "false" => Ok(Value::Bool(false)),
            _ => Err("Invalid XLSX boolean cell".into()),
        },
        "e" => {
            let error = raw
                .parse::<calamine::CellErrorType>()
                .map_err(|e| e.to_string())?;
            Ok(xlsx_cell_value(&Data::Error(error)))
        }
        "n" | "" => {
            if raw.is_empty() {
                return Ok(Value::Null);
            }
            if date {
                let number = raw.parse::<f64>().map_err(|_| "Invalid XLSX date serial")?;
                if !number.is_finite() {
                    return Err("Invalid XLSX date serial".into());
                }
                return Ok(xlsx_cell_value(&Data::DateTime(ExcelDateTime::new(
                    number,
                    ExcelDateTimeType::DateTime,
                    date1904,
                ))));
            }
            // Preserve integers as encoded in the XML instead of routing them
            // through f64; Excel's own prior rounding cannot be reconstructed.
            if let Ok(number) = raw.parse::<serde_json::Number>() {
                return Ok(Value::Number(number));
            }
            if kind.is_empty() {
                Ok(Value::String(raw.to_owned()))
            } else {
                Err("Invalid XLSX numeric cell".into())
            }
        }
        _ => Err("Unsupported XLSX cell type".into()),
    }
}
/// Excel's first number-format section, ignoring quoted/escaped literals and
/// bracketed conditions/locale/color annotations. Elapsed [h]/[m]/[s] is temporal.
pub(super) fn date_format(format: &str) -> bool {
    let mut chars = format.chars().peekable();
    let mut quote = false;
    while let Some(ch) = chars.next() {
        if quote {
            if ch == '"' {
                quote = false;
            }
            continue;
        }
        match ch {
            '"' => quote = true,
            '\\' | '_' | '*' => {
                chars.next();
            }
            ';' => return false,
            '[' => {
                let mut bracket = String::new();
                for inner in chars.by_ref() {
                    if inner == ']' {
                        break;
                    }
                    bracket.push(inner);
                }
                if !bracket.is_empty()
                    && bracket
                        .chars()
                        .all(|c| c.eq_ignore_ascii_case(&bracket.chars().next().unwrap()))
                    && matches!(
                        bracket.chars().next().unwrap().to_ascii_lowercase(),
                        'h' | 'm' | 's'
                    )
                {
                    return true;
                }
            }
            'd' | 'D' | 'm' | 'M' | 'h' | 'H' | 'y' | 'Y' | 's' | 'S' => return true,
            _ => {}
        }
    }
    false
}
