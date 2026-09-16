use anyhow::Result;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) async fn write_management_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    user_id: Uuid,
    project_id: Option<Uuid>,
    data_source_id: Option<Uuid>,
    resource_path: &[String],
    action: &str,
    metadata: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, user_id, project_id, data_source_id,
          resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'allow', 'ADMIN_MUTATION', $8, 'control-plane.admin', $9)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(user_id)
    .bind(project_id)
    .bind(data_source_id)
    .bind(serde_json::to_value(resource_path)?)
    .bind(action)
    .bind(Uuid::new_v4())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(super) async fn write_gateway_enrollment_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    gateway_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, 'gateway.enrollment.activate', 'allow', 'GATEWAY_PROOF_ACCEPTED', $4, 'gateway', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(serde_json::json!(["gateways", gateway_id.to_string()]))
    .bind(Uuid::new_v4())
    .bind(serde_json::json!({ "status": "active", "proof": "certificate-and-one-time-token" }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(super) async fn write_gateway_certificate_rotation_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    gateway_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, 'gateway.certificate-rotation.activate', 'allow', 'GATEWAY_ROTATION_PROOF_ACCEPTED', $4, 'gateway', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(serde_json::json!(["gateways", gateway_id.to_string()]))
    .bind(Uuid::new_v4())
    .bind(serde_json::json!({ "status": "active", "proof": "current-signing-key-and-one-time-token" }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}
