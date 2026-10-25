use anyhow::{Context, Result};
use serde_json::{json, Value};
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::{
    path::PathBuf,
    process::Output,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

struct Fixture {
    root: tempfile::TempDir,
    next_input: AtomicUsize,
}

impl Fixture {
    async fn new() -> Result<Self> {
        let root = tempfile::tempdir()?;
        let data = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(root.path().join("records.db"))
                .create_if_missing(true),
        )
        .await?;
        sqlx::raw_sql(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL); \
            INSERT INTO items VALUES (1, 'one'); CREATE INDEX items_name ON items(name); \
            CREATE VIEW item_names AS SELECT name FROM items;",
        )
        .execute(&data)
        .await?;
        data.close().await;
        let metadata = SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(root.path().join("metadata.db"))
                .create_if_missing(true),
        )
        .await?;
        sqlx::raw_sql("CREATE TABLE projects (id TEXT PRIMARY KEY); \
            CREATE TABLE connections (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, driver TEXT, config TEXT, updated_at INTEGER); \
            CREATE TABLE resources (id TEXT PRIMARY KEY, project_id TEXT, connection_id TEXT, parent_id TEXT, kind TEXT, name TEXT, metadata TEXT, last_updated INTEGER); \
            INSERT INTO projects VALUES ('project-a'), ('project-b');").execute(&metadata).await?;
        let configuration = json!({"id":"conn-a", "projectId":"project-a", "name":"fixture", "driver":"sqlite", "url":root.path().join("records.db").to_string_lossy(), "database":root.path().join("records.db").to_string_lossy()});
        sqlx::query("INSERT INTO connections VALUES ('conn-a','project-a','fixture','sqlite',?,1)")
            .bind(configuration.to_string())
            .execute(&metadata)
            .await?;
        let configuration = json!({"id":"conn-pg", "projectId":"project-a", "name":"unconnected PostgreSQL", "driver":"postgres", "url":"postgres://127.0.0.1:1/app"});
        sqlx::query("INSERT INTO connections VALUES ('conn-pg','project-a','pg','postgres',?,1)")
            .bind(configuration.to_string())
            .execute(&metadata)
            .await?;
        sqlx::raw_sql(r#"
            INSERT INTO resources VALUES
              ('main','project-a','conn-a',NULL,'DATABASE','main','{}',1),
              ('other','project-a','conn-a',NULL,'DATABASE','other','{}',1),
              ('ca','project-a','conn-a','main','TABLE','cached_allowed','{"password":"private"}',1),
              ('co','project-a','conn-a','other','TABLE','cached_outside','{}',1),
              ('cl','project-a','conn-a',NULL,'TABLE','cached_legacy','{}',1),
              ('cc','project-a','conn-a','main','TABLE','cached_conflicting','{"database":"other"}',1),
              ('foreign','project-b','conn-a',NULL,'DATABASE','main','{}',1),
              ('cross-project','project-a','conn-a','foreign','TABLE','cached_cross_project','{}',1),
              ('pg-schema','project-a','conn-pg',NULL,'DATABASE','main','{}',1),
              ('pg-legacy','project-a','conn-pg','pg-schema','TABLE','pg_legacy','{}',1),
              ('pg-known','project-a','conn-pg','pg-schema','TABLE','pg_known','{"database":"main"}',1);
        "#).execute(&metadata).await?;
        metadata.close().await;
        Ok(Self {
            root,
            next_input: AtomicUsize::new(0),
        })
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_oxide-agent"));
        command.kill_on_drop(true);
        command.env("NO_PROXY", "127.0.0.1,localhost");
        // Isolate test authorization from the developer's optional CLI settings.
        for name in [
            "OXIDE_PROJECT_ID",
            "OXIDE_CONNECTION_ID",
            "OXIDE_DATABASE",
            "OXIDE_MCP_TOOL",
            "OXIDE_MCP_QUERY_TIMEOUT_SECS",
        ] {
            command.env_remove(name);
        }
        command
    }

    fn scope(&self, command: &mut Command) {
        command
            .args(["--project", "project-a", "--data-dir"])
            .arg(self.root.path());
    }

    async fn call(&self, tool: &str, input: Value, extra: &[&str]) -> Result<Output> {
        let input_file = self.root.path().join(format!(
            "input-{}.json",
            self.next_input.fetch_add(1, Ordering::Relaxed)
        ));
        tokio::fs::write(&input_file, input.to_string()).await?;
        let mut command = self.command();
        command
            .args(["tools", "call", tool, "--input"])
            .arg(format!("@{}", input_file.display()));
        self.scope(&mut command);
        if !extra.contains(&"--connection") {
            command.args(["--connection", "conn-a"]);
        }
        if !extra.contains(&"--query-timeout-secs") {
            command.args(["--query-timeout-secs", "5"]);
        }
        command.args(extra);
        Ok(tokio::time::timeout(Duration::from_secs(15), command.output()).await??)
    }

    async fn json(&self, tool: &str, input: Value, extra: &[&str]) -> Result<Value> {
        let output = self.call(tool, input, extra).await?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).context("CLI must return only JSON")
    }
}

