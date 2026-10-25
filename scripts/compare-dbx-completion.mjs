// Runs the checked-out DBX algorithms against the bundled LSP with one fixture
// matrix. All third-party runtime inputs stay in the owned evidence directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
assert(args.every(a => a === '--install' || a === '--help'), 'supported options: --install, --help');
if (args.includes('--help')) {
    console.log('node scripts/compare-dbx-completion.mjs [--install]\nRequires sources/dbx at the recorded commit and an up-to-date bundled sql-lsp. --install prepares isolated lock-pinned dependencies; reference sources and root package files stay unchanged.');
    process.exit(0);
}
const directory = path.join(root, '.impeccable/review/dbx-runtime-comparison');
fs.mkdirSync(directory, { recursive: true });
async function run(command, parameters, cwd = root, shell = false) { const child = spawn(command, parameters, { cwd, shell, windowsHide: true, stdio: 'inherit' }); const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(exit, 0, command + ' failed'); }
await run(process.execPath, ['scripts/sql-comparison/prepare-dependencies.mjs']);
if (args.includes('--install'))
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], directory, process.platform === 'win32');
assert(fs.existsSync(path.join(directory, 'node_modules/@codemirror/lang-sql/package.json')), 'missing isolated dependencies; run with --install');
for (const step of ['fixtures', 'build-dbx', 'verify-dependencies', 'run', 'report'])
    await run(process.execPath, [`scripts/sql-comparison/${step}.mjs`]);
