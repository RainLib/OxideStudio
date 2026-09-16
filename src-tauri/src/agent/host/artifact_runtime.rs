use super::artifact_helpers::{
    artifact_export_file_name, artifact_text_range, search_artifact_text, validate_artifact_id,
    validate_artifact_read_bytes, validate_artifact_search,
};
use super::conversation_helpers::validate_project_id;
use super::host_errors::SidecarRequestError;
use super::session_state::AgentHostInner;
use crate::agent::protocol::AgentArtifactExportRequest;
use crate::agent::protocol::AgentArtifactExportResult;
use crate::agent::protocol::AgentArtifactReadRequest;
use crate::agent::protocol::AgentArtifactReadResult;
use crate::agent::protocol::AgentArtifactSearchRequest;
use crate::agent::protocol::AgentArtifactSearchResult;
use crate::agent::protocol::ArtifactReadRequest;
use crate::agent::protocol::ArtifactSearchRequest;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL;
use base64::Engine;
use serde_json::json;
use serde_json::Value;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

impl AgentHostInner {
    pub(super) async fn read_artifact(
        &self,
        request: AgentArtifactReadRequest,
    ) -> Result<AgentArtifactReadResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        validate_artifact_read_bytes(request.max_bytes).map_err(|error| anyhow!(error.message))?;
        let Some(content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Ok(AgentArtifactReadResult {
                artifact_id: request.artifact_id,
                found: false,
                offset: 0,
                next_offset: 0,
                total_bytes: 0,
                eof: true,
                content: String::new(),
            });
        };
        let (offset, next_offset, content_range) =
            artifact_text_range(&content, request.offset, request.max_bytes);
        Ok(AgentArtifactReadResult {
            artifact_id: request.artifact_id,
            found: true,
            offset,
            next_offset,
            total_bytes: content.len(),
            eof: next_offset == content.len(),
            content: content_range.to_string(),
        })
    }

    pub(super) async fn search_artifact(
        &self,
        request: AgentArtifactSearchRequest,
    ) -> Result<AgentArtifactSearchResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        validate_artifact_search(&request.query, request.max_matches, request.context_bytes)
            .map_err(|error| anyhow!(error.message))?;
        let query = request.query.trim().to_string();
        let Some(content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Ok(AgentArtifactSearchResult {
                artifact_id: request.artifact_id,
                query,
                found: false,
                total_bytes: 0,
                match_count: 0,
                truncated: false,
                matches: Vec::new(),
            });
        };
        let (matches, truncated) =
            search_artifact_text(&content, &query, request.max_matches, request.context_bytes);
        Ok(AgentArtifactSearchResult {
            artifact_id: request.artifact_id,
            query,
            found: true,
            total_bytes: content.len(),
            match_count: matches.len(),
            truncated,
            matches,
        })
    }

    pub(super) async fn export_artifact(
        &self,
        request: AgentArtifactExportRequest,
    ) -> Result<AgentArtifactExportResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        let Some(mut content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Err(anyhow!(
                "This encrypted result is no longer available. Agent artifacts expire after 7 days."
            ));
        };
        content.push('\n');
        let suggested_file_name =
            artifact_export_file_name(request.suggested_file_name.as_deref(), &request.artifact_id);
        let (sender, receiver) = oneshot::channel();
        self.app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_title("Export AI tool result")
            .set_file_name(suggested_file_name)
            .save_file(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver
            .await
            .context("artifact export dialog closed unexpectedly")?
        else {
            return Ok(AgentArtifactExportResult {
                artifact_id: request.artifact_id,
                exported: false,
                file_path: None,
                byte_count: 0,
            });
        };
        let path = selection
            .into_path()
            .map_err(|_| anyhow!("the selected export destination is not a local file"))?;
        tokio::fs::write(&path, content.as_bytes())
            .await
            .with_context(|| format!("failed to export artifact to {}", path.display()))?;
        Ok(AgentArtifactExportResult {
            artifact_id: request.artifact_id,
            exported: true,
            file_path: Some(path.to_string_lossy().into_owned()),
            byte_count: content.len(),
        })
    }

    pub(super) async fn load_artifact_text(
        &self,
        project_id: &str,
        artifact_id: &str,
        pretty: bool,
    ) -> Result<Option<String>> {
        let Some(artifact) = self.store.load_artifact(project_id, artifact_id).await? else {
            return Ok(None);
        };
        let content = if pretty {
            serde_json::to_string_pretty(&artifact)?
        } else {
            serde_json::to_string(&artifact)?
        };
        Ok(Some(content))
    }

    pub(super) async fn handle_artifact_read(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ArtifactReadRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        validate_artifact_id(&request.artifact_id)?;
        validate_artifact_read_bytes(request.max_bytes)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "artifact project does not match the active turn"
            )));
        }
        let artifact = self
            .store
            .load_artifact(&request.project_id, &request.artifact_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        let Some(artifact) = artifact else {
            return Ok(json!({"artifactId": request.artifact_id, "value": null}));
        };
        let content = serde_json::to_string(&artifact).map_err(SidecarRequestError::from_json)?;
        if request.offset == 0 && content.len() <= request.max_bytes {
            return Ok(json!({"artifactId": request.artifact_id, "value": artifact}));
        }
        let (offset, end, content_range) =
            artifact_text_range(&content, request.offset, request.max_bytes);
        Ok(json!({
            "artifactId":request.artifact_id,
            "encoding":"base64-json",
            "offset":offset,
            "nextOffset":end,
            "totalBytes":content.len(),
            "eof":end == content.len(),
            "content":BASE64_URL.encode(content_range.as_bytes()),
        }))
    }

    pub(super) async fn handle_artifact_search(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ArtifactSearchRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        validate_artifact_id(&request.artifact_id)?;
        let query = request.query.trim();
        validate_artifact_search(query, request.max_matches, request.context_bytes)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "artifact project does not match the active turn"
            )));
        }
        let artifact = self
            .store
            .load_artifact(&request.project_id, &request.artifact_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        let Some(artifact) = artifact else {
            return Ok(json!({
                "artifactId": request.artifact_id,
                "query": query,
                "totalBytes": 0,
                "matchCount": 0,
                "truncated": false,
                "matches": [],
            }));
        };
        let content = serde_json::to_string(&artifact).map_err(SidecarRequestError::from_json)?;
        let (matches, truncated) =
            search_artifact_text(&content, query, request.max_matches, request.context_bytes);
        Ok(json!({
            "artifactId": request.artifact_id,
            "query": query,
            "totalBytes": content.len(),
            "matchCount": matches.len(),
            "truncated": truncated,
            "matches": matches,
        }))
    }
}
