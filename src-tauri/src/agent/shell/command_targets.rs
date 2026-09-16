use super::types::ParsedCommand;
use std::path::Path;
use std::path::PathBuf;

pub(super) fn has_recursive_flag(arguments: &[String]) -> bool {
    arguments.iter().any(|argument| {
        argument == "--recursive"
            || argument
                .strip_prefix('-')
                .is_some_and(|flags| flags.contains('R') || flags.contains('r'))
    })
}

pub(super) fn rm_is_recursive(arguments: &[String]) -> bool {
    has_recursive_flag(arguments)
}

pub(super) fn rm_targets(arguments: &[String]) -> impl Iterator<Item = &str> {
    arguments
        .iter()
        .map(String::as_str)
        .take_while(|argument| !matches!(*argument, ">" | "<"))
        .filter(|argument| !argument.starts_with('-'))
}

pub(super) fn redirection_targets(command: &ParsedCommand) -> Vec<&str> {
    let mut targets = Vec::new();
    let mut index = 0;
    while index < command.tokens.len() {
        if command.tokens[index] == ">" {
            index += 1;
            while command.tokens.get(index).is_some_and(|token| token == ">") {
                index += 1;
            }
            if let Some(target) = command.tokens.get(index) {
                targets.push(target.as_str());
            }
        }
        index += 1;
    }
    targets
}

pub(super) fn path_is_outside_project(
    project_root: &Path,
    working_directory: &Path,
    target: &str,
) -> bool {
    matches!(
        destructive_target_scope(project_root, working_directory, target),
        DestructiveTargetScope::System | DestructiveTargetScope::Dynamic
    )
}

pub(super) fn xargs_nested_command(arguments: &[String]) -> Option<String> {
    let mut index = 0;
    while let Some(argument) = arguments.get(index) {
        if matches!(
            argument.as_str(),
            "-I" | "--replace" | "-n" | "--max-args" | "-P" | "--max-procs" | "-s" | "--max-chars"
        ) {
            index += 2;
        } else if argument.starts_with('-') {
            index += 1;
        } else {
            return Some(arguments[index..].join(" "));
        }
    }
    None
}

pub(super) fn find_exec_command(arguments: &[String]) -> Option<(String, Vec<&str>)> {
    let exec_index = arguments
        .iter()
        .position(|argument| matches!(argument.as_str(), "-exec" | "-execdir"))?;
    let nested = arguments
        .iter()
        .skip(exec_index + 1)
        .take_while(|argument| !matches!(argument.as_str(), ";" | "+"))
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    if nested.is_empty() {
        return None;
    }
    let roots = arguments[..exec_index]
        .iter()
        .map(String::as_str)
        .take_while(|argument| !argument.starts_with('-'))
        .collect::<Vec<_>>();
    Some((nested, if roots.is_empty() { vec!["."] } else { roots }))
}

pub(super) fn wrapper_nested_command(arguments: &[String]) -> Option<String> {
    let mut index = 0;
    while let Some(argument) = arguments.get(index) {
        if matches!(
            argument.as_str(),
            "-u" | "-g" | "-h" | "-p" | "--user" | "--group" | "--host" | "--prompt"
        ) {
            index += 2;
        } else if argument.starts_with('-') {
            index += 1;
        } else {
            return Some(arguments[index..].join(" "));
        }
    }
    None
}

pub(super) fn shell_c_command(arguments: &[String]) -> Option<&str> {
    arguments
        .windows(2)
        .find(|pair| matches!(pair[0].as_str(), "-c" | "/c" | "-command"))
        .map(|pair| pair[1].as_str())
}

