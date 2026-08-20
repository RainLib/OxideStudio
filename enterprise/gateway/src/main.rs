mod config;
mod enrollment;
mod secret;
mod service;

pub mod proto {
    tonic::include_proto!("oxide.enterprise.gateway.v1");
}

use anyhow::Result;
use config::GatewayConfig;
use proto::data_plane_server::DataPlaneServer;
use secret::configured_provider;
use service::DataPlaneService;
use tonic::transport::{Certificate, Identity, Server, ServerTlsConfig};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "oxide_enterprise_gateway=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();
    let config = GatewayConfig::from_env()?;
    enrollment::activate(&config).await?;
    let secret_provider = configured_provider(config.allow_environment_secrets)?;
    let address = config.bind;
    let tls = ServerTlsConfig::new()
        .identity(Identity::from_pem(
            config.tls_certificate,
            config.tls_private_key,
        ))
        .client_ca_root(Certificate::from_pem(config.client_ca_certificate));
    let service = DataPlaneService::new(
        config.id,
        config.control_plane_verifying_key,
        config.sources,
        secret_provider,
    );
    tracing::info!(gateway_id = %config.id, %address, "Oxide enterprise gateway enrollment accepted; listening");
    Server::builder()
        .tls_config(tls)?
        .add_service(DataPlaneServer::new(service))
        .serve(address)
        .await?;
    Ok(())
}
