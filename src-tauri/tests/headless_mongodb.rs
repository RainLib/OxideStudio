//! Real isolated mongod + encrypted production profile + public CLI/MCP.
//! This test never adopts an existing server or application profile.
use anyhow::{anyhow, Context, Result};
use futures::TryStreamExt;
use mongodb::{
    bson::{doc, oid::ObjectId, Bson, DateTime, Decimal128, Document},
    Client,
};
use oxide_studio_lib::core::store::{MetaStore, Project, SavedConnection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Output, Stdio},
    str::FromStr,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
};

const APP: &str = "oxide_agent_documents";
const TOOL: &str = "document.findReadOnly";

fn spawn_mongod(executable: &Path, root: &Path, port: u16, auth: bool) -> Result<Child> {
    let mut command = Command::new(executable);
    command
        .args([
            "--bind_ip",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--dbpath",
        ])
        .arg(root.join("server-data"))
        .arg("--logpath")
        .arg(root.join("mongod.log"))
        .args(["--logappend", "--setParameter", "enableTestCommands=1"])
        .args(["--wiredTigerCacheSizeGB", "0.25"])
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    if auth {
        command.arg("--auth");
    }
    Ok(command.spawn()?)
}

async fn ready(child: &mut Child, uri: &str) -> Result<Client> {
    let client = Client::with_uri_str(uri).await?;
    for _ in 0..100 {
        if let Some(status) = child.try_wait()? {
            return Err(anyhow!("isolated mongod exited: {status}"));
        }
        if client
            .database("admin")
            .run_command(doc! {"ping":1})
            .await
            .is_ok()
        {
            return Ok(client);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(anyhow!("isolated mongod did not become ready"))
}

async fn require_owned_server(server: &Child, client: &Client) -> Result<()> {
    let status = client
        .database("admin")
        .run_command(doc! {"serverStatus":1})
        .await?;
    let pid = status.get("pid").and_then(|v| match v {
        Bson::Int32(v) => Some(*v as u32),
        Bson::Int64(v) => Some(*v as u32),
        Bson::Double(v) => Some(*v as u32),
        _ => None,
    });
    assert_eq!(
        pid,
        server.id(),
        "refuse to use any server not owned by this fixture"
    );
    Ok(())
}

async fn metric(admin: &Client, path: &[&str]) -> Result<u64> {
    let status = admin
        .database("admin")
        .run_command(doc! {"serverStatus":1})
        .await?;
    let mut value = Bson::Document(status).into_relaxed_extjson();
    for part in path {
        value = value[*part].clone();
    }
    value
        .as_u64()
        .context("expected numeric MongoDB acceptance metric")
}

async fn source_digest(admin: &Client) -> Result<String> {
    let mut digest = Sha256::new();
    for name in ["items", "wide", "oversized", "typed"] {
        digest.update(name.as_bytes());
        let mut cursor = admin
            .database(APP)
            .collection::<Document>(name)
            .find(doc! {})
            .sort(doc! {"_id":1})
            .await?;
        while let Some(document) = cursor.try_next().await? {
            let bytes = mongodb::bson::to_vec(&document)?;
            digest.update((bytes.len() as u64).to_le_bytes());
            digest.update(bytes);
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

struct Fixture {
    profile: PathBuf,
}
impl Fixture {
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_oxide-agent"));
        command.kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
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
            .args([
                "--project",
                "fixture-project",
                "--connection",
                "fixture-connection",
                "--data-dir",
            ])
            .arg(&self.profile)
            .args(["--database", APP]);
    }
    async fn call(&self, input: Value, extra: &[&str]) -> Result<Output> {
        let request = self.profile.join("request.json");
        tokio::fs::write(&request, input.to_string()).await?;
        let mut command = self.command();
        command
            .args(["tools", "call", TOOL, "--input"])
            .arg(format!("@{}", request.display()));
        self.scope(&mut command);
        command.args(extra);
        Ok(tokio::time::timeout(Duration::from_secs(20), command.output()).await??)
    }
    async fn json(&self, input: Value, extra: &[&str]) -> Result<Value> {
        let output = self.call(input, extra).await?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(serde_json::from_slice(&output.stdout)?)
    }
    async fn reject(&self, input: Value, extra: &[&str], expected: &str) -> Result<()> {
        let output = self.call(input, extra).await?;
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(expected),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(())
    }
    async fn mcp(&self) -> Result<()> {
        let mut command = self.command();
        command.args(["mcp", "stdio"]);
        self.scope(&mut command);
        command
            .args(["--tool", TOOL])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn()?;
        let mut input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap()).lines();
        for (id, method, params) in [
            (
                1,
                "initialize",
                json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"mongo-acceptance","version":"1"}}),
            ),
            (2, "tools/list", json!({})),
            (
                3,
                "tools/call",
                json!({"name":TOOL,"arguments":{"collection":"items","limit":1}}),
            ),
        ] {
            input
                .write_all(
                    format!(
                        "{}\n",
                        json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                    )
                    .as_bytes(),
                )
                .await?;
            let line = tokio::time::timeout(Duration::from_secs(15), output.next_line())
                .await??
                .context("MCP closed early")?;
            let reply: Value = serde_json::from_str(&line)?;
            assert!(reply.get("error").is_none(), "{reply}");
            if id == 1 {
                input
                    .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
                    .await?;
            }
            if id == 2 {
                assert_eq!(reply["result"]["tools"].as_array().unwrap().len(), 1);
                assert_eq!(reply["result"]["tools"][0]["name"], TOOL);
            }
            if id == 3 {
                assert_ne!(reply["result"]["isError"], true);
                assert_eq!(
                    reply["result"]["structuredContent"]["data"]["returnedCount"],
                    1
                );
            }
        }
        drop(input);
        tokio::time::timeout(Duration::from_secs(5), child.wait()).await??;
        Ok(())
    }
}

