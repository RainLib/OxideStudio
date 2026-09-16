use super::*;

#[test]
fn sqlite_catalog_table_transfer_retains_exact_structural_body() {
    let source = r#"CREATE TABLE "order items" (
            "id" INTEGER PRIMARY KEY,
            "parent_id" INTEGER REFERENCES "order items"("id") ON UPDATE CASCADE ON DELETE SET NULL,
            "qty" INTEGER NOT NULL CHECK (("qty" > 0)),
            "note" TEXT DEFAULT 'semi; (still one statement)',
            "total" INTEGER GENERATED ALWAYS AS (("qty" * 2)) STORED,
            UNIQUE ("note" COLLATE NOCASE)
        ) STRICT, WITHOUT ROWID"#;

    let rewritten =
        rewrite_sqlite_create_table_for_transfer(source, "order items", "archive", "order items")
            .unwrap();
    assert!(rewritten.starts_with("CREATE TABLE \"archive\".\"order items\" ("));
    assert!(rewritten.contains("ON UPDATE CASCADE ON DELETE SET NULL"));
    assert!(rewritten.contains("CHECK ((\"qty\" > 0))"));
    assert!(rewritten.contains("DEFAULT 'semi; (still one statement)'"));
    assert!(rewritten.contains("GENERATED ALWAYS AS ((\"qty\" * 2)) STORED"));
    assert!(rewritten.ends_with(") STRICT, WITHOUT ROWID;"));
}

#[test]
fn sqlite_catalog_table_transfer_rewrites_only_self_references_for_renamed_target() {
    let source = r#"CREATE TABLE `nodes` (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER REFERENCES /* keep */ `nodes`(id),
            owner_id INTEGER REFERENCES owners(id),
            note TEXT DEFAULT 'REFERENCES nodes(id)',
            CHECK (note <> 'REFERENCES `nodes`')
        )"#;

    let rewritten =
        rewrite_sqlite_create_table_for_transfer(source, "nodes", "main", "tree_nodes").unwrap();
    assert!(rewritten.contains("REFERENCES /* keep */ \"tree_nodes\"(id)"));
    assert!(rewritten.contains("REFERENCES owners(id)"));
    assert!(rewritten.contains("DEFAULT 'REFERENCES nodes(id)'"));
    assert!(rewritten.contains("CHECK (note <> 'REFERENCES `nodes`')"));
    assert_eq!(
        sqlite_transfer_target_index_name("nodes", "tree_nodes", "nodes_parent_idx"),
        "tree_nodes__nodes_parent_idx"
    );
}

#[test]
fn sqlite_catalog_table_transfer_rejects_qualified_foreign_key_targets() {
    let error = rewrite_sqlite_create_table_for_transfer(
        "CREATE TABLE nodes (id INTEGER, parent_id INTEGER REFERENCES main.nodes(id))",
        "nodes",
        "archive",
        "tree_nodes",
    )
    .unwrap_err();
    assert!(error.contains("schema-qualified foreign-key targets"));
}

#[test]
fn sqlite_catalog_index_transfer_retains_expression_and_filter() {
    let source = r#"CREATE UNIQUE INDEX "orders_search_idx"
            ON "order items" (lower("note"), "id" DESC)
            WHERE "note" <> ';' AND ("qty" > 1)"#;

    assert_eq!(
            rewrite_sqlite_create_index_for_transfer(
                source,
                "archive",
                "order items",
                "orders_search_idx",
                true,
            )
            .unwrap(),
            "CREATE UNIQUE INDEX \"archive\".\"orders_search_idx\" ON \"order items\" (lower(\"note\"), \"id\" DESC)\n            WHERE \"note\" <> ';' AND (\"qty\" > 1);"
        );
}

