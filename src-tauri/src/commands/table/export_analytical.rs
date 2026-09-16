//! Export analytical for table operations.

use super::export_types::{TableExportFormat, TableExportTypeCoercion};
use super::limits::{PARQUET_MAX_ROW_GROUP_BYTES, PARQUET_MAX_ROW_GROUP_ROWS};
use crate::core::protocol::ColumnDef;
use arrow_array::builder::BinaryBuilder;
use arrow_array::ArrayRef;
use arrow_array::BooleanArray;
use arrow_array::Date32Array;
use arrow_array::Float64Array;
use arrow_array::Int64Array;
use arrow_array::RecordBatch;
use arrow_array::StringArray;
use arrow_array::TimestampMicrosecondArray;
use arrow_array::UInt64Array;
use arrow_ipc::writer::FileWriter as ArrowIpcFileWriter;
use arrow_schema::DataType as ArrowDataType;
use arrow_schema::Field as ArrowField;
use arrow_schema::Schema as ArrowSchema;
use arrow_schema::TimeUnit;
use chrono::DateTime;
use chrono::NaiveDate;
use chrono::NaiveDateTime;
use chrono::Utc;
use parquet::arrow::ArrowWriter as ParquetArrowWriter;
use parquet::basic::Compression as ParquetCompression;
use parquet::file::properties::WriterProperties;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AnalyticalTypePolicy {
    Native,
    SqliteDynamic,
    DuckDb,
    ExternalText,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum AnalyticalColumnKind {
    Boolean,
    Date32,
    Float64,
    Int64,
    TimestampMicrosecond { utc: bool },
    UInt64,
    Binary,
    Utf8,
}

pub(super) struct AnalyticalExportPlan {
    pub(super) schema: Arc<ArrowSchema>,
    pub(super) columns: Vec<ColumnDef>,
    pub(super) kinds: Vec<AnalyticalColumnKind>,
    pub(super) type_coercions: Vec<TableExportTypeCoercion>,
}

impl AnalyticalExportPlan {
    pub(super) fn new(type_policy: AnalyticalTypePolicy, columns: Vec<ColumnDef>) -> Self {
        let mut fields = Vec::with_capacity(columns.len());
        let mut kinds = Vec::with_capacity(columns.len());
        let mut type_coercions = Vec::new();
        for column in &columns {
            let (kind, output_type, coercion_reason) =
                analytical_column_kind(type_policy, &column.data_type);
            let mut metadata = HashMap::new();
            metadata.insert("oxide.sourceDataType".to_string(), column.data_type.clone());
            metadata.insert(
                "oxide.exportRepresentation".to_string(),
                output_type.to_string(),
            );
            fields.push(
                ArrowField::new(&column.name, analytical_arrow_data_type(&kind), true)
                    .with_metadata(metadata),
            );
            if let Some(reason) = coercion_reason {
                type_coercions.push(TableExportTypeCoercion {
                    column: column.name.clone(),
                    source_type: column.data_type.clone(),
                    output_type: output_type.to_string(),
                    reason: reason.to_string(),
                });
            }
            kinds.push(kind);
        }
        Self {
            schema: Arc::new(ArrowSchema::new(fields)),
            columns,
            kinds,
            type_coercions,
        }
    }

    pub(super) fn record_batch(&self, rows: &[Vec<Value>]) -> Result<RecordBatch, String> {
        if let Some((row_index, row)) = rows
            .iter()
            .enumerate()
            .find(|(_, row)| row.len() != self.columns.len())
        {
            return Err(format!(
                "Cannot encode analytical export row {}: expected {} columns but received {}; no row value was included in this error",
                row_index + 1,
                self.columns.len(),
                row.len()
            ));
        }
        let mut arrays = Vec::<ArrayRef>::with_capacity(self.columns.len());
        for (column_index, (column, kind)) in self.columns.iter().zip(self.kinds.iter()).enumerate()
        {
            let array: ArrayRef = match kind {
                AnalyticalColumnKind::Boolean => Arc::new(BooleanArray::from(
                    rows.iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_bool(analytical_value_at(row, column_index))
                                .map_err(|_| analytical_value_error(row_index, column, "Boolean"))
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )),
                AnalyticalColumnKind::Date32 => Arc::new(Date32Array::from(
                    rows.iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_date32(analytical_value_at(row, column_index))
                                .map_err(|_| analytical_value_error(row_index, column, "Date32"))
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )),
                AnalyticalColumnKind::Float64 => Arc::new(Float64Array::from(
                    rows.iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_f64(analytical_value_at(row, column_index))
                                .map_err(|_| analytical_value_error(row_index, column, "Float64"))
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )),
                AnalyticalColumnKind::Int64 => Arc::new(Int64Array::from(
                    rows.iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_i64(analytical_value_at(row, column_index))
                                .map_err(|_| analytical_value_error(row_index, column, "Int64"))
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )),
                AnalyticalColumnKind::TimestampMicrosecond { utc } => {
                    let values = rows
                        .iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_timestamp_micros(
                                analytical_value_at(row, column_index),
                                *utc,
                            )
                            .map_err(|_| {
                                analytical_value_error(row_index, column, "Timestamp(Microsecond)")
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let array = TimestampMicrosecondArray::from(values);
                    if *utc {
                        Arc::new(array.with_timezone("UTC"))
                    } else {
                        Arc::new(array)
                    }
                }
                AnalyticalColumnKind::UInt64 => Arc::new(UInt64Array::from(
                    rows.iter()
                        .enumerate()
                        .map(|(row_index, row)| {
                            analytical_u64(analytical_value_at(row, column_index))
                                .map_err(|_| analytical_value_error(row_index, column, "UInt64"))
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                )),
                AnalyticalColumnKind::Binary => {
                    let mut builder = BinaryBuilder::new();
                    for (row_index, row) in rows.iter().enumerate() {
                        match analytical_binary(analytical_value_at(row, column_index)) {
                            Ok(Some(value)) => builder.append_value(value),
                            Ok(None) => builder.append_null(),
                            Err(()) => {
                                return Err(analytical_value_error(row_index, column, "Binary"))
                            }
                        }
                    }
                    Arc::new(builder.finish())
                }
                AnalyticalColumnKind::Utf8 => Arc::new(StringArray::from(
                    rows.iter()
                        .map(|row| analytical_utf8(analytical_value_at(row, column_index)))
                        .collect::<Vec<_>>(),
                )),
            };
            arrays.push(array);
        }
        RecordBatch::try_new(Arc::clone(&self.schema), arrays)
            .map_err(|error| format!("Could not build analytical export batch: {error}"))
    }
}

pub(super) enum AnalyticalExportWriter {
    Arrow(ArrowIpcFileWriter<File>),
    Parquet(ParquetArrowWriter<File>),
}

impl AnalyticalExportWriter {
    pub(super) fn new(
        format: TableExportFormat,
        file: File,
        schema: Arc<ArrowSchema>,
    ) -> Result<Self, String> {
        match format {
            TableExportFormat::Arrow => ArrowIpcFileWriter::try_new(file, schema.as_ref())
                .map(Self::Arrow)
                .map_err(|error| format!("Could not initialize Arrow IPC export: {error}")),
            TableExportFormat::Parquet => {
                let properties = WriterProperties::builder()
                    .set_compression(ParquetCompression::SNAPPY)
                    .set_max_row_group_row_count(Some(PARQUET_MAX_ROW_GROUP_ROWS))
                    .set_max_row_group_bytes(Some(PARQUET_MAX_ROW_GROUP_BYTES))
                    .build();
                ParquetArrowWriter::try_new(file, schema, Some(properties))
                    .map(Self::Parquet)
                    .map_err(|error| format!("Could not initialize Parquet export: {error}"))
            }
            _ => Err("Analytical writer requires Arrow or Parquet format".to_string()),
        }
    }

    pub(super) fn write(&mut self, batch: &RecordBatch) -> Result<(), String> {
        match self {
            Self::Arrow(writer) => writer
                .write(batch)
                .map_err(|error| format!("Could not write Arrow IPC batch: {error}")),
            Self::Parquet(writer) => writer
                .write(batch)
                .map_err(|error| format!("Could not write Parquet batch: {error}")),
        }
    }

    pub(super) fn finish(self) -> Result<(), String> {
        let file = match self {
            Self::Arrow(writer) => writer
                .into_inner()
                .map_err(|error| format!("Could not finalize Arrow IPC export: {error}"))?,
            Self::Parquet(writer) => writer
                .into_inner()
                .map_err(|error| format!("Could not finalize Parquet export: {error}"))?,
        };
        file.sync_all().map_err(|error| error.to_string())
    }
}

pub(super) fn analytical_column_kind(
    type_policy: AnalyticalTypePolicy,
    source_type: &str,
) -> (AnalyticalColumnKind, &'static str, Option<&'static str>) {
    if matches!(type_policy, AnalyticalTypePolicy::SqliteDynamic) {
        return (
            AnalyticalColumnKind::Utf8,
            "Utf8",
            Some("SQLite permits mixed storage classes within a declared column; the exact textual/JSON representation is retained with source-type metadata."),
        );
    }
    if matches!(type_policy, AnalyticalTypePolicy::ExternalText) {
        return (
            AnalyticalColumnKind::Utf8,
            "Utf8",
            Some("The external driver has no signed canonical analytical value mapping; the exact textual/JSON representation is retained with source-type metadata."),
        );
    }
    let normalized = source_type.trim().to_ascii_uppercase();
    let base = normalized
        .split_once('(')
        .map_or(normalized.as_str(), |(base, _)| base)
        .trim();
    let unsigned_base = base.strip_suffix(" UNSIGNED").unwrap_or(base).trim();
    if matches!(base, "BOOL" | "BOOLEAN") {
        return (AnalyticalColumnKind::Boolean, "Boolean", None);
    }
    if base == "DATE" {
        return (AnalyticalColumnKind::Date32, "Date32", None);
    }
    if matches!(base, "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE") {
        return (
            AnalyticalColumnKind::TimestampMicrosecond { utc: true },
            "Timestamp(Microsecond, UTC)",
            None,
        );
    }
    if matches!(
        base,
        "TIMESTAMP" | "TIMESTAMP WITHOUT TIME ZONE" | "DATETIME" | "DATETIME2"
    ) {
        return (
            AnalyticalColumnKind::TimestampMicrosecond { utc: false },
            "Timestamp(Microsecond)",
            None,
        );
    }
    if matches!(
        base,
        "REAL" | "FLOAT" | "FLOAT4" | "FLOAT8" | "DOUBLE" | "DOUBLE PRECISION"
    ) {
        return (AnalyticalColumnKind::Float64, "Float64", None);
    }
    let integer_type = matches!(
        unsigned_base,
        "TINYINT"
            | "SMALLINT"
            | "INT2"
            | "MEDIUMINT"
            | "INT"
            | "INTEGER"
            | "INT4"
            | "BIGINT"
            | "INT8"
            | "SERIAL"
            | "BIGSERIAL"
            | "YEAR"
    );
    if matches!(base, "UTINYINT" | "USMALLINT" | "UINTEGER" | "UBIGINT")
        || integer_type && normalized.contains("UNSIGNED")
    {
        return (AnalyticalColumnKind::UInt64, "UInt64", None);
    }
    if integer_type {
        return (AnalyticalColumnKind::Int64, "Int64", None);
    }
    if matches!(
        base,
        "BYTEA" | "BLOB" | "BINARY" | "VARBINARY" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB"
    ) {
        return (AnalyticalColumnKind::Binary, "Binary", None);
    }
    if matches!(
        base,
        "CHAR"
            | "CHARACTER"
            | "CHARACTER VARYING"
            | "VARCHAR"
            | "VARCHAR2"
            | "NVARCHAR"
            | "NVARCHAR2"
            | "TEXT"
            | "TINYTEXT"
            | "MEDIUMTEXT"
            | "LONGTEXT"
            | "BPCHAR"
            | "NAME"
            | "CITEXT"
            | "XML"
            | "STRING"
            | "ENUM"
            | "SET"
            | "UUID"
    ) {
        return (AnalyticalColumnKind::Utf8, "Utf8", None);
    }
    (
        AnalyticalColumnKind::Utf8,
        "Utf8",
        Some("No lossless native Arrow mapping is available; the exact textual/JSON representation is retained with source-type metadata."),
    )
}

pub(super) fn analytical_arrow_data_type(kind: &AnalyticalColumnKind) -> ArrowDataType {
    match kind {
        AnalyticalColumnKind::Boolean => ArrowDataType::Boolean,
        AnalyticalColumnKind::Date32 => ArrowDataType::Date32,
        AnalyticalColumnKind::Float64 => ArrowDataType::Float64,
        AnalyticalColumnKind::Int64 => ArrowDataType::Int64,
        AnalyticalColumnKind::TimestampMicrosecond { utc } => {
            ArrowDataType::Timestamp(TimeUnit::Microsecond, utc.then(|| Arc::<str>::from("UTC")))
        }
        AnalyticalColumnKind::UInt64 => ArrowDataType::UInt64,
        AnalyticalColumnKind::Binary => ArrowDataType::Binary,
        AnalyticalColumnKind::Utf8 => ArrowDataType::Utf8,
    }
}

pub(super) fn analytical_value_at(row: &[Value], column_index: usize) -> &Value {
    row.get(column_index).unwrap_or(&Value::Null)
}

pub(super) fn analytical_value_error(
    row_index: usize,
    column: &ColumnDef,
    output_type: &str,
) -> String {
    format!(
        "Cannot encode export row {} column {} from {} as {output_type}; no row value was included in this error",
        row_index + 1,
        column.name,
        column.data_type
    )
}

pub(super) fn analytical_bool(value: &Value) -> Result<Option<bool>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(*value)),
        Value::Number(value) if value.as_i64() == Some(0) => Ok(Some(false)),
        Value::Number(value) if value.as_i64() == Some(1) => Ok(Some(true)),
        Value::String(value) if value.eq_ignore_ascii_case("true") || value == "1" => {
            Ok(Some(true))
        }
        Value::String(value) if value.eq_ignore_ascii_case("false") || value == "0" => {
            Ok(Some(false))
        }
        _ => Err(()),
    }
}

pub(super) fn analytical_i64(value: &Value) -> Result<Option<i64>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::Number(value) => value.as_i64().map(Some).ok_or(()),
        Value::String(value) => value.parse::<i64>().map(Some).map_err(|_| ()),
        _ => Err(()),
    }
}