fn names(response: &Value) -> Vec<&str> {
    response["data"]["objects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|object| object["name"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn live_metadata_discovers_objects_without_a_desktop_cache_and_pages_them() -> Result<()> {
    let fixture = Fixture::new().await?;
    let result = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main","limit":1}),
            &["--database", "main"],
        )
        .await?;
    assert_eq!(result["data"]["source"], "live");
    assert_eq!(names(&result), ["item_names"]);
    assert_eq!(result["data"]["total"], 2);
    assert_eq!(result["data"]["nextOffset"], 1);
    let page = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main","offset":1,"limit":1}),
            &["--database", "main"],
        )
        .await?;
    assert_eq!(names(&page), ["items"]);
    assert!(page["data"]["nextOffset"].is_null());
    let columns = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"columns","schema":"main","relation":"items"}),
            &[],
        )
        .await?;
    assert_eq!(names(&columns), ["id", "name"]);
    let indexes = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"indexes","schema":"main","relation":"items"}),
            &[],
        )
        .await?;
    assert!(names(&indexes).contains(&"items_name"));
    let pool = SqlitePool::connect_with(
        SqliteConnectOptions::new().filename(fixture.root.path().join("records.db")),
    )
    .await?;
    sqlx::query("CREATE TABLE added_after_first_call (id INTEGER)")
        .execute(&pool)
        .await?;
    pool.close().await;
    let refreshed = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main","prefix":"added_"}),
            &[],
        )
        .await?;
    assert_eq!(names(&refreshed), ["added_after_first_call"]);
    let cached = fixture
        .json("metadata.listObjects", json!({"kind":"TABLE"}), &[])
        .await?;
    assert!(!names(&cached).contains(&"added_after_first_call"));
    Ok(())
}

#[tokio::test]
async fn cached_metadata_and_lsp_candidates_respect_database_provenance() -> Result<()> {
    let fixture = Fixture::new().await?;
    let cached = fixture
        .json(
            "metadata.listObjects",
            json!({"kind":"TABLE"}),
            &["--database", "main"],
        )
        .await?;
    assert_eq!(names(&cached), ["cached_allowed"]);
    assert_eq!(
        cached["data"]["objects"][0]["metadata"]["password"],
        "[redacted]"
    );
    let context = fixture
        .json(
            "lsp.sqlContext",
            json!({"sql":"SELECT * FROM cached_", "cursorByte":21}),
            &["--database", "main"],
        )
        .await?;
    let encoded = serde_json::to_string(&context)?;
    assert!(encoded.contains("cached_allowed"));
    assert!(!encoded.contains("cached_outside"));
    assert!(!encoded.contains("cached_legacy"));
    assert!(!encoded.contains("cached_cross_project"));
    let pg = fixture
        .json(
            "metadata.listObjects",
            json!({"connectionId":"conn-pg","kind":"TABLE"}),
            &["--connection", "conn-pg", "--database", "main"],
        )
        .await?;
    assert_eq!(names(&pg), ["pg_known"]);
    Ok(())
}

