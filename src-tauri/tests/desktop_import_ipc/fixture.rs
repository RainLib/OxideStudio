use anyhow::{ensure, Result};
use oxide_studio_lib::{
    core::{
        driver::DatabaseDriver,
        driver_package::DatabaseDriverPackageRegistry,
        manager::ConnectionManager,
        store::{MetaStore, Project, SavedConnection},
        transfer_jobs::LargeTransferJobs,
    },
    drivers::sqlite::SqliteDriver,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::path::{Path, PathBuf};

pub const ROWS: i64 = 1501;
pub const SOURCE: &str = "source-雪 & café.json";

pub struct Fixture {
    pub root: PathBuf,
    pub stage: String,
    pub manager: ConnectionManager,
    pub jobs: LargeTransferJobs,
}

pub fn payload(id: i64) -> String {
    format!("customer,{id};\"雪 & café\"\nline two")
}

impl Fixture {
    pub async fn open(root: PathBuf, stage: String) -> Result<Self> {
        let target = root.join("target.sqlite");
        let mut driver = SqliteDriver::new(target.to_str().ok_or_else(|| anyhow::anyhow!("path"))?);
        if stage == "prepare" {
            // Only a newly generated fixture can create the database/source.
            ensure!(!target.exists() && !root.join("fixture.json").exists());
            driver.connect().await?;
            driver.query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT NOT NULL,optional TEXT DEFAULT 'factory',unmapped TEXT DEFAULT 'factory'); INSERT INTO target(id,payload,optional) VALUES(-1,'existing row','seed')").await?;
            let rows: Vec<_> = (0..ROWS)
                .map(|id| {
                    let mut row = json!({"id":id,"payload":payload(id)});
                    match id % 3 {
                        0 => row["optional"] = json!("provided"),
                        1 => row["optional"] = Value::Null,
                        _ => {}
                    }
                    row
                })
                .collect();
            let source = serde_json::to_vec(&rows)?;
            std::fs::write(root.join(SOURCE), &source)?;
            std::fs::write(
                root.join("fixture.json"),
                serde_json::to_vec(
                    &json!({"rows":ROWS,"sha256":format!("{:x}",Sha256::digest(&source))}),
                )?,
            )?;
        } else {
            ensure!(target.is_file() && root.join("fixture.json").is_file());
            ensure!(
                !root.join(SOURCE).exists(),
                "original source must be offline"
            );
            driver.connect().await?;
        }
        let metadata = MetaStore::open(&root.join("profile")).await?;
        if stage == "prepare" {
            for id in ["ipc-project", "other-project"] {
                metadata
                    .save_project(&Project {
                        id: id.into(),
                        name: id.into(),
                        root_path: None,
                        created_at: 1,
                        updated_at: 1,
                    })
                    .await?;
            }
            metadata.save_connection(&SavedConnection {id:"ipc-target".into(),project_id:"ipc-project".into(),name:"isolated target".into(),driver:"sqlite".into(),config:json!({"id":"ipc-target","projectId":"ipc-project","name":"isolated target","driver":"sqlite","url":target}),created_at:1,updated_at:1}).await?;
        }
        let manager = ConnectionManager::new();
        manager
            .replace_connection_with_tunnel_and_driver_id(
                "ipc-target".into(),
                Box::new(driver),
                None,
                Some("sqlite".into()),
            )
            .await?;
        let jobs = LargeTransferJobs::open(
            &root.join("jobs"),
            metadata,
            DatabaseDriverPackageRegistry::new(root.join("packages")),
        )
        .await?;
        Ok(Self {
            root,
            stage,
            manager,
            jobs,
        })
    }

    pub fn script_config(&self) -> Result<Value> {
        Ok(json!({
            "stage":self.stage,"rows":ROWS,"source":self.root.join(SOURCE),
            "saved":if self.stage=="resume" { Some(serde_json::from_slice::<Value>(&std::fs::read(self.root.join("prepare-receipt.json"))?)?) }else {None}
        }))
    }
}

/// An independent read-only connection checks target contents; renderer claims
/// and signed job counters alone cannot establish publication correctness.
pub async fn verify_target(root: &Path, published: bool) -> Result<Value> {
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(root.join("target.sqlite"))
            .read_only(true),
    )
    .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM target")
        .fetch_one(&mut db)
        .await?;
    ensure!(
        count == if published { ROWS + 1 } else { 1 },
        "target row count: {count}"
    );
    let rows = sqlx::query("SELECT id,payload,optional,unmapped FROM target ORDER BY id")
        .fetch_all(&mut db)
        .await?;
    ensure!(
        rows[0].get::<i64, _>("id") == -1
            && rows[0].get::<String, _>("payload") == "existing row"
            && rows[0].get::<String, _>("optional") == "seed"
    );
    for (index, row) in rows.iter().enumerate() {
        ensure!(row.get::<String, _>("unmapped") == "factory");
        if index == 0 {
            continue;
        }
        let id = index as i64 - 1;
        ensure!(row.get::<i64, _>("id") == id && row.get::<String, _>("payload") == payload(id));
        let expected = match id % 3 {
            0 => Some("provided"),
            1 => None,
            _ => Some("factory"),
        };
        ensure!(
            row.get::<Option<String>, _>("optional").as_deref() == expected,
            "optional at {id}"
        );
    }
    let version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&mut db)
        .await?;
    db.close().await?;
    Ok(json!({"count":count,"allValuesVerified":true,"sqliteVersion":version}))
}
