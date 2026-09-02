use serde_json::{json, Map, Value};

const DEFAULT_FIND_LIMIT: i64 = 100;
const MAX_FIND_LIMIT: i64 = 10_000;

pub(super) fn looks_like_shell_command(input: &str) -> bool {
    let source = trim_outer_comments(input).trim_end_matches(';').trim();
    source
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("db."))
        || parse_use_database(source).is_some()
        || matches!(
            source.to_ascii_lowercase().as_str(),
            "show dbs" | "show databases"
        )
}

pub(super) fn parse_commands(input: &str) -> Result<Vec<Value>, String> {
    split_shell_statements(input)?
        .into_iter()
        .map(parse_command)
        .collect()
}

/// Parse the executable Mongo shell subset exposed by the editor.
/// This is a structural parser, not JavaScript evaluation: computed values,
/// arbitrary functions and unknown options are rejected. Mutations are lowered
/// to the same explicit native command documents accepted by the JSON console.
pub(super) fn parse_command(input: &str) -> Result<Value, String> {
    let source = trim_outer_comments(input).trim_end_matches(';').trim();

    if matches!(
        source.to_ascii_lowercase().as_str(),
        "show dbs" | "show databases"
    ) {
        return Ok(json!({
            "command": { "listDatabases": 1, "nameOnly": true }
        }));
    }

    if let Some(database) = parse_use_database(source) {
        return Ok(json!({ "useDatabase": database }));
    }

    if let Some((args, tail)) = method_call(source, 2, "version") {
        if !tail.is_empty() || !args.is_empty() {
            return Err("MongoDB db.version() does not accept arguments.".into());
        }
        return Ok(json!({ "command": { "buildInfo": 1 } }));
    }

    if let Some((args, tail)) = method_call(source, 2, "runCommand") {
        if !tail.is_empty() || args.len() != 1 {
            return Err("MongoDB db.runCommand() requires one command document.".into());
        }
        let command = required_document_value(args.first(), "runCommand argument")?;
        if command.as_object().is_none_or(Map::is_empty) {
            return Err("MongoDB db.runCommand() requires a non-empty command document.".into());
        }
        return Ok(json!({ "command": command }));
    }

    if let Some((args, tail)) = method_call(source, 2, "createUser") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB db.createUser() requires a user document and optional write concern."
                    .into(),
            );
        }
        let mut user = required_document_value(args.first(), "createUser document")?
            .as_object()
            .cloned()
            .expect("required document is an object");
        let name = user
            .remove("user")
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .filter(|value| !value.trim().is_empty())
            .ok_or("MongoDB createUser document requires a non-empty user field.")?;
        let mut command = Map::from_iter([("createUser".to_string(), Value::String(name))]);
        command.append(&mut user);
        if let Some(write_concern) = args.get(1) {
            command.insert(
                "writeConcern".to_string(),
                required_document_value(Some(write_concern), "createUser write concern")?,
            );
        }
        return Ok(json!({ "command": command }));
    }

    let (collection, prefix_end) = parse_collection_prefix(source)?;

    if let Some((args, tail)) = method_call(source, prefix_end, "find") {
        if args.len() > 3 {
            return Err("MongoDB find() accepts filter, projection and options arguments.".into());
        }
        let filter = object_argument(args.first(), "find filter")?;
        let projection = optional_object_argument(args.get(1), "find projection")?;
        let options = options_argument(
            args.get(2),
            "find options",
            &[
                "allowPartialResults",
                "collation",
                "comment",
                "hint",
                "maxTimeMS",
                "noCursorTimeout",
                "returnKey",
                "showRecordId",
            ],
        )?;
        let mut sort = None;
        let mut collation = None;
        let mut skip = 0_i64;
        let mut limit = DEFAULT_FIND_LIMIT;
        let calls = chained_calls(&tail)?;
        for (index, (name, call_args)) in calls.iter().enumerate() {
            match name.as_str() {
                "sort" => sort = Some(required_object_argument(call_args, "sort")?),
                "collation" => collation = Some(required_object_argument(call_args, "collation")?),
                "skip" => skip = bounded_integer(call_args, "skip", 0, i64::MAX)?,
                "limit" => limit = bounded_integer(call_args, "limit", 1, MAX_FIND_LIMIT)?,
                "count" if call_args.is_empty() && calls.len() == 1 => {
                    return Ok(json!({
                        "collection": collection,
                        "countDocuments": Value::Object(filter),
                    }));
                }
                "explain" if index + 1 == calls.len() => {
                    let verbosity = optional_explain_verbosity(call_args)?;
                    let mut find = Map::from_iter([
                        ("find".to_string(), Value::String(collection)),
                        ("filter".to_string(), Value::Object(filter)),
                        ("skip".to_string(), json!(skip)),
                        ("limit".to_string(), json!(limit)),
                    ]);
                    if let Some(projection) = projection {
                        find.insert("projection".to_string(), Value::Object(projection));
                    }
                    if let Some(sort) = sort {
                        find.insert("sort".to_string(), Value::Object(sort));
                    }
                    if let Some(collation) = collation {
                        find.insert("collation".to_string(), Value::Object(collation));
                    }
                    return Ok(json!({
                        "command": { "explain": find, "verbosity": verbosity }
                    }));
                }
                _ => return Err(format!("Unsupported MongoDB find() chain: {name}()")),
            }
        }
        let mut command = Map::from_iter([
            ("collection".to_string(), Value::String(collection)),
            ("find".to_string(), Value::Object(filter)),
            ("skip".to_string(), json!(skip)),
            ("limit".to_string(), json!(limit)),
        ]);
        if let Some(projection) = projection {
            command.insert("projection".to_string(), Value::Object(projection));
        }
        if let Some(sort) = sort {
            command.insert("sort".to_string(), Value::Object(sort));
        }
        if let Some(collation) = collation {
            if options.contains_key("collation") {
                return Err(
                    "MongoDB find collation cannot be supplied both as an option and chain.".into(),
                );
            }
            command.insert("collation".to_string(), Value::Object(collation));
        }
        if !options.is_empty() {
            command.insert("findOptions".to_string(), Value::Object(options));
        }
        return Ok(Value::Object(command));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "findOne") {
        if !tail.is_empty() || args.len() > 3 {
            return Err(
                "MongoDB findOne() accepts filter, projection and options arguments.".into(),
            );
        }
        let filter = object_argument(args.first(), "findOne filter")?;
        let projection = optional_object_argument(args.get(1), "findOne projection")?;
        let options = options_argument(
            args.get(2),
            "findOne options",
            &[
                "allowPartialResults",
                "collation",
                "comment",
                "hint",
                "maxTimeMS",
                "noCursorTimeout",
                "returnKey",
                "showRecordId",
            ],
        )?;
        let mut command = Map::from_iter([
            ("collection".to_string(), Value::String(collection)),
            ("find".to_string(), Value::Object(filter)),
            ("limit".to_string(), json!(1)),
        ]);
        if let Some(projection) = projection {
            command.insert("projection".to_string(), Value::Object(projection));
        }
        if !options.is_empty() {
            command.insert("findOptions".to_string(), Value::Object(options));
        }
        return Ok(Value::Object(command));
    }

    for method in ["countDocuments", "count"] {
        if let Some((args, tail)) = method_call(source, prefix_end, method) {
            if !tail.is_empty() || args.len() > 1 {
                return Err(format!("MongoDB {method}() accepts at most one filter."));
            }
            return Ok(json!({
                "collection": collection,
                "countDocuments": Value::Object(object_argument(args.first(), "count filter")?),
            }));
        }
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "aggregate") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB aggregate() requires a pipeline and optional options document.".into(),
            );
        }
        let pipeline = normalized_value(&args[0])?;
        let Value::Array(pipeline) = pipeline else {
            return Err("MongoDB aggregate() requires a pipeline array.".into());
        };
        let options = options_argument(
            args.get(1),
            "aggregate options",
            &[
                "allowDiskUse",
                "bypassDocumentValidation",
                "collation",
                "comment",
                "hint",
                "let",
                "maxTimeMS",
            ],
        )?;
        let mut command = Map::from_iter([
            ("collection".to_string(), Value::String(collection)),
            ("aggregate".to_string(), Value::Array(pipeline)),
        ]);
        if !options.is_empty() {
            command.insert("aggregateOptions".to_string(), Value::Object(options));
        }
        return Ok(Value::Object(command));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "distinct") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err("MongoDB distinct() requires a field and optional filter.".into());
        }
        let field = string_argument(&args[0])?;
        let query = object_argument(args.get(1), "distinct filter")?;
        return Ok(json!({
            "command": { "distinct": collection, "key": field, "query": query }
        }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "getIndexes") {
        if !tail.is_empty() || !args.is_empty() {
            return Err("MongoDB getIndexes() does not accept arguments.".into());
        }
        return Ok(json!({ "command": { "listIndexes": collection } }));
    }

    for metric in ["stats", "dataSize", "storageSize", "totalIndexSize"] {
        if let Some((args, tail)) = method_call(source, prefix_end, metric) {
            if !tail.is_empty() || args.len() > 1 {
                return Err(format!(
                    "MongoDB {metric}() accepts at most one positive scale."
                ));
            }
            let mut command = json!({ "collStats": collection });
            if let Some(scale) = args.first().filter(|value| !value.trim().is_empty()) {
                let scale = scale
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|value| value.is_finite() && *value > 0.0)
                    .ok_or_else(|| format!("MongoDB {metric}() scale must be positive."))?;
                command
                    .as_object_mut()
                    .expect("collStats command is an object")
                    .insert("scale".to_string(), json!(scale));
            }
            return Ok(json!({ "command": command }));
        }
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "insertOne") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB insertOne() requires a document and optional options document.".into(),
            );
        }
        let document = required_document_value(args.first(), "insertOne document")?;
        let options = options_argument(
            args.get(1),
            "insertOne options",
            &["bypassDocumentValidation", "comment", "writeConcern"],
        )?;
        if options.is_empty() {
            return Ok(json!({ "collection": collection, "insertOne": document }));
        }
        let mut command = Map::from_iter([
            ("insert".to_string(), Value::String(collection)),
            ("documents".to_string(), Value::Array(vec![document])),
        ]);
        command.extend(options);
        return Ok(json!({ "command": command }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "insertMany") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB insertMany() requires a document array and optional options document."
                    .into(),
            );
        }
        let documents = required_document_array(args.first(), "insertMany documents")?;
        let options = options_argument(
            args.get(1),
            "insertMany options",
            &[
                "bypassDocumentValidation",
                "comment",
                "ordered",
                "writeConcern",
            ],
        )?;
        if options.is_empty() {
            return Ok(json!({ "collection": collection, "insertMany": documents }));
        }
        let mut command = Map::from_iter([
            ("insert".to_string(), Value::String(collection)),
            ("documents".to_string(), Value::Array(documents)),
        ]);
        command.extend(options);
        return Ok(json!({ "command": command }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "insert") {
        if !tail.is_empty() || args.len() != 1 {
            return Err("MongoDB insert() requires one document or document array.".into());
        }
        let value = normalized_value(&args[0])?;
        return match value {
            Value::Object(_) => Ok(json!({ "collection": collection, "insertOne": value })),
            Value::Array(values) if !values.is_empty() && values.iter().all(Value::is_object) => {
                Ok(json!({ "collection": collection, "insertMany": values }))
            }
            _ => Err("MongoDB insert() requires a document or non-empty document array.".into()),
        };
    }

    for (method, many) in [("updateOne", false), ("updateMany", true)] {
        if let Some((args, tail)) = method_call(source, prefix_end, method) {
            if !tail.is_empty() || !(2..=3).contains(&args.len()) {
                return Err(format!(
                    "MongoDB {method}() requires filter, update and optional options."
                ));
            }
            let filter = required_document_value(args.first(), "update filter")?;
            let update = required_update_value(args.get(1), "update expression")?;
            let mut options = options_argument(
                args.get(2),
                "update options",
                &[
                    "arrayFilters",
                    "bypassDocumentValidation",
                    "collation",
                    "comment",
                    "hint",
                    "let",
                    "upsert",
                    "writeConcern",
                ],
            )?;
            if update.is_object() && options.keys().all(|key| key == "upsert") {
                let mut command = Map::from_iter([
                    ("collection".to_string(), Value::String(collection)),
                    (
                        method.to_string(),
                        json!({
                            "filter": filter,
                            "update": update,
                            "upsert": options.remove("upsert").unwrap_or(Value::Bool(false)),
                        }),
                    ),
                ]);
                return Ok(Value::Object(std::mem::take(&mut command)));
            }
            let mut update_spec = Map::from_iter([
                ("q".to_string(), filter),
                ("u".to_string(), update),
                ("multi".to_string(), Value::Bool(many)),
            ]);
            for key in ["arrayFilters", "collation", "hint", "upsert"] {
                if let Some(value) = options.remove(key) {
                    update_spec.insert(key.to_string(), value);
                }
            }
            let mut command = Map::from_iter([
                ("update".to_string(), Value::String(collection)),
                (
                    "updates".to_string(),
                    Value::Array(vec![Value::Object(update_spec)]),
                ),
            ]);
            command.extend(options);
            return Ok(json!({ "command": command }));
        }
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "update") {
        if !tail.is_empty() || !(2..=3).contains(&args.len()) {
            return Err("MongoDB update() requires filter, update and optional options.".into());
        }
        let filter = required_document_value(args.first(), "update filter")?;
        let update = required_update_value(args.get(1), "update expression")?;
        let mut options = options_argument(
            args.get(2),
            "legacy update options",
            &[
                "arrayFilters",
                "bypassDocumentValidation",
                "collation",
                "comment",
                "hint",
                "let",
                "multi",
                "upsert",
                "writeConcern",
            ],
        )?;
        let many = options
            .remove("multi")
            .map(|value| {
                value.as_bool().ok_or_else(|| {
                    "MongoDB legacy update multi option must be boolean.".to_string()
                })
            })
            .transpose()?
            .unwrap_or(false);
        let mut update_spec = Map::from_iter([
            ("q".to_string(), filter),
            ("u".to_string(), update),
            ("multi".to_string(), Value::Bool(many)),
        ]);
        for key in ["arrayFilters", "collation", "hint", "upsert"] {
            if let Some(value) = options.remove(key) {
                update_spec.insert(key.to_string(), value);
            }
        }
        let mut command = Map::from_iter([
            ("update".to_string(), Value::String(collection)),
            (
                "updates".to_string(),
                Value::Array(vec![Value::Object(update_spec)]),
            ),
        ]);
        command.extend(options);
        return Ok(json!({ "command": command }));
    }

    for (method, many) in [("deleteOne", false), ("deleteMany", true)] {
        if let Some((args, tail)) = method_call(source, prefix_end, method) {
            if !tail.is_empty() || !(1..=2).contains(&args.len()) {
                return Err(format!(
                    "MongoDB {method}() requires a filter and optional options document."
                ));
            }
            let filter = required_document_value(args.first(), "delete filter")?;
            let mut options = options_argument(
                args.get(1),
                "delete options",
                &["collation", "comment", "hint", "let", "writeConcern"],
            )?;
            if options.is_empty() {
                let command = Map::from_iter([
                    ("collection".to_string(), Value::String(collection)),
                    (method.to_string(), filter),
                ]);
                return Ok(Value::Object(command));
            }
            let mut delete_spec = Map::from_iter([
                ("q".to_string(), filter),
                ("limit".to_string(), json!(if many { 0 } else { 1 })),
            ]);
            for key in ["collation", "hint"] {
                if let Some(value) = options.remove(key) {
                    delete_spec.insert(key.to_string(), value);
                }
            }
            let mut command = Map::from_iter([
                ("delete".to_string(), Value::String(collection)),
                (
                    "deletes".to_string(),
                    Value::Array(vec![Value::Object(delete_spec)]),
                ),
            ]);
            command.extend(options);
            return Ok(json!({ "command": command }));
        }
    }

    for method in ["findOneAndUpdate", "findOneAndReplace"] {
        if let Some((args, tail)) = method_call(source, prefix_end, method) {
            if !tail.is_empty() || !(2..=3).contains(&args.len()) {
                return Err(format!(
                    "MongoDB {method}() requires filter, value and optional options."
                ));
            }
            let filter = required_document_value(args.first(), "findAndModify filter")?;
            let value = if method == "findOneAndUpdate" {
                required_update_value(args.get(1), "findAndModify update")?
            } else {
                required_document_value(args.get(1), "findAndModify replacement")?
            };
            let mut options = find_and_modify_options(args.get(2))?;
            let mut command = Map::from_iter([
                ("findAndModify".to_string(), Value::String(collection)),
                ("query".to_string(), filter),
                ("update".to_string(), value),
            ]);
            command.append(&mut options);
            return Ok(json!({ "command": command }));
        }
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "findOneAndDelete") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB findOneAndDelete() requires a filter and optional options.".into(),
            );
        }
        let filter = required_document_value(args.first(), "findAndModify filter")?;
        let mut options = find_and_modify_options(args.get(1))?;
        let mut command = Map::from_iter([
            ("findAndModify".to_string(), Value::String(collection)),
            ("query".to_string(), filter),
            ("remove".to_string(), Value::Bool(true)),
        ]);
        command.append(&mut options);
        return Ok(json!({ "command": command }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "createIndex") {
        if !tail.is_empty() || !(1..=2).contains(&args.len()) {
            return Err(
                "MongoDB createIndex() requires keys and optional options document.".into(),
            );
        }
        let keys = required_document_value(args.first(), "index keys")?;
        let mut spec = options_argument(
            args.get(1),
            "createIndex options",
            &[
                "background",
                "collation",
                "default_language",
                "expireAfterSeconds",
                "hidden",
                "language_override",
                "name",
                "partialFilterExpression",
                "sparse",
                "storageEngine",
                "textIndexVersion",
                "unique",
                "weights",
                "wildcardProjection",
            ],
        )?;
        spec.insert("key".to_string(), keys);
        return Ok(json!({
            "command": { "createIndexes": collection, "indexes": [spec] }
        }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "dropIndex") {
        if !tail.is_empty() || args.len() != 1 {
            return Err("MongoDB dropIndex() requires one index name or key document.".into());
        }
        let index = normalized_value(&args[0])?;
        if !index.is_string() && !index.is_object() {
            return Err("MongoDB dropIndex() requires an index name or key document.".into());
        }
        return Ok(json!({ "command": { "dropIndexes": collection, "index": index } }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "dropIndexes") {
        if !tail.is_empty() || !args.is_empty() {
            return Err("MongoDB dropIndexes() does not accept arguments.".into());
        }
        return Ok(json!({ "command": { "dropIndexes": collection, "index": "*" } }));
    }

    if let Some((args, tail)) = method_call(source, prefix_end, "drop") {
        if !tail.is_empty() || !args.is_empty() {
            return Err("MongoDB drop() does not accept arguments.".into());
        }
        return Ok(json!({ "command": { "drop": collection } }));
    }

    Err("Unsupported MongoDB shell command. Use a supported method or native JSON command.".into())
}

/// `use <database>` changes the shell's selected database; it is not JavaScript
/// evaluation. Accept one bare, whitespace-free token only and let the native
/// driver apply its final server-compatible database-name validation.
fn parse_use_database(source: &str) -> Option<&str> {
    let prefix = source.get(..3)?;
    if !prefix.eq_ignore_ascii_case("use") {
        return None;
    }
    let suffix = source.get(3..)?;
    if !suffix.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let database = suffix.trim();
    (!database.is_empty() && !database.chars().any(char::is_whitespace) && !database.contains(';'))
        .then_some(database)
}

fn required_document_value(value: Option<&String>, label: &str) -> Result<Value, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    if !value.is_object() {
        return Err(format!("MongoDB {label} must be a document."));
    }
    Ok(value)
}

fn required_document_array(value: Option<&String>, label: &str) -> Result<Vec<Value>, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    let Value::Array(values) = value else {
        return Err(format!("MongoDB {label} must be an array."));
    };
    if values.is_empty() || values.iter().any(|value| !value.is_object()) {
        return Err(format!(
            "MongoDB {label} must contain at least one document."
        ));
    }
    Ok(values)
}

fn required_update_value(value: Option<&String>, label: &str) -> Result<Value, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    let valid_document = value
        .as_object()
        .is_some_and(|document| !document.is_empty());
    let valid_pipeline = value
        .as_array()
        .is_some_and(|pipeline| !pipeline.is_empty() && pipeline.iter().all(Value::is_object));
    if !valid_document && !valid_pipeline {
        return Err(format!(
            "MongoDB {label} must be a non-empty document or pipeline array."
        ));
    }
    Ok(value)
}

fn options_argument(
    value: Option<&String>,
    label: &str,
    allowed: &[&str],
) -> Result<Map<String, Value>, String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(Map::new());
    };
    let options = normalized_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("MongoDB {label} must be a document."))?;
    if let Some(unknown) = options.keys().find(|key| {
        !allowed
            .iter()
            .any(|allowed_key| allowed_key == &key.as_str())
    }) {
        return Err(format!("Unsupported MongoDB {label} field: {unknown}."));
    }
    Ok(options)
}

