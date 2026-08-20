use crate::config::{certificate_fingerprint, GatewayConfig};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::Signer;
use oxide_enterprise_contracts::gateway_enrollment_signing_message;
use reqwest::Client;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentProof<'a> {
    gateway_id: uuid::Uuid,
    direct_endpoint: &'a str,
    certificate_fingerprint: &'a str,
    enrollment_signature: &'a str,
}

/// Exchanges the one-time enrollment token for an active Gateway record before
/// the data plane starts listening. This is intentionally fail-closed: a
/// Gateway whose identity is not accepted cannot expose its mTLS endpoint.
pub async fn activate(config: &GatewayConfig) -> Result<()> {
    let fingerprint = certificate_fingerprint(&config.tls_certificate)?;
    let enrollment_token = config.enrollment_token.as_deref().unwrap_or_default();
    let signature = STANDARD.encode(
        config
            .enrollment_signing_key
            .sign(&gateway_enrollment_signing_message(
                config.id,
                &config.public_endpoint,
                &fingerprint,
                enrollment_token,
            ))
            .to_bytes(),
    );
    let mut client = Client::builder();
    if let Some(certificate) = &config.control_plane_ca_certificate {
        client = client.add_root_certificate(
            reqwest::Certificate::from_pem(certificate)
                .context("OXIDE_CONTROL_PLANE_CA_CERTIFICATE is not a PEM certificate")?,
        );
    }
    let client = client
        .build()
        .context("failed to configure enrollment client")?;
    let request = client
        .post(format!(
            "{}/v1/gateway-enrollments/activate",
            config.control_plane_url
        ))
        .json(&EnrollmentProof {
            gateway_id: config.id,
            direct_endpoint: &config.public_endpoint,
            certificate_fingerprint: &fingerprint,
            enrollment_signature: &signature,
        });
    let request = if let Some(token) = &config.enrollment_token {
        request.header("x-oxide-gateway-enrollment", token)
    } else {
        request
    };
    let response = request
        .send()
        .await
        .context("Gateway enrollment request failed")?;
    if !response.status().is_success() {
        let status = response.status();
        anyhow::bail!("Gateway enrollment proof was rejected ({status})");
    }
    Ok(())
}
