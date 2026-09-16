use oxide_studio_lib::core::protocol::QueryResult;
use tonic::Status;
pub(super) fn encode_bounded_results(
    results: &mut [QueryResult],
    claims: &oxide_enterprise_contracts::AccessSessionClaims,
) -> Result<(Vec<u8>, u64, bool), Status> {
    let mut remaining = claims.max_rows as usize;
    let mut returned_rows = 0_u64;
    let mut truncated = false;
    for result in &mut *results {
        if result.rows.len() > remaining {
            result.rows.truncate(remaining);
            truncated = true;
        }
        remaining = remaining.saturating_sub(result.rows.len());
        returned_rows += result.rows.len() as u64;
        if remaining == 0 {
            truncated = true;
        }
    }
    let payload = serde_json::to_vec(results)
        .map_err(|_| Status::internal("failed to encode managed query result"))?;
    if payload.len() as u64 > claims.max_result_bytes {
        return Err(Status::resource_exhausted(
            "managed query result exceeds the assigned response-size limit",
        ));
    }
    Ok((payload, returned_rows, truncated))
}
