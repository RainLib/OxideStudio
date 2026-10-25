import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compareDbx, applyDbx } from '../../.impeccable/review/dbx-runtime-comparison/dbx.mjs';
const directory = path.resolve('.impeccable/review/dbx-runtime-comparison'), root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(directory, 'fixtures.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync('src-tauri/binaries/sql-lsp.exe.manifest.json', 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(manifest.sha256, sha('src-tauri/binaries/sql-lsp.exe'));
assert.equal(execFileSync('git', ['-C', 'sources/dbx', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), 'b160d130560f71c5c429be15cec6147f677a4b3a');
const processLsp = spawn(path.resolve('src-tauri/binaries/sql-lsp.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = Buffer.alloc(0), sequence = 0, stderr = '';
const pending = new Map(), notifications = new Map(), noticeWaiters = new Map();
processLsp.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-10000); });
function send(method, params, id) { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, ...(params == null ? {} : { params }), ...(id === undefined ? {} : { id }) })); processLsp.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); processLsp.stdin.write(body); }
function request(method, params) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' deadline')); }, 10000); pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); }); send(method, params, id); }); }
processLsp.stdout.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); while (true) {
    const split = buffer.indexOf('\r\n\r\n');
    if (split < 0)
        return;
    const length = Number(/Content-Length:\s*(\d+)/iu.exec(buffer.subarray(0, split).toString())[1]);
    assert(length < 8 * 1024 * 1024);
    if (buffer.length < split + 4 + length)
        return;
    const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length));
    buffer = buffer.subarray(split + 4 + length);
    if (message.method && message.id !== undefined) {
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: null }));
        processLsp.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        processLsp.stdin.write(body);
    }
    else if (message.id !== undefined)
        pending.get(message.id)?.(message);
    else if (message.method === 'textDocument/publishDiagnostics') {
        notifications.set(message.params.uri, message.params);
        noticeWaiters.get(message.params.uri)?.(message.params);
    }
} });
function published(uri) { if (notifications.has(uri))
    return Promise.resolve(notifications.get(uri)); return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('diagnostic publication deadline')), 10000); noticeWaiters.set(uri, value => { clearTimeout(timer); noticeWaiters.delete(uri); resolve(value); }); }); }
const lspPosition = (sql, at) => { const lines = sql.slice(0, at).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; };
function offset(sql, pos) { let start = 0; for (let line = 0; line < pos.line; line++)
    start = sql.indexOf('\n', start) + 1; assert(start >= 0 && start + pos.character <= sql.length); return start + pos.character; }
