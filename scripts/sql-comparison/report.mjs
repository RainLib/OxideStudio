import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory = path.resolve('.impeccable/review/dbx-runtime-comparison');
const batch = process.env.OXIDE_EVIDENCE_BATCH === undefined ? undefined : Number(process.env.OXIDE_EVIDENCE_BATCH);
assert(batch === undefined || Number.isSafeInteger(batch) && batch > 0, 'invalid evidence batch');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const r = read('results.json'), d = read('dependency-evidence.json'), fixtures = read('fixtures.json');
assert.equal(r.success, true);
assert.equal(r.cases.length, 53);
assert.equal(r.unexpectedFetches, 0);
assert.equal(r.fixturesSha256, sha(path.join(directory, 'fixtures.json')));
assert.equal(r.dbxBundleSha256, sha(path.join(directory, 'dbx.mjs')));
assert.equal(r.oxideManifest.sha256, sha('src-tauri/binaries/sql-lsp.exe'));
assert.equal(execFileSync('git', ['-C', 'sources/dbx', 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
for (const [file, hash] of Object.entries(d.sourceInputHashes))
    assert.equal(sha(file), hash, file);
for (const c of r.cases) {
    assert(c.metadataUnmodified);
    assert(c.dbx[1].syntaxAvailable);
    if (c.category === 'control')
        assert(c.oxide.comparison.pass && c.dbx.every(m => m.comparison.pass));
}
function stats(which) { const judge = c => which === 'oxide' ? c.oxide.comparison : c.dbx[1].comparison; const positive = r.cases.filter(c => c.expected.field), typed = r.cases.filter(c => c.expected.type), negative = r.cases.filter(c => c.expected.forbidden || c.expected.noFields); return { fields: [positive.filter(c => judge(c).fieldPass).length, positive.length], types: [typed.filter(c => judge(c).typePass).length, typed.length], isolation: [negative.filter(c => judge(c).isolated && judge(c).noFields).length, negative.length] }; }
function describe(c, engine) { const a = engine === 'oxide' ? c.oxide.comparison : c.dbx[1].comparison; if (!a.fieldPass)
    return '缺候选'; if (!a.typePass)
    return '候选有，未给预期类型'; if (!a.isolated || !a.noFields)
    return '来源/抑制不符'; if (!a.single)
    return '合并键重复'; return '符合本夹具'; }
const gapIds = r.cases.filter(c => !c.oxide.comparison.pass).map(c => c.id);
assert.deepEqual(gapIds, []);
const qualify = r.cases.find(c => c.id === 'clickhouse-qualify');
assert(qualify.oxide.items.some(item => item.label === 'rn' && item.detail?.includes('(UInt64)')), 'QUALIFY must retain its vendor-specific window result type');
const hive = r.cases.find(c => c.id === 'hive-lateral-view');
assert(hive.oxide.items.some(item => item.label === 'item' && item.detail?.includes('(text)')), 'Hive view must propagate the element type from the original text[] metadata fixture');
const matrix = r.cases.map(c => `| ${c.id} | ${c.profile} | ${describe(c, 'oxide')} | ${describe(c, 'dbx')} |`).join('\n');
const oxide = stats('oxide'), dbx = stats('dbx');
const report = `# DBX 与 Oxide SQL 推荐：同夹具算法运行对比

日期：2026-10-24。DBX 固定源码 \`${r.dbxReference}\`，Oxide 捆绑 release \`${r.oxideManifest.sha256}\`。本轮未 fetch；它们是被测版本，不能据此宣称仓库已更新至远端最新。

本轮实际运行 **53 组 SQL / schema / UTF-16 光标夹具**。每组调用当前 Oxide stdio LSP，以及 DBX 的字符串入口、真实 CodeMirror EditorState 入口，共 159 次推荐计算。六个基本字段控制在三条路径均符合预期；53 组 state 路径均具备光标处语法树。夹具按此前复杂语义工作和已知待查场景定向选取，计数只适用于这份数据，不能外推整体产品能力或全方言覆盖率。

| 检查维度 | Oxide | DBX EditorState 入口 |
| --- | --- | --- |
| 正向字段/变量候选存在 | ${oxide.fields.join('/')} | ${dbx.fields.join('/')} |
| 候选附带预期类型 | ${oxide.types.join('/')} | ${dbx.types.join('/')} |
| 独立来源隔离、字符串/注释抑制 | ${oxide.isolation.join('/')} | ${dbx.isolation.join('/')} |

## 已修复与仍需补齐的内容

第 42 批补齐 ClickHouse QUALIFY；第 43 批补齐 Hive LATERAL VIEW；第 44 批补齐拼音首字母和列注释搜索。53 份 SQL、schema、光标及原始断言不变，原矩阵四处缺口均已恢复；原类型维度仍有 44 项，另核对 QUALIFY / Hive 的独立类型断言。第 43 批证据保存在 lsp-metadata-search-baseline-43 目录。矩阵全通过不代表所有 SQL、厂商版本、搜索设置或可见弹窗均已对齐。

| 场景 | 复现 SQL，标记光标位置 | 实测结果 | 仍需扩大范围 |
| --- | --- | --- | --- |
| 拼音 | \`SELECT zj<cursor> FROM ledger\`，列名“租金总额” | 两条被测入口均有该字段，Oxide 保留 decimal | 多音词组、更多字典/排序偏好与可见推荐 |
| 注释 | \`SELECT rev<cursor> FROM ledger\`，amount 注释含 Revenue | 两条被测入口均有 amount，Oxide 保留 decimal | 长注释预算、大 catalog 连续编辑与厂商元数据 |

## 其他观察

DBX 的很多 CTE/递归/变量场景能给出名称，但本次构造出的候选未携带预期类型。这与该源码入口对查询局部列设置 dataType 为 undefined 的路径一致；本报告把“名称存在”和“类型可用”分开记录。JSON_TABLE、OPENJSON、分组别名等另有候选缺失；来源隔离反例也有差异，逐项见后表。它们仍受本次预加载物理元数据和所选调用路径约束。

对中间光标位置还运行了 DBX 的 prepareSqlCompletionReplacement、completionReplacementTo、insertCompletionText，在无 DOM 的真实 EditorState 上派发事务；有 \`q.am<cursor>ount\` 变成 \`q.amountount\` 的结果。完整可见弹窗的 from/to 传递、过滤及交互仍需单独验收，不能将此观察直接当作整款 DBX 编辑器结论。Oxide 的相应 textEdit 覆盖完整标识符；两个引号样例会去掉 ASCII 列名的可选引号，属于不同的文本结果，未计作类型/候选失败。

## 方法与范围

DBX 使用未修改的 analyzeSqlCompletion、生产抑制条件、语义模型、候选构造和编辑帮助函数；开启与源码相同的 semanticCompletionEnabled，并用 createDbxCodeMirrorSqlDialect 构建真实语言扩展。物理表、类型、空值、注释来自同一份合成数据，沿用参考仓库语义测试的查询局部列映射方式；没有伪造解析器、替换源模块或调用后端取数。元数据在计算后保持不变。autoAliasTables、接受后自动空格关闭，测试为显式推荐请求。

这是推荐算法及无 DOM EditorState 运行；远端元数据异步加载/缓存、自动触发菜单、候选排除设置、批量选择、可见弹窗、完整 Vue/React Workbench、安装包和数据库执行均未覆盖。原始耗时包含 DBX 进程内调用与 Oxide IPC 两种口径，未做横向性能比较。本脚本不运行 Cargo 或桌面测试；第 52 批以配置事务和诊断版本隔离后的捆绑二进制复测；其单元/原生协议验收独立记录在 [累计审计报告](lsp-complex-semantics-audit-2026-10-23.md#第五十二批配置事务与诊断快照的一致性)。

依赖位于独立证据目录，依据 DBX pnpm 锁文件精确约束版本。npm 的 peer 自动解析曾发生冲突，关闭 peer 自动解析后核对了实际打包的 **${d.packages.length} 包、${d.verifiedDependencyEdges} 条依赖边、${Object.keys(d.sourceInputHashes).length} 份输入摘要**，版本、路径及完整性摘要均与参考锁对应；不从当前项目的其他 node_modules 回落取包。源码工作区保持干净，install scripts 未执行。

复跑：首次使用 \`node scripts/compare-dbx-completion.mjs --install\`，已有隔离依赖时使用 \`node scripts/compare-dbx-completion.mjs\`。需要当前项目 Node 依赖、固定 sources/dbx 和已验证的捆绑 LSP。生成证据位于 \`.impeccable/review/dbx-runtime-comparison/\`，包括 fixtures.json、results.json、summary.json、dependency-evidence.json、metafile.json、package-lock.json。结果保留全部候选、上下文、编辑事务、诊断、各条件布尔值及两个项目摘要。首次协议关闭参数错误和补充生产抑制前的试验结果单独保留。

## 完整矩阵

| 夹具 | 方言 | Oxide | DBX EditorState 入口 |
| --- | --- | --- | --- |
${matrix}

第 64 批用配置生效确认修复后的捆绑 LSP 完成上述原夹具复测；新事务/文档快照与诊断隔离证明另见专项单元与桌面验收，未加入此固定 53 项矩阵。原矩阵缺口已消除；更多 SQL/搜索设置、完整 UI/厂商引擎等范围仍待补齐；G01–G13、E01–E07 全目标保持进行中，未提交、推送或发布。
`;
fs.writeFileSync('docs/dbx-sql-completion-comparison-2026-10-24.md', report.replaceAll('\\`', '`'));
const evidence = { ...(batch === undefined ? {} : {batch}), date: '2026-10-24', status: 'progress', goalComplete: false, scope: 'same-fixture algorithms and headless EditorState using the current pinned reference and bundled LSP', cases: r.cases.length, controls: 6, dbxModes: 2, codeMirrorSyntaxAvailable: 53, oxide, dbx, oxideGapIds: gapIds, qualifyWindowType: 'UInt64', hiveFixtureElementType: 'text', dbxReference: r.dbxReference, oxideManifest: r.oxideManifest, dbxBundleSha256: r.dbxBundleSha256, fixturesSha256: r.fixturesSha256, dependencyPackages: d.packages.length, verifiedDependencyEdges: d.verifiedDependencyEdges, sourceInputs: Object.keys(d.sourceInputHashes).length, dbxSameFixtureAlgorithmCompared: true, dbxFullDesktopCompared: false, newEngineExecutionVerified: false, rustTestsExecutedByThisScript: false };
fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
