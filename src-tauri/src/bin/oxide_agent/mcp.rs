use crate::oxide_agent::{catalog, policy::reject_self_reported_approval, runtime::ToolRuntime};
use oxide_studio_lib::core::redaction::redact_connection_url;
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, Implementation, InitializeRequestParams,
        InitializeResult, ListToolsResult, PaginatedRequestParams, ProtocolVersion,
        ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
    },
    service::{RequestContext, RoleServer},
    ErrorData, ServerHandler, ServiceExt,
};
use serde_json::{json, Map, Value};
use std::sync::Arc;

pub struct OxideMcpServer {
    runtime: Arc<ToolRuntime>,
}

impl OxideMcpServer {
    pub fn new(runtime: Arc<ToolRuntime>) -> Self {
        Self { runtime }
    }
}

impl ServerHandler for OxideMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_11_25)
            .with_server_info(
                Implementation::new("oxide-agent", env!("CARGO_PKG_VERSION"))
                    .with_title("OxideStudio read-only database tools")
                    .with_description(
                        "Project-scoped, bounded, backend-enforced read-only database tools",
                    ),
            )
            .with_instructions(format!(
                "This stdio server is restricted to OxideStudio project '{}'. It never accepts caller-reported approval and exposes no mutation tools.",
                self.runtime.grant().project_id()
            ))
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        if request.protocol_version != ProtocolVersion::V_2025_11_25 {
            return Err(ErrorData::invalid_params(
                "oxide-agent requires MCP protocol 2025-11-25",
                Some(json!({
                    "requested": request.protocol_version,
                    "supported": "2025-11-25",
                })),
            ));
        }
        context.peer.set_peer_info(request);
        Ok(self.get_info())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(
            catalog::all().into_iter().map(mcp_tool).collect(),
        ))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        catalog::find(name).map(mcp_tool)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if catalog::find(request.name.as_ref()).is_none() {
            return Err(ErrorData::new(
                rmcp::model::ErrorCode::METHOD_NOT_FOUND,
                format!("unknown OxideStudio tool: {}", request.name),
                None,
            ));
        }

        let meta = serde_json::to_value(&request.meta).unwrap_or(Value::Null);
        if let Err(error) = reject_self_reported_approval(&meta) {
            return Ok(tool_error("APPROVAL_CLAIM_REJECTED", error.to_string()));
        }
        let input = Value::Object(request.arguments.unwrap_or_default());
        match self.runtime.invoke(request.name.as_ref(), input).await {
            Ok(value) => Ok(CallToolResult::structured(value)),
            Err(error) => Ok(tool_error(
                "TOOL_EXECUTION_REJECTED",
                redact_connection_url(&error.to_string()),
            )),
        }
    }
}

pub async fn serve_stdio(runtime: Arc<ToolRuntime>) -> anyhow::Result<()> {
    // stdout belongs exclusively to the MCP transport. Diagnostics use stderr
    // in the binary entry point and never share the protocol stream.
    let service = OxideMcpServer::new(runtime)
        .serve(rmcp::transport::io::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}

fn mcp_tool(spec: catalog::ToolSpec) -> Tool {
    let input_schema: Map<String, Value> =
        spec.input_schema.as_object().cloned().unwrap_or_default();
    let annotations = ToolAnnotations::new()
        .read_only(spec.read_only)
        .destructive(spec.destructive)
        .idempotent(spec.idempotent)
        .open_world(spec.open_world);
    Tool::new(spec.name, spec.description, Arc::new(input_schema))
        .with_title(spec.title)
        .with_annotations(annotations)
}

fn tool_error(code: &str, message: String) -> CallToolResult {
    CallToolResult::structured_error(json!({
        "error": {
            "code": code,
            "message": message,
            "retryable": false,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_catalog_marks_every_tool_as_read_only() {
        for tool in catalog::all().into_iter().map(mcp_tool) {
            let annotations = tool.annotations.expect("annotations");
            assert_eq!(annotations.read_only_hint, Some(true));
            assert_eq!(annotations.destructive_hint, Some(false));
        }
    }

    #[test]
    fn server_protocol_fallback_is_stable_2025_11_25() {
        assert_eq!(ProtocolVersion::LATEST, ProtocolVersion::V_2025_11_25);
    }
}