function simple(item, engine) { return { label: item.label, name: item.data?.oxide?.column ?? item.label.split('.').at(-1).replaceAll('"', '').replaceAll('`', ''), filterText: item.filterText ?? null, kind: engine === 'dbx' ? item.type : item.kind === 5 ? 'column' : item.kind === 6 ? 'variable' : 'other', detail: item.detail ?? '', info: typeof item.info === 'string' ? item.info : typeof item.documentation === 'string' ? item.documentation : item.documentation?.value ?? '', insert: engine === 'dbx' ? item.apply : item.textEdit?.newText ?? item.insertText }; }
function judge(items, expected, engine) { const simplified = items.map(i => simple(i, engine)); const fields = simplified.filter(i => i.kind === 'column'); const wanted = simplified.filter(i => i.kind === (expected.kind ?? 'column') && (i.name === expected.field || i.label === expected.field)); const typePass = !expected.type || wanted.some(i => { const s = (i.detail + '\n' + i.info).toLowerCase(); const type = expected.type.toLowerCase(); return s.includes(type) || (type === 'boolean' && s.includes('bool')) || (type === 'bigint' && s.includes('int8')); }); const fieldPass = !expected.field || wanted.length > 0; const isolated = !(expected.forbidden ?? []).some(name => fields.some(i => i.name === name)); const noFields = !expected.noFields || fields.length === 0; const single = !expected.single || wanted.length === 1; return { pass: fieldPass && typePass && isolated && noFields && single, fieldPass, typePass, isolated, noFields, single, matching: wanted, fields }; }
const results = [];
let success = false;
let unexpectedFetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { unexpectedFetches++; throw Error('comparison must use preloaded metadata, no backend request'); };
try {
    await request('initialize', { capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } } });
    send('initialized', {});
    for (const [index, test] of data.cases.entries()) {
        assert.equal(test.marked.split('<cursor>').length, 2);
        const cursor = test.marked.indexOf('<cursor>'), sql = test.marked.replace('<cursor>', ''), uri = `oxide://dbx-comparison/${index}.sql`;
        const tables = structuredClone(data.tables);
        for (const t of tables)
            for (const c of t.columns)
                if (c.name === 'payload' && test.profile !== 'postgres')
                    c.data_type = 'json';
        const schema = { id: 'aaaaaaaa-1111-4111-8111-111111111111', database: 'app', tables, functions: [] };
        const metadataBefore = JSON.stringify(tables);
        send('workspace/didChangeConfiguration', { settings: { schemas: [schema], fileSchemas: { [uri]: schema.id }, fileDialects: { [uri]: test.profile } } });
        send('textDocument/didOpen', { textDocument: { uri, languageId: 'sql', version: 1, text: sql } });
        const publishedDiagnostic = await published(uri);
        const started = performance.now();
        const response = await request('textDocument/completion', { textDocument: { uri }, position: lspPosition(sql, cursor) });
        const oxideMilliseconds = performance.now() - started;
        const oxideItems = Array.isArray(response) ? response : response?.items ?? [];
        const oxide = judge(oxideItems, test.expected, 'oxide');
        const selected = oxideItems.find(i => simple(i, 'oxide').name === test.expected.field && i.kind === (test.expected.kind === 'variable' ? 6 : 5));
        let oxideEdit = null;
        if (selected?.textEdit?.range) {
            const edit = selected.textEdit;
            const from = offset(sql, edit.range.start), to = offset(sql, edit.range.end);
            oxideEdit = { text: sql.slice(0, from) + edit.newText + sql.slice(to), from, to, insert: edit.newText };
        }
        const dbx = [];
        for (const stateful of [false, true]) {
            const begin = performance.now();
            const runtime = compareDbx(sql, cursor, test.profile, tables, stateful);
            const milliseconds = performance.now() - begin;
            const comparison = judge(runtime.items, test.expected, 'dbx');
            const selectedIndex = runtime.items.findIndex(i => simple(i, 'dbx').name === test.expected.field && i.type === (test.expected.kind ?? 'column'));
            const edit = selectedIndex >= 0 ? applyDbx(runtime, selectedIndex) : null;
            assert.equal(JSON.stringify(tables), metadataBefore, 'DBX mutated fixture metadata');
            dbx.push({ mode: stateful ? 'codemirror-state' : 'string-helper', milliseconds, syntaxAvailable: runtime.syntaxAvailable, suppressed: runtime.suppressed, comparison, items: runtime.items, edit, context: runtime.context, rowSources: runtime.model.rowSources.map(r => ({ name: r.name, alias: r.alias, kind: r.kind, columns: r.columns, metadataTarget: r.metadataTarget })) });
        }
        if (test.category === 'control') {
            assert(oxide.pass, 'Oxide control failed ' + test.id);
            assert(dbx.every(d => d.comparison.pass), 'DBX control failed ' + test.id);
        }
        const word = (sql.slice(0, cursor).match(/[\p{L}\p{N}_@$#]*$/u)?.[0] ?? '') + (sql.slice(cursor).match(/^[\p{L}\p{N}_@$#]*/u)?.[0] ?? '');
        const editInvariant = test.expected.field && word === test.expected.field ? { expectedText: sql, oxidePreserved: oxideEdit?.text === sql, dbxPreserved: dbx.map(d => d.edit?.text === sql) } : null;
        results.push({ ...test, sql, cursor, metadataSha256: createHash('sha256').update(metadataBefore).digest('hex'), metadataUnmodified: true, utf16Position: lspPosition(sql, cursor), editInvariant, oxide: { comparison: oxide, items: oxideItems, edit: oxideEdit, milliseconds: oxideMilliseconds, diagnostics: publishedDiagnostic.diagnostics }, dbx });
    }
    await request('shutdown', null);
    send('exit', null);
    processLsp.stdin.end();
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server exit deadline')), 10000); processLsp.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('server exit ' + code)); }); });
    success = true;
}
finally {
    globalThis.fetch = originalFetch;
    if (processLsp.exitCode === null)
        processLsp.kill();
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ success, unexpectedFetches, scope: 'actual DBX source algorithms and headless CodeMirror state vs bundled Oxide stdio; no visible widget/DB engine/desktop equality claim', metadataScope: 'same preloaded synthetic physical metadata; real production analysis and suppression, unit-test metadata adapter, live editor-state option', settings: { autoAliasTables: false, insertSpaceAfterCompletion: false }, dbxReference: 'b160d130560f71c5c429be15cec6147f677a4b3a', oxideManifest: manifest, fixturesSha256: sha(path.join(directory, 'fixtures.json')), dbxBundleSha256: sha(path.join(directory, 'dbx.mjs')), controls: data.cases.filter(c => c.category === 'control').length, cases: results, stderr }, null, 2) + '\n');
}
const summary = { cases: results.length, controls: 6, oxidePass: results.filter(r => r.oxide.comparison.pass).length, dbxStringPass: results.filter(r => r.dbx[0].comparison.pass).length, dbxStatePass: results.filter(r => r.dbx[1].comparison.pass).length, oxideGaps: results.filter(r => !r.oxide.comparison.pass).map(r => r.id), dbxStateGaps: results.filter(r => !r.dbx[1].comparison.pass).map(r => r.id) };
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
