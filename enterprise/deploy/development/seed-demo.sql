\set ON_ERROR_STOP on

-- Local development data only. All endpoints use the reserved .test TLD and
-- data-source records intentionally contain no database URLs or credentials.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations
    WHERE id = '386f9632-7ac7-4fd3-974c-58716b66e988'
  ) THEN
    RAISE EXCEPTION 'Demo organization 386f9632-7ac7-4fd3-974c-58716b66e988 does not exist';
  END IF;
END
$$;

INSERT INTO users (id, display_name)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Ada Chen'),
  ('10000000-0000-4000-8000-000000000002', 'Alex Morgan'),
  ('10000000-0000-4000-8000-000000000003', '林悦'),
  ('10000000-0000-4000-8000-000000000004', 'Morgan Lee')
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name, updated_at = now();

INSERT INTO user_identities (issuer, subject, user_id, kind, verified_email)
VALUES
  ('demo://oxide-local', 'demo-ada', '10000000-0000-4000-8000-000000000001', 'oidc', 'ada@example.test'),
  ('demo://oxide-local', 'demo-alex', '10000000-0000-4000-8000-000000000002', 'oidc', 'alex@example.test'),
  ('demo://oxide-local', 'demo-lin-yue', '10000000-0000-4000-8000-000000000003', 'oidc', 'linyue@example.test'),
  ('demo://oxide-local', 'demo-morgan', '10000000-0000-4000-8000-000000000004', 'oidc', 'morgan@example.test')
ON CONFLICT (issuer, subject) DO UPDATE
SET user_id = EXCLUDED.user_id, verified_email = EXCLUDED.verified_email;

INSERT INTO organization_memberships
  (organization_id, user_id, status, organization_role)
VALUES
  ('386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000001', 'active', 'administrator'),
  ('386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000002', 'active', 'member'),
  ('386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000003', 'suspended', 'member'),
  ('386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000004', 'invited', 'member')
ON CONFLICT (organization_id, user_id) DO UPDATE
SET status = EXCLUDED.status,
    organization_role = EXCLUDED.organization_role,
    updated_at = now();

INSERT INTO managed_projects
  (id, organization_id, display_name, policy_revision)
VALUES
  ('20000000-0000-4000-8000-000000000001', '386f9632-7ac7-4fd3-974c-58716b66e988', 'Core Platform', 'demo-4'),
  ('20000000-0000-4000-8000-000000000002', '386f9632-7ac7-4fd3-974c-58716b66e988', 'Commerce', 'demo-3'),
  ('20000000-0000-4000-8000-000000000003', '386f9632-7ac7-4fd3-974c-58716b66e988', 'Observability', 'demo-2')
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    policy_revision = EXCLUDED.policy_revision,
    updated_at = now();

INSERT INTO gateways
  (id, organization_id, display_name, direct_endpoint, status, last_seen_at,
   certificate_fingerprint, enrollment_public_key, enrollment_token_hash,
   enrollment_expires_at, activated_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', '386f9632-7ac7-4fd3-974c-58716b66e988',
   'Shanghai Edge Gateway', 'https://shanghai-gateway.example.test:8790', 'active',
   now() - interval '45 seconds', repeat('11', 32), repeat('A', 44), NULL, NULL,
   now() - interval '14 days'),
  ('30000000-0000-4000-8000-000000000002', '386f9632-7ac7-4fd3-974c-58716b66e988',
   'Beijing DR Gateway', 'https://beijing-gateway.example.test:8790', 'active',
   now() - interval '2 minutes', repeat('22', 32), repeat('B', 44), NULL, NULL,
   now() - interval '7 days'),
  ('30000000-0000-4000-8000-000000000003', '386f9632-7ac7-4fd3-974c-58716b66e988',
   'Staging Gateway', 'https://staging-gateway.example.test:8790', 'pending',
   NULL, repeat('33', 32), repeat('C', 44), repeat('a', 64),
   now() + interval '24 hours', NULL)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    direct_endpoint = EXCLUDED.direct_endpoint,
    status = EXCLUDED.status,
    last_seen_at = EXCLUDED.last_seen_at,
    certificate_fingerprint = EXCLUDED.certificate_fingerprint,
    enrollment_public_key = EXCLUDED.enrollment_public_key,
    enrollment_token_hash = EXCLUDED.enrollment_token_hash,
    enrollment_expires_at = EXCLUDED.enrollment_expires_at,
    activated_at = EXCLUDED.activated_at;

INSERT INTO data_sources
  (id, organization_id, project_id, gateway_id, driver, display_name,
   capabilities, allowed_resource_summary, policy_revision, target_binding)