fn find_and_modify_options(value: Option<&String>) -> Result<Map<String, Value>, String> {
    let mut options = options_argument(
        value,
        "findOneAnd* options",
        &[
            "arrayFilters",
            "bypassDocumentValidation",
            "collation",
            "comment",
            "hint",
            "let",
            "maxTimeMS",
            "projection",
            "returnDocument",
            "returnNewDocument",
            "sort",
            "upsert",
            "writeConcern",
        ],
    )?;
    if let Some(projection) = options.remove("projection") {
        if !projection.is_object() {
            return Err("MongoDB findOneAnd* projection must be a document.".into());
        }
        options.insert("fields".to_string(), projection);
    }
    let return_document = options
        .remove("returnDocument")
        .or_else(|| options.remove("returnNewDocument"));
    if let Some(value) = return_document {
        let return_new = match value {
            Value::String(value) if value.eq_ignore_ascii_case("after") => true,
            Value::String(value) if value.eq_ignore_ascii_case("before") => false,
            Value::Bool(value) => value,
            _ => {
                return Err(
                    "MongoDB findOneAnd* returnDocument must be 'before' or 'after'.".into(),
                )
            }
        };
        options.insert("new".to_string(), Value::Bool(return_new));
    }
    Ok(options)
}

fn parse_collection_prefix(source: &str) -> Result<(String, usize), String> {
    if !source
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("db."))
    {
        return Err("MongoDB shell command must start with db.<collection>.".into());
    }
    let rest = &source[3..];
    if rest.starts_with("getCollection") {
        let open = rest
            .find('(')
            .ok_or("Invalid db.getCollection() command.")?;
        let close = matching_paren(rest, open).ok_or("Invalid db.getCollection() command.")?;
        let args = split_top_level(&rest[open + 1..close]);
        if args.len() != 1 {
            return Err("db.getCollection() requires one collection name.".into());
        }
        let collection = string_argument(&args[0])?;
        let end = 3 + close + 1;
        let suffix = &source[end..];
        let trimmed = suffix.trim_start();
        if !trimmed.starts_with('.') {
            return Err("MongoDB collection method is required.".into());
        }
        return Ok((collection, end + suffix.len() - trimmed.len()));
    }
    let collection_end = rest
        .char_indices()
        .find_map(|(index, character)| {
            (character == '.' || character.is_whitespace()).then_some(index)
        })
        .ok_or("MongoDB collection method is required.")?;
    let collection = &rest[..collection_end];
    if collection.is_empty()
        || !collection
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(
            "Invalid MongoDB collection name; use db.getCollection() for dotted names.".into(),
        );
    }
    let suffix = &rest[collection_end..];
    let dot = suffix
        .find('.')
        .ok_or("MongoDB collection method is required.")?;
    if !suffix[..dot].trim().is_empty() {
        return Err("Invalid MongoDB collection name.".into());
    }
    Ok((collection.to_string(), 3 + collection_end + dot))
}

