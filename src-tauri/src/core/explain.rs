use super::{
    dialect::DatabaseKind,
    protocol::{ExplainPlan, ExplainPlanFormat, ExplainPlanMode, ExplainPlanNode, QueryResult},
    statement::{
        execution_statement_kind, split_sql_statements, validate_read_only_sql, StatementKind,
        StatementScanDialect,
    },
};
use anyhow::{anyhow, Result};
use serde_json::{Map, Value};

pub fn validate_explain_source_sql(
    sql: &str,
    dialect: StatementScanDialect,
) -> Result<(), &'static str> {
    validate_read_only_sql(sql, dialect)?;
    let statement = split_sql_statements(sql, dialect)[0];
    match execution_statement_kind(statement) {
        StatementKind::Select | StatementKind::Values => {}
        StatementKind::Explain => {
            return Err("Explain Plan expects a query, not an existing EXPLAIN statement");
        }
        _ => {
            return Err(
                "Explain Plan requires one SELECT, TABLE, VALUES, or read-only CTE statement",
            );
        }
    }
    Ok(())
}

pub fn build_explain_statement(
    sql: &str,
    kind: DatabaseKind,
    mode: ExplainPlanMode,
) -> Result<(String, ExplainPlanFormat)> {
    let dialect = match kind {
        DatabaseKind::Postgres => StatementScanDialect::Postgres,
        DatabaseKind::Mysql => StatementScanDialect::Mysql,
    };
    validate_explain_source_sql(sql, dialect).map_err(anyhow::Error::msg)?;
    let statement = split_sql_statements(sql, dialect)[0];

    Ok(match (kind, mode) {
        (DatabaseKind::Postgres, ExplainPlanMode::Estimate) => (
            format!("EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE) {statement}"),
            ExplainPlanFormat::Json,
        ),
        (DatabaseKind::Postgres, ExplainPlanMode::Analyze) => (
            format!(
                "EXPLAIN (FORMAT JSON, ANALYZE TRUE, COSTS TRUE, BUFFERS TRUE, TIMING TRUE, SUMMARY TRUE) {statement}"
            ),
            ExplainPlanFormat::Json,
        ),
        (DatabaseKind::Mysql, ExplainPlanMode::Estimate) => (
            format!("EXPLAIN FORMAT=JSON {statement}"),
            ExplainPlanFormat::Json,
        ),
        (DatabaseKind::Mysql, ExplainPlanMode::Analyze) => (
            format!("EXPLAIN ANALYZE {statement}"),
            ExplainPlanFormat::Text,
        ),
    })
}

pub fn parse_explain_results(
    id: String,
    kind: DatabaseKind,
    mode: ExplainPlanMode,
    format: ExplainPlanFormat,
    generated_in_ms: f64,
    results: &[QueryResult],
) -> Result<ExplainPlan> {
    let raw_plan = extract_raw_plan(results, format)?;
    let mut next_id = 0usize;
    let (root, planning_time_ms, execution_time_ms) = match (kind, format) {
        (DatabaseKind::Postgres, ExplainPlanFormat::Json) => {
            parse_postgres_plan(&raw_plan, &mut next_id)?
        }
        (DatabaseKind::Mysql, ExplainPlanFormat::Json) => {
            (parse_mysql_json_plan(&raw_plan, &mut next_id)?, None, None)
        }
        (_, ExplainPlanFormat::Text) => (
            parse_text_plan(&raw_plan, &mut next_id)?,
            None,
            text_execution_time(&raw_plan),
        ),
    };
    let total_cost = root
        .total_cost
        .or_else(|| max_node_metric(&root, |node| node.total_cost));
    let estimated_rows = root
        .estimated_rows
        .or_else(|| max_node_metric(&root, |node| node.estimated_rows));
    let mut warnings = Vec::new();
    if mode == ExplainPlanMode::Estimate {
        warnings.push("Estimated plan; the query was not executed.".to_string());
    } else if kind == DatabaseKind::Mysql {
        warnings.push(
            "MySQL EXPLAIN ANALYZE uses TREE output; raw JSON is unavailable in this mode."
                .to_string(),
        );
    }

    Ok(ExplainPlan {
        id,
        driver: kind.as_str().to_string(),
        mode,
        format,
        generated_in_ms,
        planning_time_ms,
        execution_time_ms,
        total_cost,
        estimated_rows,
        root,
        raw_plan,
        warnings,
    })
}

