use super::package_identity::protocol_is_compatible;
use super::types::DriverPackageManifest;
use oxide_driver_protocol::{HandshakeResponse, DRIVER_PROTOCOL_VERSION};

/// Validate the sidecar identity returned during startup before any connection
/// secrets or database requests are sent to that process.
pub fn validate_handshake(
    manifest: &DriverPackageManifest,
    response: &HandshakeResponse,
) -> Result<(), String> {
    if !protocol_is_compatible(&response.protocol_version) {
        return Err(format!(
            "Driver runtime protocol {} is incompatible with host protocol {}",
            response.protocol_version, DRIVER_PROTOCOL_VERSION
        ));
    }
    if response.protocol_version != manifest.protocol_version {
        return Err("Driver runtime protocol does not match its manifest".to_string());
    }
    if response.package_id != manifest.package_id
        || response.package_version != manifest.package_version
        || response.driver_id != manifest.driver_id
    {
        return Err("Driver runtime identity does not match its manifest".to_string());
    }
    if !response.capabilities.query {
        return Err("Driver runtime does not provide query capability".to_string());
    }
    if manifest.schema_migration.is_some() && !response.capabilities.semantic_schema_migration {
        return Err(
            "Driver manifest declares semantic schema migration that its runtime does not provide"
                .to_string(),
        );
    }
    if let Some(capabilities) = &manifest.capabilities {
        let declares_metadata = capabilities.supports_table_browsing
            || capabilities.supports_collection_browsing
            || capabilities.supports_key_value_browsing
            || capabilities.supports_schemas
            || capabilities.supports_table_indexes
            || capabilities.supports_table_constraints
            || capabilities.supports_functions;
        if declares_metadata && !response.capabilities.metadata {
            return Err(
                "Driver manifest declares Explorer metadata that its runtime does not provide"
                    .to_string(),
            );
        }
        // Data Editor mutations are executed as a single parameterized batch
        // inside a sidecar transaction. Do not let a signed manifest expose
        // editable rows when the running package cannot uphold that atomic
        // execution contract.
        if capabilities.supports_table_row_mutation && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares table row mutation that its runtime does not provide transactions for"
                    .to_string(),
            );
        }
        if capabilities.supports_table_data_transfer && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares table data transfer that its runtime does not provide transactions for"
                    .to_string(),
            );
        }
        if capabilities.supports_transactions && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares transactions that its runtime does not provide"
                    .to_string(),
            );
        }
        if capabilities.supports_query_cancellation && !response.capabilities.cancellation {
            return Err(
                "Driver manifest declares query cancellation that its runtime does not provide"
                    .to_string(),
            );
        }
        if capabilities.supports_create_database && !response.capabilities.database_creation {
            return Err(
                "Driver manifest declares database creation that its runtime does not provide"
                    .to_string(),
            );
        }
        if capabilities.supports_database_catalogs && !response.capabilities.database_scoped_queries
        {
            return Err(
                "Driver manifest declares database catalogs that its runtime cannot query safely"
                    .to_string(),
            );
        }
        // Reverse navigation is a separate server-side query boundary. A
        // package must not advertise foreign-key navigation merely because it
        // can enumerate ordinary table metadata; old or partial sidecars
        // safely degrade this feature until they implement the bounded lookup.
        if capabilities.supports_foreign_keys && !response.capabilities.referencing_foreign_keys {
            return Err(
                "Driver manifest declares foreign-key navigation that its runtime does not provide"
                    .to_string(),
            );
        }
    }
    Ok(())
}