fn method_call(source: &str, prefix_end: usize, method: &str) -> Option<(Vec<String>, String)> {
    let raw_suffix = &source[prefix_end..];
    let suffix = raw_suffix.trim_start();
    let whitespace = raw_suffix.len() - suffix.len();
    let expected = format!(".{method}");
    if !suffix.starts_with(&expected) || !suffix[expected.len()..].starts_with('(') {
        return None;
    }
    let open = prefix_end + whitespace + expected.len();
    let close = matching_paren(source, open)?;
    Some((
        split_top_level(&source[open + 1..close]),
        source[close + 1..].trim().to_string(),
    ))
}

fn chained_calls(chain: &str) -> Result<Vec<(String, Vec<String>)>, String> {
    let mut rest = chain.trim();
    let mut calls = Vec::new();
    while !rest.is_empty() {
        let Some(after_dot) = rest.strip_prefix('.') else {
            return Err("Invalid MongoDB method chain.".into());
        };
        let open = after_dot.find('(').ok_or("Invalid MongoDB method chain.")?;
        let name = after_dot[..open].trim();
        if name.is_empty()
            || !name
                .chars()
                .all(|character| character.is_ascii_alphabetic())
        {
            return Err("Invalid MongoDB method chain.".into());
        }
        let close = matching_paren(after_dot, open).ok_or("Invalid MongoDB method chain.")?;
        calls.push((
            name.to_string(),
            split_top_level(&after_dot[open + 1..close]),
        ));
        rest = after_dot[close + 1..].trim();
    }
    Ok(calls)
}

