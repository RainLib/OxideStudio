use super::models::*;
use axum::{extract::State, http::HeaderMap, Json};

pub(super) async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    let memberships = state.store.memberships(user.id).await?;
    Ok(Json(MeResponse { user, memberships }))
}

pub(super) async fn managed_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<oxide_enterprise_contracts::ManagedProject>>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    Ok(Json(state.store.managed_projects(user.id).await?))
}
