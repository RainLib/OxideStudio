-- Audit records are append-only at the database boundary. Every successful
-- insert is also queued in the same transaction for an external SIEM sink.
-- The outbox uses audit_event_id as its immutable identity, so delivery
-- retries cannot create a second security event.
CREATE TABLE IF NOT EXISTS audit_outbox (
    audit_event_id UUID PRIMARY KEY REFERENCES audit_events(id) ON DELETE RESTRICT,
    organization_id UUID,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_expires_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_outbox_due
    ON audit_outbox(next_attempt_at)
    WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION oxide_enqueue_audit_outbox()
RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_outbox (audit_event_id, organization_id, payload)
    VALUES (
        NEW.id,
        NEW.organization_id,
        jsonb_build_object(
            'id', NEW.id,
            'occurredAt', NEW.occurred_at,
            'organizationId', NEW.organization_id,
            'userId', NEW.user_id,
            'deviceId', NEW.device_id,
            'projectId', NEW.project_id,
            'dataSourceId', NEW.data_source_id,
            'resourcePath', NEW.resource_path,
            'action', NEW.action,
            'decision', NEW.decision,
            'reasonCode', NEW.reason_code,
            'requestId', NEW.request_id,
            'source', NEW.source,
            'metadata', NEW.metadata
        )
    )
    ON CONFLICT (audit_event_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_enqueue_outbox ON audit_events;
CREATE TRIGGER audit_events_enqueue_outbox
AFTER INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION oxide_enqueue_audit_outbox();

CREATE OR REPLACE FUNCTION oxide_reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION oxide_reject_audit_event_mutation();

-- Migrations may be deployed after audit_events already contains history.
INSERT INTO audit_outbox (audit_event_id, organization_id, payload)
SELECT
    id,
    organization_id,
    jsonb_build_object(
        'id', id,
        'occurredAt', occurred_at,
        'organizationId', organization_id,
        'userId', user_id,
        'deviceId', device_id,
        'projectId', project_id,
        'dataSourceId', data_source_id,
        'resourcePath', resource_path,
        'action', action,
        'decision', decision,
        'reasonCode', reason_code,
        'requestId', request_id,
        'source', source,
        'metadata', metadata
    )
FROM audit_events
ON CONFLICT (audit_event_id) DO NOTHING;
