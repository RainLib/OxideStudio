CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('password', 'passkey', 'oidc', 'saml')),
    verified_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (issuer, subject)
);

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    requires_enterprise_sso BOOLEAN NOT NULL DEFAULT FALSE,
    required_oidc_issuer TEXT,
    auth_policy_revision TEXT NOT NULL DEFAULT '1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
    organization_role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL,
    organization_role TEXT NOT NULL,
    invited_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, invited_email, status)
);

CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    UNIQUE (organization_id, display_name)
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS gateways (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    direct_endpoint TEXT NOT NULL,
    certificate_serial TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_projects (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    policy_revision TEXT NOT NULL DEFAULT '1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_assignments (
    project_id UUID NOT NULL REFERENCES managed_projects(id) ON DELETE CASCADE,
    principal_kind TEXT NOT NULL CHECK (principal_kind IN ('user', 'group')),
    principal_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, principal_kind, principal_id)
);

CREATE TABLE IF NOT EXISTS data_sources (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES managed_projects(id) ON DELETE CASCADE,
    gateway_id UUID NOT NULL REFERENCES gateways(id),
    driver TEXT NOT NULL,
    display_name TEXT NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_resource_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
    policy_revision TEXT NOT NULL DEFAULT '1',
    -- Secret values and secret references are intentionally absent.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_catalog (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES managed_projects(id) ON DELETE CASCADE,
    data_source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES resource_catalog(id) ON DELETE CASCADE,
    path_segments JSONB NOT NULL,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    catalog_revision TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, path_segments)
);

CREATE TABLE IF NOT EXISTS access_grants (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES managed_projects(id) ON DELETE CASCADE,
    principal_kind TEXT NOT NULL CHECK (principal_kind IN ('user', 'group')),
    principal_id UUID NOT NULL,
    data_source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
    resource_path JSONB NOT NULL,
    actions JSONB NOT NULL,
    effect TEXT NOT NULL CHECK (effect IN ('permit', 'forbid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_project_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES managed_projects(id) ON DELETE CASCADE,
    alias TEXT,
    color TEXT,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS revoked_access_nonces (
    nonce UUID PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    organization_id UUID,
    user_id UUID,
    device_id UUID,
    project_id UUID,
    data_source_id UUID,
    resource_path JSONB,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    request_id UUID NOT NULL,
    source TEXT NOT NULL,
    query_fingerprint TEXT,
    row_count BIGINT,
    result_bytes BIGINT,
    duration_ms BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON organization_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email
    ON organization_invitations(invited_email, status);
CREATE INDEX IF NOT EXISTS idx_assignments_principal
    ON project_assignments(principal_kind, principal_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_project
    ON data_sources(project_id, display_name);
CREATE INDEX IF NOT EXISTS idx_access_grants_principal
    ON access_grants(organization_id, principal_kind, principal_id, project_id);
CREATE INDEX IF NOT EXISTS idx_audit_organization_time
    ON audit_events(organization_id, occurred_at DESC);
