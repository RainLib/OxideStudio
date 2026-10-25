use crate::core::protocol::{CollectionInfo, QueryResult};
use anyhow::Result;
use async_trait::async_trait;

use super::DatabaseDriver;

struct MinimalDriver;

struct CollectionsDriver;

#[async_trait]
impl DatabaseDriver for MinimalDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution(sql, 0)])
    }
}

#[async_trait]
impl DatabaseDriver for CollectionsDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution(sql, 0)])
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        Ok(["session:1", "user:1", "user:2"]
            .into_iter()
            .map(|name| CollectionInfo {
                name: name.to_string(),
                namespace: Some(namespace.to_string()),
                collection_type: None,
                document_count: None,
            })
            .collect())
    }
}

#[tokio::test]
async fn minimal_driver_can_rely_on_non_relational_defaults() {
    let driver = MinimalDriver;
    assert_eq!(driver.sql_lookup_context(None).await.unwrap(), None);
    assert_eq!(driver.sql_lookup_context(Some("db")).await.unwrap(), None);

    assert_eq!(driver.get_databases().await.unwrap(), Vec::<String>::new());
    assert_eq!(driver.get_schemas().await.unwrap(), Vec::<String>::new());
    assert_eq!(
        driver.get_database_schemas("app").await.unwrap(),
        Vec::<String>::new()
    );
    assert!(driver.get_tables("default").await.unwrap().is_empty());
    assert!(driver
        .get_database_tables("app", "default")
        .await
        .unwrap()
        .is_empty());
    assert!(driver.get_collections("default").await.unwrap().is_empty());
    assert!(driver
        .get_columns("default", "items")
        .await
        .unwrap()
        .is_empty());
    assert!(driver
        .get_indexes("default", "items")
        .await
        .unwrap()
        .is_empty());
    assert!(driver
        .get_constraints("default", "items")
        .await
        .unwrap()
        .is_empty());
    assert!(driver.get_functions("default").await.unwrap().is_empty());
    assert!(driver
        .get_database_functions("app", "default")
        .await
        .unwrap()
        .is_empty());
    assert!(driver.query_database("app", "SELECT 1").await.is_err());
    assert!(driver
        .query_database_with_context_tracked(Some("query-1"), "app", "SELECT 1", Some("public"))
        .await
        .is_err());
    assert!(driver
        .query_database_parameterized("app", "SELECT $1", &[])
        .await
        .is_err());
    assert!(driver
        .get_database_columns("app", "default", "items")
        .await
        .is_err());
    assert!(driver
        .get_database_indexes("app", "default", "items")
        .await
        .is_err());
    assert!(driver
        .get_database_constraints("app", "default", "items")
        .await
        .is_err());
    assert!(driver.set_current_schema("default").await.is_ok());
    assert!(!driver.cancel_query("query-1").await.unwrap());

    let result = driver
        .query_with_context("PING", "default")
        .await
        .expect("context query should delegate to query");
    assert_eq!(result[0].statement_type.as_deref(), Some("PING"));

    assert!(driver.begin_transaction("tx", None).await.is_err());
    assert!(driver
        .begin_database_transaction("tx", "other", None)
        .await
        .is_err());
    assert!(driver.query_transaction("tx", "PING").await.is_err());
    assert!(driver
        .execute_parameterized_transaction("tx", &[])
        .await
        .is_err());
    assert!(driver.commit_transaction("tx").await.is_err());
    assert!(driver.rollback_transaction("tx").await.is_err());
}

#[tokio::test]
async fn default_collection_pages_filter_before_paginating() {
    let driver = CollectionsDriver;

    let first = driver
        .get_collections_page("default", None, 1, Some("user:"))
        .await
        .unwrap();
    assert_eq!(first.total, Some(2));
    assert_eq!(first.next_cursor.as_deref(), Some("1"));
    assert_eq!(first.items[0].name, "user:1");

    let second = driver
        .get_collections_page("default", first.next_cursor.as_deref(), 1, Some("user:"))
        .await
        .unwrap();
    assert_eq!(second.next_cursor, None);
    assert_eq!(second.items[0].name, "user:2");
}