#[test]
fn sqlite_catalog_trigger_transfer_qualifies_identity_and_keeps_compound_body() {
    let source = r#"CREATE TRIGGER IF NOT EXISTS `orders_audit`
            AFTER UPDATE ON `order items`
            BEGIN
                INSERT INTO audit_log(order_id) VALUES (NEW.id);
                UPDATE audit_log SET touched = 1 WHERE order_id = NEW.id;
            END"#;

    let rewritten = rewrite_sqlite_create_trigger_for_transfer(
        source,
        "orders_audit",
        "archive",
        "orders_audit",
    )
    .unwrap();
    assert!(rewritten.starts_with("CREATE TRIGGER \"archive\".\"orders_audit\" AFTER UPDATE"));
    assert!(rewritten.contains("INSERT INTO audit_log(order_id) VALUES (NEW.id);"));
    assert!(rewritten.contains("UPDATE audit_log SET touched = 1"));
    assert!(rewritten.ends_with("END;"));
}

#[test]
fn sqlite_catalog_trigger_transfer_rejects_identity_and_statement_injection() {
    assert!(rewrite_sqlite_create_trigger_for_transfer(
        "CREATE TRIGGER other AFTER INSERT ON users BEGIN SELECT NEW.id; END",
        "users_audit",
        "main",
        "users_audit",
    )
    .unwrap_err()
    .contains("does not match"));
    assert!(rewrite_sqlite_create_trigger_for_transfer(
            "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END; DROP TABLE users;",
            "users_audit",
            "main",
            "users_audit",
        )
        .unwrap_err()
        .contains("exactly one statement"));
}

#[test]
fn sqlite_catalog_view_transfer_qualifies_identity_and_keeps_query_body() {
    let source = r#"CREATE VIEW IF NOT EXISTS `active users` (id, email) AS
            SELECT id, email FROM users
            WHERE active = 1 AND email <> ';'"#;
    let rewritten =
        rewrite_sqlite_create_view_for_transfer(source, "active users", "main", "active users")
            .unwrap();
    assert!(rewritten.starts_with("CREATE VIEW \"main\".\"active users\" (id, email) AS"));
    assert!(rewritten.contains("SELECT id, email FROM users"));
    assert!(rewritten.contains("email <> ';'"));
    assert!(rewritten.ends_with(';'));
}

#[test]
fn sqlite_catalog_view_transfer_rejects_identity_and_statement_injection() {
    assert!(rewrite_sqlite_create_view_for_transfer(
        "CREATE VIEW other AS SELECT id FROM users",
        "active_users",
        "main",
        "active_users",
    )
    .unwrap_err()
    .contains("does not match"));
    assert!(rewrite_sqlite_create_view_for_transfer(
        "CREATE VIEW active_users AS SELECT id FROM users; DROP TABLE users;",
        "active_users",
        "main",
        "active_users",
    )
    .unwrap_err()
    .contains("exactly one statement"));
}

#[test]
fn sqlite_catalog_transfer_rejects_malformed_or_multi_statement_ddl() {
    assert!(rewrite_sqlite_create_table_for_transfer(
        "CREATE TABLE users (id INTEGER); DROP TABLE audit",
        "users",
        "main",
        "users",
    )
    .unwrap_err()
    .contains("trailing statement"));
    assert!(rewrite_sqlite_create_table_for_transfer(
        "CREATE TABLE users (id INTEGER",
        "users",
        "main",
        "users",
    )
    .unwrap_err()
    .contains("unbalanced parentheses"));
    assert!(rewrite_sqlite_create_table_for_transfer(
        "CREATE TABLE users (id INTEGER) AS SELECT 1",
        "users",
        "main",
        "users",
    )
    .unwrap_err()
    .contains("unsupported trailing options"));
    assert!(rewrite_sqlite_create_index_for_transfer(
        "CREATE INDEX users_idx ON users (id) ORDER BY id",
        "main",
        "users",
        "users_idx",
        false,
    )
    .unwrap_err()
    .contains("unsupported trailing clause"));
}
