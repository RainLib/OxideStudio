use super::*;
use sqlx::Executor;

#[tokio::test]
#[ignore = "isolated MySQL spatial, charset, identity and native defaults acceptance"]
async fn mysql_transfer_spatial_charset_identity_and_native_defaults() -> Result<()> {
    let mut f = MysqlFixture::new(0).await?;
    let result = async {
        // SQLx defaults each new session to UTC. Exercise the user's actual
        // saved URL option rather than assuming the server default wins.
        let mut configured=url::Url::parse(&f.engine.url)?;
        configured.query_pairs_mut().append_pair("timezone","-07:00");
        for name in ["source","target"] {
            f.meta.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"mysql".into(),created_at:1,updated_at:2,config:json!({"id":name,"projectId":"p","name":name,"driver":"mysql","url":configured.as_str()})}).await?;
        }
        sqlx::query("SET SESSION time_zone='-07:00'").execute(&mut f.engine.connection).await?;
        let source=f.engine.table("source"); let target=f.engine.table("target");
        for name in [&source,&target] {
            sqlx::query(&format!("DROP TABLE {name}")).execute(&mut f.engine.connection).await?;
        }
        let common=r#"kept VARCHAR(32) CHARACTER SET latin1 COLLATE latin1_bin,choice ENUM('a','with''quote','back\\slash','中文') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,flags SET('red','grün','蓝') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,moment TIMESTAMP(6),raw_value VARBINARY(16),g GEOMETRY NOT NULL SRID 4326"#;
        sqlx::query(&format!("CREATE TABLE {source}(id BIGINT PRIMARY KEY,latin VARCHAR(32) CHARACTER SET latin1 COLLATE latin1_bin,{common}) ENGINE=InnoDB")).execute(&mut f.engine.connection).await?;
        sqlx::query(&format!("CREATE TABLE {target}(id BIGINT AUTO_INCREMENT PRIMARY KEY,latin VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,{common},created_value DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),native_context VARCHAR(64) NOT NULL DEFAULT 'pending') ENGINE=InnoDB")).execute(&mut f.engine.connection).await?;
        f.engine.connection.execute(format!("CREATE TRIGGER `{}`.capture_zone BEFORE INSERT ON {target} FOR EACH ROW SET NEW.native_context=@@session.time_zone",f.engine.schema).as_str()).await?;
        for (id,choice,instant,point) in [(0,"with'quote","2026-11-01 08:30:00.123456+00:00","POINT(30 10)"),(7,"back\\slash","2026-11-01 09:30:00.654321+00:00","POINT(40 20)")] {
            sqlx::query(&format!("INSERT INTO {source}(id,latin,kept,choice,flags,moment,raw_value,g) VALUES(?,?,?,?,?,?,?,ST_GeomFromText(?,4326))"))
                .bind(id).bind("café").bind("café").bind(choice).bind("red,蓝").bind(instant).bind(vec![0,255,1,2]).bind(point).execute(&mut f.engine.connection).await?;
        }
        let before: String=sqlx::query_scalar("SELECT CAST(NOW(6) AS CHAR)").fetch_one(&mut f.engine.connection).await?;
        let review=f.jobs.prepare(f.request(LargeTransferMode::Append)).await.context("prepare spatial/charset/default transfer")?;
        let latin=review.mapped_columns.iter().find(|column|column.source=="latin").context("missing charset mapping")?;
        ensure!(latin.source_type.contains("latin1_bin")&&latin.target_type.contains("utf8mb4_bin"),"charset/collation must remain visible in review");
        f.jobs.start("p",&review.job.id,&review.confirmation_token).await?;
        f.wait(&review.job.id,Phase::Completed).await?;
        let after: String=sqlx::query_scalar("SELECT CAST(NOW(6) AS CHAR)").fetch_one(&mut f.engine.connection).await?;
        let valid:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {source} s JOIN {target} t USING(id) WHERE CAST(CONVERT(s.latin USING utf8mb4) AS BINARY)=CAST(t.latin AS BINARY) AND CAST(s.kept AS BINARY)=CAST(t.kept AS BINARY) AND HEX(t.kept)='636166E9' AND CAST(s.choice AS BINARY)=CAST(t.choice AS BINARY) AND CAST(s.flags AS BINARY)=CAST(t.flags AS BINARY) AND s.moment=t.moment AND s.raw_value=t.raw_value AND ST_SRID(t.g)=4326 AND ST_AsWKB(s.g)=ST_AsWKB(t.g) AND t.native_context='-07:00' AND t.created_value BETWEEN ? AND ?"))
            .bind(&before).bind(&after).fetch_one(&mut f.engine.connection).await?;
        if valid!=2 || f.count("target").await?!=2 {
            let checks=[("latin","CAST(CONVERT(s.latin USING utf8mb4) AS BINARY)=CAST(t.latin AS BINARY)"),("kept","CAST(s.kept AS BINARY)=CAST(t.kept AS BINARY) AND HEX(t.kept)='636166E9'"),("enum","CAST(s.choice AS BINARY)=CAST(t.choice AS BINARY)"),("set","CAST(s.flags AS BINARY)=CAST(t.flags AS BINARY)"),("timestamp","s.moment=t.moment"),("binary","s.raw_value=t.raw_value"),("spatial","ST_SRID(t.g)=4326 AND ST_AsWKB(s.g)=ST_AsWKB(t.g)"),("context","t.native_context='-07:00'"),("defaults","t.created_value BETWEEN ? AND ?")];
            let expressions=checks.iter().map(|(_,expression)|format!("CAST(SUM(NOT COALESCE({expression},FALSE)) AS SIGNED)")).collect::<Vec<_>>().join(",");
            let row=sqlx::query(&format!("SELECT {expressions} FROM {source} s JOIN {target} t USING(id)")).bind(&before).bind(&after).fetch_one(&mut f.engine.connection).await?;
            let details=checks.iter().enumerate().map(|(index,(name,_))|Ok(format!("{name}:{}",row.try_get::<Option<i64>,_>(index)?.unwrap_or(-1)))).collect::<Result<Vec<_>>>()?;
            let ids:String=sqlx::query_scalar(&format!("SELECT CAST(GROUP_CONCAT(id ORDER BY id) AS CHAR) FROM {target}")).fetch_one(&mut f.engine.connection).await?;
            let times:(String,String,i64)=sqlx::query_as(&format!("SELECT CAST(s.moment AS CHAR),CAST(t.moment AS CHAR),TIMESTAMPDIFF(MICROSECOND,s.moment,t.moment) FROM {source} s JOIN {target} t USING(id) ORDER BY id LIMIT 1")).fetch_one(&mut f.engine.connection).await?;
            anyhow::bail!("native MySQL transfer differences: {}; target ids {ids}; timestamps {:?}",details.join(","),times);
        }
        let next=sqlx::query(&format!("INSERT INTO {target}(latin,g) VALUES('next',ST_GeomFromText('POINT(30 10)',4326))")).execute(&mut f.engine.connection).await?.last_insert_id();
        ensure!(next>7,"native auto-increment did not advance beyond mapped explicit identities");
        Ok(())
    }.await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated MySQL no-primary-key duplicate-row transfer"]
