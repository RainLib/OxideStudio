-- A rotated client certificate must not retain access for the remainder of an
-- already-issued ticket, nor be silently enrolled again later. Keep the
-- retired fingerprint in the organization-scoped Gateway revocation feed.
CREATE TABLE IF NOT EXISTS retired_device_certificates (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    certificate_fingerprint TEXT NOT NULL,
    retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL CHECK (reason IN ('certificate_rotated', 'device_revoked')),
    PRIMARY KEY (organization_id, certificate_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_retired_device_certificates_organization
    ON retired_device_certificates(organization_id, retired_at DESC);

-- Preserve revocations created before this history table existed. Existing
-- deployments must not regain the ability to reactivate a known-revoked
-- certificate merely because the certificate is no longer the active record.
INSERT INTO retired_device_certificates (organization_id, certificate_fingerprint, reason)
SELECT organization_id, certificate_fingerprint, 'device_revoked'
FROM managed_devices
WHERE status = 'revoked'
ON CONFLICT (organization_id, certificate_fingerprint) DO NOTHING;
