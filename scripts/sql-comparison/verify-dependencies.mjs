import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd(), directory = path.resolve('.impeccable/review/dbx-runtime-comparison'), moduleRoot = path.join(directory, 'node_modules');
const plan = JSON.parse(fs.readFileSync(path.join(directory, 'dependency-plan.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(directory, 'metafile.json'), 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries = new Map(Object.values(plan.closure).map(p => [p.name + '@' + p.version, p]));
const packages = new Map(), inputs = {};
let edges = 0;
function owner(file) { let parent = path.dirname(file); while (parent.startsWith(moduleRoot)) {
    const manifest = path.join(parent, 'package.json');
    if (fs.existsSync(manifest)) {
        const p = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (p.name)
            return { directory: parent, ...p };
    }
    parent = path.dirname(parent);
} }
for (const [file, input] of Object.entries(meta.inputs)) {
    const absolute = path.resolve(file);
    inputs[file] = sha(absolute);
    if (!file.includes('node_modules'))
        continue;
    assert(absolute.startsWith(moduleRoot + path.sep), 'non-isolated runtime dependency ' + file);
    const p = owner(absolute);
    assert(p, 'missing package owner ' + file);
    const expected = entries.get(p.name + '@' + p.version);
    assert(expected, 'package version absent from DBX lock ' + p.name + '@' + p.version);
    const relative = path.relative(directory, p.directory).replaceAll('\\', '/');
    const installed = lock.packages[relative];
    assert(installed);
    assert.equal(installed.integrity, expected.integrity, p.name);
    packages.set(relative, { name: p.name, version: p.version, integrity: installed.integrity });
    for (const edge of input.imports) {
        if (edge.external || edge.path.startsWith('node:'))
            continue;
        const other = owner(path.resolve(edge.path));
        if (!other || other.name === p.name)
            continue;
        const ref = expected.dependencies[other.name];
        assert(ref, 'unplanned dependency ' + p.name + ' -> ' + other.name);
        assert.equal(other.version, ref.split('(')[0], p.name + ' -> ' + other.name);
        edges++;
    }
}
assert(Object.keys(meta.outputs).every(key => meta.outputs[key].imports.every(i => !i.external || i.path.startsWith('node:'))));
const result = { runtimeDependencyFiles: Object.keys(inputs).filter(p => p.includes('node_modules')).length, packages: [...packages.values()], verifiedDependencyEdges: edges, sourceInputHashes: inputs, dbxHead: 'b160d130560f71c5c429be15cec6147f677a4b3a', packageManager: 'npm with source-lock exact edge overrides; peer auto-resolution disabled', nativeModulesStubbed: false, sourceModulesReplaced: false };
fs.writeFileSync(path.join(directory, 'dependency-evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ packages: packages.size, verifiedEdges: edges, inputs: Object.keys(inputs).length }));