#[tokio::test]
async fn live_metadata_rejects_scope_escape_and_does_not_enable_writes() -> Result<()> {
    let fixture = Fixture::new().await?;
    for (input, extra) in [
        (
            json!({"kind":"relations","schema":"other"}),
            vec!["--database", "main"],
        ),
        (
            json!({"kind":"relations","schema":"main"}),
            vec!["--tool", "metadata.listObjects"],
        ),
        (
            json!({"kind":"relations","schema":"main","approved":true}),
            vec![],
        ),
        (json!({"kind":"columns","schema":"main"}), vec![]),
    ] {
        let output = fixture.call("metadata.inspectLive", input, &extra).await?;
        assert!(
            !output.status.success(),
            "authorization and closed inputs must reject this call"
        );
    }
    let write = fixture
        .call("query.runReadOnly", json!({"sql":"DELETE FROM items"}), &[])
        .await?;
    assert!(!write.status.success());
    let read = fixture
        .json(
            "query.runReadOnly",
            json!({"sql":"SELECT name FROM items"}),
            &[],
        )
        .await?;
    assert!(serde_json::to_string(&read)?.contains("one"));
    let metadata = SqlitePool::connect_with(
        SqliteConnectOptions::new().filename(fixture.root.path().join("metadata.db")),
    )
    .await?;
    let pinned = json!({"id":"conn-a", "projectId":"project-a", "name":"pinned fixture", "driver":"sqlite", "url":fixture.root.path().join("records.db").to_string_lossy(), "driverPackageVersion":"9.9.9"});
    sqlx::query("UPDATE connections SET config=? WHERE id='conn-a'")
        .bind(pinned.to_string())
        .execute(&metadata)
        .await?;
    let denied = fixture
        .call(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main"}),
            &[],
        )
        .await?;
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("is not installed"));
    let denied = fixture
        .call(
            "query.runReadOnly",
            json!({"sql":"SELECT name FROM items"}),
            &[],
        )
        .await?;
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("is not installed"));
    let oidc = json!({"id":"conn-a", "projectId":"project-a", "name":"OIDC fixture", "driver":"mongodb", "url":"mongodb://127.0.0.1:1/app?authMechanism=MONGODB-OIDC"});
    sqlx::query("UPDATE connections SET driver='mongodb', config=? WHERE id='conn-a'")
        .bind(oidc.to_string())
        .execute(&metadata)
        .await?;
    metadata.close().await;
    let denied = fixture
        .call(
            "metadata.inspectLive",
            json!({"kind":"schemas","database":"app"}),
            &[],
        )
        .await?;
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr)
        .contains("OIDC browser authentication is unavailable"));
    Ok(())
}

