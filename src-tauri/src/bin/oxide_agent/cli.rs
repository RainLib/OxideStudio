use crate::oxide_agent::{
    bridge_mcp, catalog, mcp,
    policy::Grant,
    runtime::ToolRuntime,
    store::{resolve_data_dir, HeadlessStore},
};
use anyhow::{anyhow, Context, Result};
use clap::{Args, Parser, Subcommand};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

const MAX_INPUT_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Parser)]
#[command(
    name = "oxide-agent",
    version,
    about = "OxideStudio project-scoped read-only MCP and CLI tools"
)]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run an MCP transport.
    Mcp {
        #[command(subcommand)]
        command: McpCommand,
    },
    /// Discover or call the same bounded tool registry without MCP.
    Tools {
        #[command(subcommand)]
        command: ToolsCommand,
    },
}

#[derive(Debug, Subcommand)]
enum McpCommand {
    /// Serve MCP 2025-11-25 over stdin/stdout.
    Stdio(ScopeArgs),
    /// Internal Desktop-authenticated MCP bridge. Not a public integration surface.
    #[command(hide = true)]
    Bridge,
}

#[derive(Debug, Subcommand)]
enum ToolsCommand {
    /// List available first-release tools.
    List,
    /// Print one tool's contract.
    Inspect { name: String },
    /// Invoke one tool with a JSON object loaded from @file.
    Call {
        name: String,
        #[arg(long, value_name = "@FILE")]
        input: String,
        #[command(flatten)]
        scope: ScopeArgs,
    },
}

#[derive(Debug, Clone, Args)]
pub struct ScopeArgs {
    /// Immutable project grant for this process.
    #[arg(long, env = "OXIDE_PROJECT_ID")]
    project: String,
    /// Optional immutable connection grant. Omitting it grants project-scoped connection selection.
    #[arg(long, env = "OXIDE_CONNECTION_ID")]
    connection: Option<String>,
    /// Override OxideStudio's application-data directory.
    #[arg(long, env = "OXIDE_DATA_DIR")]
    data_dir: Option<PathBuf>,
    /// Maximum query rows returned to a caller.
    #[arg(long, default_value_t = 200, value_parser = parse_max_rows)]
    max_rows: usize,
    /// Maximum serialized bytes returned by one tool call.
    #[arg(long, default_value_t = 262_144, value_parser = parse_max_result_bytes)]
    max_result_bytes: usize,
    /// Global database query timeout in seconds. Omit for 30 seconds; 0 disables the deadline.
    #[arg(long, env = "OXIDE_MCP_QUERY_TIMEOUT_SECS", value_parser = parse_query_timeout_secs)]
    query_timeout_secs: Option<u64>,
}

impl Cli {
    pub async fn execute(self) -> Result<()> {
        match self.command {
            Command::Mcp {
                command: McpCommand::Stdio(scope),
            } => {
                let runtime = scope.runtime().await?;
                mcp::serve_stdio(runtime).await
            }
            Command::Mcp {
                command: McpCommand::Bridge,
            } => bridge_mcp::serve_stdio().await,
            Command::Tools {
                command: ToolsCommand::List,
            } => print_json(&catalog::all()),
            Command::Tools {
                command: ToolsCommand::Inspect { name },
            } => {
                let tool = catalog::find(&name)
                    .ok_or_else(|| anyhow!("unknown OxideStudio tool: {name}"))?;
                print_json(&tool)
            }
            Command::Tools {
                command: ToolsCommand::Call { name, input, scope },
            } => {
                if catalog::find(&name).is_none() {
                    return Err(anyhow!("unknown OxideStudio tool: {name}"));
                }
                let input = read_input_reference(&input)?;
                let result = scope.runtime().await?.invoke(&name, input).await?;
                print_json(&result)
            }
        }
    }
}