fn extract_raw_plan(results: &[QueryResult], format: ExplainPlanFormat) -> Result<Value> {
    let values: Vec<&Value> = results
        .iter()
        .flat_map(|result| result.rows.iter())
        .flat_map(|row| row.iter())
        .filter(|value| !value.is_null())
        .collect();
    if values.is_empty() {
        return Err(anyhow!("Explain Plan returned no plan data"));
    }

    match format {
        ExplainPlanFormat::Json => {
            let value = values[0].clone();
            if let Value::String(text) = value {
                serde_json::from_str(&text)
                    .map_err(|error| anyhow!("Explain Plan returned invalid JSON: {error}"))
            } else {
                Ok(value.clone())
            }
        }
        ExplainPlanFormat::Text => {
            let lines = values
                .iter()
                .filter_map(|value| match value {
                    Value::String(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>();
            if lines.is_empty() {
                return Err(anyhow!("Explain Plan returned invalid text output"));
            }
            Ok(Value::String(lines.join("\n")))
        }
    }
}

fn parse_postgres_plan(
    raw: &Value,
    next_id: &mut usize,
) -> Result<(ExplainPlanNode, Option<f64>, Option<f64>)> {
    let entry = raw
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(raw);
    let object = entry
        .as_object()
        .ok_or_else(|| anyhow!("PostgreSQL Explain Plan root is not an object"))?;
    let plan = object
        .get("Plan")
        .ok_or_else(|| anyhow!("PostgreSQL Explain Plan does not contain a Plan node"))?;
    Ok((
        parse_postgres_node(plan, next_id)?,
        number(object.get("Planning Time")),
        number(object.get("Execution Time")),
    ))
}

fn parse_postgres_node(value: &Value, next_id: &mut usize) -> Result<ExplainPlanNode> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("PostgreSQL plan node is not an object"))?;
    let id = allocate_node_id(next_id);
    let conditions = [
        "Index Cond",
        "Recheck Cond",
        "Hash Cond",
        "Merge Cond",
        "Join Filter",
        "Filter",
    ]
    .iter()
    .filter_map(|key| string(object.get(*key)).map(|value| format!("{key}: {value}")))
    .collect::<Vec<_>>();
    let children = object
        .get("Plans")
        .and_then(Value::as_array)
        .map(|plans| {
            plans
                .iter()
                .map(|plan| parse_postgres_node(plan, next_id))
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?
        .unwrap_or_default();

    Ok(ExplainPlanNode {
        id,
        node_type: string(object.get("Node Type")).unwrap_or_else(|| "Plan".to_string()),
        relation: string(object.get("Relation Name")),
        alias: string(object.get("Alias")),
        access_type: string(object.get("Scan Direction")),
        join_type: string(object.get("Join Type")),
        index: string(object.get("Index Name")),
        condition: (!conditions.is_empty()).then(|| conditions.join(" · ")),
        startup_cost: number(object.get("Startup Cost")),
        total_cost: number(object.get("Total Cost")),
        estimated_rows: number(object.get("Plan Rows")),
        actual_startup_time_ms: number(object.get("Actual Startup Time")),
        actual_total_time_ms: number(object.get("Actual Total Time")),
        actual_rows: number(object.get("Actual Rows")),
        loops: number(object.get("Actual Loops")),
        children,
    })
}

fn parse_mysql_json_plan(raw: &Value, next_id: &mut usize) -> Result<ExplainPlanNode> {
    let object = raw
        .as_object()
        .ok_or_else(|| anyhow!("MySQL Explain Plan root is not an object"))?;
    let root = object.get("query_block").unwrap_or(raw);
    parse_mysql_container(root, "Query Block", next_id)
}

fn parse_mysql_container(
    value: &Value,
    label: &str,
    next_id: &mut usize,
) -> Result<ExplainPlanNode> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("MySQL plan node is not an object"))?;
    if label == "Table" {
        return Ok(parse_mysql_table(object, next_id));
    }

    let id = allocate_node_id(next_id);
    let mut children = Vec::new();
    for (key, child_label) in [
        ("table", "Table"),
        ("query_block", "Query Block"),
        ("grouping_operation", "Grouping"),
        ("ordering_operation", "Ordering"),
        ("duplicates_removal", "Duplicate Removal"),
        ("union_result", "Union"),
        ("materialized_from_subquery", "Materialized Subquery"),
    ] {
        if let Some(child) = object.get(key) {
            children.push(parse_mysql_container(child, child_label, next_id)?);
        }
    }
    for key in ["nested_loop", "attached_subqueries", "query_specifications"] {
        if let Some(items) = object.get(key).and_then(Value::as_array) {
            for item in items {
                let child = if item.get("table").is_some() {
                    parse_mysql_container(item.get("table").unwrap_or(item), "Table", next_id)?
                } else {
                    parse_mysql_container(item, title_case(key), next_id)?
                };
                children.push(child);
            }
        }
    }

    Ok(ExplainPlanNode {
        id,
        node_type: label.to_string(),
        relation: None,
        alias: None,
        access_type: None,
        join_type: None,
        index: None,
        condition: string(object.get("attached_condition")),
        startup_cost: None,
        total_cost: cost_number(object, "query_cost")
            .or_else(|| cost_number(object, "prefix_cost")),
        estimated_rows: number(object.get("rows_produced_per_join")),
        actual_startup_time_ms: None,
        actual_total_time_ms: None,
        actual_rows: None,
        loops: None,
        children,
    })
}

fn parse_mysql_table(object: &Map<String, Value>, next_id: &mut usize) -> ExplainPlanNode {
    ExplainPlanNode {
        id: allocate_node_id(next_id),
        node_type: "Table Access".to_string(),
        relation: string(object.get("table_name")),
        alias: None,
        access_type: string(object.get("access_type")),
        join_type: None,
        index: string(object.get("key")),
        condition: string(object.get("attached_condition")),
        startup_cost: cost_number(object, "read_cost"),
        total_cost: cost_number(object, "prefix_cost")
            .or_else(|| cost_number(object, "query_cost")),
        estimated_rows: number(object.get("rows_produced_per_join"))
            .or_else(|| number(object.get("rows_examined_per_scan"))),
        actual_startup_time_ms: None,
        actual_total_time_ms: None,
        actual_rows: None,
        loops: None,
        children: Vec::new(),
    }
}

fn parse_text_plan(raw: &Value, next_id: &mut usize) -> Result<ExplainPlanNode> {
    let text = raw
        .as_str()
        .ok_or_else(|| anyhow!("Text Explain Plan is not a string"))?;
    let mut flat = Vec::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let trimmed = line.trim_start();
        let depth = line.len().saturating_sub(trimmed.len()) / 4;
        let detail = trimmed.strip_prefix("->").unwrap_or(trimmed).trim();
        flat.push((depth, parse_text_node(detail, next_id)));
    }
    if flat.is_empty() {
        return Err(anyhow!("Text Explain Plan did not contain a node"));
    }

    let mut cursor = 0usize;
    let mut roots = Vec::new();
    while cursor < flat.len() {
        roots.push(build_text_tree(&flat, &mut cursor));
    }
    if roots.len() == 1 {
        return Ok(roots.remove(0));
    }
    Ok(ExplainPlanNode {
        id: allocate_node_id(next_id),
        node_type: "Query Plan".to_string(),
        relation: None,
        alias: None,
        access_type: None,
        join_type: None,
        index: None,
        condition: None,
        startup_cost: None,
        total_cost: max_nodes_metric(&roots, |node| node.total_cost),
        estimated_rows: max_nodes_metric(&roots, |node| node.estimated_rows),
        actual_startup_time_ms: None,
        actual_total_time_ms: max_nodes_metric(&roots, |node| node.actual_total_time_ms),
        actual_rows: max_nodes_metric(&roots, |node| node.actual_rows),
        loops: None,
        children: roots,
    })
}

