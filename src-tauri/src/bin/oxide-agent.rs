#[path = "oxide_agent/mod.rs"]
mod oxide_agent;

#[tokio::main]
async fn main() {
    if let Err(error) = oxide_agent::run().await {
        eprintln!("oxide-agent: {error:#}");
        std::process::exit(1);
    }
}