async fn mysql_transfer_unkeyed_duplicate_rows_are_preserved() -> Result<()> {
    let mut f = MysqlFixture::new(0).await?;
    let result=async {
        let source=f.engine.table("source"); let target=f.engine.table("target");
        for name in [&source,&target] {
            sqlx::query(&format!("DROP TABLE {name}")).execute(&mut f.engine.connection).await?;
            sqlx::query(&format!("CREATE TABLE {name}(n INT,label VARCHAR(64),raw_value VARBINARY(4)) ENGINE=InnoDB")).execute(&mut f.engine.connection).await?;
        }
        sqlx::query(&format!("INSERT INTO {source} VALUES(7,'same',NULL),(7,'same',NULL),(NULL,'empty',UNHEX('00FF'))")).execute(&mut f.engine.connection).await?;
        sqlx::query(&format!("INSERT INTO {target} VALUES(99,'baseline',NULL)")).execute(&mut f.engine.connection).await?;
        let mut request=f.request(LargeTransferMode::Overwrite); request.batch_rows=2;
        let review=f.jobs.prepare(request).await?;
        f.jobs.start("p",&review.job.id,&review.confirmation_token).await?;
        let completed=f.wait(&review.job.id,Phase::Completed).await?;
        let duplicates:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target} WHERE n=7 AND label='same' AND raw_value IS NULL")).fetch_one(&mut f.engine.connection).await?;
        let nullable:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target} WHERE n IS NULL AND label='empty' AND raw_value=UNHEX('00FF')")).fetch_one(&mut f.engine.connection).await?;
        ensure!(completed.rows_staged==3&&completed.batches==2&&f.count("target").await?==3&&duplicates==2&&nullable==1,"unkeyed duplicates or NULL/binary rows were deduplicated or lost");
        Ok(())
    }.await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated MySQL partitioned target upsert"]
