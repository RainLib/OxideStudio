import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory = path.resolve('.impeccable/review/dbx-runtime-comparison');
fs.writeFileSync(path.join(directory, 'resolve.mjs'), 'export const resolve=specifier=>import.meta.resolve(specifier);\n');
const { resolve } = await import(pathToFileURL(path.join(directory, 'resolve.mjs')).href);
const source = path.resolve('sources/dbx');
const result = await build({ entryPoints: ['scripts/sql-comparison/dbxEntry.mts'], outfile: path.join(directory, 'dbx.mjs'), bundle: true, format: 'esm', platform: 'node', nodePaths: [path.join(directory, 'node_modules')], mainFields: ['module', 'main'], alias: { '@': path.resolve('sources/dbx/apps/desktop/src'), '@dbx-app/mongo-shell': path.resolve('sources/dbx/packages/mongo-shell/src/index.ts') }, plugins: [{ name: 'isolated-locked-packages', setup(build) {
                build.onResolve({ filter: /^[^./\\]/ }, args => {
                    if (path.isAbsolute(args.path) || args.path.startsWith('node:') || args.path.startsWith('@/') || args.path.startsWith('@dbx-app/') || !(args.importer.startsWith(source) || args.importer.endsWith('dbxEntry.mts')))
                        return;
                    let file = fileURLToPath(resolve(args.path));
                    if (!fs.existsSync(file) && fs.existsSync(file + '.js'))
                        file += '.js';
                    return { path: file };
                });
            } }], treeShaking: true, metafile: true, logLevel: 'silent' });
fs.writeFileSync(path.join(directory, 'metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
console.log(JSON.stringify({ inputs: Object.keys(result.metafile.inputs).length, externals: result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports }));
