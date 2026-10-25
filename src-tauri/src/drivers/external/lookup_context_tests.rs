use super::validate_context;
use oxide_driver_protocol::SqlLookupContext;
#[test]
fn context_accepts_driver_names_and_preserves_quoted_identifier_characters() {
    let context = SqlLookupContext {
        database: "Sales.DB".into(),
        default_schema: "sales]; --".into(),
    };
    assert_eq!(
        validate_context(Some(context.clone()), Some("Sales.DB")).unwrap(),
        Some(context)
    );
    assert_eq!(validate_context(None, None).unwrap(), None);
}
#[test]
fn context_rejects_wrong_database_and_invalid_names() {
    for (database, schema, expected) in [
        ("other", "app", Some("db")),
        ("", "app", None),
        ("db", " ", None),
        ("db", "app\n", None),
    ] {
        assert!(validate_context(
            Some(SqlLookupContext {
                database: database.into(),
                default_schema: schema.into()
            }),
            expected
        )
        .is_err());
    }
}
