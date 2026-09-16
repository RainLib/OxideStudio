//! Executable discovery and launch environment shared by detection, login and turns.
use super::CliProviderKind;
use anyhow::{anyhow, Result};
#[cfg(windows)]
use std::ffi::OsStr;
use std::{
    env,
    path::{Path, PathBuf},
};
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliCommandSpec {
    pub program: String,
    pub prefix_args: Vec<String>,
    pub resolved_path: Option<String>,
}

impl CliCommandSpec {
    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        // GUI launches do not inherit the shell's Node manager PATH. npm
        // entrypoints use /usr/bin/env node, including during login/catalog probes.
        if let Some(path) = launch_path(Path::new(&self.program), env::var_os("PATH").as_deref()) {
            command.env("PATH", path);
        }
        command
    }
}

pub fn validate_configured_program(value: Option<&str>, default_program: &str) -> Result<String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_program);
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(anyhow!(
            "CLI executable path contains unsupported characters"
        ));
    }
    if !is_path_like(value)
        && !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(anyhow!(
            "CLI executable must be a path or command name without arguments"
        ));
    }
    Ok(value.to_string())
}

pub async fn resolve_command(
    provider: CliProviderKind,
    configured: Option<&str>,
) -> Result<CliCommandSpec> {
    let default_program = match provider {
        CliProviderKind::CodexCli => "codex",
        CliProviderKind::CodebuddyCli => "codebuddy",
    };
    let configured = validate_configured_program(configured, default_program)?;
    if is_path_like(&configured) {
        let path = expand_tilde(&configured);
        if !path.is_file() {
            return Err(anyhow!(
                "{} executable was not found at {}",
                provider.display_name(),
                path.display()
            ));
        }
        return command_for_path(provider, path);
    }

    let mut names = vec![configured.clone()];
    if provider == CliProviderKind::CodebuddyCli && configured == default_program {
        names.push("cbc".to_string());
    }
    for name in names {
        if let Some(path) = find_program(&name) {
            return command_for_path(provider, path);
        }
    }
    Err(anyhow!(
        "{} is not installed or is not available on PATH",
        provider.display_name()
    ))
}

/// Resolve an auxiliary executable without accepting command-line arguments.
/// This is used by the managed CLI setup flow for trusted tools such as npm.
pub fn resolve_named_command(name: &str) -> Result<CliCommandSpec> {
    let configured = validate_configured_program(Some(name), name)?;
    let path = find_program(&configured)
        .ok_or_else(|| anyhow!("{configured} is not installed or is not available on PATH"))?;
    #[cfg(windows)]
    {
        // npm on Windows is normally exposed as npm.cmd. Launching that shim
        // through cmd.exe is brittle for desktop processes (especially with
        // nvm-windows and a PATH inherited before Node was installed). Use the
        // real npm JavaScript entrypoint through node.exe instead.
        if let Some(spec) = windows_npm_node_entrypoint(&path) {
            return Ok(spec);
        }
    }
    command_for_generic_path(path)
}

pub(super) fn command_for_path(
    _provider: CliProviderKind,
    path: PathBuf,
) -> Result<CliCommandSpec> {
    #[cfg(windows)]
    {
        if _provider == CliProviderKind::CodexCli {
            if let Some(spec) = windows_codex_node_entrypoint(&path) {
                return Ok(spec);
            }
        } else if _provider == CliProviderKind::CodebuddyCli {
            if let Some(spec) = windows_codebuddy_node_entrypoint(&path) {
                return Ok(spec);
            }
        }
    }
    command_for_generic_path(path)
}

fn command_for_generic_path(path: PathBuf) -> Result<CliCommandSpec> {
    // The runtime changes cwd to a private temporary directory after discovery.
    let path = std::path::absolute(path)?;
    let resolved_path = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        let extension = path
            .extension()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "cmd" | "bat") {
            return Ok(CliCommandSpec {
                program: env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
                prefix_args: vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/C".to_string(),
                    resolved_path.clone(),
                ],
                resolved_path: Some(resolved_path),
            });
        }
    }
    Ok(CliCommandSpec {
        program: resolved_path.clone(),
        prefix_args: Vec::new(),
        resolved_path: Some(resolved_path),
    })
}

