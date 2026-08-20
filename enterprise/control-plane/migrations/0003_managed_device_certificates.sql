-- A managed access ticket is useful only to the device certificate registered
-- for its principal. Device UUIDs are local correlation IDs, not identities.
CREATE TABLE IF NOT EXISTS managed_devices (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    certificate_fingerprint TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    enrolled_by UUID NOT NULL REFERENCES users(id),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (organization_id, user_id, device_id),
    UNIQUE (organization_id, certificate_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_managed_devices_active_principal
    ON managed_devices(organization_id, user_id)
    WHERE status = 'active';
