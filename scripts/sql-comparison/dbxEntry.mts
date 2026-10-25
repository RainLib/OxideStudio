// Isolated reference adapter, compiled by build-dbx.mjs with DBX lock-pinned dependencies.
import { buildSqlCompletionItemsFromContext, prepareSqlCompletionReplacement } from '../../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion';
import { sqlSemanticLocalColumnsByTable } from '../../sources/dbx/apps/desktop/src/lib/sql/semantic/completion';
import { buildSqlSemanticModel } from '../../sources/dbx/apps/desktop/src/lib/sql/semantic/model';
import { createDbxCodeMirrorSqlDialect } from '../../sources/dbx/apps/desktop/src/lib/editor/codemirrorSqlDialect';
import * as langSql from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { syntaxTreeAvailable } from '@codemirror/language';
import { insertCompletionText } from '@codemirror/autocomplete';
import { completionReplacementTo } from '../../sources/dbx/apps/desktop/src/lib/editor/batchColumnSelection';
import { appendSqlCompletionSpace } from '../../sources/dbx/apps/desktop/src/lib/editor/sqlCompletionInsertion';
import { analyzeSqlCompletion } from '../../sources/dbx/apps/desktop/src/lib/sql/sqlCompletionAnalysis';
import type { DatabaseType } from '../../sources/dbx/apps/desktop/src/types/database';
import type { SqlSemanticBuildOptions } from '../../sources/dbx/apps/desktop/src/lib/sql/semantic/types';
type MetadataTable = {
    name: string;
    columns: Array<{
        name: string;
        data_type: string;
        nullable: boolean;
        comment?: string | null;
    }>;
};
export function compareDbx(sql: string, cursor: number, profile: DatabaseType, tables: MetadataTable[], stateful = false) {
    const dialect = profile === 'postgres' ? 'postgres' : profile === 'sqlserver' ? 'sqlserver' : 'mysql';
    const options: SqlSemanticBuildOptions = { databaseType: profile, dialect };
    const state = stateful ? EditorState.create({ doc: sql, selection: { anchor: cursor }, extensions: [langSql.sql({ dialect: createDbxCodeMirrorSqlDialect(langSql, profile === 'clickhouse' ? 'clickhouse' : dialect, profile) })] }) : undefined;
    if (state)
        options.editorState = state;
    const model = buildSqlSemanticModel(sql, cursor, options);
    const analysis = analyzeSqlCompletion({ sql, cursor, databaseType: profile, dialect: options.dialect, semanticCompletionEnabled: true }, state);
    const context = analysis.completionContext;
    const columnsByTable = sqlSemanticLocalColumnsByTable(model);
    for (const t of tables)
        columnsByTable.set(t.name, t.columns.map(c => ({ name: c.name, table: t.name, dataType: c.data_type, isNullable: c.nullable, comment: c.comment })));
    const items = analysis.suppressed && !analysis.sequenceLiteralContext ? [] : buildSqlCompletionItemsFromContext(context, { tables: tables.map(t => ({ name: t.name })), objects: [], columnsByTable, autoAliasTables: false, keywordCase: 'upper', ...options });
    const prepared = prepareSqlCompletionReplacement(sql, cursor, context, items);
    return { items: prepared.items, context, model, stateful, suppressed: analysis.suppressed, syntaxAvailable: state ? syntaxTreeAvailable(state, cursor) : null, from: prepared.from, state: state ?? EditorState.create({ doc: sql, selection: { anchor: cursor } }) };
}
export function applyDbx(result: ReturnType<typeof compareDbx>, index: number) {
    const item = result.items[index];
    const state = result.state;
    const from = result.from, to = completionReplacementTo({ from, to: result.model.cursor, nextCharacter: state.sliceDoc(result.model.cursor, result.model.cursor + 1), replaceClosingQuote: item.replaceClosingQuote, replaceSelectWildcard: item.replaceSelectWildcard });
    const insert = appendSqlCompletionSpace(item.apply ?? item.label, { enabled: false, itemType: item.type, nextCharacter: state.sliceDoc(to, to + 1) });
    const next = state.update(insertCompletionText(state, insert, from, to)).state;
    return { text: next.doc.toString(), from, to, insert, caret: next.selection.main.head };
}
