mod bridge_mcp;
mod catalog;
mod cli;
mod http;
mod http_auth;
mod mcp;
mod policy;
mod runtime;
mod store;

pub async fn run() -> anyhow::Result<()> {
    cli::reject_approval_flags()?;
    cli::parse().execute().await
}
