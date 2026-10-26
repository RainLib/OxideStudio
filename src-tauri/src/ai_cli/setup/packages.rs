use super::paths::managed_executable_path;
use crate::ai_cli::runtime::{run_captured, CliCommandSpec};
use crate::ai_cli::CliProviderKind;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(super) const NPM_REGISTRY: &str = "https://registry.npmjs.org/";
// Large bundled CLIs can take several minutes to download on ordinary links.
// Keep a bounded deadline without cancelling a healthy transfer after 60s.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(super) const CODEX_PACKAGE_VERSION: &str = "0.147.0";

pub(super) const CODEX_PACKAGE_INTEGRITY: &str =
    "sha512-EQLEXecAG2ptxI7UpBMo2TR/ga5596/c/OsYF/0LoUDh5JANZ7IoGqlzBEWbuEVQ76JePIbtTW/ihCkp1a7Z3w==";

pub(super) const CODEBUDDY_PACKAGE_VERSION: &str = "2.135.0";

pub(super) const CODEBUDDY_PACKAGE_INTEGRITY: &str =
    "sha512-W6PgFWi16Px7V6F67qCZVJcfVhzW66oMhKgfoIPhtQPfhIO4TNWXawsPXfuULVgpyUl+kI6VWyR2CRQTUmC3TA==";

#[derive(Clone, Copy)]
pub(super) struct ManagedPackageSpec {
    pub(super) name: &'static str,
    pub(super) version: &'static str,
    pub(super) integrity: &'static str,
}

impl ManagedPackageSpec {
    pub(super) fn reference(self) -> String {
        format!("{}@{}", self.name, self.version)
    }

    pub(super) fn package_json_path(self, root: &Path) -> PathBuf {
        self.name
            .split('/')
            .fold(root.join("node_modules"), |path, part| path.join(part))
            .join("package.json")
    }
}

pub(super) fn managed_package_spec(provider: CliProviderKind) -> ManagedPackageSpec {
    match provider {
        CliProviderKind::CodexCli => ManagedPackageSpec {
            name: "@openai/codex",
            version: CODEX_PACKAGE_VERSION,
            integrity: CODEX_PACKAGE_INTEGRITY,
        },
        CliProviderKind::CodebuddyCli => ManagedPackageSpec {
            name: "@tencent-ai/codebuddy-code",
            version: CODEBUDDY_PACKAGE_VERSION,
            integrity: CODEBUDDY_PACKAGE_INTEGRITY,
        },
    }
}

pub(super) async fn download_verified_package(
    npm: &CliCommandSpec,
    package: ManagedPackageSpec,
    destination: &Path,
    cwd: &Path,
) -> Result<PathBuf> {
    let args = vec![
        "pack".to_string(),
        package.reference(),
        "--json".to_string(),
        "--pack-destination".to_string(),
        destination.to_string_lossy().into_owned(),
        format!("--registry={NPM_REGISTRY}"),
    ];
    let output = run_captured(
        npm,
        &args,
        &BTreeMap::new(),
        Some(cwd),
        None,
        DOWNLOAD_TIMEOUT,
    )
    .await
    .context("failed to download the managed package for verification")?;
    if !output.success {
        return Err(anyhow!(
            "managed package download failed: {}",
            first_output_line(&output.stderr, &output.stdout)
        ));
    }
    let response: Value = serde_json::from_str(output.stdout.trim())
        .context("npm returned an invalid package verification response")?;
    let result = response
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| anyhow!("npm returned no package verification result"))?;
    let actual_integrity = result
        .get("integrity")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if actual_integrity != package.integrity {
        return Err(anyhow!(
            "managed package integrity mismatch for {}: installation was stopped",
            package.reference()
        ));
    }
    let filename = result
        .get("filename")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("npm did not identify the verified package archive"))?;
    let filename_path = Path::new(filename);
    if filename_path.file_name().and_then(|value| value.to_str()) != Some(filename) {
        return Err(anyhow!("npm returned an unsafe package archive path"));
    }
    let archive = destination.join(filename);
    if !archive.is_file() {
        return Err(anyhow!(
            "verified managed package archive was not created at {}",
            archive.display()
        ));
    }
    Ok(archive)
}

pub(super) fn first_output_line<'a>(stderr: &'a str, stdout: &'a str) -> &'a str {
    stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("npm did not provide an error message")
}

pub(super) fn verify_staged_install(
    staging: &Path,
    provider: CliProviderKind,
    package: ManagedPackageSpec,
) -> Result<()> {
    let executable = managed_executable_path(staging, provider);
    if !executable.is_file() {
        return Err(anyhow!(
            "managed installation completed but {} was not created",
            executable.display()
        ));
    }
    let package_json_path = package.package_json_path(staging);
    let package_json: Value = serde_json::from_slice(
        &std::fs::read(&package_json_path)
            .with_context(|| format!("failed to read {}", package_json_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", package_json_path.display()))?;
    let actual_version = package_json
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if actual_version != package.version {
        return Err(anyhow!(
            "managed package version mismatch: expected {}, received {}",
            package.version,
            if actual_version.is_empty() {
                "an unspecified version"
            } else {
                actual_version
            }
        ));
    }
    Ok(())
}

pub(super) fn activate_managed_install(
    target: &Path,
    staging: &Path,
    provider: CliProviderKind,
) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("managed agent directory has no parent"))?;
    if staging.parent() != Some(parent) {
        return Err(anyhow!(
            "managed install staging directory is outside its target"
        ));
    }
    let backup = parent.join(format!(
        ".{}-backup-{}",
        provider.as_str(),
        uuid::Uuid::new_v4()
    ));
    let had_existing = target.exists();
    if had_existing {
        std::fs::rename(target, &backup).with_context(|| {
            format!(
                "failed to preserve the existing managed installation at {}",
                target.display()
            )
        })?;
    }
    if let Err(error) = std::fs::rename(staging, target) {
        if had_existing {
            let _ = std::fs::rename(&backup, target);
        }
        return Err(error).with_context(|| {
            format!(
                "failed to activate the verified managed installation at {}",
                target.display()
            )
        });
    }
    if had_existing {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(())
}
