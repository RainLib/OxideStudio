//! Export text for table operations.

use super::export_types::TableExportFormat;
use super::values::value_to_export_cow;
use serde_json::Value;
use std::io::Write;

pub(super) fn csv_escape(value: &Value) -> String {
    let mut output = String::new();
    push_csv_export_value(&mut output, value);
    output
}

pub(super) fn tsv_escape(value: &Value) -> String {
    let mut output = String::new();
    push_tsv_export_value(&mut output, value);
    output
}

pub(super) fn markdown_escape_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    push_markdown_export_text(&mut output, value);
    output
}

pub(super) fn push_csv_export_value(output: &mut String, value: &Value) {
    let value = value_to_export_cow(value);
    let quoted = value
        .chars()
        .any(|character| matches!(character, ',' | '"' | '\n' | '\r'));
    if quoted {
        output.push('"');
    }
    for character in value.chars() {
        if character == '"' {
            output.push_str("\"\"");
        } else {
            output.push(character);
        }
    }
    if quoted {
        output.push('"');
    }
}

pub(super) fn push_tsv_export_value(output: &mut String, value: &Value) {
    for character in value_to_export_cow(value).chars() {
        output.push(if matches!(character, '\t' | '\r' | '\n') {
            ' '
        } else {
            character
        });
    }
}

pub(super) fn push_markdown_export_text(output: &mut String, value: &str) {
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\\' => output.push_str("\\\\"),
            '|' => output.push_str("\\|"),
            '\r' => {
                if characters.peek() == Some(&'\n') {
                    characters.next();
                }
                output.push_str("<br>");
            }
            '\n' => output.push_str("<br>"),
            _ => output.push(character),
        }
    }
}

pub(super) fn push_markdown_export_value(output: &mut String, value: &Value) {
    if value.is_null() {
        output.push_str("NULL");
    } else {
        push_markdown_export_text(output, &value_to_export_cow(value));
    }
}

pub(super) fn push_delimited_export_row(
    output: &mut String,
    format: TableExportFormat,
    row: &[Value],
) {
    output.clear();
    let (separator, prefix, suffix) = match format {
        TableExportFormat::Csv => (",", "", "\n"),
        TableExportFormat::Tsv => ("\t", "", "\n"),
        TableExportFormat::Markdown => (" | ", "| ", " |\n"),
        _ => unreachable!("only delimited text formats use this row encoder"),
    };
    output.push_str(prefix);
    for (index, value) in row.iter().enumerate() {
        if index > 0 {
            output.push_str(separator);
        }
        match format {
            TableExportFormat::Csv => push_csv_export_value(output, value),
            TableExportFormat::Tsv => push_tsv_export_value(output, value),
            TableExportFormat::Markdown => push_markdown_export_value(output, value),
            _ => unreachable!("only delimited text formats use this row encoder"),
        }
    }
    output.push_str(suffix);
}

pub(super) fn write_json_export_row<W: Write>(
    writer: &mut W,
    columns: &[String],
    row: &[Value],
) -> Result<(), String> {
    writer.write_all(b"{").map_err(|error| error.to_string())?;
    for (index, column) in columns.iter().enumerate() {
        if index > 0 {
            writer.write_all(b",").map_err(|error| error.to_string())?;
        }
        serde_json::to_writer(&mut *writer, column).map_err(|error| error.to_string())?;
        writer.write_all(b":").map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut *writer, row.get(index).unwrap_or(&Value::Null))
            .map_err(|error| error.to_string())?;
    }
    writer.write_all(b"}").map_err(|error| error.to_string())
}