async fn mysql_transfer_partitioned_upsert_keeps_unmatched_keys() -> Result<()> {
    let mut f = MysqlFixture::new(3).await?;
    let result=async {
        let target=f.engine.table("target");
        sqlx::query(&format!("ALTER TABLE {target} PARTITION BY RANGE(id)(PARTITION p0 VALUES LESS THAN(10),PARTITION p1 VALUES LESS THAN MAXVALUE)")).execute(&mut f.engine.connection).await?;
        sqlx::query(&format!("INSERT INTO {target}(id,label) VALUES(1,'old'),(99,'retained')")).execute(&mut f.engine.connection).await?;
        let review=f.jobs.prepare(f.request(LargeTransferMode::Upsert)).await?;
        f.jobs.start("p",&review.job.id,&review.confirmation_token).await?;
        f.wait(&review.job.id,Phase::Completed).await?;
        let updated:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {} s JOIN {target} t USING(id) WHERE CAST(s.label AS BINARY)=CAST(t.label AS BINARY) AND s.precise_value=t.precise_value AND s.bytes=t.bytes",f.engine.table("source"))).fetch_one(&mut f.engine.connection).await?;
        let retained:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target} WHERE id=99 AND label='retained'")).fetch_one(&mut f.engine.connection).await?;
        ensure!(updated==3&&retained==1&&f.count("target").await?==4,"partitioned upsert changed unmatched keys or mapped values");
        Ok(())
    }.await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated MySQL overwrite rollback after target trigger failure"]
async fn mysql_transfer_target_trigger_failure_rolls_back_overwrite() -> Result<()> {
    let mut f = MysqlFixture::new(3).await?;
    let result=async {
        let target=f.engine.table("target");
        sqlx::query(&format!("INSERT INTO {target}(id,label) VALUES(99,'baseline')")).execute(&mut f.engine.connection).await?;
        f.engine.connection.execute(format!("CREATE TRIGGER `{}`.fail_insert BEFORE INSERT ON {target} FOR EACH ROW BEGIN IF NEW.id=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated trigger rejection'; END IF; END",f.engine.schema).as_str()).await?;
        let review=f.jobs.prepare(f.request(LargeTransferMode::Overwrite)).await?;
        f.jobs.start("p",&review.job.id,&review.confirmation_token).await?;
        let paused=f.wait(&review.job.id,Phase::Paused).await?;
        let baseline:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target} WHERE id=99 AND label='baseline'")).fetch_one(&mut f.engine.connection).await?;
        ensure!(paused.rows_staged==3&&baseline==1&&f.count("target").await?==1,"failed target insert committed the preceding overwrite DELETE");
        f.jobs.cancel("p",&review.job.id).await?;
        f.wait(&review.job.id,Phase::Cancelled).await?;
        f.engine.connection.execute(format!("DROP TRIGGER `{}`.fail_insert",f.engine.schema).as_str()).await?;
        let reviewed=f.jobs.prepare(f.request(LargeTransferMode::Overwrite)).await?;
        f.jobs.start("p",&reviewed.job.id,&reviewed.confirmation_token).await?;
        f.wait(&reviewed.job.id,Phase::Completed).await?;
        ensure!(f.count("target").await?==3,"fresh review without rejecting trigger must publish successfully");
        Ok(())
    }.await;
    f.engine.close().await?;
    result
}
