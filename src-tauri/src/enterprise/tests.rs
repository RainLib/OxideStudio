use super::{
    callback::parse_callback_request,
    session::{decode_refresh_token_secret, decrypt_refresh_token, encrypt_refresh_token},
    support::normalized_https_url,
};

#[test]
fn callback_requires_code_and_state() {
    let request = "GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n";
    assert_eq!(
        parse_callback_request(request).unwrap(),
        ("abc".into(), "xyz".into())
    );
    assert!(parse_callback_request("GET /callback?code=abc HTTP/1.1\r\n\r\n").is_err());
}

#[test]
fn public_config_rejects_embedded_credentials_and_remote_http() {
    assert!(normalized_https_url("https://secret@example.test", "issuer").is_err());
    assert!(normalized_https_url("http://example.test", "issuer").is_err());
    assert!(normalized_https_url("http://127.0.0.1:8080", "issuer").is_ok());
}

#[test]
fn refresh_token_secret_supports_utf8_and_legacy_windows_utf16() {
    assert_eq!(
        decode_refresh_token_secret(b"opaque-refresh-token".to_vec()).unwrap(),
        "opaque-refresh-token"
    );

    let legacy = "legacy-refresh-token"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    assert_eq!(
        decode_refresh_token_secret(legacy).unwrap(),
        "legacy-refresh-token"
    );
}

#[test]
fn long_refresh_token_round_trips_through_encrypted_session() {
    let token = "refresh-token-segment.".repeat(512);
    let key = [42_u8; 32];
    let encrypted = encrypt_refresh_token(&token, &key).unwrap();

    assert_ne!(encrypted, token.as_bytes());
    assert_eq!(decrypt_refresh_token(&encrypted, &key).unwrap(), token);
    assert!(decrypt_refresh_token(&encrypted, &[7_u8; 32]).is_err());
}
