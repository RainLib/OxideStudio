use super::*;
use oxide_studio_lib::core::transfer_jobs::LargeTransferListQuery;
use sqlx::Executor;

#[tokio::test]
#[ignore = "isolated native MySQL scoped role and trigger visibility acceptance"]
async fn mysql_transfer_scoped_role_and_missing_trigger_visibility() -> Result<()> {
    let engine = Engine::open_with_prefix("oxidetransfer").await?;
    check_role_transfer(MysqlFixture::with_engine(3, engine).await?, false).await
}

#[tokio::test]
#[ignore = "isolated MySQL escaped database role native access and fail-closed acceptance"]
async fn mysql_transfer_escaped_database_role_matches_native_access() -> Result<()> {
    check_role_transfer(MysqlFixture::new(3).await?, true).await
}

fn database_access_denied(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>())
        .is_some_and(|error| error.number() == 1044)
}

async fn check_role_transfer(mut f: MysqlFixture, escaped_database: bool) -> Result<()> {
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let user = format!("oxide_u_{}", &suffix[..20]);
    let role = format!("oxide_r_{}", &suffix[..20]);
    let password = uuid::Uuid::new_v4().simple().to_string();
    let account = format!("'{user}'@'127.0.0.1'");
    let role_account = format!("'{role}'@'%'");
    let grant_scope = f.engine.schema.replace('_', "\\_");
    let result=async{
        f.engine.connection.execute(format!("CREATE ROLE {role_account}").as_str()).await?;
        f.engine.connection.execute(format!("CREATE USER {account} IDENTIFIED BY '{password}'").as_str()).await?;
        f.engine.connection.execute(format!("GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,DROP,CREATE TEMPORARY TABLES,TRIGGER ON `{grant_scope}`.* TO {role_account}").as_str()).await?;
        f.engine.connection.execute(format!("GRANT {role_account} TO {account}").as_str()).await?;
        f.engine.connection.execute(format!("SET DEFAULT ROLE {role_account} TO {account}").as_str()).await?;
        let target=f.engine.table("target");
        sqlx::query(&format!("ALTER TABLE {target} ADD native_context VARCHAR(64) NOT NULL DEFAULT 'pending'")).execute(&mut f.engine.connection).await?;
        f.engine.connection.execute(format!("CREATE TRIGGER `{}`.capture_context BEFORE INSERT ON {target} FOR EACH ROW SET NEW.native_context=@@session.time_zone",f.engine.schema).as_str()).await?;
        let mut url=url::Url::parse(&f.engine.url)?;
        url.set_path(&format!("/{}",f.engine.schema));
        url.set_username(&user).map_err(|_|anyhow!("role fixture user"))?;
        url.set_password(Some(&password)).map_err(|_|anyhow!("role fixture password"))?;
        let connection=sqlx::MySqlConnection::connect(url.as_str()).await;
        if let Err(error)=&connection {
            // MySQL 8.0 can reject escaped database grants once roles are
            // active (upstream #110582). Prove the native restriction and the
            // Host's refusal independently; never grant a wider wildcard or
            // silently drop this scenario to turn the version matrix green.
            let version:String=sqlx::query_scalar("SELECT VERSION()").fetch_one(&mut f.engine.connection).await?;
            ensure!(escaped_database&&version.starts_with("8.0.")&&database_access_denied(error),"unexpected native role access failure on {version}: {error}");
            let mut no_database=url.clone(); no_database.set_path("");
            let mut native=sqlx::MySqlConnection::connect(no_database.as_str()).await?;
            let active:String=sqlx::query_scalar("SELECT CAST(CURRENT_ROLE() AS CHAR CHARACTER SET utf8mb4)").fetch_one(&mut native).await?;
            ensure!(active.contains(&role),"native restriction requires the default role to actually be active");
            let denied=native.execute(format!("USE `{}`",f.engine.schema).as_str()).await.err().context("native USE must reproduce escaped-role access denial")?;
            ensure!(database_access_denied(&denied),"unexpected native USE failure: {denied}");
            native.close().await?;
            for name in ["source","target"] {
                f.meta.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"mysql".into(),created_at:1,updated_at:1,config:json!({"id":name,"projectId":"p","name":name,"driver":"mysql","url":url.as_str()})}).await?;
            }
            let denied=f.jobs.prepare(f.request(LargeTransferMode::Append)).await.err().context("Host must reject the same inaccessible native schema")?;
            ensure!(denied.downcast_ref::<sqlx::Error>().is_some_and(database_access_denied),"unexpected Host role access failure: {denied:#}");
            let page=f.jobs.list(LargeTransferListQuery{project_id:"p".into(),cursor:None}).await?;
            ensure!(f.count("target").await?==0&&!page.jobs.is_empty()&&page.jobs.iter().all(|job|job.rows_staged==0),"native role denial must not stage or publish rows");
            println!("MySQL {version}: native escaped-database role access denied (1044); native USE and Host prepare both refuse; target remains unchanged");
            return Ok(());
        }
        let mut connection=connection?;
        let (active,native_zone):(String,String)=sqlx::query_as("SELECT CAST(CURRENT_ROLE() AS CHAR),CAST(@@session.time_zone AS CHAR)").fetch_one(&mut connection).await?;
        ensure!(active.contains(&role),"MySQL test role must actually be active");
        connection.close().await?;
        for name in ["source","target"] {
            f.meta.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"mysql".into(),created_at:1,updated_at:1,config:json!({"id":name,"projectId":"p","name":name,"driver":"mysql","url":url.as_str()})}).await?;
        }
        let review=f.jobs.prepare(f.request(LargeTransferMode::Append)).await.context("prepare using scoped default role")?;
        f.jobs.start("p",&review.job.id,&review.confirmation_token).await?;
        f.wait(&review.job.id,Phase::Completed).await?;
        let matched:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target} WHERE native_context=?")).bind(native_zone).fetch_one(&mut f.engine.connection).await?;
        ensure!(matched==3&&f.count("target").await?==3,"MySQL trigger lost original native session context");
        f.engine.connection.execute(format!("REVOKE TRIGGER ON `{grant_scope}`.* FROM {role_account}").as_str()).await?;
        let error=f.jobs.prepare(f.request(LargeTransferMode::Overwrite)).await.err().context("missing trigger visibility must reject preparation")?;
        ensure!(error.to_string().contains("TRIGGER visibility"),"unexpected trigger visibility rejection: {error:#}");
        ensure!(f.count("target").await?==3,"permission rejection changed original target");
        Ok(())
    }.await;
    let user_cleanup = f
        .engine
        .connection
        .execute(format!("DROP USER IF EXISTS {account}").as_str())
        .await;
    let role_cleanup = f
        .engine
        .connection
        .execute(format!("DROP ROLE IF EXISTS {role_account}").as_str())
        .await;
    f.engine.close().await?;
    user_cleanup?;
    role_cleanup?;
    result
}