fn parse_text_node(detail: &str, next_id: &mut usize) -> ExplainPlanNode {
    let metric_start = detail.find(" (cost=").or_else(|| detail.find("(cost="));
    let node_type = metric_start
        .map(|index| detail[..index].trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("Plan")
        .to_string();
    let (startup_cost, total_cost) = range_metric(detail, "cost=");
    let (actual_startup_time_ms, actual_total_time_ms) = range_metric(detail, "actual time=");
    ExplainPlanNode {
        id: allocate_node_id(next_id),
        node_type,
        relation: None,
        alias: None,
        access_type: None,
        join_type: None,
        index: None,
        condition: None,
        startup_cost,
        total_cost,
        estimated_rows: scalar_metric(detail, "rows="),
        actual_startup_time_ms,
        actual_total_time_ms,
        actual_rows: detail
            .find("actual time=")
            .and_then(|index| scalar_metric(&detail[index..], "rows=")),
        loops: scalar_metric(detail, "loops="),
        children: Vec::new(),
    }
}

fn build_text_tree(flat: &[(usize, ExplainPlanNode)], cursor: &mut usize) -> ExplainPlanNode {
    let depth = flat[*cursor].0;
    let mut node = flat[*cursor].1.clone();
    *cursor += 1;
    while *cursor < flat.len() && flat[*cursor].0 > depth {
        node.children.push(build_text_tree(flat, cursor));
    }
    node
}

fn text_execution_time(raw: &Value) -> Option<f64> {
    raw.as_str().and_then(|text| {
        text.lines()
            .filter_map(|line| range_metric(line, "actual time=").1)
            .reduce(f64::max)
    })
}

fn cost_number(object: &Map<String, Value>, key: &str) -> Option<f64> {
    object
        .get("cost_info")
        .and_then(Value::as_object)
        .and_then(|cost| number(cost.get(key)))
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn scalar_metric(text: &str, key: &str) -> Option<f64> {
    let start = text.find(key)? + key.len();
    let value = text[start..]
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ')' | ','))
        .next()?;
    value.parse().ok()
}

