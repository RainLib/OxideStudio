-- The original table predates organization-scoped Gateway feeds. Existing
-- legacy values stay unscoped and are intentionally never distributed.
ALTER TABLE revoked_access_nonces
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- The Gateway snapshot prunes expired entries before reading its own tenant's
-- live ticket revocations. This index keeps that bounded cleanup cheap.
CREATE INDEX IF NOT EXISTS idx_revoked_access_nonces_organization_expiry
    ON revoked_access_nonces(organization_id, expires_at);