fn object_argument(value: Option<&String>, label: &str) -> Result<Map<String, Value>, String> {
    let value = value.map(String::as_str).unwrap_or("{}");
    normalized_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("MongoDB {label} must be a document."))
}

fn optional_object_argument(
    value: Option<&String>,
    label: &str,
) -> Result<Option<Map<String, Value>>, String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| object_argument(Some(value), label))
        .transpose()
}

fn required_object_argument(args: &[String], label: &str) -> Result<Map<String, Value>, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one document."));
    }
    object_argument(args.first(), label)
}

fn bounded_integer(
    args: &[String],
    label: &str,
    minimum: i64,
    maximum: i64,
) -> Result<i64, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one integer."));
    }
    let value = args[0]
        .trim()
        .parse::<i64>()
        .map_err(|_| format!("MongoDB {label}() requires an integer."))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "MongoDB {label}() must be between {minimum} and {maximum}."
        ));
    }
    Ok(value)
}

fn optional_explain_verbosity(args: &[String]) -> Result<String, String> {
    if args.is_empty() {
        return Ok("queryPlanner".to_string());
    }
    if args.len() != 1 {
        return Err("MongoDB explain() accepts at most one verbosity string.".into());
    }
    let value = string_argument(&args[0])?;
    if !matches!(
        value.as_str(),
        "queryPlanner" | "executionStats" | "allPlansExecution"
    ) {
        return Err("Unsupported MongoDB explain() verbosity.".into());
    }
    Ok(value)
}

