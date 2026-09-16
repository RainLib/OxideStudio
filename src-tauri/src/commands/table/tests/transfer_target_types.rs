use super::*;

#[test]
fn transfer_target_types_use_conservative_target_dialect_representations() {
    let same_product = transfer_target_column_type("uuid", "postgres", "postgres");
    assert_eq!(same_product.data_type, "uuid");
    assert_eq!(
        same_product.compatibility,
        TableDataTransferCompatibility::Exact
    );

    let mysql_uuid = transfer_target_column_type("uuid", "postgres", "mysql");
    assert_eq!(mysql_uuid.data_type, "VARCHAR");
    assert_eq!(mysql_uuid.length.as_deref(), Some("36"));
    assert_eq!(
        mysql_uuid.compatibility,
        TableDataTransferCompatibility::Review
    );
    assert_eq!(
        transfer_target_column_type("blob", "mysql", "postgres").data_type,
        "BYTEA"
    );
    assert_eq!(
        transfer_target_column_type("decimal(18,2)", "postgres", "sqlite").data_type,
        "NUMERIC"
    );
    assert_eq!(
        transfer_target_column_type("bigint unsigned", "mysql", "postgres")
            .length
            .as_deref(),
        None
    );
    assert_eq!(
        transfer_target_column_type("double precision", "mysql", "postgres").data_type,
        "DOUBLE PRECISION"
    );
    let unsupported = transfer_target_column_type("vendor_geography", "postgres", "mysql");
    assert_eq!(unsupported.data_type, "UNMAPPED");
    assert_eq!(
        unsupported.compatibility,
        TableDataTransferCompatibility::Unsupported
    );

    let same_product_custom =
        transfer_target_column_type("vendor_geography", "postgres", "postgres");
    assert_eq!(same_product_custom.data_type, "vendor_geography");
    assert_eq!(
        same_product_custom.compatibility,
        TableDataTransferCompatibility::Review
    );
}

#[test]
fn transfer_target_profiles_normalize_driver_aliases() {
    assert_eq!(
        super::transfer_target_mapping_profile("postgresql", "mariadb"),
        "postgres-to-mysql/v1"
    );
    assert_eq!(
        super::transfer_target_mapping_profile("sqlite3", "postgresql"),
        "sqlite-to-postgres/v1"
    );
}
