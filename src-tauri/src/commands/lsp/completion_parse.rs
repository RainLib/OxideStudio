use super::wire_types::{
    CompletionDocumentation, CompletionItem, CompletionItemLabelDetails, CompletionMarkupContent,
    CompletionTextEdit, InsertReplaceEdit, Position, Range, TextEdit,
};
use serde_json::Value;

pub(super) const MAX_LSP_COMPLETION_ITEM_BYTES: usize = 256 * 1024;
pub(super) const MAX_LSP_COMPLETION_ITEMS: usize = 2_000;

pub(super) fn parse_completion_documentation(value: &Value) -> Option<CompletionDocumentation> {
    if let Some(text) = value.as_str() {
        return Some(CompletionDocumentation::Text(text.to_string()));
    }

    if let Some(text) = value.get("value").and_then(|value| value.as_str()) {
        return Some(CompletionDocumentation::Markup(CompletionMarkupContent {
            kind: value
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("plaintext")
                .to_string(),
            value: text.to_string(),
        }));
    }

    if let Some(items) = value.as_array() {
        let docs: Vec<String> = items
            .iter()
            .filter_map(parse_completion_documentation)
            .map(|documentation| match documentation {
                CompletionDocumentation::Text(text) => text,
                CompletionDocumentation::Markup(markup) => markup.value,
            })
            .filter(|doc| !doc.trim().is_empty())
            .collect();
        if !docs.is_empty() {
            return Some(CompletionDocumentation::Text(docs.join("\n\n")));
        }
    }

    None
}

pub(super) fn parse_position(value: &Value) -> Option<Position> {
    Some(Position {
        line: value.get("line")?.as_u64()?.try_into().ok()?,
        character: value.get("character")?.as_u64()?.try_into().ok()?,
    })
}

pub(super) fn parse_range(value: &Value) -> Option<Range> {
    Some(Range {
        start: parse_position(value.get("start")?)?,
        end: parse_position(value.get("end")?)?,
    })
}

pub(super) fn parse_text_edit(value: &Value) -> Option<TextEdit> {
    Some(TextEdit {
        range: parse_range(value.get("range")?)?,
        new_text: value.get("newText")?.as_str()?.to_string(),
    })
}

pub(super) fn parse_completion_text_edit(value: &Value) -> Option<CompletionTextEdit> {
    if let Some(edit) = parse_text_edit(value) {
        return Some(CompletionTextEdit::Edit(edit));
    }
    Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
        new_text: value.get("newText")?.as_str()?.to_string(),
        insert: parse_range(value.get("insert")?)?,
        replace: parse_range(value.get("replace")?)?,
    }))
}

pub(super) fn parse_default_completion_text_edit(
    item: &Value,
    edit_range: &Value,
) -> Option<CompletionTextEdit> {
    let new_text = item
        .get("textEditText")
        .or_else(|| item.get("insertText"))
        .or_else(|| item.get("label"))?
        .as_str()?
        .to_string();
    if let Some(range) = parse_range(edit_range) {
        return Some(CompletionTextEdit::Edit(TextEdit { range, new_text }));
    }
    Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
        new_text,
        insert: parse_range(edit_range.get("insert")?)?,
        replace: parse_range(edit_range.get("replace")?)?,
    }))
}

fn completion_value<'a>(
    item: &'a Value,
    defaults: Option<&'a Value>,
    key: &str,
) -> Option<&'a Value> {
    item.get(key)
        .or_else(|| defaults.and_then(|value| value.get(key)))
}

pub(super) fn parse_completion_item(
    item: &Value,
    defaults: Option<&Value>,
) -> Option<CompletionItem> {
    Some(CompletionItem {
        label: item.get("label")?.as_str()?.to_string(),
        label_details: item.get("labelDetails").and_then(|value| {
            let details = CompletionItemLabelDetails {
                detail: value
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                description: value
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            };
            (details.detail.is_some() || details.description.is_some()).then_some(details)
        }),
        kind: item.get("kind").and_then(|v| v.as_i64()).map(|v| v as u32),
        detail: item
            .get("detail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        documentation: item
            .get("documentation")
            .and_then(parse_completion_documentation),
        insert_text: item
            .get("insertText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        insert_text_format: completion_value(item, defaults, "insertTextFormat")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        insert_text_mode: completion_value(item, defaults, "insertTextMode")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
        sort_text: item
            .get("sortText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        filter_text: item
            .get("filterText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        text_edit: item
            .get("textEdit")
            .and_then(parse_completion_text_edit)
            .or_else(|| {
                defaults
                    .and_then(|value| value.get("editRange"))
                    .and_then(|range| parse_default_completion_text_edit(item, range))
            }),
        additional_text_edits: item.get("additionalTextEdits").and_then(|value| {
            let edits = value
                .as_array()?
                .iter()
                .filter_map(parse_text_edit)
                .collect::<Vec<_>>();
            Some(edits)
        }),
        preselect: item.get("preselect").and_then(|v| v.as_bool()),
        commit_characters: completion_value(item, defaults, "commitCharacters").and_then(|value| {
            Some(
                value
                    .as_array()?
                    .iter()
                    .filter_map(|character| character.as_str().map(str::to_string))
                    .collect(),
            )
        }),
        deprecated: item
            .get("deprecated")
            .and_then(|value| value.as_bool())
            .or_else(|| {
                item.get("tags")
                    .and_then(|value| value.as_array())
                    .map(|tags| tags.iter().any(|tag| tag.as_u64() == Some(1)))
            }),
        data: completion_value(item, defaults, "data").cloned(),
    })
}

pub(super) fn parse_bounded_completion_items(
    items: &[Value],
    defaults: Option<&Value>,
) -> (Vec<CompletionItem>, bool) {
    let mut incomplete = items.len() > MAX_LSP_COMPLETION_ITEMS;
    let mut parsed = Vec::with_capacity(items.len().min(MAX_LSP_COMPLETION_ITEMS));
    for item in items.iter().take(MAX_LSP_COMPLETION_ITEMS) {
        let within_item_limit = serde_json::to_vec(item)
            .is_ok_and(|encoded| encoded.len() <= MAX_LSP_COMPLETION_ITEM_BYTES);
        if !within_item_limit {
            incomplete = true;
            continue;
        }
        if let Some(item) = parse_completion_item(item, defaults) {
            parsed.push(item);
        } else {
            incomplete = true;
        }
    }
    (parsed, incomplete)
}

pub(super) fn merge_completion_item_values(original: Value, resolved: Value) -> Value {
    match (original, resolved) {
        (Value::Object(mut original), Value::Object(resolved)) => {
            original.extend(resolved);
            Value::Object(original)
        }
        (_, resolved) => resolved,
    }
}
