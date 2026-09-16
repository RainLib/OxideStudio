use anyhow::{bail, Context, Result};
use std::path::{Component, Path, PathBuf};
use url::Url;

use super::runtime::{canonical_directory, GIT_FILE_LIMIT};

pub(super) fn validate_relative_path(value: &str) -> Result<String> {
    if value.is_empty() || value.contains('\0') {
        bail!("Git path is invalid");
    }
    let path = Path::new(value);
    if path.is_absolute() {
        bail!("Git path must be relative");
    }
    let mut segments = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => segments.push(
                value
                    .to_str()
                    .context("Git path must be valid UTF-8")?
                    .to_string(),
            ),
            Component::CurDir => {}
            _ => bail!("Git path cannot leave the project root"),
        }
    }
    if segments.is_empty() {
        bail!("Git path is required");
    }
    Ok(segments.join("/"))
}

pub(super) fn validated_paths(paths: &[String]) -> Result<Vec<String>> {
    if paths.is_empty() || paths.len() > GIT_FILE_LIMIT {
        bail!("select between 1 and {GIT_FILE_LIMIT} Git paths");
    }
    paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect()
}

pub(super) fn validate_remote_url(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_whitespace) {
        bail!("Git repository URL is invalid");
    }
    if let Ok(url) = Url::parse(value) {
        if !matches!(url.scheme(), "http" | "https" | "ssh" | "git") {
            bail!("Git repository URL must use HTTPS, HTTP, SSH, or Git protocol");
        }
        if matches!(url.scheme(), "http" | "https")
            && (!url.username().is_empty() || url.password().is_some())
        {
            bail!("Git repository URL must not contain credentials");
        }
        if url.host_str().is_none() {
            bail!("Git repository URL must include a host");
        }
        return Ok(value.to_string());
    }
    let Some((host, path)) = value.split_once(':') else {
        bail!("Git repository URL must be an absolute remote URL");
    };
    if path.is_empty()
        || !host.contains('@')
        || host.starts_with('@')
        || host.ends_with('@')
        || path.starts_with('/')
    {
        bail!("Git SSH URL is invalid");
    }
    Ok(value.to_string())
}

pub(super) fn validate_remote_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || value.starts_with('-')
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        bail!("Git remote name is invalid");
    }
    Ok(value.to_string())
}

pub(super) fn validate_commit_message(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("commit message is required");
    }
    if value.len() > 16_384 || value.contains('\0') {
        bail!("commit message is too large or invalid");
    }
    Ok(value.to_string())
}

pub(super) fn validate_commit_revision(value: &str) -> Result<String> {
    let value = value.trim();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("Git commit revision must be a full hexadecimal object id");
    }
    Ok(value.to_ascii_lowercase())
}

pub(super) fn validate_clone_destination(value: &str) -> Result<PathBuf> {
    let destination = Path::new(value.trim());
    let destination = canonical_directory(destination, "clone destination")?;
    if std::fs::read_dir(&destination)?
        .next()
        .transpose()?
        .is_some()
    {
        bail!("clone destination must be an empty directory");
    }
    Ok(destination)
}
