use super::command_targets::wildcard_match;
use super::policy_config::finding;
use super::syntax::executable_basename;
use super::types::{
    CommandPolicyContext, CommandPolicyFinding, CommandPolicyHook, DeclarativeCommandPolicyHook,
};
use regex::Regex;

impl CommandPolicyHook for DeclarativeCommandPolicyHook {
    fn evaluate(&self, context: &CommandPolicyContext<'_>) -> Vec<CommandPolicyFinding> {
        let cwd = context
            .working_directory
            .to_string_lossy()
            .replace('\\', "/");
        context
            .syntax
            .commands
            .iter()
            .flat_map(|command| {
                self.rules.iter().filter_map(|rule| {
                    if !rule.sandbox_modes.is_empty()
                        && !rule
                            .sandbox_modes
                            .iter()
                            .any(|mode| mode == context.sandbox_mode.as_str())
                    {
                        return None;
                    }
                    if !rule.executables.is_empty() {
                        let executable = command.executable.as_deref().map(executable_basename)?;
                        if !rule
                            .executables
                            .iter()
                            .any(|candidate| candidate.eq_ignore_ascii_case(&executable))
                        {
                            return None;
                        }
                    }
                    if let Some(pattern) = rule.argument_regex.as_deref() {
                        let regex = Regex::new(pattern).ok()?;
                        if !regex.is_match(&command.text) {
                            return None;
                        }
                    }
                    if let Some(pattern) = rule.cwd_glob.as_deref() {
                        if !wildcard_match(pattern, &cwd) {
                            return None;
                        }
                    }
                    Some(finding(
                        &format!("{}.{}", self.source, rule.id),
                        rule.action,
                        "Command policy rule matched",
                        rule.message.as_deref().unwrap_or(
                            "A configured command policy requires additional protection.",
                        ),
                        Some(&command.text),
                    ))
                })
            })
            .collect()
    }
}