impl ScopeArgs {
    async fn runtime(self) -> Result<Arc<ToolRuntime>> {
        let grant = Grant::new(
            self.project,
            self.connection,
            self.max_rows,
            self.max_result_bytes,
        )?;
        let data_dir = resolve_data_dir(self.data_dir)?;
        let store = HeadlessStore::open(&data_dir).await?;
        Ok(Arc::new(
            ToolRuntime::new(store, grant, self.query_timeout_secs).await?,
        ))
    }
}

pub fn parse() -> Cli {
    Cli::parse()
}

pub fn reject_approval_flags() -> Result<()> {
    if std::env::args_os().skip(1).any(|argument| {
        let argument = argument.to_string_lossy();
        argument == "--approve" || argument.starts_with("--approve=")
    }) {
        return Err(anyhow!(
            "--approve is forbidden: CLI callers cannot self-authorize database actions"
        ));
    }
    Ok(())
}

fn read_input_reference(reference: &str) -> Result<Value> {
    let path = reference
        .strip_prefix('@')
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| anyhow!("--input must use @file so JSON is not exposed in process args"))?;
    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path)
        .with_context(|| format!("failed to inspect tool input file {}", path.display()))?;
    if !metadata.is_file() {
        return Err(anyhow!("tool input is not a regular file"));
    }
    if metadata.len() > MAX_INPUT_FILE_BYTES {
        return Err(anyhow!(
            "tool input exceeds the {} byte limit",
            MAX_INPUT_FILE_BYTES
        ));
    }
    let bytes = std::fs::read(&path)
        .with_context(|| format!("failed to read tool input file {}", path.display()))?;
    let value: Value = serde_json::from_slice(&bytes).context("tool input is not valid JSON")?;
    if !value.is_object() {
        return Err(anyhow!("tool input must be a JSON object"));
    }
    Ok(value)
}

fn print_json(value: &impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn parse_max_rows(value: &str) -> Result<usize, String> {
    parse_bounded_usize(value, 1, 1_000, "max rows")
}

fn parse_max_result_bytes(value: &str) -> Result<usize, String> {
    parse_bounded_usize(value, 4_096, 1_048_576, "max result bytes")
}

fn parse_query_timeout_secs(value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| "query timeout must be a non-negative integer".to_string())
}

fn parse_bounded_usize(value: &str, min: usize, max: usize, label: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("{label} must be an integer"))?;
    if !(min..=max).contains(&parsed) {
        return Err(format!("{label} must be between {min} and {max}"));
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn command_tree_is_well_formed() {
        Cli::command().debug_assert();
    }

    #[test]
    fn mcp_stdio_requires_a_project_grant() {
        let error = Cli::try_parse_from(["oxide-agent", "mcp", "stdio"]).unwrap_err();
        assert!(error.to_string().contains("--project"));
    }

    #[test]
    fn self_approval_is_not_a_cli_option() {
        let error =
            Cli::try_parse_from(["oxide-agent", "mcp", "stdio", "--project", "p", "--approve"])
                .unwrap_err();
        assert!(error.to_string().contains("--approve"));
    }

    #[test]
    fn query_timeout_accepts_global_override_and_unlimited() {
        let finite = Cli::try_parse_from([
            "oxide-agent",
            "mcp",
            "stdio",
            "--project",
            "p",
            "--query-timeout-secs",
            "300",
        ])
        .unwrap();
        let unlimited = Cli::try_parse_from([
            "oxide-agent",
            "mcp",
            "stdio",
            "--project",
            "p",
            "--query-timeout-secs",
            "0",
        ])
        .unwrap();

        let timeout = |cli: Cli| match cli.command {
            Command::Mcp {
                command: McpCommand::Stdio(scope),
            } => scope.query_timeout_secs,
            _ => panic!("expected MCP stdio command"),
        };
        assert_eq!(timeout(finite), Some(300));
        assert_eq!(timeout(unlimited), Some(0));
        assert!(Cli::try_parse_from([
            "oxide-agent",
            "mcp",
            "stdio",
            "--project",
            "p",
            "--query-timeout-secs",
            "-1",
        ])
        .is_err());
    }
}
