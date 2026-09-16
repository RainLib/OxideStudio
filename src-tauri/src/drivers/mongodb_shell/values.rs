use super::source::{matching_paren, split_top_level};
use serde_json::{json, Map, Value};

pub(super) fn normalized_value(input: &str) -> Result<Value, String> {
    let transformed = transform_shell_constructors(input.trim())?;
    json5::from_str(&transformed).map_err(|error| format!("Invalid MongoDB argument: {error}"))
}

pub(super) fn string_argument(value: &str) -> Result<String, String> {
    normalized_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "MongoDB argument must be a string.".into())
}

pub(super) fn transform_shell_constructors(input: &str) -> Result<String, String> {
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

pub(super) fn shell_constructor_value(name: &str, arguments: &[String]) -> Result<Value, String> {
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
