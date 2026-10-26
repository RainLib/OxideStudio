//! Bounded PostgreSQL mutations shared by the desktop and Gateway. Authority
//! remains at the Gateway; parsing in the desktop only selects the RPC.
use anyhow::{anyhow, bail, Result};
use oxide_enterprise_contracts::AccessAction;
use sqlparser::{
    ast::{
        AlterTableOperation, ColumnOption, DropBehavior, Expr, Ident, ObjectName, Statement,
        TableConstraint, Visit, VisitMut, Visitor, VisitorMut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use std::ops::ControlFlow;

pub struct ManagedMutationPlan {
    pub action: AccessAction,
    pub target: Vec<String>,
    pub sql: String,
}

struct MutationTargetQualifier(ObjectName);
impl VisitorMut for MutationTargetQualifier {
    type Break = ();
    fn pre_visit_relation(&mut self, relation: &mut ObjectName) -> ControlFlow<Self::Break> {
        *relation = self.0.clone();
        ControlFlow::Continue(())
    }
}

struct MutationVisitor<'a> {
    database: &'a str,
    schema: Option<&'a str>,
    target: Option<Vec<String>>,
}
impl Visitor for MutationVisitor<'_> {
    type Break = anyhow::Error;
    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<Self::Break> {
        let path = relation
            .0
            .iter()
            .map(|part| {
                part.as_ident().map(|ident| {
                    if ident.quote_style.is_some() {
                        ident.value.clone()
                    } else {
                        ident.value.to_ascii_lowercase()
                    }
                })
            })
            .collect::<Option<Vec<_>>>();
        let Some(mut path) = path else {
            return ControlFlow::Break(anyhow!("Dynamic mutation targets are unsupported"));
        };
        match path.len() {
            1 => {
                let Some(schema) = self.schema.filter(|value| !value.is_empty()) else {
                    return ControlFlow::Break(anyhow!(
                        "Select a schema before modifying an unqualified table"
                    ));
                };
                path.insert(0, schema.to_string());
                path.insert(0, self.database.to_string());
            }
            2 => path.insert(0, self.database.to_string()),
            3 if path[0] == self.database => {}
            _ => {
                return ControlFlow::Break(anyhow!(
                    "Mutation target must be in the selected database"
                ))
            }
        }
        if self.target.as_ref().is_some_and(|target| target != &path) {
            return ControlFlow::Break(anyhow!(
                "Managed mutations must reference one authorized table"
            ));
        }
        self.target = Some(path);
        ControlFlow::Continue(())
    }
    fn pre_visit_expr(&mut self, expression: &Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(function) = expression {
            let name = function.name.to_string().to_ascii_lowercase();
            let name = name.strip_prefix("pg_catalog.").unwrap_or(&name);
            if !matches!(
                name,
                "now"
                    | "lower"
                    | "upper"
                    | "trim"
                    | "length"
                    | "coalesce"
                    | "nullif"
                    | "abs"
                    | "round"
                    | "greatest"
                    | "least"
                    | "jsonb_build_object"
                    | "jsonb_build_array"
            ) {
                return ControlFlow::Break(anyhow!(
                    "This function is not supported in managed mutations"
                ));
            }
        }
        ControlFlow::Continue(())
    }
}