fn string_argument(value: &str) -> Result<String, String> {
    normalized_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "MongoDB argument must be a string.".into())
}

fn normalized_value(input: &str) -> Result<Value, String> {
    let transformed = transform_shell_constructors(input.trim())?;
    json5::from_str(&transformed).map_err(|error| format!("Invalid MongoDB argument: {error}"))
}

fn transform_shell_constructors(input: &str) -> Result<String, String> {
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    let mut quote = None;
    let mut escaped = false;
    while index < input.len() {
        let rest = &input[index..];
        let character = rest.chars().next().ok_or("Invalid MongoDB argument.")?;
        if let Some(delimiter) = quote {
            output.push(character);
            index += character.len_utf8();
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            output.push(character);
            index += character.len_utf8();
            continue;
        }
        let constructor = [
            "NumberDecimal(",
            "NumberLong(",
            "NumberInt(",
            "ObjectId(",
            "ISODate(",
            "Timestamp(",
            "BinData(",
        ]
        .into_iter()
        .find(|constructor| rest.starts_with(constructor));
        let Some(constructor) = constructor else {
            output.push(character);
            index += character.len_utf8();
            continue;
        };
        let open = index + constructor.len() - 1;
        let close = matching_paren(input, open).ok_or("Unclosed MongoDB value constructor.")?;
        let arguments = split_top_level(&input[open + 1..close]);
        let extended = shell_constructor_value(constructor.trim_end_matches('('), &arguments)?;
        output.push_str(&extended.to_string());
        index = close + 1;
    }
    Ok(output)
}

