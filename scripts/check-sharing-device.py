#!/usr/bin/env python3
"""Validate configured macOS Gateway identity without printing credentials."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

BASE = Path.home() / "Library/Application Support/com.houshuai.oxide-studio/enterprise"


def openssl(*args):
    result = subprocess.run(["openssl", *args], capture_output=True, check=True,
                            stdin=subprocess.DEVNULL, timeout=10)
    return result.stdout


def check():
    config = json.loads((BASE / "account.json").read_text())
    names = ("gatewayCaCertificatePath", "gatewayClientCertificatePath", "gatewayClientPrivateKeyPath")
    missing = [name for name in names if not config.get(name) or not Path(config[name]).is_file()]
    result = {"deviceId": (BASE / "device-id").read_text().strip(),
              "identityReady": False, "missing": missing}
    if missing:
        result["nextStep"] = "Sign this Mac's CSR using the existing hs_test CA, configure the three files, then enroll the certificate fingerprint."
        return result
    ca, cert, key = [config[name] for name in names]
    openssl("verify", "-purpose", "sslclient", "-CAfile", ca, cert)
    openssl("x509", "-in", cert, "-checkend", "86400", "-noout")
    certificate_public = openssl("x509", "-in", cert, "-pubkey", "-noout")
    private_public = openssl("pkey", "-in", key, "-pubout")
    if certificate_public != private_public:
        raise ValueError("Certificate does not match this device private key")
    result.update(identityReady=True, certificateSha256=hashlib.sha256(
        openssl("x509", "-in", cert, "-outform", "DER")
    ).hexdigest(), nextStep="Verify this device ID and certificate fingerprint are active in the organization; then test actual Gateway queries.")
    return result


if __name__ == "__main__":
    try:
        report = check()
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["identityReady"] else 2)
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        sys.exit("Device validation failed; inspect the configured certificate chain, expiry and key match locally.")