#[tokio::test]
#[ignore = "requires an explicit native mongod path; creates only isolated temporary data and users"]
async fn real_mongodb_read_only_cli_and_mcp() -> Result<()> {
    let executable = PathBuf::from(
        std::env::var_os("OXIDE_MONGOD")
            .context("set OXIDE_MONGOD to the native mongod executable")?,
    );
    let root = tempfile::Builder::new()
        .prefix("oxide-mongodb-readonly-")
        .tempdir()?
        .keep();
    println!("MongoDB acceptance fixture: {}", root.display());
    tokio::fs::create_dir(root.join("server-data")).await?;
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let base = format!("mongodb://127.0.0.1:{port}/?directConnection=true&serverSelectionTimeoutMS=300&connectTimeoutMS=300");
    let mut server = spawn_mongod(&executable, &root, port, false)?;
    let bootstrap = ready(&mut server, &base).await?;
    require_owned_server(&server, &bootstrap).await?;
    let database = bootstrap.database(APP);
    database
        .collection::<Document>("items")
        .insert_many((0..40).map(
            |id| doc! {"_id":id, "rank":id/4, "name":format!("n{id:02}"), "approved":true, "secret":"project-only"},
        ))
        .await?;
    database
        .collection::<Document>("wide")
        .insert_many((0..40).map(|id| doc! {"_id":id, "payload":"x".repeat(40_000)}))
        .await?;
    database
        .collection::<Document>("oversized")
        .insert_one(doc! {"_id":1, "payload":"x".repeat(50_000)})
        .await?;
    let typed = doc! {"_id":ObjectId::parse_str("507f1f77bcf86cd799439011")?, "large":Bson::Int64(9_007_199_254_740_993), "amount":Decimal128::from_str("1.250")?, "created":DateTime::from_millis(0), "bytes":Bson::Binary(mongodb::bson::Binary {subtype:mongodb::bson::spec::BinarySubtype::Generic, bytes:vec![0,255,1]})};
    database
        .collection::<Document>("typed")
        .insert_one(typed.clone())
        .await?;
    bootstrap.database("admin").run_command(doc! {"createUser":"fixture_admin","pwd":"fixture-admin-only","roles":[{"role":"root","db":"admin"}]}).await?;
    database.run_command(doc! {"createUser":"fixture_reader","pwd":"fixture-reader-only","roles":[{"role":"read","db":APP}]}).await?;
    let _ = bootstrap
        .database("admin")
        .run_command(doc! {"shutdown":1,"force":true})
        .await;
    tokio::time::timeout(Duration::from_secs(15), server.wait()).await??;
    bootstrap.shutdown().await;
    server = spawn_mongod(&executable, &root, port, true)?;
    let admin_url = format!("mongodb://fixture_admin:fixture-admin-only@127.0.0.1:{port}/admin?directConnection=true&serverSelectionTimeoutMS=300&connectTimeoutMS=300");
    let admin = ready(&mut server, &admin_url).await?;
    require_owned_server(&server, &admin).await?;
    let reader_url = format!("mongodb://fixture_reader:fixture-reader-only@127.0.0.1:{port}/{APP}?directConnection=true&serverSelectionTimeoutMS=300&appName=oxide-headless-documents");
    let reader = Client::with_uri_str(&reader_url).await?;
    assert!(
        reader
            .database(APP)
            .collection::<Document>("items")
            .insert_one(doc! {"_id":999})
            .await
            .is_err(),
        "the acceptance account must be read-only at the server"
    );
    let fixture = Fixture {
        profile: root.join("profile"),
    };
    let store = MetaStore::open(&fixture.profile).await?;
    store
        .save_project(&Project {
            id: "fixture-project".into(),
            name: "isolated MongoDB".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await?;
    store.save_connection(&SavedConnection {
        id:"fixture-connection".into(),project_id:"fixture-project".into(),name:"MongoDB read-only account".into(),driver:"mongodb".into(),created_at:1,updated_at:1,
        config:json!({"id":"fixture-connection","projectId":"fixture-project","name":"MongoDB read-only account","driver":"mongodb","url":reader_url,"database":APP}),
    }).await?;
    let metadata = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(fixture.profile.join("metadata.db"))
            .read_only(true),
    )
    .await?;
    let protected_before: (String,Vec<u8>,Vec<u8>) = sqlx::query_as("SELECT c.config,s.ciphertext,s.nonce FROM connections c JOIN connection_credentials s ON s.connection_id=c.id AND s.project_id=c.project_id WHERE c.id='fixture-connection'").fetch_one(&metadata).await?;
    assert!(!protected_before.0.contains("fixture-reader-only"));
    let key_before =
        tokio::fs::read(fixture.profile.join("connection-credentials-v1.secret")).await?;

    let source_before = source_digest(&admin).await?;
    let query = json!({"collection":"items","filter":{"rank":{"$gte":8}},"sort":[{"field":"rank","direction":-1},{"field":"name","direction":1}],"limit":50});
    let first = fixture.json(query.clone(), &["--max-rows", "2"]).await?;
    assert_eq!(first["data"]["returnedCount"], 2);
    assert_eq!(first["data"]["nextOffset"], 2);
    assert_eq!(first["data"]["documents"][0]["_id"]["$numberInt"], "36");
    let mut next = query;
    next["offset"] = json!(2);
    let second = fixture.json(next, &["--max-rows", "2"]).await?;
    assert_eq!(second["data"]["documents"][0]["_id"]["$numberInt"], "38");
    let projected = fixture
        .json(
            json!({"collection":"items","limit":1,"projection":{"_id":0,"name":1}}),
            &[],
        )
        .await?;
    assert_eq!(projected["data"]["documents"][0], json!({"name":"n00"}));
    let business = fixture.json(json!({"collection":"items", "filter":{"approved":true}, "projection":{"_id":0,"approved":1}, "limit":1}), &[]).await?;
    assert_eq!(business["data"]["documents"][0], json!({"approved":true}));
    let exact = fixture
        .json(
            json!({"collection":"typed","filter":{"_id":{"$oid":"507f1f77bcf86cd799439011"}}}),
            &[],
        )
        .await?;
    assert_eq!(
        exact["data"]["documents"][0],
        Bson::Document(typed.clone()).into_canonical_extjson()
    );
    let all = fixture
        .json(json!({"collection":"items","limit":100}), &[])
        .await?;
    assert_eq!(all["data"]["returnedCount"], 40);
    assert_eq!(all["data"]["hasMore"], false);
    let wide = fixture
        .json(
            json!({"collection":"wide","limit":40}),
            &["--max-result-bytes", "1048576"],
        )
        .await?;
    assert_eq!(wide["data"]["byteLimited"], true);
    assert!(wide["data"]["returnedCount"].as_u64().unwrap() < 40);
    assert_eq!(wide["data"]["nextOffset"], wide["data"]["returnedCount"]);
    fixture
        .reject(
            json!({"collection":"oversized"}),
            &["--max-result-bytes", "4096"],
            "narrower field projection",
        )
        .await?;
    fixture
        .json(
            json!({"collection":"oversized","projection":{"payload":0}}),
            &["--max-result-bytes", "4096"],
        )
        .await?;
    let finds = metric(&admin, &["metrics", "commands", "find", "total"]).await?;
    for input in [
        json!({"collection":"items","database":"outside"}),
        json!({"collection":"$cmd"}),
        json!({"collection":"items","filter":{"$where":"return true"}}),
        json!({"collection":"items","filter":{"nested":{"$function":{}}}}),
        json!({"collection":"items","projection":{"value":{"$meta":"textScore"}}}),
        json!({"collection":"items","aggregate":[{"$out":"other"}]}),
    ] {
        let rejected = fixture.call(input, &[]).await?;
        assert!(!rejected.status.success());
        assert!(rejected.stdout.is_empty());
    }
    fixture
        .reject(
            json!({"collection":"items"}),
            &["--tool", "metadata.inspectLive"],
            "outside the granted tool scope",
        )
        .await?;
    assert_eq!(
        metric(&admin, &["metrics", "commands", "find", "total"]).await?,
        finds,
        "denied inputs must never reach find"
    );
    fixture.mcp().await?;
    assert!(metric(&admin, &["metrics", "commands", "killCursors", "total"]).await? > 0);
    assert_eq!(
        metric(&admin, &["metrics", "cursor", "open", "total"]).await?,
        0,
        "CLI/MCP disconnect must finish cursor cleanup"
    );
    admin.database("admin").run_command(doc! {"configureFailPoint":"failCommand","mode":{"times":1},"data":{"failCommands":["find"],"appName":"oxide-headless-documents","blockConnection":true,"blockTimeMS":2500}}).await?;
    fixture
        .reject(
            json!({"collection":"items"}),
            &["--query-timeout-secs", "1"],
            "deadline",
        )
        .await?;
    admin
        .database("admin")
        .run_command(doc! {"configureFailPoint":"failCommand","mode":"off"})
        .await?;
    assert_eq!(
        metric(&admin, &["metrics", "cursor", "open", "total"]).await?,
        0
    );
    assert_eq!(
        admin
            .database(APP)
            .collection::<Document>("items")
            .count_documents(doc! {})
            .await?,
        40
    );
    let typed_after = admin
        .database(APP)
        .collection::<Document>("typed")
        .find_one(doc! {})
        .await?
        .unwrap();
    assert_eq!(
        typed_after, typed,
        "document reads must preserve all source BSON values"
    );
    assert_eq!(
        source_digest(&admin).await?,
        source_before,
        "all source collections must remain byte-for-byte equivalent in BSON"
    );
    let protected_after: (String,Vec<u8>,Vec<u8>) = sqlx::query_as("SELECT c.config,s.ciphertext,s.nonce FROM connections c JOIN connection_credentials s ON s.connection_id=c.id AND s.project_id=c.project_id WHERE c.id='fixture-connection'").fetch_one(&metadata).await?;
    assert_eq!(protected_after, protected_before);
    assert_eq!(
        tokio::fs::read(fixture.profile.join("connection-credentials-v1.secret")).await?,
        key_before
    );
    let version = admin
        .database("admin")
        .run_command(doc! {"buildInfo":1})
        .await?
        .get_str("version")?
        .to_string();
    tokio::fs::write(root.join("evidence.json"),serde_json::to_vec_pretty(&json!({"serverVersion":version,"tool":TOOL,"encryptedProfileUnchanged":true,"serverReadOnlyAccount":true,"typedBsonPreserved":true,"rowAndByteBounds":true,"databaseAndToolGrants":true,"unsafeInputsRejectedBeforeFind":true,"mcpPassed":true,"deadlineEnforced":true,"openCursorsAfterReads":0,"sourceUnchanged":true}))?).await?;
    reader.shutdown().await;
    let _ = admin
        .database("admin")
        .run_command(doc! {"shutdown":1,"force":true})
        .await;
    tokio::time::timeout(Duration::from_secs(15), server.wait()).await??;
    admin.shutdown().await;
    metadata.close().await;
    println!("MongoDB acceptance passed; evidence: {}", root.display());
    Ok(())
}
