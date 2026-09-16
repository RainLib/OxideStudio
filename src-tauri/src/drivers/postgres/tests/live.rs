use super::super::*;
use crate::core::driver::DatabaseDriver;
use dotenvy::dotenv;
use std::env;

#[tokio::test]
#[ignore = "requires a live TEST_POSTGRES_URL database"]
async fn test_get_schemas() {
    dotenv().ok();
    let database_url = env::var("TEST_POSTGRES_URL").expect("TEST_POSTGRES_URL must be set");

    let mut driver = PostgresDriver::new(&database_url);
    driver.connect().await.expect("Failed to connect");

    let schemas = driver.get_schemas().await.expect("Failed to get schemas");
    println!("Schemas: {:?}", schemas);
    assert!(!schemas.is_empty());

    driver.disconnect().await.expect("Failed to disconnect");
}