#[cfg(windows)]
pub(super) fn windows_codex_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension != "cmd" && extension != "bat" {
        return None;
    }
    let parent = path.parent()?;
    let codex_js = [
        // npm global installation layout.
        parent
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js"),
        // OxideStudio managed installation layout:
        // <profile>/node_modules/.bin/codex.cmd
        parent
            .parent()?
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())?;
    let bundled_node = parent.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };
    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![codex_js.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

#[cfg(windows)]
pub(super) fn windows_codebuddy_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension != "cmd" && extension != "bat" {
        return None;
    }
    let parent = path.parent()?;
    let codebuddy_entrypoint = [
        // npm global installation layout.
        parent
            .join("node_modules")
            .join("@tencent-ai")
            .join("codebuddy-code")
            .join("bin")
            .join("codebuddy"),
        // OxideStudio managed installation layout:
        // <profile>/node_modules/.bin/codebuddy.cmd
        parent
            .parent()?
            .join("@tencent-ai")
            .join("codebuddy-code")
            .join("bin")
            .join("codebuddy"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())?;
    let bundled_node = parent.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };
    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![codebuddy_entrypoint.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

#[cfg(windows)]
pub(super) fn windows_npm_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let file_name = path.file_name()?.to_str()?;
    let is_npm = file_name.eq_ignore_ascii_case("npm")
        || path
            .file_stem()
            .and_then(OsStr::to_str)
            .is_some_and(|stem| stem.eq_ignore_ascii_case("npm"));
    if !is_npm || !matches!(extension.as_str(), "" | "cmd" | "bat") {
        return None;
    }

    let parent = path.parent()?;
    let npm_cli = parent
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if !npm_cli.is_file() {
        return None;
    }
    let sibling_node = parent.join("node.exe");
    let node = if sibling_node.is_file() {
        sibling_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };

    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![npm_cli.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

fn find_program(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if is_executable_file(path) {
        return Some(path.to_path_buf());
    }
    let mut directories = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend(common_cli_directories());

    find_program_in_directories(name, directories)
}

pub(super) fn find_program_in_directories(
    name: &str,
    directories: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    #[cfg(windows)]
    // Node distributions contain both a Unix `npm` script and `npm.cmd`.
    // Windows launchable formats must win over an extensionless sibling.
    let extensions = [".exe", ".cmd", ".bat", ""];
    #[cfg(not(windows))]
    let extensions = [""];

    for directory in directories {
        for extension in extensions {
            let candidate = directory.join(format!("{name}{extension}"));
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn common_cli_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    #[cfg(windows)]
    {
        for key in ["NVM_SYMLINK", "NVM_HOME"] {
            if let Some(directory) = env::var_os(key) {
                let directory = PathBuf::from(directory);
                directories.push(directory.clone());
                directories.extend(version_directories(&directory));
            }
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            directories.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            directories.push(local_app_data.join("Programs/nodejs"));
            let nvm = local_app_data.join("nvm");
            directories.push(nvm.clone());
            directories.extend(version_directories(&nvm));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join("nodejs"));
        }
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            let user = PathBuf::from(user_profile);
            directories.push(user.join(".local/bin"));
            let nvm = user.join("AppData/Roaming/nvm");
            directories.extend(version_directories(&nvm));
        }
        if let Some(system_drive) = env::var_os("SystemDrive") {
            directories.push(PathBuf::from(system_drive).join("nvm4w/nodejs"));
        }
        // nvm-windows commonly uses this symlink even when a desktop process
        // was launched before NVM_SYMLINK was added to its inherited environment.
        directories.push(PathBuf::from(r"C:\nvm4w\nodejs"));
    }
    #[cfg(not(windows))]
    {
        directories.extend([
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ]);
        if let Some(home) = env::var_os("HOME") {
            directories.extend(unix_user_directories(Path::new(&home)));
        }
        if let Some(root) = env::var_os("NVM_DIR") {
            directories.extend(
                version_directories(&PathBuf::from(root).join("versions/node"))
                    .into_iter()
                    .map(|path| path.join("bin")),
            );
        }
        for key in ["VOLTA_HOME", "ASDF_DATA_DIR"] {
            if let Some(root) = env::var_os(key) {
                directories.push(PathBuf::from(root).join(if key == "VOLTA_HOME" {
                    "bin"
                } else {
                    "shims"
                }));
            }
        }
    }
    directories
}

fn version_directories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| {
        let version = |path: &PathBuf| {
            path.file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| semver::Version::parse(name.trim_start_matches('v')).ok())
        };
        version(right)
            .cmp(&version(left))
            .then_with(|| right.cmp(left))
    });
    versions
}

