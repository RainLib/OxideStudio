mod api;
mod auth;
mod config;
mod store;

use anyhow::Result;
use api::AppState;
use auth::OidcVerifier;
use axum::http::{
    header::{AUTHORIZATION, CONTENT_TYPE},
    HeaderName, Method,
};
use config::Config;
use oxide_enterprise_contracts::TicketSigner;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use store::ControlPlaneStore;
use tower_http::{
    cors::CorsLayer,
    request_id::{MakeRequestUuid, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "oxide_control_plane=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = Config::from_env()?;
    let cors = CorsLayer::new()
        .allow_origin(config.allowed_origins.clone())
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    let verifier = OidcVerifier::load(
        config.oidc_issuer,
        config.oidc_audience,
        &config.oidc_jwks_url,
    )
    .await?;
    let state = AppState {
        store: ControlPlaneStore::new(pool),
        verifier: Arc::new(verifier),
        ticket_signer: Arc::new(TicketSigner::from_bytes(config.ticket_signing_key)),
    };
    let app = api::router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(SetRequestIdLayer::new(
            HeaderName::from_static("x-request-id"),
            MakeRequestUuid,
        ));
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(address = %config.bind, "Oxide control plane listening");
    axum::serve(listener, app).await?;
    Ok(())
}