pub fn managed_mutation_plan(
    sql: &str,
    database: &str,
    schema: Option<&str>,
) -> Result<ManagedMutationPlan> {
    if sql.is_empty() || sql.len() > 200_000 {
        bail!("Mutation SQL must contain 1 to 200000 bytes");
    }
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)?;
    let [statement] = statements.as_slice() else {
        bail!("Each managed mutation must contain one SQL statement");
    };
    let action = match statement {
        Statement::Insert(insert) if insert.returning.is_none() => AccessAction::DataWrite,
        Statement::Update { returning: None, .. } => AccessAction::DataWrite,
        Statement::Delete(delete) if delete.returning.is_none() => AccessAction::DataWrite,
        Statement::AlterTable { operations, location: None, on_cluster: None, iceberg: false, .. }
            if !operations.is_empty() && operations.iter().all(|operation| matches!(operation,
                AlterTableOperation::AddColumn { .. } | AlterTableOperation::RenameColumn { .. } |
                AlterTableOperation::AlterColumn { .. } | AlterTableOperation::AddConstraint { .. } |
                AlterTableOperation::DropColumn { drop_behavior: None | Some(DropBehavior::Restrict), .. } |
                AlterTableOperation::DropConstraint { drop_behavior: None | Some(DropBehavior::Restrict), .. }
            )) => AccessAction::SchemaDdl,
        _ => bail!("Managed mutations support INSERT/UPDATE/DELETE without RETURNING and reviewed ALTER TABLE column/constraint changes"),
    };
    let mut visitor = MutationVisitor {
        database,
        schema,
        target: None,
    };
    if let ControlFlow::Break(error) = statement.visit(&mut visitor) {
        return Err(error);
    }
    // sqlparser's relation visitor does not classify REFERENCES names as
    // relations. Check both table and inline column foreign keys explicitly.
    if let Statement::AlterTable { operations, .. } = statement {
        for operation in operations {
            let references: Vec<&ObjectName> = match operation {
                AlterTableOperation::AddConstraint {
                    constraint: TableConstraint::ForeignKey { foreign_table, .. },
                    ..
                } => vec![foreign_table],
                AlterTableOperation::AddColumn { column_def, .. } => column_def
                    .options
                    .iter()
                    .filter_map(|option| match &option.option {
                        ColumnOption::ForeignKey { foreign_table, .. } => Some(foreign_table),
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            };
            for relation in references {
                if let ControlFlow::Break(error) = visitor.pre_visit_relation(relation) {
                    return Err(error);
                }
            }
        }
    }
    let target = visitor
        .target
        .ok_or_else(|| anyhow!("Mutation has no table target"))?;
    let qualified = ObjectName::from(vec![
        Ident::with_quote('"', &target[1]),
        Ident::with_quote('"', &target[2]),
    ]);
    let mut executable = statement.clone();
    let _ = VisitMut::visit(
        &mut executable,
        &mut MutationTargetQualifier(qualified.clone()),
    );
    if let Statement::AlterTable { operations, .. } = &mut executable {
        for operation in operations {
            match operation {
                AlterTableOperation::AddConstraint {
                    constraint: TableConstraint::ForeignKey { foreign_table, .. },
                    ..
                } => *foreign_table = qualified.clone(),
                AlterTableOperation::AddColumn { column_def, .. } => {
                    for option in &mut column_def.options {
                        if let ColumnOption::ForeignKey { foreign_table, .. } = &mut option.option {
                            *foreign_table = qualified.clone();
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(ManagedMutationPlan {
        action,
        target,
        sql: executable.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typed_grid_and_schema_statements_have_distinct_authority() {
        for sql in [
            "INSERT INTO app.notes(id,note) VALUES($1,$2)",
            "UPDATE app.notes SET note=$1 WHERE id=$2",
            "DELETE FROM app.notes WHERE id=$1",
        ] {
            let plan = managed_mutation_plan(sql, "fixture", None).unwrap();
            assert_eq!(plan.action, AccessAction::DataWrite);
            assert_eq!(plan.target, vec!["fixture", "app", "notes"]);
        }
        for sql in [
            "ALTER TABLE app.notes ADD COLUMN test text",
            "ALTER TABLE app.notes DROP COLUMN test RESTRICT",
            "ALTER TABLE app.notes RENAME COLUMN test TO renamed",
            "ALTER TABLE app.notes ALTER COLUMN note SET NOT NULL",
        ] {
            assert_eq!(
                managed_mutation_plan(sql, "fixture", None).unwrap().action,
                AccessAction::SchemaDdl
            );
        }
    }
    #[test]
    fn rejects_authority_changes_multiple_targets_and_executable_functions() {
        for sql in [
            "UPDATE app.notes SET note='x'; DELETE FROM app.notes",
            "GRANT ALL ON app.notes TO public",
            "ALTER TABLE app.notes DISABLE ROW LEVEL SECURITY",
            "ALTER TABLE app.notes RENAME TO other",
            "ALTER TABLE app.notes DROP COLUMN note CASCADE",
            "DO $$ BEGIN END $$",
            "COPY app.notes TO '/tmp/leak'",
            "INSERT INTO app.notes SELECT * FROM app.secret",
            "UPDATE app.notes SET note=evil()",
            "UPDATE app.notes SET note=pg_catalog.pg_read_file('/tmp/x')",
            "UPDATE app.notes SET note='x' RETURNING *",
            "ALTER TABLE app.notes ADD CONSTRAINT fk FOREIGN KEY(id) REFERENCES app.secret(id)",
            "ALTER TABLE app.notes ADD COLUMN other_id bigint REFERENCES app.secret(id)",
        ] {
            assert!(
                managed_mutation_plan(sql, "fixture", None).is_err(),
                "{sql}"
            );
        }
    }
    #[test]
    fn preserves_quotes_parameters_and_selected_database() {
        let unqualified = managed_mutation_plan(
            "UPDATE notes SET note=$1 WHERE id=$2",
            "fixture",
            Some("app"),
        )
        .unwrap();
        assert_eq!(
            unqualified.sql,
            "UPDATE \"app\".\"notes\" SET note = $1 WHERE id = $2"
        );
        assert_eq!(
            managed_mutation_plan("UPDATE APP.NOTES SET note=$1", "fixture", None)
                .unwrap()
                .target,
            vec!["fixture", "app", "notes"]
        );
        let plan = managed_mutation_plan(
            "UPDATE \"app\".\"Order Details\" SET note=$1 WHERE id=$2",
            "fixture",
            None,
        )
        .unwrap();
        assert_eq!(plan.target, vec!["fixture", "app", "Order Details"]);
        assert!(managed_mutation_plan("UPDATE notes SET note=$1", "fixture", None).is_err());
        assert!(
            managed_mutation_plan("UPDATE elsewhere.app.notes SET note=$1", "fixture", None)
                .is_err()
        );
    }
}
