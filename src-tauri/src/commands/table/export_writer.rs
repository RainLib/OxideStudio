//! Export writer for table operations.
use super::limits::TABLE_EXPORT_CANCELLED;

use super::export_analytical::{AnalyticalExportPlan, AnalyticalExportWriter};
use super::export_files::ExportTemporaryFile;
use super::export_sql::{sql_insert_statements, SqlInsertExportOptions};
use super::export_text::{
    csv_escape, markdown_escape_text, push_delimited_export_row, tsv_escape, write_json_export_row,
};
use super::export_types::{
    TableExportEncoding, TableExportFormat, TableExportProgress, TableExportResult,
    TableExportWriterContext, TableExportWriterMessage,
};
use super::export_xlsx::StreamingXlsxWriter;
use super::limits::TABLE_EXPORT_PROGRESS_EVENT;
use super::policy::schema_option;
use crate::core::protocol::ColumnDef;
use serde_json::Value;
use std::fs::File;
use std::io::BufWriter;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::watch;

/// Blocking file and compression work is deliberately isolated from Tokio's
/// async workers. The bounded receiver is the export backpressure boundary:
/// when two pages are queued, the database producer waits instead of growing
/// memory without limit.
pub(super) fn write_table_export_stream(
    context: TableExportWriterContext,
    mut receiver: mpsc::Receiver<TableExportWriterMessage>,
    cancel_rx: watch::Receiver<bool>,
) -> Result<TableExportResult, String> {
    let TableExportWriterContext {
        app,
        export_id,
        final_path,
        kind,
        sql_dialect,
        override_system_value,
        sql_insert_batch_rows,
        sql_insert_conflict_policy,
        sql_conflict_key_columns,
        analytical_type_policy,
        schema,
        table,
        format,
        encoding,
        xlsx_auto_filter,
        progress_rows,
        progress_batches,
    } = context;
    let mut temporary_file = ExportTemporaryFile::create(&final_path)?;
    let file = File::create(&temporary_file.path).map_err(|error| error.to_string())?;
    let mut file = Some(file);
    let mut text_writer = if matches!(
        format,
        TableExportFormat::Csv
            | TableExportFormat::Json
            | TableExportFormat::Jsonl
            | TableExportFormat::Markdown
            | TableExportFormat::Sql
            | TableExportFormat::Tsv
    ) {
        Some(BufWriter::new(
            file.take().expect("text export owns the output file"),
        ))
    } else {
        None
    };
    let mut xlsx_writer = matches!(format, TableExportFormat::Xlsx).then(|| {
        StreamingXlsxWriter::new(
            file.take().expect("XLSX export owns the output file"),
            xlsx_auto_filter,
        )
    });
    let mut analytical_plan: Option<AnalyticalExportPlan> = None;
    let mut analytical_writer: Option<AnalyticalExportWriter> = None;
    if matches!(encoding, TableExportEncoding::Utf8Bom) {
        text_writer
            .as_mut()
            .ok_or_else(|| "XLSX exports do not use a text encoding".to_string())?
            .write_all(b"\xEF\xBB\xBF")
            .map_err(|error| error.to_string())?;
    }

    let mut columns = Vec::<ColumnDef>::new();
    let mut column_names = Vec::<String>::new();
    let mut columns_initialized = false;
    let mut wrote_json_row = false;
    let mut wrote_delimited_header = false;
    let mut wrote_xlsx_header = false;
    let mut rows_exported = 0_u64;
    let mut batches = 0_u64;
    // Reuse one row buffer for all delimited formats. Large exports therefore
    // retain only the largest encoded row instead of allocating a Vec<String>
    // and a joined String for every row.
    let mut text_row_buffer = String::new();

    if matches!(format, TableExportFormat::Json) {
        text_writer
            .as_mut()
            .expect("text writer exists for JSON exports")
            .write_all(b"[")
            .map_err(|error| error.to_string())?;
    } else if matches!(format, TableExportFormat::Sql) {
        writeln!(
            text_writer
                .as_mut()
                .expect("text writer exists for SQL exports"),
            "-- OxideStudio data export for {}",
            kind.qualified_table(schema_option(&schema), &table)
        )
        .map_err(|error| error.to_string())?;
    }

    loop {
        if *cancel_rx.borrow() {
            return Err(format!(
                "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
            ));
        }
        let Some(message) = receiver.blocking_recv() else {
            return Err(
                "Export source stopped before completion; partial file removed".to_string(),
            );
        };
        match message {
            TableExportWriterMessage::Finish => break,
            TableExportWriterMessage::Batch {
                columns: batch_columns,
                rows,
            } => {
                if columns_initialized {
                    if columns
                        .iter()
                        .map(|column| column.name.as_str())
                        .ne(batch_columns.iter().map(|column| column.name.as_str()))
                    {
                        return Err("Export columns changed between database pages".to_string());
                    }
                } else {
                    columns = batch_columns;
                    column_names = columns.iter().map(|column| column.name.clone()).collect();
                    columns_initialized = true;
                    if matches!(
                        format,
                        TableExportFormat::Arrow | TableExportFormat::Parquet
                    ) {
                        let plan =
                            AnalyticalExportPlan::new(analytical_type_policy, columns.clone());
                        analytical_writer = Some(AnalyticalExportWriter::new(
                            format,
                            file.take().expect("analytical export owns the output file"),
                            Arc::clone(&plan.schema),
                        )?);
                        analytical_plan = Some(plan);
                    }
                }

                if matches!(format, TableExportFormat::Xlsx) && !wrote_xlsx_header {
                    xlsx_writer
                        .as_mut()
                        .expect("XLSX writer exists for XLSX exports")
                        .write_header(&column_names)?;
                    wrote_xlsx_header = true;
                }
                if matches!(format, TableExportFormat::Csv | TableExportFormat::Tsv)
                    && !wrote_delimited_header
                {
                    let delimiter = if matches!(format, TableExportFormat::Tsv) {
                        "\t"
                    } else {
                        ","
                    };
                    let header = column_names
                        .iter()
                        .map(|column| {
                            let value = Value::String(column.clone());
                            if matches!(format, TableExportFormat::Tsv) {
                                tsv_escape(&value)
                            } else {
                                csv_escape(&value)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(delimiter);
                    writeln!(
                        text_writer
                            .as_mut()
                            .expect("text writer exists for delimited exports"),
                        "{header}"
                    )
                    .map_err(|error| error.to_string())?;
                    wrote_delimited_header = true;
                }
                if matches!(format, TableExportFormat::Markdown) && !wrote_delimited_header {
                    let header = column_names
                        .iter()
                        .map(|column| markdown_escape_text(column))
                        .collect::<Vec<_>>()
                        .join(" | ");
                    let separator = column_names
                        .iter()
                        .map(|_| "---")
                        .collect::<Vec<_>>()
                        .join(" | ");
                    writeln!(
                        text_writer
                            .as_mut()
                            .expect("text writer exists for Markdown exports"),
                        "| {header} |\n| {separator} |"
                    )
                    .map_err(|error| error.to_string())?;
                    wrote_delimited_header = true;
                }

                if matches!(
                    format,
                    TableExportFormat::Arrow | TableExportFormat::Parquet
                ) {
                    if !rows.is_empty() {
                        let batch = analytical_plan
                            .as_ref()
                            .expect("analytical plan exists after column initialization")
                            .record_batch(&rows)?;
                        analytical_writer
                            .as_mut()
                            .expect("analytical writer exists after column initialization")
                            .write(&batch)?;
                    }
                } else if matches!(format, TableExportFormat::Sql) {
                    for statement in sql_insert_statements(
                        SqlInsertExportOptions {
                            kind,
                            dialect: sql_dialect,
                            override_system_value,
                            batch_rows: sql_insert_batch_rows,
                            conflict_policy: sql_insert_conflict_policy,
                            conflict_key_columns: &sql_conflict_key_columns,
                            schema: &schema,
                            table: &table,
                        },
                        &columns,
                        &rows,
                    )? {
                        if *cancel_rx.borrow() {
                            return Err(format!(
                                "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                            ));
                        }
                        writeln!(
                            text_writer
                                .as_mut()
                                .expect("text writer exists for SQL exports"),
                            "{statement}"
                        )
                        .map_err(|error| error.to_string())?;
                    }
                } else {
                    for row in &rows {
                        if *cancel_rx.borrow() {
                            return Err(format!(
                                "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                            ));
                        }
                        match format {
                            TableExportFormat::Arrow | TableExportFormat::Parquet => {
                                unreachable!("analytical batches are written outside the row loop")
                            }
                            TableExportFormat::Csv => {
                                push_delimited_export_row(
                                    &mut text_row_buffer,
                                    TableExportFormat::Csv,
                                    row,
                                );
                                text_writer
                                    .as_mut()
                                    .expect("text writer exists for CSV exports")
                                    .write_all(text_row_buffer.as_bytes())
                                    .map_err(|error| error.to_string())?;
                            }
                            TableExportFormat::Json => {
                                let writer = text_writer
                                    .as_mut()
                                    .expect("text writer exists for JSON exports");
                                if wrote_json_row {
                                    writer.write_all(b",").map_err(|error| error.to_string())?;
                                }
                                write_json_export_row(writer, &column_names, row)?;
                                wrote_json_row = true;
                            }
                            TableExportFormat::Jsonl => {
                                let writer = text_writer
                                    .as_mut()
                                    .expect("text writer exists for JSON Lines exports");
                                write_json_export_row(writer, &column_names, row)?;
                                writer.write_all(b"\n").map_err(|error| error.to_string())?;
                            }
                            TableExportFormat::Markdown => {
                                push_delimited_export_row(
                                    &mut text_row_buffer,
                                    TableExportFormat::Markdown,
                                    row,
                                );
                                text_writer
                                    .as_mut()
                                    .expect("text writer exists for Markdown exports")
                                    .write_all(text_row_buffer.as_bytes())
                                    .map_err(|error| error.to_string())?;
                            }
                            TableExportFormat::Sql => {
                                unreachable!("SQL batches are written outside the row loop")
                            }
                            TableExportFormat::Tsv => {
                                push_delimited_export_row(
                                    &mut text_row_buffer,
                                    TableExportFormat::Tsv,
                                    row,
                                );
                                text_writer
                                    .as_mut()
                                    .expect("text writer exists for TSV exports")
                                    .write_all(text_row_buffer.as_bytes())
                                    .map_err(|error| error.to_string())?;
                            }
                            TableExportFormat::Xlsx => {
                                xlsx_writer
                                    .as_mut()
                                    .expect("XLSX writer exists for XLSX exports")
                                    .write_row(row)?;
                            }
                        }
                    }
                }

                if !rows.is_empty() {
                    rows_exported += rows.len() as u64;
                    batches += 1;
                    progress_rows.store(rows_exported, Ordering::Release);
                    progress_batches.store(batches, Ordering::Release);
                    if let Some(app) = app.as_ref() {
                        let _ = app.emit(
                            TABLE_EXPORT_PROGRESS_EVENT,
                            TableExportProgress {
                                export_id: export_id.clone(),
                                rows_exported,
                                batches,
                                terminal: false,
                                status: "running".to_string(),
                                message: None,
                            },
                        );
                    }
                }
            }
        }
    }

    if matches!(format, TableExportFormat::Json) {
        text_writer
            .as_mut()
            .expect("text writer exists for JSON exports")
            .write_all(b"]")
            .map_err(|error| error.to_string())?;
    }
    if let Some(mut writer) = text_writer {
        writer.flush().map_err(|error| error.to_string())?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| error.to_string())?;
        drop(writer);
    }
    if let Some(writer) = xlsx_writer.take() {
        writer.finish()?;
    }
    if matches!(
        format,
        TableExportFormat::Arrow | TableExportFormat::Parquet
    ) && analytical_writer.is_none()
    {
        let plan = AnalyticalExportPlan::new(analytical_type_policy, Vec::new());
        analytical_writer = Some(AnalyticalExportWriter::new(
            format,
            file.take()
                .expect("empty analytical export owns the output file"),
            Arc::clone(&plan.schema),
        )?);
        analytical_plan = Some(plan);
    }
    if let Some(writer) = analytical_writer.take() {
        writer.finish()?;
    }
    let type_coercions = analytical_plan
        .map(|plan| plan.type_coercions)
        .unwrap_or_default();
    temporary_file.finalize(&final_path)?;

    Ok(TableExportResult {
        export_id,
        file_path: final_path.display().to_string(),
        rows_exported,
        batches,
        max_rows: None,
        report_id: None,
        type_coercions,
    })
}
