use super::*;
use oxide_studio_lib::core::schema_diff::{
    compare_schema_snapshots, finalize_schema_snapshot, SchemaChangeKind, SchemaDiffPlan,
    SchemaRelationSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
};

#[tokio::test]
async fn mysql_live_character_metadata_and_schema_migration() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live MySQL character test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }
    let url = env::var("TEST_MYSQL_URL").context("TEST_MYSQL_URL must be set")?;
    let connection_id = "live-mysql-character";
    let database = unique_name("oxide_live_character");
    let manager = manager_with_connection(DatabaseKind::Mysql, &url, connection_id).await?;
    manager
        .query(
            connection_id,
            &format!(
                "CREATE DATABASE {} CHARACTER SET latin1 COLLATE latin1_swedish_ci;",
                mysql_ident(&database)
            ),
            None,
            None,
            None,
        )
        .await?;

    let result = character_migration_flow(&manager, connection_id, &database).await;
    let _ = manager
        .query(
            connection_id,
            &format!("DROP DATABASE IF EXISTS {};", mysql_ident(&database)),
            None,
            None,
            None,
        )
        .await;
    let _ = manager.disconnect_connection(connection_id).await;
    result
}

async fn character_snapshot(
    manager: &ConnectionManager,
    connection_id: &str,
    database: &str,
    table: &str,
) -> Result<SchemaSnapshot> {
    // Map both real fixture tables to the selected destination relation. All
    // column metadata comes from the same driver used by snapshot capture.
    finalize_schema_snapshot(SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: table.to_string(),
        fingerprint: String::new(),
        project_id: "live-character".to_string(),
        connection_id: connection_id.to_string(),
        connection_name: "Isolated MySQL integration".to_string(),
        driver: "mysql".to_string(),
        database_name: Some(database.to_string()),
        schema_name: database.to_string(),
        captured_at: 1,
        relations: vec![SchemaRelationSnapshot {
            name: "character_target".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            comment: None,
            definition: None,
            materialized_view_populated: None,
            dependencies: Vec::new(),
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: manager.get_columns(connection_id, database, table).await?,
            indexes: manager.get_indexes(connection_id, database, table).await?,
            constraints: manager
                .get_constraints(connection_id, database, table)
                .await?,
        }],
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: Vec::new(),
    })
}

async fn apply_fixture_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    database: &str,
    plan: &SchemaDiffPlan,
) -> Result<()> {
    for change in &plan.changes {
        assert!(change.blocked_reason.is_none(), "{change:?}");
        for sql in &change.sql {
            manager
                .query(connection_id, sql, Some(database.to_string()), None, None)
                .await?;
        }
    }
    Ok(())
}

async fn character_migration_flow(
    manager: &ConnectionManager,
    connection_id: &str,
    database: &str,
) -> Result<()> {
    manager.set_current_schema(connection_id, database).await?;
    let version = manager
        .query(connection_id, "SELECT VERSION();", None, None, None)
        .await?;
    println!(
        "MySQL character migration server: {}",
        version[0].rows[0][0]
    );
    manager
        .query(
            connection_id,
            "CREATE TABLE character_source (
                id INT PRIMARY KEY,
                unicode_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'anonymous',
                legacy_name VARCHAR(40) CHARACTER SET latin1 COLLATE latin1_bin
             ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
             CREATE TABLE character_target (id INT PRIMARY KEY)
             DEFAULT CHARACTER SET latin1 COLLATE latin1_swedish_ci;",
            Some(database.to_string()),
            None,
            None,
        )
        .await?;
    let source = character_snapshot(manager, connection_id, database, "character_source").await?;
    let target = character_snapshot(manager, connection_id, database, "character_target").await?;
    let unicode = source.relations[0]
        .columns
        .iter()
        .find(|column| column.name == "unicode_name")
        .context("missing Unicode column")?;
    assert_eq!(unicode.character_set.as_deref(), Some("utf8mb4"));
    assert_eq!(unicode.collation.as_deref(), Some("utf8mb4_bin"));
    let add = compare_schema_snapshots(&source, &target, 2)?;
    assert_eq!(add.changes.len(), 2);
    assert!(add
        .changes
        .iter()
        .all(|change| change.kind == SchemaChangeKind::ColumnAdd));
    assert!(add
        .migration_sql
        .contains("CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"));
    assert!(add
        .migration_sql
        .contains("CHARACTER SET latin1 COLLATE latin1_bin"));
    apply_fixture_plan(manager, connection_id, database, &add).await?;
    let target = character_snapshot(manager, connection_id, database, "character_target").await?;
    assert!(compare_schema_snapshots(&source, &target, 3)?
        .changes
        .is_empty());

    manager
        .query(
            connection_id,
            "ALTER TABLE character_source MODIFY COLUMN unicode_name VARCHAR(80)
             CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'anonymous';",
            Some(database.to_string()),
            None,
            None,
        )
        .await?;
    let source = character_snapshot(manager, connection_id, database, "character_source").await?;
    let modify = compare_schema_snapshots(&source, &target, 4)?;
    assert_eq!(modify.changes.len(), 1);
    assert_eq!(modify.changes[0].kind, SchemaChangeKind::ColumnModify);
    assert!(modify.changes[0].manual_review);
    apply_fixture_plan(manager, connection_id, database, &modify).await?;
    let target = character_snapshot(manager, connection_id, database, "character_target").await?;
    assert!(compare_schema_snapshots(&source, &target, 5)?
        .changes
        .is_empty());

    let mut legacy = source.clone();
    for column in &mut legacy.relations[0].columns {
        column.character_set = None;
        column.collation = None;
        if column.name == "unicode_name" {
            column.is_nullable = false;
        }
    }
    let legacy = finalize_schema_snapshot(legacy)?;
    let legacy_modify = compare_schema_snapshots(&legacy, &target, 6)?;
    assert_eq!(legacy_modify.changes.len(), 1);
    apply_fixture_plan(manager, connection_id, database, &legacy_modify).await?;
    let target = character_snapshot(manager, connection_id, database, "character_target").await?;
    let unicode = target.relations[0]
        .columns
        .iter()
        .find(|column| column.name == "unicode_name")
        .context("missing migrated Unicode column")?;
    assert!(!unicode.is_nullable);
    assert_eq!(unicode.character_set.as_deref(), Some("utf8mb4"));
    assert_eq!(unicode.collation.as_deref(), Some("utf8mb4_unicode_ci"));
    Ok(())
}
