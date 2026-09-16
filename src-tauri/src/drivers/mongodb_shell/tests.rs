use super::*;

#[test]
fn parses_read_shell_find_chain_and_extended_json() {
    let value = parse_command(
        "db.products.find({_id: ObjectId('507f1f77bcf86cd799439011')}, {name: 1}).sort({name: 1}).skip(2).limit(5)",
    )
    .unwrap();
    assert_eq!(value["collection"], "products");
    assert_eq!(value["find"]["_id"]["$oid"], "507f1f77bcf86cd799439011");
    assert_eq!(value["projection"]["name"], 1);
    assert_eq!(value["sort"]["name"], 1);
    assert_eq!(value["skip"], 2);
    assert_eq!(value["limit"], 5);

    let literal =
        parse_command(r#"db.products.find({note: "ObjectId('not-a-constructor')"}) // read only"#)
            .unwrap();
    assert_eq!(literal["find"]["note"], "ObjectId('not-a-constructor')");

    let localized = parse_command(
        "db.products.find({name: 'Ada'}).collation({locale: 'en', strength: 1}).limit(10)",
    )
    .unwrap();
    assert_eq!(localized["collation"]["locale"], "en");

    let explained =
        parse_command("db.products.find({active: true}).sort({name: 1}).explain('executionStats')")
            .unwrap();
    assert_eq!(explained["command"]["explain"]["find"], "products");
    assert_eq!(explained["command"]["verbosity"], "executionStats");

    let hinted = parse_command(
        "db.products.find({active: true}, {name: 1}, {hint: {active: 1}, maxTimeMS: 500})",
    )
    .unwrap();
    assert_eq!(hinted["findOptions"]["hint"]["active"], 1);
    assert_eq!(hinted["findOptions"]["maxTimeMS"], 500);

    let aggregate = parse_command(
        "db.products.aggregate([{$match: {active: true}}], {allowDiskUse: true, maxTimeMS: 1000})",
    )
    .unwrap();
    assert_eq!(aggregate["aggregateOptions"]["allowDiskUse"], true);
    assert_eq!(aggregate["aggregateOptions"]["maxTimeMS"], 1000);
}

#[test]
fn parses_dotted_collection_and_read_helpers() {
    let value =
        parse_command("db.getCollection('audit.logs').distinct('tenant.id', {active: true})")
            .unwrap();
    assert_eq!(value["command"]["distinct"], "audit.logs");
    assert_eq!(value["command"]["key"], "tenant.id");
    assert_eq!(value["command"]["query"]["active"], true);

    let indexes = parse_command("db.users.getIndexes()").unwrap();
    assert_eq!(indexes["command"]["listIndexes"], "users");

    let databases = parse_command("show databases").unwrap();
    assert_eq!(databases["command"]["listDatabases"], 1);
    let version = parse_command("db.version()").unwrap();
    assert_eq!(version["command"]["buildInfo"], 1);
}

#[test]
fn parses_a_single_shell_use_database_statement() {
    let command = parse_command("use reporting").unwrap();
    assert_eq!(command["useDatabase"], "reporting");
    assert!(looks_like_shell_command("use reporting"));
    assert!(!looks_like_shell_command("useful"));
    assert!(parse_command("use reporting warehouse").is_err());
}

#[test]
fn keeps_shell_reads_bounded_and_structurally_marks_mutating_aggregation() {
    let find = parse_command("db.users.find({active: true})").unwrap();
    assert_eq!(find["limit"], DEFAULT_FIND_LIMIT);
    assert!(parse_command("db.users.find({}).limit(0)").is_err());
    assert!(parse_command("db.users.find({}).limit(10001)").is_err());
    let aggregate = parse_command("db.users.aggregate([{$out: 'backup'}])").unwrap();
    assert_eq!(aggregate["collection"], "users");
    assert_eq!(aggregate["aggregate"][0]["$out"], "backup");
}

#[test]
fn splits_multiple_shell_reads_without_splitting_literals() {
    let commands =
        parse_commands("db.users.find({note: 'a;b'}).limit(5); db.orders.count({active: true});")
            .unwrap();
    assert_eq!(commands.len(), 2);
    assert_eq!(commands[0]["find"]["note"], "a;b");
    assert_eq!(commands[1]["collection"], "orders");
}

#[test]
fn lowers_shell_mutations_to_explicit_native_commands() {
    let insert =
        parse_command("db.users.insertMany([{name: 'Ada'}, {name: 'Grace'}], {ordered: false})")
            .unwrap();
    assert_eq!(insert["command"]["insert"], "users");
    assert_eq!(insert["command"]["documents"].as_array().unwrap().len(), 2);
    assert_eq!(insert["command"]["ordered"], false);

    let update = parse_command(
        "db.users.updateMany({active: false}, [{$set: {active: true}}], {upsert: true, comment: 'repair'})",
    )
    .unwrap();
    assert_eq!(update["command"]["update"], "users");
    assert_eq!(update["command"]["updates"][0]["multi"], true);
    assert_eq!(update["command"]["updates"][0]["upsert"], true);
    assert_eq!(update["command"]["comment"], "repair");

    let delete = parse_command(
        "db.users.deleteOne({_id: ObjectId('507f1f77bcf86cd799439011')}, {hint: {_id: 1}})",
    )
    .unwrap();
    assert_eq!(delete["command"]["delete"], "users");
    assert_eq!(delete["command"]["deletes"][0]["limit"], 1);
    assert_eq!(delete["command"]["deletes"][0]["hint"]["_id"], 1);

    let legacy =
        parse_command("db.users.update({active: false}, {$set: {active: true}}, {multi: true})")
            .unwrap();
    assert_eq!(legacy["command"]["updates"][0]["multi"], true);
}

#[test]
fn rejects_unknown_mutation_options_and_malformed_payloads() {
    assert!(parse_command("db.users.insertMany([])").is_err());
    assert!(parse_command("db.users.updateOne({}, {}, {unknown: true})").is_err());
    assert!(parse_command("db.users.deleteOne({}, {unknown: true})").is_err());
    assert!(parse_command("db.users.createIndex('name')").is_err());
}

#[test]
fn maps_atomic_mutations_and_extended_shell_constructors() {
    let command = parse_command(
        "db.events.findOneAndUpdate({_id: ObjectId('507f1f77bcf86cd799439011')}, {$set: {count: NumberLong('9223372036854775807'), ratio: NumberDecimal('1.25'), stamp: Timestamp(42, 7), raw: BinData(4, 'AQID')}}, {projection: {count: 1}, returnDocument: 'after'})",
    )
    .unwrap();
    assert_eq!(command["command"]["findAndModify"], "events");
    assert_eq!(command["command"]["new"], true);
    assert_eq!(command["command"]["fields"]["count"], 1);
    assert_eq!(
        command["command"]["update"]["$set"]["count"]["$numberLong"],
        "9223372036854775807"
    );
    assert_eq!(
        command["command"]["update"]["$set"]["ratio"]["$numberDecimal"],
        "1.25"
    );
    assert_eq!(
        command["command"]["update"]["$set"]["stamp"]["$timestamp"]["t"],
        42
    );
    assert_eq!(
        command["command"]["update"]["$set"]["raw"]["$binary"]["subType"],
        "04"
    );
}
