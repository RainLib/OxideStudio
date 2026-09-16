use super::types::MAX_DRIVER_CATALOG_FIELD_LENGTH;
use regex::Regex;
use semver::{Version, VersionReq};

pub(super) fn validate_connection_url_template(template: Option<&str>) -> Result<(), String> {
    let Some(template) = template else {
        return Ok(());
    };
    if template.is_empty()
        || template.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH
        || template.chars().any(char::is_control)
        || !template
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
    {
        return Err("Driver connection URL template is invalid".to_string());
    }

    let allowed = ["{host}", "{port}", "{database}", "{user}", "{password}"];
    let mut remaining = template;
    while let Some(open) = remaining.find('{') {
        let (prefix, suffix) = remaining.split_at(open);
        if prefix.contains('}') {
            return Err("Driver connection URL template has unmatched braces".to_string());
        }
        let Some(close) = suffix.find('}') else {
            return Err("Driver connection URL template has unmatched braces".to_string());
        };
        let placeholder = &suffix[..=close];
        if !allowed.contains(&placeholder) {
            return Err(
                "Driver connection URL template has an unsupported placeholder".to_string(),
            );
        }
        remaining = &suffix[close + 1..];
    }
    if remaining.contains('}') {
        return Err("Driver connection URL template has unmatched braces".to_string());
    }
    Ok(())
}

/// Package ranges use explicit, comma-or-space separated comparators such as
/// `>= 6 < 9`. Keeping the grammar deliberately narrow avoids treating a
/// product banner as executable policy while still covering the range syntax
/// published by the driver catalog.
pub(super) fn normalized_server_version_range(range: &str) -> Result<String, String> {
    if range.trim().is_empty() || range.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
        return Err("Driver server version range is invalid".to_string());
    }
    let pattern = Regex::new(r"(>=|<=|>|<|=)\s*(\d+(?:\.\d+){0,2})")
        .expect("server version range expression must compile");
    let mut at = 0;
    let mut comparators = Vec::new();
    for matched in pattern.captures_iter(range) {
        let whole = matched
            .get(0)
            .expect("range match must have a whole capture");
        if !range[at..whole.start()]
            .chars()
            .all(|character| character.is_ascii_whitespace() || character == ',')
        {
            return Err("Driver server version range uses unsupported syntax".to_string());
        }
        let version = matched
            .get(2)
            .expect("range match must have a version capture")
            .as_str();
        let mut parts = version.split('.');
        let major = parts.next().expect("version capture has a major");
        let minor = parts.next().unwrap_or("0");
        let patch = parts.next().unwrap_or("0");
        comparators.push(format!(
            "{}{}.{}.{}",
            matched
                .get(1)
                .expect("range match must have a comparator")
                .as_str(),
            major,
            minor,
            patch
        ));
        at = whole.end();
    }
    if comparators.is_empty()
        || !range[at..]
            .chars()
            .all(|character| character.is_ascii_whitespace() || character == ',')
    {
        return Err("Driver server version range uses unsupported syntax".to_string());
    }
    Ok(comparators.join(", "))
}

pub(super) fn validate_server_version_range(range: Option<&str>) -> Result<(), String> {
    let Some(range) = range else {
        return Ok(());
    };
    let normalized = normalized_server_version_range(range)?;
    VersionReq::parse(&normalized)
        .map(|_| ())
        .map_err(|_| "Driver server version range is invalid".to_string())
}

/// Compare a product banner returned by a sidecar with its signed manifest.
/// We intentionally extract only the first numeric version sequence: JDBC and
/// native clients commonly return banners such as `PostgreSQL 16.3 (Ubuntu)`.
pub fn validate_server_version_compatibility(
    range: Option<&str>,
    detected_version: Option<&str>,
) -> Result<(), String> {
    let Some(range) = range else {
        return Ok(());
    };
    let normalized = normalized_server_version_range(range)?;
    let requirement = VersionReq::parse(&normalized)
        .map_err(|_| "Driver server version range is invalid".to_string())?;
    let detected = detected_version.unwrap_or_default();
    let version_pattern =
        Regex::new(r"\d+(?:\.\d+){0,2}").expect("server version expression must compile");
    let Some(version) = version_pattern.find(detected).map(|value| value.as_str()) else {
        return Err(
            "Driver could not determine a numeric server version required by its package"
                .to_string(),
        );
    };
    let mut parts = version.split('.');
    let normalized_version = format!(
        "{}.{}.{}",
        parts.next().expect("version capture has a major"),
        parts.next().unwrap_or("0"),
        parts.next().unwrap_or("0")
    );
    let parsed = Version::parse(&normalized_version)
        .map_err(|_| "Driver returned an invalid server version".to_string())?;
    if requirement.matches(&parsed) {
        Ok(())
    } else {
        Err(format!(
            "Server version {version} is outside this driver package's supported range {range}"
        ))
    }
}