VALUES
  ('40000000-0000-4000-8000-000000000001', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'postgres', 'Production PostgreSQL',
   '["resourceDiscover","metadataRead","queryRead"]',
   '["oxide_app/public","oxide_app/billing"]', 'demo-4', repeat('a1', 32)),
  ('40000000-0000-4000-8000-000000000002', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'mysql', 'Orders MySQL',
   '["resourceDiscover","metadataRead","queryRead"]',
   '["commerce/orders","commerce/order_items"]', 'demo-3', repeat('b2', 32)),
  ('40000000-0000-4000-8000-000000000003', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
   'mongodb', 'Customer Events MongoDB',
   '["resourceDiscover","metadataRead","queryRead"]',
   '["events/customer_events"]', 'demo-4', repeat('c3', 32)),
  ('40000000-0000-4000-8000-000000000004', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
   'elasticsearch', 'Application Logs',
   '["resourceDiscover","metadataRead","queryRead"]',
   '["logs-app-*","traces-*"]', 'demo-2', repeat('d4', 32)),
  ('40000000-0000-4000-8000-000000000005', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'redis', 'Session Cache Redis',
   '["resourceDiscover","metadataRead","queryRead"]',
   '["session:*","feature:*"]', 'demo-3', repeat('e5', 32))
ON CONFLICT (id) DO UPDATE
SET project_id = EXCLUDED.project_id,
    gateway_id = EXCLUDED.gateway_id,
    driver = EXCLUDED.driver,
    display_name = EXCLUDED.display_name,
    capabilities = EXCLUDED.capabilities,
    allowed_resource_summary = EXCLUDED.allowed_resource_summary,
    policy_revision = EXCLUDED.policy_revision,
    target_binding = EXCLUDED.target_binding,
    updated_at = now();

INSERT INTO resource_catalog
  (id, organization_id, project_id, data_source_id, parent_id,
   path_segments, kind, display_name, catalog_revision)
