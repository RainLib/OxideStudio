#[path = "oxide_agent/mod.rs"]
mod oxide_agent;

#[tokio::main]
async fn main() {
    if let Err(error) = oxide_agent::run().await {
        let message =
            oxide_studio_lib::core::redaction::redact_connection_url(&format!("{error:#}"));
        eprintln!("oxide-agent: {message}");
        std::process::exit(1);
    }
}
