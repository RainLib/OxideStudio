//! Reviewed Nacos configuration transfer.
//!
//! Nacos configurations are not SQL rows. The migration surface therefore
//! uses the driver's full native snapshot, binds the source and destination
//! revisions into a preview token, and keeps publish out of the query editor.

use crate::core::{
    manager::ConnectionManager,
    protocol::{NacosConfigPublishRequest, NacosConfigSnapshot, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

const MAX_TRANSFER_ITEMS: usize = 100;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigLocation {
    pub data_id: String,
    pub group: String,
    #[serde(default)]
    pub tenant: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferItem {
    pub source: NacosConfigLocation,
    pub target: NacosConfigLocation,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum NacosConflictPolicy {
    #[default]
    Abort,
    Skip,
    Overwrite,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferRequest {
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub items: Vec<NacosConfigTransferItem>,
    #[serde(default)]
    pub conflict_policy: NacosConflictPolicy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteNacosConfigTransferRequest {
    #[serde(flatten)]
    pub transfer: NacosConfigTransferRequest,
    pub confirmation_token: String,
    #[serde(default)]
    pub confirmation_phrase: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferPlanItem {
    pub source: NacosConfigLocation,
    pub target: NacosConfigLocation,
    pub status: String,
    pub source_content_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_content_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferPlan {
    pub total: usize,
    pub creates: usize,
    pub conflicts: usize,
    pub items: Vec<NacosConfigTransferPlanItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_phrase: Option<String>,
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferReceiptItem {
    pub target: NacosConfigLocation,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigTransferReceipt {
    pub created: usize,
    pub overwritten: usize,
    pub skipped: usize,
    pub items: Vec<NacosConfigTransferReceiptItem>,
}

async fn confirm_bundled_nacos(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err(
            "External drivers do not provide the reviewed Nacos migration protocol".to_string(),
        );
    }
    let driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The active connection identity is unavailable".to_string())?;
    if !driver.trim().eq_ignore_ascii_case("nacos") {
        return Err(
            "Nacos configuration migration requires an active Nacos connection".to_string(),
        );
    }
    Ok(())
}

fn validate_location(location: &NacosConfigLocation) -> Result<(), String> {
    for value in [&location.data_id, &location.group, &location.tenant] {
        if value.len() > 1_024 || value.contains('\0') {
            return Err("Nacos configuration key is invalid".to_string());
        }
    }
    if location.data_id.trim().is_empty() || location.group.trim().is_empty() {
        return Err("Nacos configuration dataId and group are required".to_string());
    }
    Ok(())
}

fn validate_request(request: &NacosConfigTransferRequest) -> Result<(), String> {
    if request.source_connection_id.trim().is_empty()
        || request.target_connection_id.trim().is_empty()
    {
        return Err("Nacos source and target connections are required".to_string());
    }
    if request.items.is_empty() || request.items.len() > MAX_TRANSFER_ITEMS {
        return Err(format!(
            "Select between 1 and {MAX_TRANSFER_ITEMS} Nacos configurations to migrate"
        ));
    }
    let mut targets = std::collections::HashSet::new();
    for item in &request.items {
        validate_location(&item.source)?;
        validate_location(&item.target)?;
        let target = (
            &item.target.data_id,
            &item.target.group,
            &item.target.tenant,
        );
        if !targets.insert(target) {
            return Err(
                "Multiple Nacos source configurations map to the same target key".to_string(),
            );
        }
        if request.source_connection_id == request.target_connection_id
            && item.source == item.target
        {
            return Err("A Nacos configuration cannot be migrated onto itself".to_string());
        }
    }
    Ok(())
}

fn digest_snapshot(snapshot: &NacosConfigSnapshot) -> String {
    let mut digest = Sha256::new();
    for value in [
        snapshot.data_id.as_bytes(),
        snapshot.group.as_bytes(),
        snapshot.tenant.as_bytes(),
        snapshot.content.as_bytes(),
        snapshot.revision.as_deref().unwrap_or("").as_bytes(),
    ] {
        digest.update(value);
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

fn plan_token(
    request: &NacosConfigTransferRequest,
    rows: &[(
        NacosConfigTransferItem,
        NacosConfigSnapshot,
        Option<NacosConfigSnapshot>,
    )],
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"oxide-nacos-config-transfer-v1\0");
    digest.update(request.source_connection_id.as_bytes());
    digest.update([0]);
    digest.update(request.target_connection_id.as_bytes());
    digest.update([0]);
    digest.update(format!("{:?}", request.conflict_policy).as_bytes());
    let mut rows = rows.iter().collect::<Vec<_>>();
    rows.sort_by(|(left, _, _), (right, _, _)| {
        (
            &left.target.tenant,
            &left.target.group,
            &left.target.data_id,
        )
            .cmp(&(
                &right.target.tenant,
                &right.target.group,
                &right.target.data_id,
            ))
    });
    for (item, source, target) in rows {
        for value in [
            item.source.data_id.as_bytes(),
            item.source.group.as_bytes(),
            item.source.tenant.as_bytes(),
            item.target.data_id.as_bytes(),
            item.target.group.as_bytes(),
            item.target.tenant.as_bytes(),
            digest_snapshot(source).as_bytes(),
            target
                .as_ref()
                .map(digest_snapshot)
                .unwrap_or_default()
                .as_bytes(),
        ] {
            digest.update(value);
            digest.update([0]);
        }
    }
    format!("{:x}", digest.finalize())
}

async fn build_plan(
    manager: &ConnectionManager,
    request: &NacosConfigTransferRequest,
) -> Result<
    (
        NacosConfigTransferPlan,
        Vec<(
            NacosConfigTransferItem,
            NacosConfigSnapshot,
            Option<NacosConfigSnapshot>,
        )>,
    ),
    String,
> {
    validate_request(request)?;
    confirm_bundled_nacos(manager, &request.source_connection_id).await?;
    confirm_bundled_nacos(manager, &request.target_connection_id).await?;
    let mut rows = Vec::with_capacity(request.items.len());
    for item in &request.items {
        let source = manager
            .get_nacos_config_snapshot(
                &request.source_connection_id,
                &item.source.data_id,
                &item.source.group,
                &item.source.tenant,
            )
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                format!(
                    "Nacos source configuration {}/{} no longer exists",
                    item.source.group, item.source.data_id
                )
            })?;
        let target = manager
            .get_nacos_config_snapshot(
                &request.target_connection_id,
                &item.target.data_id,
                &item.target.group,
                &item.target.tenant,
            )
            .await
            .map_err(|error| error.to_string())?;
        rows.push((item.clone(), source, target));
    }
    let creates = rows
        .iter()
        .filter(|(_, _, target)| target.is_none())
        .count();
    let conflicts = rows.len() - creates;
    let token = plan_token(request, &rows);
    let items = rows
        .iter()
        .map(|(item, source, target)| NacosConfigTransferPlanItem {
            source: item.source.clone(),
            target: item.target.clone(),
            status: if target.is_some() {
                "conflict"
            } else {
                "create"
            }
            .to_string(),
            source_content_digest: digest_snapshot(source),
            target_content_digest: target.as_ref().map(digest_snapshot),
        })
        .collect();
    Ok((
        NacosConfigTransferPlan {
            total: rows.len(),
            creates,
            conflicts,
            items,
            confirmation_phrase: (conflicts > 0).then(|| {
                format!(
                    "OVERWRITE {conflicts} CONFIGURATION{}",
                    if conflicts == 1 { "" } else { "S" }
                )
            }),
            confirmation_token: token,
        },
        rows,
    ))
}

#[tauri::command]
pub async fn preview_nacos_config_transfer(
    manager: State<'_, ConnectionManager>,
    request: NacosConfigTransferRequest,
) -> Result<Response<NacosConfigTransferPlan>, String> {
    Ok(match build_plan(&manager, &request).await {
        Ok((plan, _)) => Response::ok(plan),
        Err(error) => Response::err("NACOS_CONFIG_TRANSFER_PREVIEW_ERROR", &error),
    })
}

#[tauri::command]
pub async fn execute_nacos_config_transfer(
    manager: State<'_, ConnectionManager>,
    request: ExecuteNacosConfigTransferRequest,
) -> Result<Response<NacosConfigTransferReceipt>, String> {
    let result = async {
        let (plan, rows) = build_plan(&manager, &request.transfer).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "Nacos migration plan changed after preview; review it again before applying"
                    .to_string(),
            );
        }
        if matches!(request.transfer.conflict_policy, NacosConflictPolicy::Abort)
            && plan.conflicts > 0
        {
            return Err(
                "Nacos migration has target conflicts; choose Skip or Overwrite after review"
                    .to_string(),
            );
        }
        if let Some(phrase) = plan.confirmation_phrase.as_deref() {
            if !matches!(
                request.transfer.conflict_policy,
                NacosConflictPolicy::Overwrite
            ) {
                return Err(
                    "Nacos conflicts require an explicit Overwrite or Skip policy".to_string(),
                );
            }
            if request.confirmation_phrase.trim() != phrase {
                return Err(format!(
                    "Type {phrase} exactly to overwrite existing Nacos configurations"
                ));
            }
        }
        let mut receipt = NacosConfigTransferReceipt {
            created: 0,
            overwritten: 0,
            skipped: 0,
            items: Vec::with_capacity(rows.len()),
        };
        for (item, source, target) in rows {
            if target.is_some()
                && matches!(request.transfer.conflict_policy, NacosConflictPolicy::Skip)
            {
                receipt.skipped += 1;
                receipt.items.push(NacosConfigTransferReceiptItem {
                    target: item.target,
                    status: "skipped".to_string(),
                });
                continue;
            }
            let published = manager
                .publish_nacos_config(
                    &request.transfer.target_connection_id,
                    NacosConfigPublishRequest {
                        data_id: &item.target.data_id,
                        group: &item.target.group,
                        tenant: &item.target.tenant,
                        content: &source.content,
                        expected_revision: target
                            .as_ref()
                            .and_then(|snapshot| snapshot.revision.as_deref()),
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
            if published.overwritten {
                receipt.overwritten += 1;
            } else {
                receipt.created += 1;
            }
            receipt.items.push(NacosConfigTransferReceiptItem {
                target: item.target,
                status: if published.overwritten {
                    "overwritten"
                } else {
                    "created"
                }
                .to_string(),
            });
        }
        Ok(receipt)
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => Response::err("NACOS_CONFIG_TRANSFER_EXECUTE_ERROR", &error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location(data_id: &str) -> NacosConfigLocation {
        NacosConfigLocation {
            data_id: data_id.to_string(),
            group: "DEFAULT_GROUP".to_string(),
            tenant: String::new(),
        }
    }

    #[test]
    fn transfer_request_rejects_duplicate_targets_and_self_copy() {
        let item = NacosConfigTransferItem {
            source: location("source"),
            target: location("target"),
        };
        let request = NacosConfigTransferRequest {
            source_connection_id: "a".to_string(),
            target_connection_id: "b".to_string(),
            items: vec![item.clone(), item],
            conflict_policy: NacosConflictPolicy::Abort,
        };
        assert!(validate_request(&request).is_err());
        let self_copy = NacosConfigTransferRequest {
            source_connection_id: "a".to_string(),
            target_connection_id: "a".to_string(),
            items: vec![NacosConfigTransferItem {
                source: location("same"),
                target: location("same"),
            }],
            conflict_policy: NacosConflictPolicy::Abort,
        };
        assert!(validate_request(&self_copy).is_err());
    }

    #[test]
    fn transfer_token_binds_source_target_and_conflict_policy() {
        let item = NacosConfigTransferItem {
            source: location("source"),
            target: location("target"),
        };
        let source = NacosConfigSnapshot {
            data_id: "source".to_string(),
            group: "DEFAULT_GROUP".to_string(),
            tenant: String::new(),
            content: "one".to_string(),
            revision: Some("source-md5".to_string()),
        };
        let target = NacosConfigSnapshot {
            data_id: "target".to_string(),
            group: "DEFAULT_GROUP".to_string(),
            tenant: String::new(),
            content: "old".to_string(),
            revision: Some("target-md5".to_string()),
        };
        let mut request = NacosConfigTransferRequest {
            source_connection_id: "a".to_string(),
            target_connection_id: "b".to_string(),
            items: vec![item.clone()],
            conflict_policy: NacosConflictPolicy::Overwrite,
        };
        let original = plan_token(
            &request,
            &[(item.clone(), source.clone(), Some(target.clone()))],
        );
        let changed_source = NacosConfigSnapshot {
            content: "two".to_string(),
            ..source
        };
        assert_ne!(
            original,
            plan_token(
                &request,
                &[(item.clone(), changed_source, Some(target.clone()))]
            )
        );
        request.conflict_policy = NacosConflictPolicy::Skip;
        assert_ne!(
            original,
            plan_token(
                &request,
                &[(
                    item,
                    NacosConfigSnapshot {
                        data_id: "source".to_string(),
                        group: "DEFAULT_GROUP".to_string(),
                        tenant: String::new(),
                        content: "one".to_string(),
                        revision: Some("source-md5".to_string())
                    },
                    Some(target)
                )]
            )
        );
    }
}
