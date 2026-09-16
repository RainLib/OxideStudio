use super::GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use oxide_enterprise_contracts::gateway_enrollment_signing_message;
use rand::RngCore;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(super) fn generate_enrollment_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn digest_enrollment_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn constant_time_equals(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

pub(super) fn verify_enrollment_signature(
    public_key: Option<&str>,
    signature: &str,
    gateway_id: Uuid,
    direct_endpoint: &str,
    certificate_fingerprint: &str,
    enrollment_token: &str,
) -> bool {
    verify_gateway_signature(
        public_key,
        signature,
        &gateway_enrollment_signing_message(
            gateway_id,
            direct_endpoint,
            certificate_fingerprint,
            enrollment_token,
        ),
    )
}

pub(super) fn verify_gateway_signature(
    public_key: Option<&str>,
    signature: &str,
    message: &[u8],
) -> bool {
    let Some(public_key) = public_key else {
        return false;
    };
    let Ok(public_key) = STANDARD.decode(public_key) else {
        return false;
    };
    let Ok(public_key) = <[u8; 32]>::try_from(public_key.as_slice()) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key) else {
        return false;
    };
    let Ok(signature) = STANDARD.decode(signature) else {
        return false;
    };
    let Ok(signature) = Signature::try_from(signature.as_slice()) else {
        return false;
    };
    verifying_key.verify(message, &signature).is_ok()
}

pub(super) fn gateway_heartbeat_is_fresh(
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    let Some(last_seen_at) = last_seen_at else {
        return false;
    };
    last_seen_at <= now
        && last_seen_at >= now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS)
}

pub(super) fn rotated_device_certificate<'a>(
    previous_certificate_fingerprint: Option<&'a str>,
    next_certificate_fingerprint: &str,
) -> Option<&'a str> {
    previous_certificate_fingerprint.filter(|previous| *previous != next_certificate_fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxide_enterprise_contracts::gateway_revocation_snapshot_signing_message;

    #[test]
    fn enrollment_tokens_are_opaque_and_only_the_digest_is_stable() {
        let token = generate_enrollment_token();
        assert!(token.len() >= 43);
        assert_eq!(digest_enrollment_token(&token).len(), 64);
        assert_ne!(digest_enrollment_token(&token), token);
        assert!(constant_time_equals(
            digest_enrollment_token(&token).as_bytes(),
            digest_enrollment_token(&token).as_bytes()
        ));
        assert!(!constant_time_equals(b"expected", b"different"));
    }

    #[test]
    fn enrollment_requires_a_signature_from_the_registered_key() {
        use ed25519_dalek::{Signer, SigningKey};
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let gateway_id = Uuid::new_v4();
        let endpoint = "https://gateway.example.test";
        let fingerprint = "a".repeat(64);
        let token = "enrollment-token";
        let signature = signing_key.sign(&gateway_enrollment_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
            token,
        ));
        assert!(verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            gateway_id,
            endpoint,
            &fingerprint,
            token,
        ));
        assert!(!verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            gateway_id,
            "https://other.example.test",
            &fingerprint,
            token,
        ));
        let restart_signature = signing_key.sign(&gateway_enrollment_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
            "",
        ));
        assert!(verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(restart_signature.to_bytes()),
            gateway_id,
            endpoint,
            &fingerprint,
            "",
        ));
    }

    #[test]
    fn gateway_signature_is_bound_to_the_revocation_snapshot_domain() {
        use ed25519_dalek::{Signer, SigningKey};
        let signing_key = SigningKey::from_bytes(&[3; 32]);
        let gateway_id = Uuid::new_v4();
        let endpoint = "https://gateway.example.test";
        let fingerprint = "b".repeat(64);
        let signature = signing_key.sign(&gateway_revocation_snapshot_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
        ));
        assert!(verify_gateway_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            &gateway_revocation_snapshot_signing_message(gateway_id, endpoint, &fingerprint),
        ));
        assert!(!verify_gateway_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            &gateway_enrollment_signing_message(gateway_id, endpoint, &fingerprint, ""),
        ));
    }

    #[test]
    fn gateway_ticket_issuance_requires_a_recent_signed_heartbeat() {
        let now = chrono::Utc::now();
        assert!(gateway_heartbeat_is_fresh(
            Some(now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS)),
            now,
        ));
        assert!(!gateway_heartbeat_is_fresh(
            Some(now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS + 1)),
            now,
        ));
        assert!(!gateway_heartbeat_is_fresh(None, now));
        assert!(!gateway_heartbeat_is_fresh(
            Some(now + chrono::Duration::seconds(1)),
            now,
        ));
    }

    #[test]
    fn device_certificate_rotation_only_retires_a_replaced_fingerprint() {
        assert_eq!(rotated_device_certificate(None, "new"), None);
        assert_eq!(rotated_device_certificate(Some("same"), "same"), None);
        assert_eq!(
            rotated_device_certificate(Some("previous"), "replacement"),
            Some("previous")
        );
    }
}