pub(super) fn common_write_targets<'a>(executable: &str, arguments: &'a [String]) -> Vec<&'a str> {
    match executable {
        "tee" => arguments
            .iter()
            .map(String::as_str)
            .filter(|argument| !argument.starts_with('-'))
            .collect(),
        "cp" | "mv" | "install" | "touch" | "mkdir" => arguments
            .iter()
            .rev()
            .map(String::as_str)
            .find(|argument| !argument.starts_with('-'))
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DestructiveTargetScope {
    ProjectChild,
    ProjectRoot,
    System,
    Dynamic,
}

pub(super) fn destructive_target_scope(
    project_root: &Path,
    working_directory: &Path,
    target: &str,
) -> DestructiveTargetScope {
    let normalized = target.trim_matches(|character| matches!(character, '\'' | '"'));
    if normalized.is_empty()
        || normalized.contains('$')
        || normalized.contains('`')
        || normalized.contains('*')
        || normalized == "{}"
    {
        return DestructiveTargetScope::Dynamic;
    }
    if normalized == "~"
        || normalized.starts_with("~/")
        || matches!(normalized, "$HOME" | "${HOME}")
    {
        return DestructiveTargetScope::System;
    }
    if matches!(normalized, "/" | "//")
        || is_windows_drive_root(normalized)
        || std::env::var_os("HOME")
            .map(PathBuf::from)
            .is_some_and(|home| Path::new(normalized) == home)
    {
        return DestructiveTargetScope::System;
    }
    let candidate = if Path::new(normalized).is_absolute() {
        PathBuf::from(normalized)
    } else {
        working_directory.join(normalized)
    };
    let candidate = lexical_normalize(&candidate);
    let project_root = lexical_normalize(project_root);
    if candidate == project_root {
        DestructiveTargetScope::ProjectRoot
    } else if project_root.starts_with(&candidate) {
        DestructiveTargetScope::System
    } else if candidate.starts_with(&project_root) {
        DestructiveTargetScope::ProjectChild
    } else {
        DestructiveTargetScope::System
    }
}

pub(super) fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

pub(super) fn is_windows_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

pub(super) fn is_device_path(value: &str) -> bool {
    value.starts_with("/dev/") || value.starts_with("\\\\.\\")
}

pub(super) fn is_package_install(executable: &str, arguments: &[String]) -> bool {
    let arguments = arguments
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    match executable {
        "npm" | "pnpm" | "yarn" | "bun" | "pip" | "pip3" | "gem" | "cargo" => arguments
            .iter()
            .any(|argument| matches!(argument.as_str(), "install" | "add")),
        "apt" | "apt-get" | "dnf" | "yum" | "brew" | "winget" | "choco" => arguments
            .iter()
            .any(|argument| matches!(argument.as_str(), "install" | "upgrade")),
        _ => false,
    }
}

pub(super) fn disables_security_controls(executable: &str, arguments: &[String]) -> bool {
    let normalized = arguments
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    match executable {
        "csrutil" => normalized.iter().any(|argument| argument == "disable"),
        "spctl" => normalized
            .iter()
            .any(|argument| matches!(argument.as_str(), "--master-disable" | "--global-disable")),
        "setenforce" => normalized.first().is_some_and(|value| value == "0"),
        "ufw" => normalized.iter().any(|argument| argument == "disable"),
        "set-mppreference" => normalized
            .iter()
            .any(|argument| argument == "-disablerealtimemonitoring" || argument == "$true"),
        "bcdedit" => {
            normalized
                .iter()
                .any(|argument| matches!(argument.as_str(), "testsigning" | "nointegritychecks"))
                && normalized.iter().any(|argument| argument == "on")
        }
        "systemctl" | "service" => {
            normalized.iter().any(|argument| {
                argument.contains("firewall")
                    || argument.contains("apparmor")
                    || argument.contains("selinux")
            }) && normalized
                .iter()
                .any(|argument| matches!(argument.as_str(), "stop" | "disable" | "mask"))
        }
        _ => false,
    }
}

pub(super) fn git_is_destructive(arguments: &[String]) -> bool {
    let normalized = arguments
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut index = 0;
    while let Some(argument) = normalized.get(index) {
        if matches!(argument.as_str(), "-c" | "-C" | "--git-dir" | "--work-tree") {
            index += 2;
        } else if argument.starts_with('-') {
            index += 1;
        } else {
            break;
        }
    }
    normalized.get(index).is_some_and(|subcommand| {
        let command_arguments = &normalized[index + 1..];
        (subcommand == "reset" && command_arguments.iter().any(|value| value == "--hard"))
            || (subcommand == "clean"
                && command_arguments.iter().any(|value| {
                    value == "--force"
                        || value
                            .strip_prefix('-')
                            .is_some_and(|flags| flags.contains('f'))
                }))
            || subcommand == "checkout" && command_arguments.iter().any(|value| value == "--")
            || subcommand == "restore"
                && command_arguments.iter().any(|value| value == "--worktree")
    })
}

pub(super) fn downloads_piped_to_shell(command: &str) -> bool {
    let normalized = command.to_ascii_lowercase();
    let downloads = normalized.contains("curl ") || normalized.contains("wget ");
    downloads
        && [
            "| sh",
            "| bash",
            "| zsh",
            "| fish",
            "| powershell",
            "| pwsh",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
}

pub(super) fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let (mut pattern_index, mut value_index) = (0, 0);
    let (mut star, mut star_match) = (None, 0);
    while value_index < value.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == b'?' || pattern[pattern_index] == value[value_index])
        {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star = Some(pattern_index);
            pattern_index += 1;
            star_match = value_index;
        } else if let Some(star_index) = star {
            pattern_index = star_index + 1;
            star_match += 1;
            value_index = star_match;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}
