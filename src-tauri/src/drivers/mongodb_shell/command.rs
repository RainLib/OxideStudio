use super::arguments::{
    bounded_integer, find_and_modify_options, object_argument, optional_explain_verbosity,
    optional_object_argument, options_argument, required_document_array, required_document_value,
    required_object_argument, required_update_value,
};
use super::source::{
    chained_calls, method_call, parse_collection_prefix, parse_use_database,
    split_shell_statements, trim_outer_comments,
};
use super::values::{normalized_value, string_argument};
use serde_json::{json, Map, Value};

pub(super) const DEFAULT_FIND_LIMIT: i64 = 100;
pub(super) const MAX_FIND_LIMIT: i64 = 10_000;

pub(crate) fn looks_like_shell_command(input: &str) -> bool {
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

pub(crate) fn parse_commands(input: &str) -> Result<Vec<Value>, String> {
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
