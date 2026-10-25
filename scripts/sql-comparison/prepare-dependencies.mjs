import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
assert.equal(execFileSync('git', ['-C', 'sources/dbx', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), 'b160d130560f71c5c429be15cec6147f677a4b3a', 'reference revision changed; review fixture compatibility before preparing dependencies');
assert.equal(execFileSync('git', ['-C', 'sources/dbx', 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'reference source must be unchanged');
const root = process.cwd();
const directory = path.join(root, '.impeccable/review/dbx-runtime-comparison');
fs.mkdirSync(directory, { recursive: true });
const lock = YAML.parse(fs.readFileSync('sources/dbx/pnpm-lock.yaml', 'utf8'));
const selected = ['@codemirror/lang-sql', '@codemirror/state', '@codemirror/language', '@codemirror/view', '@codemirror/autocomplete', '@lezer/highlight', 'pinyin-pro', 'dayjs', 'vue-i18n', 'clsx', 'tailwind-merge', 'vue', '@tauri-apps/api', 'pinia', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-fs', 'happy-dom'];
const refs = Object.fromEntries(selected.map(name => [name, (lock.importers['.'].dependencies[name] ?? lock.importers['.'].devDependencies[name]).version]));
const versionOf = ref => ref.split('(')[0];
const dependencies = Object.fromEntries(Object.entries(refs).map(([name, ref]) => [name, versionOf(ref)]));
const overrides = {};
const closure = {};
function visit(name, ref) { const key = name + '@' + ref; if (closure[key])
    return; const snapshot = lock.snapshots[key]; if (!snapshot)
    throw Error('missing snapshot ' + key); const edges = snapshot.dependencies ?? {}; const version = versionOf(ref); closure[key] = { name, version, integrity: lock.packages[name + '@' + version]?.resolution?.integrity, dependencies: edges }; if (Object.keys(edges).length)
    overrides[name + '@' + version] = Object.fromEntries(Object.entries(edges).map(([child, childRef]) => [child, versionOf(childRef)])); for (const [child, childRef] of Object.entries(edges))
    visit(child, childRef); }
for (const [name, ref] of Object.entries(refs))
    visit(name, ref);
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'oxide-dbx-comparison-local', private: true, type: 'module', dependencies, overrides }, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'dependency-plan.json'), JSON.stringify({ dbxLock: 'sources/dbx/pnpm-lock.yaml', closure }, null, 2) + '\n');
console.log(JSON.stringify({ directory, dependencies, packages: Object.keys(closure).length }));
