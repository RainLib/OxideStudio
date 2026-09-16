use super::command_targets::{
    common_write_targets, destructive_target_scope, disables_security_controls,
    downloads_piped_to_shell, find_exec_command, git_is_destructive, has_recursive_flag,
    is_device_path, is_package_install, path_is_outside_project, redirection_targets,
    rm_is_recursive, rm_targets, shell_c_command, wrapper_nested_command, xargs_nested_command,
    DestructiveTargetScope,
};
use super::policy_config::finding;
use super::syntax::{command_arguments, executable_basename, parse_shell_syntax};
use super::types::{
    BuiltInCommandPolicyHook, CommandPolicyContext, CommandPolicyDecision, CommandPolicyFinding,
    CommandPolicyHook, ShellSandboxMode,
};

impl CommandPolicyHook for BuiltInCommandPolicyHook {
    fn evaluate(&self, context: &CommandPolicyContext<'_>) -> Vec<CommandPolicyFinding> {
        let mut findings = Vec::new();
        let normalized = context.command.to_ascii_lowercase();

        if normalized.contains(":(){ :|:& };:")
            || normalized.contains(":(){:|:&};:")
            || normalized.contains(": () { :|:& }; :")
        {
            findings.push(finding(
                "builtin.shell.fork-bomb",
                CommandPolicyDecision::Block,
                "Fork bomb blocked",
                "This command can exhaust the machine by spawning processes without a bound.",
                Some(":(){ :|:& };:"),
            ));
        }
        if context.syntax.has_error {
            findings.push(finding(
                "builtin.shell.unparsed",
                CommandPolicyDecision::Confirm,
                "Shell syntax could not be fully inspected",
                "OxideStudio could not prove that every command target is safe.",
                None,
            ));
        }
        if context.syntax.has_command_substitution || context.syntax.has_process_substitution {
            findings.push(finding(
                "builtin.shell.dynamic-substitution",
                CommandPolicyDecision::Confirm,
                "Dynamic shell execution",
                "Command or process substitution can construct an executable or target at runtime.",
                None,
            ));
        }

        for parsed in &context.syntax.commands {
            let Some(executable) = parsed.executable.as_deref() else {
                if !parsed.text.trim().is_empty() {
                    findings.push(finding(
                        "builtin.shell.dynamic-executable",
                        CommandPolicyDecision::Confirm,
                        "Dynamic executable name",
                        "The command executable cannot be resolved before execution.",
                        Some(&parsed.text),
                    ));
                }
                continue;
            };
            let executable = executable_basename(executable);
            let arguments = command_arguments(parsed);
            if parsed.dynamic {
                findings.push(finding(
                    "builtin.shell.dynamic-arguments",
                    CommandPolicyDecision::Confirm,
                    "Dynamic command arguments",
                    "Variable or command expansion affects this command and requires deliberate confirmation.",
                    Some(&parsed.text),
                ));
            }

            for target in redirection_targets(parsed) {
                if is_device_path(target) {
                    findings.push(finding(
                        "builtin.system.device-redirection",
                        CommandPolicyDecision::Block,
                        "Protected device write blocked",
                        "Shell redirection cannot write directly to a protected device.",
                        Some(target),
                    ));
                } else if context.sandbox_mode == ShellSandboxMode::Unrestricted
                    && path_is_outside_project(
                        context.project_root,
                        context.working_directory,
                        target,
                    )
                {
                    findings.push(finding(
                        "builtin.fs.unrestricted-external-write",
                        CommandPolicyDecision::Confirm,
                        "Write outside the project",
                        "Unrestricted mode can modify this path outside the active project.",
                        Some(target),
                    ));
                }
            }

            if matches!(
                executable.as_str(),
                "mkfs"
                    | "mkfs.ext4"
                    | "mkfs.xfs"
                    | "fdisk"
                    | "parted"
                    | "sfdisk"
                    | "wipefs"
                    | "format"
                    | "format.com"
            ) {
                findings.push(finding(
                    "builtin.system.disk-format",
                    CommandPolicyDecision::Block,
                    "Disk formatting blocked",
                    "Formatting or repartitioning disks is never allowed through the Agent shell.",
                    Some(&parsed.text),
                ));
            }
            if executable == "diskutil"
                && arguments.iter().any(|argument| {
                    matches!(
                        argument.to_ascii_lowercase().as_str(),
                        "erasedisk" | "erasevolume" | "partitiondisk" | "secureerase"
                    )
                })
            {
                findings.push(finding(
                    "builtin.system.diskutil-erase",
                    CommandPolicyDecision::Block,
                    "Disk erase blocked",
                    "Destructive diskutil operations are outside the project boundary.",
                    Some(&parsed.text),
                ));
            }
            if executable == "dd"
                && arguments.iter().any(|argument| {
                    argument
                        .to_ascii_lowercase()
                        .strip_prefix("of=")
                        .is_some_and(is_device_path)
                })
            {
                findings.push(finding(
                    "builtin.system.raw-device-write",
                    CommandPolicyDecision::Block,
                    "Raw device write blocked",
                    "Writing directly to a device can irreversibly destroy data.",
                    Some(&parsed.text),
                ));
            }
            if matches!(
                executable.as_str(),
                "shutdown" | "reboot" | "halt" | "poweroff"
            ) {
                findings.push(finding(
                    "builtin.system.power-control",
                    CommandPolicyDecision::Block,
                    "Power control blocked",
                    "The Agent shell cannot shut down or restart the machine.",
                    Some(&parsed.text),
                ));
            }
            if matches!(executable.as_str(), "sandbox-exec" | "bwrap" | "unshare") {
                findings.push(finding(
                    "builtin.shell.sandbox-bypass",
                    CommandPolicyDecision::Block,
                    "Sandbox bypass blocked",
                    "Nested sandbox or namespace commands can invalidate OxideStudio's execution boundary.",
                    Some(&parsed.text),
                ));
            }
            if matches!(executable.as_str(), "sudo" | "doas" | "su") {
                findings.push(finding(
                    "builtin.system.privilege-escalation",
                    CommandPolicyDecision::Confirm,
                    "Privilege elevation requested",
                    "This command may run with permissions beyond the active user or sandbox.",
                    Some(&parsed.text),
                ));
            }
            if matches!(executable.as_str(), "eval" | "exec") {
                findings.push(finding(
                    "builtin.shell.eval-exec",
                    CommandPolicyDecision::Confirm,
                    "Dynamically evaluated command",
                    "eval and exec can hide the final executable from static inspection.",
                    Some(&parsed.text),
                ));
            }
            if matches!(
                executable.as_str(),
                "systemctl" | "service" | "launchctl" | "sc" | "net"
            ) {
                findings.push(finding(
                    "builtin.system.service-management",
                    CommandPolicyDecision::Confirm,
                    "System service operation",
                    "Starting, stopping, or reconfiguring services can affect the whole machine.",
                    Some(&parsed.text),
                ));
            }
            if matches!(
                executable.as_str(),
                "kill" | "killall" | "pkill" | "taskkill" | "stop-process"
            ) {
                findings.push(finding(
                    "builtin.system.process-management",
                    CommandPolicyDecision::Confirm,
                    "Process management command",
                    "Stopping processes can interrupt unrelated work or system services.",
                    Some(&parsed.text),
                ));
            }
            if disables_security_controls(executable.as_str(), &arguments) {
                findings.push(finding(
                    "builtin.system.security-disable",
                    CommandPolicyDecision::Block,
                    "Security controls cannot be disabled",
                    "The Agent shell cannot disable operating-system security, malware protection, or firewall enforcement.",
                    Some(&parsed.text),
                ));
            }
            if matches!(executable.as_str(), "chmod" | "chown" | "chgrp")
                && has_recursive_flag(&arguments)
            {
                findings.push(finding(
                    "builtin.fs.recursive-permissions",
                    CommandPolicyDecision::Confirm,
                    "Recursive permission change",
                    "Recursive ownership or permission changes can make project files inaccessible.",
                    Some(&parsed.text),
                ));
            }
            if is_package_install(executable.as_str(), &arguments) {
                findings.push(finding(
                    "builtin.system.package-install",
                    CommandPolicyDecision::Confirm,
                    "Package installation",
                    "Installing packages can execute third-party lifecycle scripts or change system state.",
                    Some(&parsed.text),
                ));
            }
            if executable == "git" && git_is_destructive(&arguments) {
                findings.push(finding(
                    "builtin.git.destructive-worktree",
                    CommandPolicyDecision::Confirm,
                    "Destructive Git operation",
                    "This Git command can discard tracked or untracked project changes.",
                    Some(&parsed.text),
                ));
            }
            if executable == "rm" && rm_is_recursive(&arguments) {
                for target in rm_targets(&arguments) {
                    match destructive_target_scope(
                        context.project_root,
                        context.working_directory,
                        target,
                    ) {
                        DestructiveTargetScope::System => findings.push(finding(
                            "builtin.fs.system-recursive-delete",
                            CommandPolicyDecision::Block,
                            "System-wide recursive deletion blocked",
                            "The delete target is the filesystem root, home directory, or an ancestor of the active project.",
                            Some(target),
                        )),
                        DestructiveTargetScope::ProjectRoot => findings.push(finding(
                            "builtin.fs.project-root-delete",
                            CommandPolicyDecision::Confirm,
                            "Project root deletion",
                            "This command can delete the entire active project, including untracked files.",
                            Some(target),
                        )),
                        DestructiveTargetScope::Dynamic => findings.push(finding(
                            "builtin.fs.dynamic-delete-target",
                            CommandPolicyDecision::Confirm,
                            "Dynamic recursive delete target",
                            "The recursive delete target cannot be resolved safely before execution.",
                            Some(target),
                        )),
                        DestructiveTargetScope::ProjectChild => {}
                    }
                }
            }

            if executable == "xargs" {
                if let Some(nested) = xargs_nested_command(&arguments) {
                    let nested_syntax = parse_shell_syntax(&nested);
                    let nested_context = CommandPolicyContext {
                        project_root: context.project_root,
                        working_directory: context.working_directory,
                        command: &nested,
                        sandbox_mode: context.sandbox_mode,
                        syntax: &nested_syntax,
                    };
                    findings.extend(BuiltInCommandPolicyHook.evaluate(&nested_context));
                    if nested_syntax.commands.iter().any(|command| {
                        command.executable.as_deref().is_some_and(|value| {
                            executable_basename(value) == "rm"
                                && rm_is_recursive(&command_arguments(command))
                        })
                    }) {
                        findings.push(finding(
                            "builtin.fs.xargs-recursive-delete",
                            CommandPolicyDecision::Confirm,
                            "Dynamic recursive delete target",
                            "xargs supplies delete targets at runtime, so their scope cannot be proven safe.",
                            Some(&parsed.text),
                        ));
                    }
                }
            }
            if executable == "find" {
                if let Some((nested, search_roots)) = find_exec_command(&arguments) {
                    let nested_syntax = parse_shell_syntax(&nested);
                    let nested_context = CommandPolicyContext {
                        project_root: context.project_root,
                        working_directory: context.working_directory,
                        command: &nested,
                        sandbox_mode: context.sandbox_mode,
                        syntax: &nested_syntax,
                    };
                    findings.extend(BuiltInCommandPolicyHook.evaluate(&nested_context));
                    if nested_syntax.commands.iter().any(|command| {
                        command.executable.as_deref().is_some_and(|value| {
                            executable_basename(value) == "rm"
                                && rm_is_recursive(&command_arguments(command))
                        })
                    }) {
                        for root in search_roots {
                            let (decision, title, detail) = match destructive_target_scope(
                                context.project_root,
                                context.working_directory,
                                root,
                            ) {
                                DestructiveTargetScope::System => (
                                    CommandPolicyDecision::Block,
                                    "System-wide find deletion blocked",
                                    "find -exec can recursively delete entries outside the active project.",
                                ),
                                _ => (
                                    CommandPolicyDecision::Confirm,
                                    "Dynamic find deletion",
                                    "find -exec chooses delete targets at runtime and requires explicit confirmation.",
                                ),
                            };
                            findings.push(finding(
                                "builtin.fs.find-exec-delete",
                                decision,
                                title,
                                detail,
                                Some(root),
                            ));
                        }
                    }
                }
            }
            if matches!(executable.as_str(), "sudo" | "doas" | "command") {
                if let Some(nested) = wrapper_nested_command(&arguments) {
                    let nested_syntax = parse_shell_syntax(&nested);
                    let nested_context = CommandPolicyContext {
                        project_root: context.project_root,
                        working_directory: context.working_directory,
                        command: &nested,
                        sandbox_mode: context.sandbox_mode,
                        syntax: &nested_syntax,
                    };
                    findings.extend(BuiltInCommandPolicyHook.evaluate(&nested_context));
                }
            }
            if matches!(
                executable.as_str(),
                "sh" | "bash" | "zsh" | "fish" | "powershell" | "pwsh"
            ) {
                if let Some(nested) = shell_c_command(&arguments) {
                    let nested_syntax = parse_shell_syntax(nested);
                    let nested_context = CommandPolicyContext {
                        project_root: context.project_root,
                        working_directory: context.working_directory,
                        command: nested,
                        sandbox_mode: context.sandbox_mode,
                        syntax: &nested_syntax,
                    };
                    findings.extend(BuiltInCommandPolicyHook.evaluate(&nested_context));
                }
            }

            if context.sandbox_mode == ShellSandboxMode::Unrestricted {
                for target in common_write_targets(executable.as_str(), &arguments) {
                    if path_is_outside_project(
                        context.project_root,
                        context.working_directory,
                        target,
                    ) {
                        findings.push(finding(
                            "builtin.fs.unrestricted-external-write",
                            CommandPolicyDecision::Confirm,
                            "Write outside the project",
                            "Unrestricted mode can modify this path outside the active project.",
                            Some(target),
                        ));
                    }
                }
            }
        }

        if downloads_piped_to_shell(context.command) {
            findings.push(finding(
                "builtin.network.pipe-to-shell",
                CommandPolicyDecision::Confirm,
                "Downloaded content executes as code",
                "Reviewing a remote script is not possible when it is piped directly into an interpreter.",
                None,
            ));
        }
        findings
    }
}
