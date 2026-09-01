use crate::core::mq_agent::RocketMqAgentManager;
use crate::core::protocol::Response;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::net::lookup_host;
use tokio::time::timeout;

const ROCKETMQ_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_NAMESERVERS: usize = 16;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RocketMqProbeResult {
    pub endpoints: Vec<String>,
}

#[tauri::command]
pub async fn probe_rocketmq_nameservers(
    namesrv_addr: String,
) -> Result<Response<RocketMqProbeResult>, String> {
    let endpoints = parse_rocketmq_nameservers(&namesrv_addr).map_err(|error| error.to_string())?;
    let mut reachable = Vec::new();
    for endpoint in endpoints {
        let connected = timeout(ROCKETMQ_PROBE_TIMEOUT, async {
            let mut addresses = lookup_host(&endpoint).await?;
            let address = addresses
                .next()
                .ok_or_else(|| std::io::Error::other("no resolved address"))?;
            tokio::net::TcpStream::connect(address).await.map(|_| ())
        })
        .await;
        if matches!(connected, Ok(Ok(()))) {
            reachable.push(endpoint);
        }
    }
    if reachable.is_empty() {
        return Ok(Response::err_with_details(
            "ROCKETMQ_NAMESRV_UNREACHABLE",
            "No configured RocketMQ NameServer is reachable",
            true,
            None,
        ));
    }
    Ok(Response::ok(RocketMqProbeResult {
        endpoints: reachable,
    }))
}

/// Starts the dedicated RocketMQ workspace agent for one connection.  The
/// process is owned by the desktop host, never by the webview, and is replaced
/// atomically if this connection is re-opened.
#[tauri::command]
pub async fn connect_rocketmq_workspace(
    app: AppHandle,
    manager: State<'_, RocketMqAgentManager>,
    connection_id: String,
    config: Value,
) -> Result<Value, String> {
    manager
        .connect(&app, connection_id, config)
        .await
        .map_err(|error| error.to_string())
}

/// Performs the same real agent handshake and broker check without retaining a
/// session or credentials after the response is returned.
#[tauri::command]
pub async fn test_rocketmq_workspace(
    app: AppHandle,
    manager: State<'_, RocketMqAgentManager>,
    config: Value,
) -> Result<Value, String> {
    manager
        .test_connection(&app, config)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_rocketmq_cluster(
    manager: State<'_, RocketMqAgentManager>,
    connection_id: String,
) -> Result<Value, String> {
    manager
        .request(
            &connection_id,
            "mq_describe_cluster",
            Value::Object(Default::default()),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_rocketmq_topics(
    manager: State<'_, RocketMqAgentManager>,
    connection_id: String,
    keyword: Option<String>,
) -> Result<Value, String> {
    manager
        .request(
            &connection_id,
            "mq_list_topics",
            serde_json::json!({ "keyword": keyword.unwrap_or_default() }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_rocketmq_consumer_groups(
    manager: State<'_, RocketMqAgentManager>,
    connection_id: String,
    keyword: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<Value, String> {
    manager
        .request(
            &connection_id,
            "mq_list_consumer_groups",
            serde_json::json!({
                "keyword": keyword.unwrap_or_default(),
                "offset": offset.unwrap_or(0),
                "limit": limit.unwrap_or(200),
            }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn disconnect_rocketmq_workspace(
    manager: State<'_, RocketMqAgentManager>,
    connection_id: String,
) -> Result<(), String> {
    manager.disconnect(&connection_id).await;
    Ok(())
}

fn parse_rocketmq_nameservers(value: &str) -> Result<Vec<String>, &'static str> {
    let mut endpoints = BTreeSet::new();
    for raw in value.split([',', ';']) {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        if raw.contains("//") || raw.contains(['/', '?', '#']) {
            return Err("RocketMQ NameServer addresses must be host:port values");
        }
        let address: SocketAddr = raw.parse().or_else(|_| {
            let (host, port) = raw
                .rsplit_once(':')
                .ok_or("RocketMQ NameServer addresses are invalid")?;
            if host.trim().is_empty()
                || (host.contains(':') && !(host.starts_with('[') && host.ends_with(']')))
            {
                return Err("RocketMQ NameServer addresses are invalid");
            }
            port.parse::<u16>()
                .map_err(|_| "RocketMQ NameServer addresses are invalid")?;
            Ok::<SocketAddr, &'static str>("127.0.0.1:1".parse().unwrap())
        })?;
        if address.port() == 0 {
            return Err("RocketMQ NameServer addresses are invalid");
        }
        endpoints.insert(raw.to_string());
        if endpoints.len() > MAX_NAMESERVERS {
            return Err("At most 16 RocketMQ NameServer addresses are allowed");
        }
    }
    if endpoints.is_empty() {
        return Err("RocketMQ NameServer address is required");
    }
    Ok(endpoints.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nameservers_are_bounded_and_normalized() {
        assert_eq!(
            parse_rocketmq_nameservers("127.0.0.1:9876;127.0.0.1:9876").unwrap(),
            ["127.0.0.1:9876"]
        );
        assert!(parse_rocketmq_nameservers("http://localhost:9876").is_err());
        assert!(parse_rocketmq_nameservers(":9876").is_err());
        assert!(parse_rocketmq_nameservers("2001:db8::1:9876").is_err());
    }
}
