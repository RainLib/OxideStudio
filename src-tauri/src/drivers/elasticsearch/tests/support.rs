use serde_json::{json, Value};

pub(super) async fn read_test_http_request(socket: &mut tokio::net::TcpStream) -> String {
    use tokio::io::AsyncReadExt;

    let mut request = Vec::new();
    let mut buffer = [0_u8; 4096];
    let mut expected_length = None;
    loop {
        let read = socket.read(&mut buffer).await.unwrap();
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if expected_length.is_none() {
            if let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let body_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                expected_length = Some(header_end + 4 + body_length);
            }
        }
        if expected_length.is_some_and(|length| request.len() >= length) {
            break;
        }
    }
    String::from_utf8_lossy(&request).into_owned()
}

pub(super) fn serve_test_http_responses(
    listener: tokio::net::TcpListener,
    responses: Vec<(u16, String)>,
) -> tokio::task::JoinHandle<Vec<String>> {
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;

        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            requests.push(read_test_http_request(&mut socket).await);
            let reason = match status {
                200 => "OK",
                400 => "Bad Request",
                401 => "Unauthorized",
                403 => "Forbidden",
                503 => "Service Unavailable",
                _ => "Error",
            };
            let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    })
}

pub(super) fn missing_pit_shard_doc_response() -> Value {
    json!({
        "error": {
            "root_cause": [{
                "type": "query_shard_exception",
                "reason": "No mapping found for [_shard_doc] in order to sort on"
            }],
            "type": "search_phase_execution_exception",
            "reason": "all shards failed"
        },
        "status": 400
    })
}

pub(super) fn test_document_page_response(total: usize) -> String {
    json!({
        "hits": {
            "total": { "value": total, "relation": "eq" },
            "hits": [{
                "_id": "1",
                "_source": { "name": "one" }
            }]
        }
    })
    .to_string()
}
