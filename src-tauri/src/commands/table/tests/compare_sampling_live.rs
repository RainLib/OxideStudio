use super::super::compare_rows::{data_compare_sample_coverage, fetch_sampled_data_compare_rows};
use super::super::compare_sampling::fetch_data_compare_sample_keys;
use super::*;
use anyhow::{ensure, Context};

#[tokio::test]
#[ignore = "isolated native PostgreSQL sampled comparison"]
async fn sampled_compare_live_postgres_detects_middle_difference() -> Result<()> {
    native_sampling("postgresql", DatabaseKind::Postgres, "TEST_POSTGRES_URL").await
}

#[tokio::test]
#[ignore = "isolated native MySQL sampled comparison"]
async fn sampled_compare_live_mysql_detects_middle_difference() -> Result<()> {
    native_sampling("mysql", DatabaseKind::Mysql, "TEST_MYSQL_URL").await
}

async fn native_sampling(driver_name: &str, kind: DatabaseKind, variable: &str) -> Result<()> {
    let url = std::env::var(variable).context("use the isolated native SQL fixture")?;
    let parsed = url::Url::parse(&url)?;
    ensure!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        "isolated loopback database required"
    );
    let schema = if kind == DatabaseKind::Mysql {
        parsed.path().trim_start_matches('/').to_string()
    } else {
        "public".into()
    };
    ensure!(!schema.is_empty(), "isolated database name required");
    let prefix = format!("oxide_cmp_{}", uuid::Uuid::new_v4().simple());
    let source = TableDataCompareEndpoint {
        connection_id: "sampling".into(),
        driver: driver_name.into(),
        database: None,
        schema: schema.clone(),
        table: format!("{prefix}_source"),
    };
    let target = TableDataCompareEndpoint {
        table: format!("{prefix}_target"),
        ..source.clone()
    };
    let source_name = kind.qualified_table(Some(&schema), &source.table);
    let target_name = kind.qualified_table(Some(&schema), &target.table);
    let key_table = format!("{prefix}_keys");
    let key_name = kind.qualified_table(Some(&schema), &key_table);
    let manager = ConnectionManager::new();
    manager
        .add_connection(
            "sampling".into(),
            crate::drivers::connect_driver(driver_name, &url).await?,
        )
        .await;
    let result=async {
        let single=kind.quote_identifier(&format!("{prefix}_single"));
        let expression=kind.quote_identifier(&format!("{prefix}_expr"));
        manager.query("sampling",&format!("CREATE TABLE {key_name}(a BIGINT NOT NULL,b BIGINT NOT NULL,c VARCHAR(100) NOT NULL,d VARCHAR(100),e VARCHAR(100),f VARCHAR(100),g VARCHAR(100),h VARCHAR(100),PRIMARY KEY(a,b)); CREATE UNIQUE INDEX {single} ON {key_name}(c); CREATE UNIQUE INDEX {expression} ON {key_name}((lower(e)),f);"),None,None,None).await?;
        if kind==DatabaseKind::Postgres {
            let partial=kind.quote_identifier(&format!("{prefix}_partial"));
            let included=kind.quote_identifier(&format!("{prefix}_included"));
            manager.query("sampling",&format!("CREATE UNIQUE INDEX {partial} ON {key_name}(d) WHERE d IS NOT NULL; CREATE UNIQUE INDEX {included} ON {key_name}(g) INCLUDE(h);"),None,None,None).await?;
        }
        let key_metadata=column_lookup(manager.get_columns("sampling",&schema,&key_table).await?);
        ensure!(!data_compare_key_columns_are_declared_unique(&key_metadata,&["a".into()])&&data_compare_key_columns_are_declared_unique(&key_metadata,&["a".into(),"b".into()]),"composite primary members must not appear individually unique");
        ensure!(key_metadata["c"].is_unique&&!key_metadata["a"].is_unique&&!key_metadata["b"].is_unique&&!key_metadata["f"].is_unique,"only complete single-column indexes prove independent uniqueness");
        if kind==DatabaseKind::Postgres {
            ensure!(!key_metadata["d"].is_unique&&key_metadata["g"].is_unique&&!key_metadata["h"].is_unique,"partial and INCLUDE index column semantics");
        }
        let digits="(SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
        let sql=format!("CREATE TABLE {source_name}(id BIGINT NOT NULL PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE {target_name}(id BIGINT NOT NULL PRIMARY KEY,value TEXT NOT NULL); INSERT INTO {source_name} SELECT 1+n0.d+n1.d*10+n2.d*100+n3.d*1000+n4.d*10000,'same' FROM {digits} n0 CROSS JOIN {digits} n1 CROSS JOIN {digits} n2 CROSS JOIN {digits} n3 CROSS JOIN {digits} n4; INSERT INTO {source_name} VALUES(100001,'same'); INSERT INTO {target_name} SELECT * FROM {source_name}; UPDATE {target_name} SET value='middle change' WHERE id=50001;");
        manager.query("sampling",&sql,None,None,None).await?;
        let count=super::super::compare_rows::data_compare_row_count(&manager.query("sampling",&format!("SELECT COUNT(*) FROM {source_name}"),None,None,None).await?).map_err(anyhow::Error::msg)?;
        ensure!(count==100001,"actual sampled relation size");
        let columns=vec!["id".into(),"value".into()]; let keys=vec!["id".into()];
        let metadata=column_lookup(manager.get_columns("sampling",&schema,&source.table).await?);
        let (_sender,cancellation)=watch::channel(false);
        for strategy in [TableDataCompareSamplingStrategy::ExtremeValues,TableDataCompareSamplingStrategy::Stratified] {
            let source_keys=fetch_data_compare_sample_keys(&manager,&source,"sample-live-source",&cancellation,kind,&keys,3,count,&strategy,|_|{}).await.map_err(anyhow::Error::msg)?;
            let target_keys=fetch_data_compare_sample_keys(&manager,&target,"sample-live-target",&cancellation,kind,&keys,3,count,&strategy,|_|{}).await.map_err(anyhow::Error::msg)?;
            let shared=merge_data_compare_sample_keys(source_keys,target_keys).map_err(anyhow::Error::msg)?;
            let left=fetch_sampled_data_compare_rows(&manager,&source,&cancellation,kind,&columns,&metadata,&keys,&shared,|_|{}).await.map_err(anyhow::Error::msg)?;
            let right=fetch_sampled_data_compare_rows(&manager,&target,&cancellation,kind,&columns,&metadata,&keys,&shared,|_|{}).await.map_err(anyhow::Error::msg)?;
            let coverage=data_compare_sample_coverage(left.len(),right.len(),count,count);
            let compared=build_table_data_compare_result(left,right,&columns,&keys,count,count,1000,TableDataCompareDegradationLevel::Sample,Some(strategy.clone()),coverage,None,"sampling_acceptance",true,&cancellation).map_err(anyhow::Error::msg)?;
            ensure!(!compared.counts_exact&&compared.confidence_score.is_none(),"sample must not claim exact whole-table results");
            if strategy==TableDataCompareSamplingStrategy::Stratified {
                ensure!(compared.modified_count==1&&compared.modified[0].source_values["id"]==json!(50001)&&compared.checksums_match==Some(false),"stratified sample must detect the actual middle-only edit");
            } else {
                ensure!(compared.modified_count==0&&compared.checksums_match==Some(true),"boundary samples reproduce the old blind spot");
            }
            let sampled=fetch_data_compare_sample_keys(&manager,&source,"sample-live-budget",&cancellation,kind,&keys,10000,count,&strategy,|_|{}).await.map_err(anyhow::Error::msg)?;
            ensure!(sampled.len()==10000,"10000 requested keys must not be silently truncated by the driver");
        }
        println!("{driver_name}: unique-key metadata verified; 100001 actual rows, middle-only edit detected by stratified sampling; both strategies return 10000 keys through bounded queries");
        Ok(())
    }.await;
    let cleanup = manager
        .query(
            "sampling",
            &format!("DROP TABLE IF EXISTS {target_name}; DROP TABLE IF EXISTS {source_name}; DROP TABLE IF EXISTS {key_name};"),
            None,
            None,
            None,
        )
        .await;
    let disconnect = manager.disconnect_connection("sampling").await;
    result?;
    cleanup?;
    disconnect?;
    Ok(())
}