fn shell_constructor_value(name: &str, arguments: &[String]) -> Result<Value, String> {
    match name {
        "ObjectId" | "ISODate" => {
            if arguments.len() != 1 {
                return Err(format!("MongoDB {name}() requires one string."));
            }
            let value = string_argument(&arguments[0])?;
            let key = if name == "ObjectId" { "$oid" } else { "$date" };
            Ok(Value::Object(Map::from_iter([(
                key.to_string(),
                json!(value),
            )])))
        }
        "NumberLong" | "NumberInt" | "NumberDecimal" => {
            if arguments.len() != 1 {
                return Err(format!("MongoDB {name}() requires one numeric value."));
            }
            let parsed = json5::from_str::<Value>(arguments[0].trim())
                .map_err(|_| format!("MongoDB {name}() requires one numeric value."))?;
            let value = match parsed {
                Value::String(value) => value,
                Value::Number(value) => value.to_string(),
                _ => return Err(format!("MongoDB {name}() requires one numeric value.")),
            };
            let key = match name {
                "NumberLong" => "$numberLong",
                "NumberInt" => "$numberInt",
                _ => "$numberDecimal",
            };
            Ok(Value::Object(Map::from_iter([(
                key.to_string(),
                json!(value),
            )])))
        }
        "Timestamp" => {
            if arguments.len() != 2 {
                return Err("MongoDB Timestamp() requires time and increment integers.".into());
            }
            let time = arguments[0]
                .trim()
                .parse::<u32>()
                .map_err(|_| "MongoDB Timestamp() time must be an unsigned integer.".to_string())?;
            let increment = arguments[1].trim().parse::<u32>().map_err(|_| {
                "MongoDB Timestamp() increment must be an unsigned integer.".to_string()
            })?;
            Ok(json!({ "$timestamp": { "t": time, "i": increment } }))
        }
        "BinData" => {
            if arguments.len() != 2 {
                return Err("MongoDB BinData() requires subtype and base64 data.".into());
            }
            let subtype = arguments[0]
                .trim()
                .parse::<u8>()
                .map_err(|_| "MongoDB BinData() subtype must be between 0 and 255.".to_string())?;
            let base64 = string_argument(&arguments[1])?;
            Ok(json!({
                "$binary": {
                    "base64": base64,
                    "subType": format!("{subtype:02x}"),
                }
            }))
        }
        _ => Err(format!("Unsupported MongoDB value constructor: {name}().")),
    }
}

