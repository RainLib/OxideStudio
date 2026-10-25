use anyhow::{ensure, Result};
use arrow_array::{Int64Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema};
use oxide_studio_lib::core::{
    driver_package::DatabaseDriverPackageRegistry,
    file_query::FileQuerySessions,
    store::{MetaStore, Project},
};
use parquet::arrow::ArrowWriter;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
pub struct Fixture {
    pub metadata: MetaStore,
    pub registry: DatabaseDriverPackageRegistry,
    pub service: FileQuerySessions,
    pub files: Vec<(PathBuf, String)>,
}
impl Fixture {
    pub async fn open(root: &Path) -> Result<Self> {
        let workspace = root.join("project");
        std::fs::create_dir_all(&workspace)?;
        let csv = workspace.join("sales-雪.csv");
        std::fs::write(&csv, "id,label\n9007199254740993,雪\n2,café\n")?;
        let json_path = workspace.join("sales.json");
        std::fs::write(
            &json_path,
            br#"[{"id":9007199254740993,"label":"json"},{"id":2,"label":null}]"#,
        )?;
        let jsonl = workspace.join("sales.jsonl");
        std::fs::write(
            &jsonl,
            b"{\"id\":9007199254740993,\"label\":\"jsonl\"}\n{\"id\":2,\"label\":null}\n",
        )?;
        let parquet = workspace.join("sales.parquet");
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("label", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![9007199254740993_i64, 2])),
                Arc::new(StringArray::from(vec![Some("parquet"), None])),
            ],
        )?;
        let mut writer = ArrowWriter::try_new(std::fs::File::create(&parquet)?, schema, None)?;
        writer.write(&batch)?;
        writer.close()?;
        let registry = DatabaseDriverPackageRegistry::new(root.join("signed-drivers"));
        let package = registry
            .resolve_version("duckdb", "0.1.0")
            .map_err(anyhow::Error::msg)?;
        ensure!(
            package
                .manifest
                .capabilities
                .as_ref()
                .is_some_and(|caps| caps.file_query_formats.len() == 4),
            "signed file format grants missing"
        );
        registry
            .activate_package("duckdb", "0.1.0")
            .map_err(anyhow::Error::msg)?;
        let metadata = MetaStore::open(&root.join("profile")).await?;
        let project = Project {
            id: "file-query-project".into(),
            name: "Isolated file query".into(),
            root_path: Some(workspace.to_string_lossy().into()),
            created_at: 1,
            updated_at: 1,
        };
        metadata.save_project(&project).await?;
        metadata
            .save_project(&Project {
                id: "other-project".into(),
                name: "Other isolated project".into(),
                root_path: None,
                created_at: 1,
                updated_at: 1,
            })
            .await?;
        std::fs::write(
            root.join("fixture.json"),
            serde_json::to_vec_pretty(
                &json!({"project":project,"names":["sales-雪.csv","sales.json","sales.jsonl","sales.parquet"]}),
            )?,
        )?;
        let files = [csv, json_path, jsonl, parquet]
            .into_iter()
            .map(|path| {
                let digest = format!("{:x}", Sha256::digest(std::fs::read(&path)?));
                Ok((path, digest))
            })
            .collect::<Result<Vec<_>>>()?;
        let service = FileQuerySessions::new(&root.join("file-query-cache"), registry.clone())?;
        Ok(Self {
            metadata,
            registry,
            service,
            files,
        })
    }
    pub fn verify_sources(&self) -> Result<()> {
        for (path, digest) in &self.files {
            ensure!(
                format!("{:x}", Sha256::digest(std::fs::read(path)?)) == *digest,
                "file query modified a source"
            );
        }
        Ok(())
    }
}