fn is_path_like(value: &str) -> bool {
    Path::new(value).is_absolute()
        || value.contains('/')
        || value.contains('\\')
        || value.starts_with('~')
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
        if let Some(home) = home {
            let suffix = value
                .trim_start_matches('~')
                .trim_start_matches(['/', '\\']);
            return PathBuf::from(home).join(suffix);
        }
    }
    PathBuf::from(value)
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0);
    }
    #[cfg(not(unix))]
    true
}

#[cfg(not(windows))]
fn unix_user_directories(home: &Path) -> Vec<PathBuf> {
    let mut directories = vec![
        home.join(".local/bin"),
        home.join(".volta/bin"),
        home.join(".asdf/shims"),
        home.join(".npm-global/bin"),
    ];
    directories.extend(
        version_directories(&home.join(".nvm/versions/node"))
            .into_iter()
            .map(|path| path.join("bin")),
    );
    directories
}

fn launch_path(program: &Path, inherited: Option<&std::ffi::OsStr>) -> Option<std::ffi::OsString> {
    let mut directories = Vec::new();
    if let Some(parent) = program.parent().filter(|path| path.is_absolute()) {
        directories.push(parent.to_path_buf());
    }
    if let Some(path) = inherited {
        directories.extend(env::split_paths(path).filter(|path| path.is_absolute()));
    }
    directories.extend(common_cli_directories());
    let mut seen = std::collections::HashSet::new();
    directories.retain(|path| seen.insert(path.clone()));
    env::join_paths(directories).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn npm_entrypoint_runs_with_gui_path_and_isolated_cwd() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join(".nvm/versions/node/v22.17.1/bin");
        std::fs::create_dir_all(&bin).unwrap();
        for (name, content) in [
            ("node", "#!/bin/sh\nprintf 'runtime-ok'\n"),
            ("codex", "#!/usr/bin/env node\n"),
        ] {
            let file = bin.join(name);
            std::fs::write(&file, content).unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path =
            find_program_in_directories("codex", unix_user_directories(root.path())).unwrap();
        let spec = command_for_path(CliProviderKind::CodexCli, path).unwrap();
        let mut command = spec.command();
        command.env(
            "PATH",
            launch_path(
                Path::new(&spec.program),
                Some(std::ffi::OsStr::new("/usr/bin:/bin")),
            )
            .unwrap(),
        );
        let output = command
            .current_dir(tempfile::tempdir().unwrap().path())
            .output()
            .await
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"runtime-ok");
    }
    #[test]
    fn node_versions_sort_numerically() {
        let root = tempfile::tempdir().unwrap();
        for version in ["v9.0.0", "v22.17.1", "v22.9.0"] {
            std::fs::create_dir(root.path().join(version)).unwrap();
        }
        assert_eq!(
            version_directories(root.path())[0].file_name().unwrap(),
            "v22.17.1"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discovery_skips_non_executable_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("codex"), "not executable").unwrap();
        assert!(find_program_in_directories("codex", [root.path().to_path_buf()]).is_none());
    }
}
