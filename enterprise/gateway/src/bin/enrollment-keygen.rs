use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;

fn main() -> Result<()> {
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret)?;
    let signing_key = SigningKey::from_bytes(&secret);
    println!(
        "public_key_base64={}",
        STANDARD.encode(signing_key.verifying_key().as_bytes())
    );
    println!(
        "private_key_base64={}",
        STANDARD.encode(signing_key.to_bytes())
    );
    eprintln!("Save private_key_base64 in a private file (mode 0600 on Unix). Do not share it.");
    Ok(())
}
