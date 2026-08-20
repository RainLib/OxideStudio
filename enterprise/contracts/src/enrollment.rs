use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Stable lowercase SHA-256 fingerprint for a DER-encoded X.509 certificate.
/// The same helper is used when Desktop requests a ticket and when Gateway
/// reads the peer certificate from its mTLS connection.
pub fn certificate_fingerprint(certificate_der: &[u8]) -> String {
    Sha256::digest(certificate_der)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Domain-separated canonical payload signed by a Gateway during its one-time
/// enrollment. Newlines make fields unambiguous while preserving stable bytes
/// across the control-plane and Gateway implementations.
pub fn gateway_enrollment_signing_message(
    gateway_id: Uuid,
    direct_endpoint: &str,
    certificate_fingerprint: &str,
    enrollment_token: &str,
) -> Vec<u8> {
    format!(
        "oxide-gateway-enrollment-v1\n{gateway_id}\n{direct_endpoint}\n{certificate_fingerprint}\n{enrollment_token}"
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_message_is_domain_separated_and_field_bound() {
        let id = Uuid::nil();
        let first = gateway_enrollment_signing_message(id, "https://a", "a", "token");
        let second = gateway_enrollment_signing_message(id, "https://b", "a", "token");
        assert!(first.starts_with(b"oxide-gateway-enrollment-v1\n"));
        assert_ne!(first, second);
    }
}