fn range_metric(text: &str, key: &str) -> (Option<f64>, Option<f64>) {
    let Some(start) = text.find(key).map(|index| index + key.len()) else {
        return (None, None);
    };
    let value = text[start..]
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ')' | ','))
        .next()
        .unwrap_or_default();
    let mut parts = value.split("..");
    let first = parts.next().and_then(|value| value.parse().ok());
    let second = parts.next().and_then(|value| value.parse().ok());
    (first, second.or(first))
}

fn allocate_node_id(next_id: &mut usize) -> String {
    let id = format!("node-{next_id}");
    *next_id += 1;
    id
}

fn title_case(value: &str) -> &str {
    match value {
        "nested_loop" => "Nested Loop",
        "attached_subqueries" => "Attached Subquery",
        "query_specifications" => "Query Specification",
        _ => "Plan",
    }
}

fn max_node_metric(
    node: &ExplainPlanNode,
    metric: impl Copy + Fn(&ExplainPlanNode) -> Option<f64>,
) -> Option<f64> {
    metric(node)
        .into_iter()
        .chain(
            node.children
                .iter()
                .filter_map(|child| max_node_metric(child, metric)),
        )
        .reduce(f64::max)
}

fn max_nodes_metric(
    nodes: &[ExplainPlanNode],
    metric: impl Copy + Fn(&ExplainPlanNode) -> Option<f64>,
) -> Option<f64> {
    nodes
        .iter()
        .filter_map(|node| max_node_metric(node, metric))
        .reduce(f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::protocol::ColumnDef;

    fn json_result(value: Value) -> Vec<QueryResult> {
        vec![QueryResult::rows(
            vec![ColumnDef {
                name: "plan".to_string(),
                data_type: "json".to_string(),
            }],
            vec![vec![value]],
        )]
    }

    #[test]
    fn explain_statement_is_driver_specific_and_read_only() {
        let (postgres, postgres_format) = build_explain_statement(
            "SELECT * FROM users;",
            DatabaseKind::Postgres,
            ExplainPlanMode::Estimate,
        )
        .unwrap();
        assert_eq!(postgres_format, ExplainPlanFormat::Json);
        assert!(postgres.starts_with("EXPLAIN (FORMAT JSON"));
        assert!(!postgres.ends_with(';'));

        let (mysql, mysql_format) = build_explain_statement(
            "SELECT * FROM users",
            DatabaseKind::Mysql,
            ExplainPlanMode::Analyze,
        )
        .unwrap();
        assert_eq!(mysql_format, ExplainPlanFormat::Text);
        assert_eq!(mysql, "EXPLAIN ANALYZE SELECT * FROM users");

        for sql in [
            "DELETE FROM users",
            "SELECT 1; SELECT 2",
            "EXPLAIN SELECT * FROM users",
            "SHOW TABLES",
            "DESCRIBE users",
        ] {
            assert!(build_explain_statement(
                sql,
                DatabaseKind::Postgres,
                ExplainPlanMode::Estimate
            )
            .is_err());
        }
    }

    #[test]
    fn parses_postgres_json_plan_and_actual_metrics() {
        let raw = serde_json::json!([{
            "Plan": {
                "Node Type": "Hash Join",
                "Join Type": "Inner",
                "Startup Cost": 1.2,
                "Total Cost": 42.5,
                "Plan Rows": 12,
                "Actual Startup Time": 0.1,
                "Actual Total Time": 0.8,
                "Actual Rows": 10,
                "Actual Loops": 1,
                "Hash Cond": "(users.team_id = teams.id)",
                "Plans": [{
                    "Node Type": "Seq Scan",
                    "Relation Name": "users",
                    "Alias": "users",
                    "Total Cost": 12.0,
                    "Plan Rows": 10
                }]
            },
            "Planning Time": 0.4,
            "Execution Time": 1.1
        }]);
        let plan = parse_explain_results(
            "plan-1".to_string(),
            DatabaseKind::Postgres,
            ExplainPlanMode::Analyze,
            ExplainPlanFormat::Json,
            2.0,
            &json_result(raw),
        )
        .unwrap();

        assert_eq!(plan.root.node_type, "Hash Join");
        assert_eq!(plan.root.children[0].relation.as_deref(), Some("users"));
        assert_eq!(plan.total_cost, Some(42.5));
        assert_eq!(plan.planning_time_ms, Some(0.4));
        assert_eq!(plan.execution_time_ms, Some(1.1));
    }

    #[test]
    fn parses_mysql_json_plan_into_operation_and_table_nodes() {
        let raw = serde_json::json!({
            "query_block": {
                "select_id": 1,
                "cost_info": { "query_cost": "4.20" },
                "nested_loop": [{
                    "table": {
                        "table_name": "users",
                        "access_type": "ref",
                        "key": "idx_team",
                        "rows_examined_per_scan": 3,
                        "rows_produced_per_join": 2,
                        "cost_info": { "prefix_cost": "1.25" }
                    }
                }]
            }
        });
        let plan = parse_explain_results(
            "plan-2".to_string(),
            DatabaseKind::Mysql,
            ExplainPlanMode::Estimate,
            ExplainPlanFormat::Json,
            1.0,
            &json_result(raw),
        )
        .unwrap();

        assert_eq!(plan.root.node_type, "Query Block");
        assert_eq!(plan.root.total_cost, Some(4.2));
        assert_eq!(plan.root.children[0].relation.as_deref(), Some("users"));
        assert_eq!(plan.root.children[0].access_type.as_deref(), Some("ref"));
        assert_eq!(plan.estimated_rows, Some(2.0));
    }

    #[test]
    fn parses_mysql_analyze_tree_metrics() {
        let results = vec![QueryResult::rows(
            vec![ColumnDef {
                name: "EXPLAIN".to_string(),
                data_type: "text".to_string(),
            }],
            vec![vec![Value::String(
                "-> Nested loop inner join  (cost=4.50 rows=2) (actual time=0.100..0.500 rows=2 loops=1)\n    -> Table scan on users  (cost=1.20 rows=3) (actual time=0.050..0.100 rows=3 loops=1)".to_string(),
            )]],
        )];
        let plan = parse_explain_results(
            "plan-3".to_string(),
            DatabaseKind::Mysql,
            ExplainPlanMode::Analyze,
            ExplainPlanFormat::Text,
            1.0,
            &results,
        )
        .unwrap();

        assert_eq!(plan.root.node_type, "Nested loop inner join");
        assert_eq!(plan.root.total_cost, Some(4.5));
        assert_eq!(plan.root.actual_total_time_ms, Some(0.5));
        assert_eq!(plan.root.children[0].estimated_rows, Some(3.0));
        assert_eq!(plan.execution_time_ms, Some(0.5));
    }
}
