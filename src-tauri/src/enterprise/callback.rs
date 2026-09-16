use anyhow::{anyhow, Context, Result};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use url::Url;

use super::support::MAX_CALLBACK_BYTES;

pub(super) async fn receive_callback(listener: TcpListener) -> Result<(String, String)> {
    let (mut socket, _) = listener.accept().await?;
    let mut buffer = vec![0_u8; MAX_CALLBACK_BYTES];
    let read = socket
        .read(&mut buffer)
        .await
        .context("failed to read the sign-in callback")?;
    let request =
        std::str::from_utf8(&buffer[..read]).context("sign-in callback was not valid HTTP")?;
    let result = parse_callback_request(request);
    let (status, message) = if result.is_ok() {
        ("200 OK", "Sign-in complete. You can return to OxideStudio.")
    } else {
        (
            "400 Bad Request",
            "Sign-in could not be completed. Return to OxideStudio for details.",
        )
    };
    let body = format!(
        "<!doctype html><html><body style=\"font:14px system-ui;background:#15171a;color:#e7e9ed;padding:48px\"><h1 style=\"font-size:18px\">OxideStudio</h1><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    result
}

pub(super) fn parse_callback_request(request: &str) -> Result<(String, String)> {
    let request_target = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split_once(' ').map(|(target, _)| target))
        .context("sign-in callback request line is invalid")?;
    let callback = Url::parse(&format!("http://127.0.0.1{request_target}"))
        .context("sign-in callback URL is invalid")?;
    if callback.path() != "/callback" {
        return Err(anyhow!("sign-in callback path is invalid"));
    }
    let parameters = callback
        .query_pairs()
        .into_owned()
        .collect::<std::collections::HashMap<_, _>>();
    if let Some(error) = parameters.get("error") {
        return Err(anyhow!("identity provider returned {error}"));
    }
    let code = parameters
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned()
        .context("sign-in callback did not contain an authorization code")?;
    let state = parameters
        .get("state")
        .filter(|value| !value.is_empty())
        .cloned()
        .context("sign-in callback did not contain state")?;
    Ok((code, state))
}