struct McpClient {
    child: Child,
    input: ChildStdin,
    output: tokio::io::Lines<BufReader<ChildStdout>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ClientEntry {
    Native,
    Launcher,
    Npm,
}

impl McpClient {
    async fn start(fixture: &Fixture, entry: ClientEntry) -> Result<Self> {
        let mut command = if entry != ClientEntry::Native {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_path_buf();
            let mut command = if entry == ClientEntry::Npm {
                let mut command = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
                command.args(["run", "--silent", "ai:mcp", "--"]);
                command
            } else {
                let mut command = Command::new("node");
                command.arg(root.join("scripts/oxide-ai.mjs"));
                command
            };
            command
                .current_dir(&root)
                .env("OXIDE_AGENT_BIN", env!("CARGO_BIN_EXE_oxide-agent"));
            for name in [
                "OXIDE_PROJECT_ID",
                "OXIDE_CONNECTION_ID",
                "OXIDE_DATABASE",
                "OXIDE_MCP_TOOL",
                "OXIDE_MCP_QUERY_TIMEOUT_SECS",
            ] {
                command.env_remove(name);
            }
            command
        } else {
            fixture.command()
        };
        if entry != ClientEntry::Npm {
            command.args(["mcp", "stdio"]);
        }
        fixture.scope(&mut command);
        command
            .args([
                "--connection",
                "conn-a",
                "--query-timeout-secs",
                "5",
                "--database",
                "main",
                "--tool",
                "metadata.inspectLive",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn()?;
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut client = Self {
            child,
            input,
            output,
        };
        let initialized = client.request(1, "initialize", json!({"protocolVersion":"2025-11-25", "capabilities":{}, "clientInfo":{"name":"external-conformance","version":"1"}})).await?;
        assert_eq!(initialized["result"]["serverInfo"]["name"], "oxide-agent");
        client
            .send(json!({"jsonrpc":"2.0", "method":"notifications/initialized"}))
            .await?;
        Ok(client)
    }

    async fn send(&mut self, value: Value) -> Result<()> {
        self.input
            .write_all(format!("{value}\n").as_bytes())
            .await?;
        self.input.flush().await?;
        Ok(())
    }

    async fn request(&mut self, id: u32, method: &str, params: Value) -> Result<Value> {
        self.send(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .await?;
        loop {
            let line = tokio::time::timeout(Duration::from_secs(15), self.output.next_line())
                .await??
                .context("MCP server closed before responding")?;
            let value: Value = serde_json::from_str(&line)
                .context("MCP stdout must contain only JSON-RPC frames")?;
            if value["id"] == id {
                return Ok(value);
            }
        }
    }
}

async fn verify_external_client(entry: ClientEntry) -> Result<()> {
    let fixture = Fixture::new().await?;
    let mut client = McpClient::start(&fixture, entry).await?;
    let listed = client.request(2, "tools/list", json!({})).await?;
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "metadata.inspectLive");
    let result = client.request(3,"tools/call",json!({"name":"metadata.inspectLive", "arguments":{"kind":"relations","schema":"main"}})).await?;
    assert_ne!(result["result"]["isError"], true, "{result}");
    assert_eq!(
        names(&result["result"]["structuredContent"]),
        ["item_names", "items"]
    );
    let escaped = client.request(4,"tools/call",json!({"name":"metadata.inspectLive", "arguments":{"kind":"relations","schema":"other"}})).await?;
    assert_eq!(escaped["result"]["isError"], true);
    let hidden = client
        .request(
            5,
            "tools/call",
            json!({"name":"query.runReadOnly", "arguments":{"sql":"SELECT 1"}}),
        )
        .await?;
    assert!(hidden.get("error").is_some());
    let McpClient {
        mut child, input, ..
    } = client;
    drop(input);
    let status = tokio::time::timeout(Duration::from_secs(5), child.wait()).await??;
    assert!(status.success(), "MCP must shut down after stdin closes");
    Ok(())
}

#[tokio::test]
async fn external_stdio_client_reads_live_metadata_under_immutable_grants() -> Result<()> {
    verify_external_client(ClientEntry::Native).await
}

#[tokio::test]
async fn development_launcher_forwards_to_the_same_native_mcp_contract() -> Result<()> {
    verify_external_client(ClientEntry::Launcher).await
}

#[tokio::test]
async fn npm_silent_entry_preserves_json_rpc_framing_and_authorization() -> Result<()> {
    verify_external_client(ClientEntry::Npm).await
}

#[tokio::test]
async fn encrypted_saved_connections_work_without_writing_credentials_or_metadata() -> Result<()> {
    use aes_gcm::{
        aead::{Aead, Payload},
        Aes256Gcm, KeyInit, Nonce,
    };
    let fixture = Fixture::new().await?;
    let key = [42_u8; 32];
    let nonce = [3_u8; 12];
    let key_path = fixture.root.path().join("connection-credentials-v1.secret");
    tokio::fs::write(&key_path, key).await?;
    let secrets = json!({"url":fixture.root.path().join("records.db").to_string_lossy(), "password":"fixture-private-password"});
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .unwrap()
        .encrypt(
            &Nonce::from(nonce),
            Payload {
                msg: secrets.to_string().as_bytes(),
                aad: b"oxide-connection-credential-v1\0project-a\0conn-a",
            },
        )
        .unwrap();
    let metadata = SqlitePool::connect_with(
        SqliteConnectOptions::new().filename(fixture.root.path().join("metadata.db")),
    )
    .await?;
    sqlx::query("CREATE TABLE connection_credentials (project_id TEXT, connection_id TEXT, ciphertext BLOB, nonce BLOB, updated_at INTEGER, PRIMARY KEY(project_id,connection_id))")
        .execute(&metadata).await?;
    let safe = json!({"id":"conn-a", "projectId":"project-a", "name":"fixture", "driver":"sqlite", "url":"", "database":fixture.root.path().join("records.db").to_string_lossy()}).to_string();
    sqlx::query("UPDATE connections SET config=? WHERE id='conn-a'")
        .bind(&safe)
        .execute(&metadata)
        .await?;
    sqlx::query("INSERT INTO connection_credentials VALUES ('project-a','conn-a',?,?,1)")
        .bind(&ciphertext)
        .bind(nonce.to_vec())
        .execute(&metadata)
        .await?;
    let live = fixture
        .json(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main"}),
            &[],
        )
        .await?;
    assert_eq!(names(&live), ["item_names", "items"]);
    let rows = fixture
        .json(
            "query.runReadOnly",
            json!({"sql":"SELECT name FROM items"}),
            &[],
        )
        .await?;
    assert!(rows.to_string().contains("one"));
    assert!(!rows.to_string().contains("fixture-private-password"));
    let stored: String = sqlx::query_scalar("SELECT config FROM connections WHERE id='conn-a'")
        .fetch_one(&metadata)
        .await?;
    assert_eq!(stored, safe);
    let stored: Vec<u8> = sqlx::query_scalar(
        "SELECT ciphertext FROM connection_credentials WHERE connection_id='conn-a'",
    )
    .fetch_one(&metadata)
    .await?;
    assert_eq!(stored, ciphertext);
    assert_eq!(tokio::fs::read(&key_path).await?, key);
    let copied = json!({"id":"conn-copy", "projectId":"project-a", "name":"copy", "driver":"sqlite", "url":""});
    sqlx::query("INSERT INTO connections VALUES ('conn-copy','project-a','copy','sqlite',?,1)")
        .bind(copied.to_string())
        .execute(&metadata)
        .await?;
    sqlx::query("INSERT INTO connection_credentials VALUES ('project-a','conn-copy',?,?,1)")
        .bind(&ciphertext)
        .bind(nonce.to_vec())
        .execute(&metadata)
        .await?;
    let replayed = fixture
        .call(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main"}),
            &["--connection", "conn-copy"],
        )
        .await?;
    assert!(!replayed.status.success());
    assert!(String::from_utf8_lossy(&replayed.stderr).contains("could not be authenticated"));
    tokio::fs::remove_file(&key_path).await?;
    let summary = fixture
        .json("connection.listSummaries", json!({}), &[])
        .await?;
    assert!(!summary.to_string().contains("fixture-private-password"));
    let missing = fixture
        .call(
            "metadata.inspectLive",
            json!({"kind":"relations","schema":"main"}),
            &[],
        )
        .await?;
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("credential key is unavailable"));
    assert!(!key_path.exists());
    metadata.close().await;
    Ok(())
}

#[tokio::test]
async fn shared_store_initialization_and_encryption_interoperate_with_the_standalone_cli(
) -> Result<()> {
    use oxide_studio_lib::core::store::{MetaStore, Project, SavedConnection};

    let fixture = Fixture {
        root: tempfile::tempdir()?,
        next_input: AtomicUsize::new(0),
    };
    let source = fixture.root.path().join("records.db");
    let data = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(&source)
            .create_if_missing(true),
    )
    .await?;
    sqlx::raw_sql("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES(42, 'shared-store');")
        .execute(&data).await?;
    data.close().await;
    let store = MetaStore::open(fixture.root.path()).await?;
    store
        .save_project(&Project {
            id: "project-a".into(),
            name: "standalone fixture".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await?;
    store.save_connection(&SavedConnection {
        id: "conn-a".into(), project_id: "project-a".into(), name: "encrypted SQLite".into(),
        driver: "sqlite".into(), created_at: 1, updated_at: 1,
        config: json!({"id":"conn-a", "projectId":"project-a", "name":"encrypted SQLite", "driver":"sqlite", "url":source, "database":source, "password":"standalone-private-fixture"}),
    }).await?;
    let key_path = fixture.root.path().join("connection-credentials-v1.secret");
    let key = tokio::fs::read(&key_path).await?;
    let reopened = MetaStore::open(fixture.root.path()).await?;
    let connections = reopened.get_connections("project-a").await?;
    assert_eq!(
        connections[0].config["password"],
        "standalone-private-fixture"
    );
    let metadata = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(fixture.root.path().join("metadata.db"))
            .read_only(true),
    )
    .await?;
    let stored: (String, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT c.config, s.ciphertext, s.nonce FROM connections c JOIN connection_credentials s ON s.project_id=c.project_id AND s.connection_id=c.id WHERE c.id='conn-a'",
    ).fetch_one(&metadata).await?;
    assert!(!stored.0.contains("standalone-private-fixture"));
    let result = fixture
        .json(
            "query.runReadOnly",
            json!({"sql":"SELECT id, name FROM items"}),
            &[],
        )
        .await?;
    assert!(result.to_string().contains("shared-store"));
    assert!(!result.to_string().contains("standalone-private-fixture"));
    let after: (String, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT c.config, s.ciphertext, s.nonce FROM connections c JOIN connection_credentials s ON s.project_id=c.project_id AND s.connection_id=c.id WHERE c.id='conn-a'",
    ).fetch_one(&metadata).await?;
    assert_eq!(
        after, stored,
        "standalone reads must not rewrite Desktop credentials"
    );
    assert_eq!(tokio::fs::read(&key_path).await?, key);
    metadata.close().await;
    Ok(())
}

#[derive(Clone, Default)]
struct SearchFixtureState {
    requests: std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>,
    slow: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

async fn search_fixture_response(
    axum::extract::State(state): axum::extract::State<SearchFixtureState>,
    request: axum::http::Request<axum::body::Body>,
) -> (axum::http::StatusCode, axum::Json<Value>) {
    let path = request.uri().path().to_string();
    state
        .requests
        .lock()
        .unwrap()
        .push((request.method().to_string(), path.clone()));
    let body = if path == "/" {
        json!({"name":"fixture", "cluster_name":"fixture", "version":{"number":"8.15.3"}, "tagline":"You Know, for Search"})
    } else if path == "/_cat/indices" {
        if state.slow.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        json!([{"index":"allowed","docs.count":"1"},{"index":"outside","docs.count":"2"}])
    } else if path.starts_with("/_resolve/index/") {
        json!({"indices":[{"name":"allowed","aliases":[],"attributes":["open"]},{"name":"outside","aliases":[],"attributes":["open"]}],"aliases":[],"data_streams":[]})
    } else if path == "/allowed/_mapping" {
        json!({"allowed":{"mappings":{"properties":{"title":{"type":"keyword"}}}}})
    } else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(json!({"error":"unexpected fixture route"})),
        );
    };
    (axum::http::StatusCode::OK, axum::Json(body))
}

#[tokio::test]
async fn search_metadata_uses_native_http_and_filters_index_grants_before_returning() -> Result<()>
{
    let fixture = Fixture::new().await?;
    let state = SearchFixtureState::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = axum::Router::new()
        .fallback(search_fixture_response)
        .with_state(state.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let outcome = async {
        let metadata = SqlitePool::connect_with(SqliteConnectOptions::new().filename(fixture.root.path().join("metadata.db"))).await?;
        let configuration = json!({"id":"conn-a", "projectId":"project-a", "name":"search fixture", "driver":"elasticsearch", "url":"", "host":"127.0.0.1", "port":address.port(), "database":"stale-database"});
        sqlx::query("UPDATE connections SET driver='elasticsearch', config=? WHERE id='conn-a'")
            .bind(configuration.to_string()).execute(&metadata).await?;
        metadata.close().await;
        for kind in ["databases", "collections"] {
            let result = fixture.json("metadata.inspectLive", json!({"kind":kind}), &["--database","allowed"]).await?;
            assert_eq!(names(&result), ["allowed"]);
            assert!(!result.to_string().contains("outside"));
        }
        let columns = fixture.json("metadata.inspectLive", json!({"kind":"columns","relation":"allowed"}), &["--database","allowed"]).await?;
        assert_eq!(names(&columns), ["_id", "title"]);
        let before = state.requests.lock().unwrap().len();
        let denied = fixture.call("metadata.inspectLive", json!({"kind":"columns","relation":"outside"}), &["--database","allowed"]).await?;
        assert!(!denied.status.success());
        assert_eq!(before, state.requests.lock().unwrap().len(), "scope rejection must happen before network access");
        state.slow.store(true, Ordering::Relaxed);
        let timed_out = fixture.call("metadata.inspectLive", json!({"kind":"collections"}), &["--database","allowed","--query-timeout-secs","1"]).await?;
        assert!(!timed_out.status.success());
        assert!(String::from_utf8_lossy(&timed_out.stderr).contains("deadline"));
        assert!(state.requests.lock().unwrap().iter().all(|(method, _)| method == "GET"));
        Ok::<_, anyhow::Error>(())
    }.await;
    server.abort();
    let _ = server.await;
    outcome
}
