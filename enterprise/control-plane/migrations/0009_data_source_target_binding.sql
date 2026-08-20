-- A target binding is a SHA-256 fingerprint of a credential-free canonical
-- database locator. It lets the control plane sign the expected target while
-- keeping the connection URL and secret reference Gateway-local.
ALTER TABLE data_sources
    ADD COLUMN IF NOT EXISTS target_binding TEXT;

ALTER TABLE data_sources
    ADD CONSTRAINT data_sources_target_binding_format
    CHECK (target_binding IS NULL OR target_binding ~ '^[0-9a-f]{64}$');
