const fail = message => { throw new Error(message); };
const validName = value => typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const validContext = context => context && validName(context.database) && validName(context.defaultSchema);

export function validateSqlLookupFixture(fixture) {
  if (!fixture) return;
  if (!validContext(fixture.current)) fail("SQL lookup fixture requires an explicit current database and default schema");
  if (!Array.isArray(fixture.databases) || fixture.databases.length < 1 || fixture.databases.length > 8) fail("SQL lookup fixture requires 1 to 8 scoped database contexts");
  const names = new Set([fixture.current.database]);
  for (const item of fixture.databases) {
    if (!validContext(item) || names.has(item.database)) fail("SQL lookup fixture requires distinct, explicitly named databases");
    names.add(item.database);
  }
  const query = fixture.currentQuery;
  if (typeof query?.statement !== "string" || !query.statement.trim() || query.context?.database != null || query.context?.schema != null || query.context?.readOnly !== true) fail("SQL lookup restoration query must observe the current context without selecting a database or schema");
  if (JSON.stringify(query.expect?.firstRow) !== JSON.stringify([fixture.current.database, fixture.current.defaultSchema])) fail("SQL lookup restoration query requires the exact current database/default-schema row");
}

export const SQL_LOOKUP_CHECKS = Object.freeze(["sqlLookupCurrent", "sqlLookupScoped", "sqlLookupRestored", "sqlLookupQueryRestored"]);

/** Metadata and an independent query must both observe the original session
 * after each scoped lookup. Results stay inside the runner, never the report. */
export async function verifySqlLookupContext({fixture, metadata, query}) {
  const expectContext = (actual, expected) => {
    if (!validContext(actual) || actual.database !== expected.database || actual.defaultSchema !== expected.defaultSchema) fail("SQL lookup context did not match the fixture scope/default schema");
  };
  expectContext(await metadata(null), fixture.current);
  await query(fixture.currentQuery);
  for (const scoped of fixture.databases) {
    expectContext(await metadata(scoped.database), scoped);
    expectContext(await metadata(null), fixture.current);
    await query(fixture.currentQuery);
  }
}