VALUES
  ('50000000-0000-4000-8000-000000000001', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', NULL,
   '["oxide_app"]', 'database', 'oxide_app', 'demo-4'),
  ('50000000-0000-4000-8000-000000000002', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '["oxide_app","public"]', 'schema', 'public', 'demo-4'),
  ('50000000-0000-4000-8000-000000000003', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000002', '["oxide_app","public","accounts"]', 'table', 'accounts', 'demo-4'),
  ('50000000-0000-4000-8000-000000000004', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', NULL,
   '["commerce"]', 'database', 'commerce', 'demo-3'),
  ('50000000-0000-4000-8000-000000000005', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000004', '["commerce","orders"]', 'table', 'orders', 'demo-3'),
  ('50000000-0000-4000-8000-000000000006', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', NULL,
   '["events"]', 'database', 'events', 'demo-4'),
  ('50000000-0000-4000-8000-000000000007', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003',
   '50000000-0000-4000-8000-000000000006', '["events","customer_events"]', 'collection', 'customer_events', 'demo-4'),
  ('50000000-0000-4000-8000-000000000008', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004', NULL,
   '["logs-app-*"]', 'index-pattern', 'logs-app-*', 'demo-2'),
  ('50000000-0000-4000-8000-000000000009', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000005', NULL,
   '["session:*"]', 'key-pattern', 'session:*', 'demo-3'),
  ('50000000-0000-4000-8000-000000000010', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000005', NULL,
   '["feature:*"]', 'key-pattern', 'feature:*', 'demo-3')
ON CONFLICT (id) DO UPDATE
SET parent_id = EXCLUDED.parent_id,
    path_segments = EXCLUDED.path_segments,
    kind = EXCLUDED.kind,
    display_name = EXCLUDED.display_name,
    catalog_revision = EXCLUDED.catalog_revision,
    updated_at = now();

INSERT INTO project_assignments (project_id, principal_kind, principal_id)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'user', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', 'user', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'user', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'user', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003', 'user', '10000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO project_assignments (project_id, principal_kind, principal_id)
SELECT project.id, 'user', owner_membership.user_id
FROM (
  VALUES
    ('20000000-0000-4000-8000-000000000001'::uuid),
    ('20000000-0000-4000-8000-000000000002'::uuid),
    ('20000000-0000-4000-8000-000000000003'::uuid)
) AS project(id)
CROSS JOIN LATERAL (
  SELECT user_id
  FROM organization_memberships
  WHERE organization_id = '386f9632-7ac7-4fd3-974c-58716b66e988'
    AND organization_role = 'owner'
    AND status = 'active'
  ORDER BY created_at
  LIMIT 1
) AS owner_membership
ON CONFLICT DO NOTHING;

INSERT INTO managed_devices
  (organization_id, user_id, device_id, certificate_fingerprint, display_name,
   status, enrolled_by, enrolled_at)
SELECT
  '386f9632-7ac7-4fd3-974c-58716b66e988',
  device.user_id,
  device.device_id,
  device.fingerprint,
  device.display_name,
  'active',
  owner_membership.user_id,
  device.enrolled_at
FROM (
  VALUES
    ('10000000-0000-4000-8000-000000000001'::uuid, '60000000-0000-4000-8000-000000000001'::uuid, repeat('61', 32), 'Ada MacBook Pro', now() - interval '12 days'),
    ('10000000-0000-4000-8000-000000000002'::uuid, '60000000-0000-4000-8000-000000000002'::uuid, repeat('62', 32), 'Alex Windows Workstation', now() - interval '5 days')
) AS device(user_id, device_id, fingerprint, display_name, enrolled_at)
CROSS JOIN LATERAL (
  SELECT user_id
  FROM organization_memberships
  WHERE organization_id = '386f9632-7ac7-4fd3-974c-58716b66e988'
    AND organization_role = 'owner'
    AND status = 'active'
  ORDER BY created_at
  LIMIT 1
) AS owner_membership
ON CONFLICT (organization_id, user_id, device_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    certificate_fingerprint = EXCLUDED.certificate_fingerprint;

INSERT INTO access_grants
  (id, organization_id, project_id, principal_kind, principal_id,
   data_source_id, resource_path, actions, effect)
VALUES
  ('70000000-0000-4000-8000-000000000001', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000001', 'user', '10000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000001', '["oxide_app","public"]',
   '["resourceDiscover","metadataRead","queryRead"]', 'permit'),
  ('70000000-0000-4000-8000-000000000002', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', 'user', '10000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000005', '["session:*"]',
   '["resourceDiscover","metadataRead","queryRead"]', 'permit'),
  ('70000000-0000-4000-8000-000000000003', '386f9632-7ac7-4fd3-974c-58716b66e988',
   '20000000-0000-4000-8000-000000000002', 'user', '10000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000002', '["commerce","payment_methods"]',
   '["resource.discover","metadata.read","query.read"]', 'forbid')
ON CONFLICT (id) DO UPDATE
SET actions = EXCLUDED.actions,
    effect = EXCLUDED.effect;

UPDATE access_grants
SET actions = '["resource.discover","metadata.read","query.read"]'
WHERE id IN (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002'
);

-- The locally authenticated Casdoor admin owns the demo organization. Give
-- that owner a readable scope for every seeded source so the desktop client
-- can exercise project and driver discovery immediately after sign-in.
INSERT INTO access_grants
  (id, organization_id, project_id, principal_kind, principal_id,
   data_source_id, resource_path, actions, effect)
SELECT
  demo_grant.id,
  '386f9632-7ac7-4fd3-974c-58716b66e988',
  demo_grant.project_id,
  'user',
  owner_membership.user_id,
  demo_grant.data_source_id,
  demo_grant.resource_path,
  '["resource.discover","metadata.read","query.read"]',
  'permit'
FROM (
  VALUES
    ('70000000-0000-4000-8000-000000000101'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '40000000-0000-4000-8000-000000000001'::uuid, '["oxide_app"]'::jsonb),
    ('70000000-0000-4000-8000-000000000102'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, '40000000-0000-4000-8000-000000000002'::uuid, '["commerce"]'::jsonb),
    ('70000000-0000-4000-8000-000000000103'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '40000000-0000-4000-8000-000000000003'::uuid, '["events"]'::jsonb),
    ('70000000-0000-4000-8000-000000000104'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, '40000000-0000-4000-8000-000000000004'::uuid, '["logs-app-*"]'::jsonb),
    ('70000000-0000-4000-8000-000000000105'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, '40000000-0000-4000-8000-000000000005'::uuid, '["session:*"]'::jsonb)
) AS demo_grant(id, project_id, data_source_id, resource_path)
CROSS JOIN LATERAL (
  SELECT user_id
  FROM organization_memberships
  WHERE organization_id = '386f9632-7ac7-4fd3-974c-58716b66e988'
    AND organization_role = 'owner'
    AND status = 'active'
  ORDER BY created_at
  LIMIT 1
) AS owner_membership
ON CONFLICT (id) DO UPDATE
SET principal_id = EXCLUDED.principal_id,
    resource_path = EXCLUDED.resource_path,
    actions = EXCLUDED.actions,
    effect = EXCLUDED.effect;

INSERT INTO audit_events
  (id, occurred_at, organization_id, user_id, project_id, data_source_id,
   resource_path, action, decision, reason_code, request_id, source, metadata)
VALUES
  ('90000000-0000-4000-8000-000000000001', now() - interval '3 minutes',
   '386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '["oxide_app","public","accounts"]', 'queryRead', 'permit', 'policy_permit',
   '91000000-0000-4000-8000-000000000001', 'gateway',
   '{"driver":"postgres","durationMs":42,"rowCount":18}'),
  ('90000000-0000-4000-8000-000000000002', now() - interval '12 minutes',
   '386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   '["commerce","payment_methods"]', 'queryRead', 'forbid', 'explicit_forbid',
   '91000000-0000-4000-8000-000000000002', 'control-plane',
   '{"driver":"mysql","ticketNonce":"92000000-0000-4000-8000-000000000002"}'),
  ('90000000-0000-4000-8000-000000000003', now() - interval '25 minutes',
   '386f9632-7ac7-4fd3-974c-58716b66e988', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004',
   '["logs-app-2026.09"]', 'metadataRead', 'permit', 'policy_permit',
   '91000000-0000-4000-8000-000000000003', 'gateway',
   '{"driver":"elasticsearch","durationMs":17}')
ON CONFLICT (id) DO NOTHING;

COMMIT;