pub(super) fn analytical_u64(value: &Value) -> Result<Option<u64>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::Number(value) => value.as_u64().map(Some).ok_or(()),
        Value::String(value) => value.parse::<u64>().map(Some).map_err(|_| ()),
        _ => Err(()),
    }
}

pub(super) fn analytical_f64(value: &Value) -> Result<Option<f64>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::Number(value) => value.as_f64().map(Some).ok_or(()),
        Value::String(value) => match value.as_str() {
            "Infinity" => Ok(Some(f64::INFINITY)),
            "-Infinity" => Ok(Some(f64::NEG_INFINITY)),
            "NaN" => Ok(Some(f64::NAN)),
            _ => value.parse::<f64>().map(Some).map_err(|_| ()),
        },
        _ => Err(()),
    }
}

pub(super) fn analytical_date32(value: &Value) -> Result<Option<i32>, ()> {
    if let Some(value) = value.as_i64() {
        return i32::try_from(value).map(Some).map_err(|_| ());
    }
    let Value::String(value) = value else {
        return if value.is_null() { Ok(None) } else { Err(()) };
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| ())?;
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("valid Unix epoch date");
    i32::try_from((date - epoch).num_days())
        .map(Some)
        .map_err(|_| ())
}

pub(super) fn analytical_timestamp_micros(value: &Value, utc: bool) -> Result<Option<i64>, ()> {
    let Value::String(value) = value else {
        return if value.is_null() { Ok(None) } else { Err(()) };
    };
    if let Some((unit, raw_value)) = value.split_once(':') {
        let normalized_unit = unit.to_ascii_lowercase();
        if matches!(
            normalized_unit.as_str(),
            "second"
                | "seconds"
                | "millisecond"
                | "milliseconds"
                | "microsecond"
                | "microseconds"
                | "nanosecond"
                | "nanoseconds"
        ) {
            let raw_value = raw_value.parse::<i64>().map_err(|_| ())?;
            let micros = match normalized_unit.as_str() {
                "second" | "seconds" => raw_value.checked_mul(1_000_000),
                "millisecond" | "milliseconds" => raw_value.checked_mul(1_000),
                "microsecond" | "microseconds" => Some(raw_value),
                "nanosecond" | "nanoseconds" if raw_value % 1_000 == 0 => Some(raw_value / 1_000),
                _ => None,
            };
            return micros.map(Some).ok_or(());
        }
    }
    if utc {
        return DateTime::parse_from_rfc3339(value)
            .map(|value| Some(value.with_timezone(&Utc).timestamp_micros()))
            .map_err(|_| ());
    }
    [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ]
    .iter()
    .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
    .map(|value| Some(value.and_utc().timestamp_micros()))
    .ok_or(())
}

pub(super) fn analytical_binary(value: &Value) -> Result<Option<Vec<u8>>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::String(value) => {
            let Some(hex) = value
                .strip_prefix("\\x")
                .or_else(|| value.strip_prefix("0x"))
            else {
                return Ok(Some(value.as_bytes().to_vec()));
            };
            if hex.len() % 2 != 0 {
                return Err(());
            }
            (0..hex.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).map_err(|_| ()))
                .collect::<Result<Vec<_>, _>>()
                .map(Some)
        }
        Value::Array(values) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or(())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        _ => Err(()),
    }
}

pub(super) fn analytical_utf8(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).ok(),
    }
}
