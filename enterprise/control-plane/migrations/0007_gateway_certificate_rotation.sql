-- Keep the active Gateway identity intact until a replacement certificate
-- proves possession of the existing Gateway signing key and a fresh,
-- administrator-issued one-time rotation token.
ALTER TABLE gateways
    ADD COLUMN IF NOT EXISTS pending_certificate_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS certificate_rotation_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS certificate_rotation_expires_at TIMESTAMPTZ;

ALTER TABLE gateways
    DROP CONSTRAINT IF EXISTS gateways_rotation_challenge_complete;
ALTER TABLE gateways
    ADD CONSTRAINT gateways_rotation_challenge_complete
    CHECK (
        (pending_certificate_fingerprint IS NULL
         AND certificate_rotation_token_hash IS NULL
         AND certificate_rotation_expires_at IS NULL)
        OR
        (pending_certificate_fingerprint IS NOT NULL
         AND certificate_rotation_token_hash IS NOT NULL
         AND certificate_rotation_expires_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_gateways_certificate_rotation_expiry
    ON gateways(certificate_rotation_expires_at)
    WHERE certificate_rotation_token_hash IS NOT NULL;
