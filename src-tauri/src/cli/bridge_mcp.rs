use crate::oxide_agent::policy::reject_self_reported_approval;
use oxide_studio_lib::{
    agent::{bridge::PrivateBridgeClient, protocol::AgentToolManifestEntry},
    core::redaction::redact_connection_url,
};
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
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

pub struct PrivateBridgeMcpServer {
    client: Arc<Mutex<PrivateBridgeClient>>,
    tools: Arc<HashMap<String, AgentToolManifestEntry>>,
}

impl PrivateBridgeMcpServer {
    async fn connect() -> anyhow::Result<Self> {
        let mut client = PrivateBridgeClient::connect_from_environment().await?;
        let tools: Vec<AgentToolManifestEntry> =
            serde_json::from_value(client.list_tools().await?)?;
        if tools.is_empty() {
            anyhow::bail!("private Agent bridge has no tools for this turn");
        }
        Ok(Self {
            client: Arc::new(Mutex::new(client)),
            tools: Arc::new(
                tools
                    .into_iter()
                    .map(|tool| (tool.name.clone(), tool))
                    .collect(),
            ),
        })
    }
}

impl ServerHandler for PrivateBridgeMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_11_25)
            .with_server_info(
                Implementation::new("oxide-agent-private", env!("CARGO_PKG_VERSION"))
                    .with_title("OxideStudio scoped application tools")
                    .with_description(
                        "Turn-scoped tools routed through the running OxideStudio Desktop approval broker",
                    ),
            )
            .with_instructions(
                "This server is private to one OxideStudio turn. The Desktop validates the frozen workspace and creates every required approval; caller-reported approval is rejected.",
            )
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        if !ProtocolVersion::KNOWN_VERSIONS.contains(&request.protocol_version) {
            return Err(ErrorData::invalid_params(
                "oxide-agent private bridge requires MCP protocol 2025-11-25",
                Some(json!({
                    "requested":request.protocol_version,
                    "supported":ProtocolVersion::KNOWN_VERSIONS,
                })),
            ));
        }
        let negotiated = request.protocol_version.clone();
        context.peer.set_peer_info(request);
        Ok(self.get_info().with_protocol_version(negotiated))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut tools = self.tools.values().map(mcp_tool).collect::<Vec<_>>();
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(ListToolsResult::with_all_items(tools))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.get(name).map(mcp_tool)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !self.tools.contains_key(request.name.as_ref()) {
            return Err(ErrorData::new(
                rmcp::model::ErrorCode::METHOD_NOT_FOUND,
                format!("unknown OxideStudio private tool: {}", request.name),
                None,
            ));
        }
        let meta = serde_json::to_value(&request.meta).unwrap_or(Value::Null);
        let input = Value::Object(request.arguments.unwrap_or_default());
        if let Err(error) =
            reject_self_reported_approval(&meta).and_then(|_| reject_self_reported_approval(&input))
        {
            return Ok(tool_error("APPROVAL_CLAIM_REJECTED", error.to_string()));
        }
        let call_id = format!("cli-{}", uuid::Uuid::new_v4());
        match self
            .client
            .lock()
            .await
            .call_tool(call_id, request.name.to_string(), input)
            .await
        {
            Ok(value) => Ok(CallToolResult::structured(value)),
            Err(error) => Ok(tool_error(
                "TOOL_EXECUTION_REJECTED",
                redact_connection_url(&error.to_string()),
            )),
        }
    }
}

pub async fn serve_stdio() -> anyhow::Result<()> {
    // The inherited endpoint and token are mandatory. There is deliberately no
    // project/data-dir fallback: without the live Desktop broker this mode exits.
    let service = PrivateBridgeMcpServer::connect()
        .await?
        .serve(rmcp::transport::io::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}

fn mcp_tool(spec: &AgentToolManifestEntry) -> Tool {
    let input_schema: Map<String, Value> =
        spec.input_schema.as_object().cloned().unwrap_or_default();
    let destructive = spec
        .permissions
        .iter()
        .any(|permission| permission == "destructive");
    let read_only = spec
        .permissions
        .iter()
        .all(|permission| permission == "read");
    let open_world = spec
        .permissions
        .iter()
        .any(|permission| permission == "external");
    let annotations = ToolAnnotations::new()
        .read_only(read_only)
        .destructive(destructive)
        .idempotent(read_only)
        .open_world(open_world);
    Tool::new(
        spec.name.clone(),
        spec.description.clone(),
        Arc::new(input_schema),
    )
    .with_title(spec.name.clone())
    .with_annotations(annotations)
}

fn tool_error(code: &str, message: String) -> CallToolResult {
    CallToolResult::structured_error(json!({
        "error":{
            "code":code,
            "message":message,
            "retryable":false,
        }
    }))
}
