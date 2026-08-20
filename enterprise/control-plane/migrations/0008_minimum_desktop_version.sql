-- This is a managed-access compatibility gate. It is not device attestation:
-- the desktop version is supplied by the signed application runtime and the
-- control plane still relies on OIDC plus mTLS device identity for access.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS minimum_desktop_version TEXT NOT NULL DEFAULT '0.0.0';
