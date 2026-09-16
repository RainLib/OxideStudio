use super::types::{DriverPackageTrust, MAX_DRIVER_MANIFEST_BYTES, MAX_DRIVER_SIGNATURE_BYTES};
use minisign_verify::Signature;
use std::fs;
use std::path::Path;

pub(super) fn verify_package_signature(
    manifest_path: &Path,
    trust: &DriverPackageTrust,
) -> Result<(), String> {
    match trust {
        DriverPackageTrust::PublicKey(public_key) => {
            let manifest_metadata = fs::metadata(manifest_path)
                .map_err(|error| format!("Cannot inspect driver manifest: {error}"))?;
            if !manifest_metadata.is_file() || manifest_metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
                return Err("Driver manifest is missing or exceeds 256 KiB".to_string());
            }
            let manifest = fs::read(manifest_path)
                .map_err(|error| format!("Cannot read driver manifest: {error}"))?;
            let signature_path = manifest_path.with_extension("json.minisig");
            let signature_metadata = fs::metadata(&signature_path).map_err(|error| {
                format!(
                    "Driver package signature is missing or unreadable ({}): {error}",
                    signature_path.display()
                )
            })?;
            if !signature_metadata.is_file()
                || signature_metadata.len() > MAX_DRIVER_SIGNATURE_BYTES
            {
                return Err("Driver package signature is missing or exceeds 64 KiB".to_string());
            }
            let signature_text = fs::read_to_string(&signature_path).map_err(|error| {
                format!(
                    "Driver package signature is missing or unreadable ({}): {error}",
                    signature_path.display()
                )
            })?;
            let signature = Signature::decode(&signature_text)
                .map_err(|error| format!("Driver package signature is invalid: {error}"))?;
            public_key
                .verify(&manifest, &signature, false)
                .map_err(|error| format!("Driver package signature is not trusted: {error}"))
        }
        DriverPackageTrust::Unavailable => {
            Err("No trusted database driver signing key is configured in this build".to_string())
        }
        DriverPackageTrust::InvalidKey(error) => Err(format!(
            "The database driver signing key configured for this build is invalid: {error}"
        )),
        #[cfg(test)]
        DriverPackageTrust::AllowUnsigned => Ok(()),
    }
}
