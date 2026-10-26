use super::proto::ResourceItem;
use anyhow::{anyhow, Result};
use std::collections::BTreeSet;

pub(super) fn sole_catalog(items: Vec<ResourceItem>) -> Result<String> {
    let names = items
        .into_iter()
        .map(|item| item.name)
        .collect::<BTreeSet<_>>();
    if names.len() == 1 {
        let name = names.into_iter().next().unwrap();
        if !name.trim().is_empty() {
            return Ok(name);
        }
    }
    Err(anyhow!("Select a database from the assigned data source before requesting SQL metadata or running a query."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(name: &str) -> ResourceItem {
        ResourceItem {
            kind: "database".into(),
            name: name.into(),
            metadata_json: Vec::new(),
        }
    }
    #[test]
    fn resolves_only_one_gateway_confirmed_database() {
        assert_eq!(sole_catalog(vec![item("app")]).unwrap(), "app");
        assert_eq!(sole_catalog(vec![item("app"), item("app")]).unwrap(), "app");
    }
    #[test]
    fn an_unselected_or_ambiguous_database_is_actionable_instead_of_empty_metadata() {
        assert!(sole_catalog(vec![]).is_err());
        assert!(sole_catalog(vec![item("")]).is_err());
        assert!(sole_catalog(vec![item("app"), item("other")]).is_err());
    }
}