fn matching_paren(source: &str, open: usize) -> Option<usize> {
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, byte) in source.as_bytes().iter().enumerate().skip(open) {
        let character = *byte as char;
        if escaped {
            escaped = false;
            continue;
        }
        if let Some(delimiter) = quote {
            if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == '(' {
            depth += 1;
        } else if character == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn split_top_level(source: &str) -> Vec<String> {
    if source.trim().is_empty() {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut start = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, byte) in source.as_bytes().iter().enumerate() {
        let character = *byte as char;
        if escaped {
            escaped = false;
            continue;
        }
        if let Some(delimiter) = quote {
            if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
        } else if character == ',' && depth == 0 {
            result.push(source[start..index].trim().to_string());
            start = index + 1;
        }
    }
    result.push(source[start..].trim().to_string());
    result
}

fn split_shell_statements(source: &str) -> Result<Vec<&str>, String> {
    let mut statements = Vec::new();
    let mut start = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let bytes = source.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let character = bytes[index] as char;
        let next = bytes.get(index + 1).copied().map(char::from);
        if line_comment {
            if matches!(character, '\n' | '\r') {
                line_comment = false;
            }
            index += 1;
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            index += 1;
            continue;
        }
        if (character == '/' && next == Some('/')) || (character == '-' && next == Some('-')) {
            line_comment = true;
            index += 2;
            continue;
        }
        if character == '/' && next == Some('*') {
            block_comment = true;
            index += 2;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
            if depth < 0 {
                return Err("MongoDB shell command has unbalanced delimiters.".into());
            }
        } else if character == ';' && depth == 0 {
            let statement = source[start..index].trim();
            if !statement.is_empty() {
                statements.push(statement);
            }
            start = index + 1;
        }
        index += 1;
    }
    if quote.is_some() || block_comment || depth != 0 {
        return Err("MongoDB shell command has an unclosed string, comment, or delimiter.".into());
    }
    let statement = source[start..].trim();
    if !statement.is_empty() {
        statements.push(statement);
    }
    if statements.is_empty() {
        return Err("MongoDB shell command is required.".into());
    }
    Ok(statements)
}

fn trim_outer_comments(mut source: &str) -> &str {
    loop {
        source = source.trim_start();
        if source.starts_with("//") || source.starts_with("--") {
            source = source
                .find(['\n', '\r'])
                .map(|index| &source[index + 1..])
                .unwrap_or("");
            continue;
        }
        if source.starts_with("/*") {
            let Some(end) = source.find("*/") else {
                return source;
            };
            source = &source[end + 2..];
            continue;
        }
        break;
    }

    let source = source.trim_end();
    let mut body_end = 0;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut characters = source.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        let next = characters.peek().map(|(_, character)| *character);
        if line_comment {
            if matches!(character, '\n' | '\r') {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                block_comment = false;
                characters.next();
            }
            continue;
        }
        if let Some(delimiter) = quote {
            body_end = index + character.len_utf8();
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if (character == '/' && next == Some('/')) || (character == '-' && next == Some('-')) {
            line_comment = true;
            characters.next();
            continue;
        }
        if character == '/' && next == Some('*') {
            block_comment = true;
            characters.next();
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        }
        if !character.is_whitespace() {
            body_end = index + character.len_utf8();
        }
    }
    source[..body_end].trim_end()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_read_shell_find_chain_and_extended_json() {
        let value = parse_command(
            "db.products.find({_id: ObjectId('507f1f77bcf86cd799439011')}, {name: 1}).sort({name: 1}).skip(2).limit(5)",
        )
        .unwrap();
        assert_eq!(value["collection"], "products");
        assert_eq!(value["find"]["_id"]["$oid"], "507f1f77bcf86cd799439011");
        assert_eq!(value["projection"]["name"], 1);
        assert_eq!(value["sort"]["name"], 1);
        assert_eq!(value["skip"], 2);
        assert_eq!(value["limit"], 5);

        let literal = parse_command(
            r#"db.products.find({note: "ObjectId('not-a-constructor')"}) // read only"#,
        )
        .unwrap();
        assert_eq!(literal["find"]["note"], "ObjectId('not-a-constructor')");

        let localized = parse_command(
            "db.products.find({name: 'Ada'}).collation({locale: 'en', strength: 1}).limit(10)",
        )
        .unwrap();
        assert_eq!(localized["collation"]["locale"], "en");

        let explained = parse_command(
            "db.products.find({active: true}).sort({name: 1}).explain('executionStats')",
        )
        .unwrap();
        assert_eq!(explained["command"]["explain"]["find"], "products");
        assert_eq!(explained["command"]["verbosity"], "executionStats");

        let hinted = parse_command(
            "db.products.find({active: true}, {name: 1}, {hint: {active: 1}, maxTimeMS: 500})",
        )
        .unwrap();
        assert_eq!(hinted["findOptions"]["hint"]["active"], 1);
        assert_eq!(hinted["findOptions"]["maxTimeMS"], 500);

        let aggregate = parse_command(
            "db.products.aggregate([{$match: {active: true}}], {allowDiskUse: true, maxTimeMS: 1000})",
        )
        .unwrap();
        assert_eq!(aggregate["aggregateOptions"]["allowDiskUse"], true);
        assert_eq!(aggregate["aggregateOptions"]["maxTimeMS"], 1000);
    }

    #[test]
    fn parses_dotted_collection_and_read_helpers() {
        let value =
            parse_command("db.getCollection('audit.logs').distinct('tenant.id', {active: true})")
                .unwrap();
        assert_eq!(value["command"]["distinct"], "audit.logs");
        assert_eq!(value["command"]["key"], "tenant.id");
        assert_eq!(value["command"]["query"]["active"], true);

        let indexes = parse_command("db.users.getIndexes()").unwrap();
        assert_eq!(indexes["command"]["listIndexes"], "users");

        let databases = parse_command("show databases").unwrap();
        assert_eq!(databases["command"]["listDatabases"], 1);
        let version = parse_command("db.version()").unwrap();
        assert_eq!(version["command"]["buildInfo"], 1);
    }

    #[test]
    fn parses_a_single_shell_use_database_statement() {
        let command = parse_command("use reporting").unwrap();
        assert_eq!(command["useDatabase"], "reporting");
        assert!(looks_like_shell_command("use reporting"));
        assert!(!looks_like_shell_command("useful"));
        assert!(parse_command("use reporting warehouse").is_err());
    }

    #[test]
    fn keeps_shell_reads_bounded_and_structurally_marks_mutating_aggregation() {
        let find = parse_command("db.users.find({active: true})").unwrap();
        assert_eq!(find["limit"], DEFAULT_FIND_LIMIT);
        assert!(parse_command("db.users.find({}).limit(0)").is_err());
        assert!(parse_command("db.users.find({}).limit(10001)").is_err());
        let aggregate = parse_command("db.users.aggregate([{$out: 'backup'}])").unwrap();
        assert_eq!(aggregate["collection"], "users");
        assert_eq!(aggregate["aggregate"][0]["$out"], "backup");
    }

    #[test]
    fn splits_multiple_shell_reads_without_splitting_literals() {
        let commands = parse_commands(
            "db.users.find({note: 'a;b'}).limit(5); db.orders.count({active: true});",
        )
        .unwrap();
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0]["find"]["note"], "a;b");
        assert_eq!(commands[1]["collection"], "orders");
    }

    #[test]
    fn lowers_shell_mutations_to_explicit_native_commands() {
        let insert = parse_command(
            "db.users.insertMany([{name: 'Ada'}, {name: 'Grace'}], {ordered: false})",
        )
        .unwrap();
        assert_eq!(insert["command"]["insert"], "users");
        assert_eq!(insert["command"]["documents"].as_array().unwrap().len(), 2);
        assert_eq!(insert["command"]["ordered"], false);

        let update = parse_command(
            "db.users.updateMany({active: false}, [{$set: {active: true}}], {upsert: true, comment: 'repair'})",
        )
        .unwrap();
        assert_eq!(update["command"]["update"], "users");
        assert_eq!(update["command"]["updates"][0]["multi"], true);
        assert_eq!(update["command"]["updates"][0]["upsert"], true);
        assert_eq!(update["command"]["comment"], "repair");

        let delete = parse_command(
            "db.users.deleteOne({_id: ObjectId('507f1f77bcf86cd799439011')}, {hint: {_id: 1}})",
        )
        .unwrap();
        assert_eq!(delete["command"]["delete"], "users");
        assert_eq!(delete["command"]["deletes"][0]["limit"], 1);
        assert_eq!(delete["command"]["deletes"][0]["hint"]["_id"], 1);

        let legacy = parse_command(
            "db.users.update({active: false}, {$set: {active: true}}, {multi: true})",
        )
        .unwrap();
        assert_eq!(legacy["command"]["updates"][0]["multi"], true);
    }

    #[test]
    fn rejects_unknown_mutation_options_and_malformed_payloads() {
        assert!(parse_command("db.users.insertMany([])").is_err());
        assert!(parse_command("db.users.updateOne({}, {}, {unknown: true})").is_err());
        assert!(parse_command("db.users.deleteOne({}, {unknown: true})").is_err());
        assert!(parse_command("db.users.createIndex('name')").is_err());
    }

    #[test]
    fn maps_atomic_mutations_and_extended_shell_constructors() {
        let command = parse_command(
            "db.events.findOneAndUpdate({_id: ObjectId('507f1f77bcf86cd799439011')}, {$set: {count: NumberLong('9223372036854775807'), ratio: NumberDecimal('1.25'), stamp: Timestamp(42, 7), raw: BinData(4, 'AQID')}}, {projection: {count: 1}, returnDocument: 'after'})",
        )
        .unwrap();
        assert_eq!(command["command"]["findAndModify"], "events");
        assert_eq!(command["command"]["new"], true);
        assert_eq!(command["command"]["fields"]["count"], 1);
        assert_eq!(
            command["command"]["update"]["$set"]["count"]["$numberLong"],
            "9223372036854775807"
        );
        assert_eq!(
            command["command"]["update"]["$set"]["ratio"]["$numberDecimal"],
            "1.25"
        );
        assert_eq!(
            command["command"]["update"]["$set"]["stamp"]["$timestamp"]["t"],
            42
        );
        assert_eq!(
            command["command"]["update"]["$set"]["raw"]["$binary"]["subType"],
            "04"
        );
    }
}
