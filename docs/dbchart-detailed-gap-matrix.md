# OxideStudio 与 ChartDB 最新主干差距矩阵

> 对照日期：2026-08-10
> 官方仓库：`https://github.com/chartdb/chartdb`
> 本地只读基线：`sources/dbchart`
> ChartDB 分支/提交：`main` / `c24936a402bb3e24b4858f05282d69a04fcfe25b`
> 基线版本：`v1.20.1-1-gc24936a`
> 最新提交：`feat: add move-to-area and auto-arrange-area context menu options (#1120)`

本文中的 ChartDB 路径均相对 `sources/dbchart/`。对齐指用户能力、边界和体验对齐，不要求复制其前端架构。ChartDB 没有 SQL LSP；SQL 语义、提示和代码片段继续以 `sources/dbx` 的 DBX 实现作为直接参考，ChartDB 主要用于数据库结构导入、跨方言生成、图形编辑和画布体验对照。

## 结论

- OxideStudio 的数据库产品目录、真实连接、SQL LSP、表数据流式导出和迁移执行安全边界已超过 ChartDB。
- ChartDB 的优势集中在可编辑 ER 图、DBML 即时编译/差异预览、结构导入导出、跨方言转换告警、画布历史和区域组织。
- SQL 智能提示的协议、snippet、函数参数、JOIN/外键推导和主要作用域 fallback 已补齐；事务、query/explain execution、文件 workflow、LSP document lifecycle、稳定协议 provider 与 metadata hover coordinator 已从 `QueryEditor.tsx` 移出，剩余重点是迁出 completion 与 view lifecycle。
- 迁移侧最大的可迁移逻辑是“确定性类型映射 + 不支持特性清单”，而不是 ChartDB 的 AI 生成兜底。Oxide 的可执行迁移必须继续受 capability、预检、确认摘要和 journal 约束。

## 1. SQL Editor、LSP 与智能提示

| ID | 状态 | 差距/能力 | ChartDB / DBX 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| L01 | 已对齐并增强 | 编辑器内容与语义引擎持续同步 | ChartDB `src/components/code-snippet/dbml/dbml-completion-provider.ts:34` 创建长生命周期 `Compiler`；`src/pages/editor-page/side-panel/dbml-section/table-dbml/table-dbml.tsx:101` 持续更新 source | `useLspDocumentLifecycle.ts` 与 `lspDocumentSync.ts` 维护 didOpen/didChange FIFO、已确认 text/version shadow、session owner 与关闭清理；tab/连接/session 改变后迟到的 didOpen 会被丢弃并主动 didClose，补全前仍强制同步当前版本 |
| L02 | 本阶段增强 | LSP CompletionItem 协议字段曾被裁剪，可能导致导入文本、提交字符和弃用状态丢失 | ChartDB DBML provider 直接复用 Monaco completion contract；DBX `apps/desktop/src/lib/editor/sqlCompletionPresentation.ts` | `src-tauri/src/commands/lsp.rs` 与 `src/features/query-editor/model/lspCompletionPresentation.ts` 已补 `InsertReplaceEdit`、`additionalTextEdits`、`commitCharacters`、deprecated tag 和 Markdown 文档适配 |
| L03 | 本阶段增强 | 常用 SQL 代码块数量不足，触发词展示和精确匹配排序不够稳定 | DBX `apps/desktop/src/lib/sql/sqlSnippetTemplates.ts:11`、`apps/desktop/src/lib/sql/sqlCompletion.ts:4041` | `src/features/query-editor/model/sqlCommandSnippets.ts` 已补 `join/case/exists/not exists/transaction/explain`，精确 trigger 优先，支持方言分页/ALTER/事务、keyword case 与 Manticore `MATCH/FACET/SHOW/CALL PQ` 专属模板；设置页可自定义/启停/恢复默认 |
| L04 | 本阶段增强 | 用户可新增、修改、禁用并同步 SQL snippet | DBX `apps/desktop/src/stores/settingsStore.ts:832`、`apps/desktop/src/components/config/EditorSettingsDialog.vue`、`docs/content/docs/sql-snippets.cn.mdx` | `src/lib/appSettings.ts` 与 `SettingsDialog.tsx` 已增加 snippet schema、设置 UI、唯一 id/prefix 校验、启停/删除/恢复默认、本地持久化及版本化 JSON 导入导出；仍缺可选云同步 |
| L05 | 本阶段增强 | 函数/存储过程候选应带参数占位符和签名帮助 | DBX `apps/desktop/src/lib/sql/sqlCompletion.ts:3011`、`:4122`，`apps/desktop/src/lib/editor/sqlSignatureTooltip.ts` | `sqlCompletionInsertion.ts` 已在 server 仅返回裸函数名但 detail 含签名时生成 Monaco 参数占位符；已有 snippet/textEdit 与光标后已有 `(` 时保持 server/用户文本优先；同名不同 signature 的 overload 不再被 fallback merge 去重，会作为独立候选主动展示 |
| L06 | 本阶段增强 | 基于 FK、别名、CTE 和子查询作用域生成 JOIN/字段候选 | DBX `apps/desktop/src/lib/sql/semantic/completion.ts`、`apps/desktop/src/lib/sql/semantic/model.ts:308-427`、`apps/desktop/src/lib/sql/sqlCompletion.ts:2909` | `sqlJoinCompletion.ts` 已按外键生成完整 `JOIN … ON …`；缓存 fallback 识别 correlated outer alias、derived subquery、LATERAL/APPLY 与显式 table-function output columns。Bundled LSP 的 local relation overlay 现原生覆盖 CTE/derived/table-function/correlation scope、`WITH ORDINALITY`、partial positional rename、JOIN 后逗号 source、LATERAL/APPLY 派生表与函数；相关子查询只按需解析被限定的外层 alias，未限定列不泄漏。前端传入的 `catalog` 现由 Rust Schema 保留，三/四段限定、SQL Server `database..table` 和跨 catalog 同名表按 catalog + schema + table 消歧；table hint 和真实 `lateral` 表名不会误判。单一 SQL-noise 缓冲区和 512 KiB 上限约束按键路径 |
| L07 | 本阶段增强 | 补全触发与排序应避免“空列表、重复候选、过期响应覆盖新输入” | ChartDB trigger 字符位于 `src/components/code-snippet/dbml/dbml-completion-provider.ts:19`；DBX `lib/sql/sqlCompletionTriggerPolicy.ts`、`lib/common/pinyin.ts`、`lib/common/completionMatch.ts` | Oxide 已有请求 generation、model version、cancellation 检查和 overload-aware 去重；现在提供智能位置/名称前缀/仅手动三种触发模式，LSP 请求前门控；live LSP 与缓存候选合并，Unicode、拼音首字母、camel/fuzzy 排序覆盖对象/列/FK JOIN；`sqlCompletionTelemetry.ts` 只记录无内容的触发/延迟/结果原因 |
| L08 | 本阶段增强 | SQL/DBML 编辑差异预览的细粒度防抖与可撤销应用 | ChartDB `src/pages/editor-page/side-panel/dbml-section/table-dbml/table-dbml.tsx:265` 使用 debounce，`:284` 应用，`:306` 撤销 | Diagram 的 DBML Draft 对当前 snapshot 生成文本，250ms 防抖解析 relation/warning，确认后只调用 snapshot compare 打开只读 diff；offline plan 同时禁用 Apply 和 Open in console。textarea 原生 undo 可用；仍缺逐项接受和结构化 schema CRUD history |
| L09 | 本阶段增强 | `QueryEditor.tsx` 仍承载过多 provider 和视图生命周期 | DBX 将 semantic、presentation、insertion、execution target、keymap 分文件；ChartDB 将 completion manager 单独封装 | completion 已分层，事务、执行和文件 workflow 已有独立 controller；LSP virtual-document lifecycle 独立管理 owner/version/text/FIFO/session。稳定协议 providers 由 `useLspCoreProviderCoordinator` 统一拥有；metadata + LSP hover 现由 `useLspHoverProviderCoordinator` 注册一次并通过 runtime ref 读取最新连接/schema，metadata revision、连接 owner 或 model version 变化后丢弃迟到结果。rename prepare/apply 均校验当前 document owner。六阶段累计从 `QueryEditor.tsx` 移出约 1,126 行。仍需迁出 completion 与剩余 view lifecycle |

## 2. 数据库结构、导入与迁移

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| M01 | Oxide 增强项 | ChartDB 只定义 Generic + 8 个数据库产品 | `src/lib/domain/database-type.ts:1`，capability 在 `src/lib/domain/database-capabilities.ts:11` | Oxide `src/features/database-drivers/model/referenceDriverCatalog.ts` 有 70+ 候选并区分安装/运行/能力；真实可用性仍以签名包和 conformance 证据为准 |
| M02 | 已对齐并增强 | 一条可复制的 metadata query 将数据库结构转成统一 JSON | `src/lib/data/import-metadata/scripts/scripts.ts:22` 到 `:30` 覆盖 PostgreSQL/MySQL/SQLite/SQL Server/MariaDB/ClickHouse/CockroachDB/Oracle；schema 位于 `metadata-types/database-metadata.ts` | `chartDbMetadataQueries.ts` 为同一 8 类数据库及兼容驱动生成 target-scoped、read-only、单 JSON cell 查询；Snapshot 对话框可一键复制。`chartDbMetadataImport.ts` 严格导入 wrapper，限制 16 MiB，并保持 review-only/Apply 禁用 |
| M03 | 部分对齐 | SQL DDL 离线导入和方言自动识别 | `src/lib/data/sql-import/index.ts:121` 检测方言，`:178` 导入，dialect importers 位于同目录 | Oxide 有 SQL 文件审阅/执行和 project DDL snapshot；缺少完整 DDL → editable schema snapshot 的多方言解析面 |
| M04 | 本阶段增强 | DBML 导入、导出、校验和 apply diff | `src/lib/dbml/dbml-import/`、`src/lib/dbml/dbml-export/`、`src/lib/dbml/apply-dbml/` | `schemaDbml.ts` 导出 review-only DBML；`schemaDbmlImport.ts` 有界解析 table/column/default/index/复合 FK、校验 schema/重复/缺失引用、保留 source warning，并从 Snapshot 对话框保存为离线 baseline 后进入 live diff。DBML 和项目 DDL 均强制禁用 Apply；仍缺 ChartDB 全语法编译器与编辑器内即时 diff |
| M05 | 本阶段增强 | 确定性跨方言 DDL 转换 | `src/lib/data/sql-export/cross-dialect/index.ts:33` 目前仅 PostgreSQL → MySQL/MariaDB/SQL Server；类型表在 `postgresql/type-mappings.ts` | `src-tauri/src/core/schema_diff.rs` 已为 PostgreSQL → MySQL/SQL Server 的特殊类型生成确定性 review notes，同时坚持不生成/执行跨库 DDL；下一步把覆盖扩展为 capability 驱动的完整映射计划 |
| M06 | 本阶段增强 | 转换前枚举不支持特性并把告警写入产物 | `src/lib/data/sql-export/cross-dialect/unsupported-features.ts:36` 检测 array/custom type/default/index 等 | `SchemaConversionIssue` 已结构化记录 relation/column、source/target type、safe/review/unsupported、原因、remediation 和 `blocksAutomaticConversion`，迁移视图明确显示 `blocks DDL`；覆盖 array、JSONB、timezone、network、interval、serial、PostgreSQL cast/sequence default、partial/expression/specialized index 与显式 custom type |
| M07 | Oxide 增强项 | 可执行迁移预检、确认、事务/非事务边界和 journal | ChartDB `src/lib/data/sql-export/export-sql-script.ts:154` 主要生成 SQL，不负责安全执行 | Oxide `src-tauri/src/commands/schema_diff.rs:493` 执行，`src-tauri/src/core/schema_diff.rs` 规划；PostgreSQL 事务、MySQL 显式非事务、SQLite rebuild、rollback artifact/journal 已存在 |
| M08 | 未完成 | 70+ 产品的 migration capability 仍缺逐产品语义实现 | ChartDB 不覆盖此规模 | 外置 driver 只有声明 `semantic DDL/migration` 协议并通过真实 conformance 后才可执行；否则保持 review-only，不借用相似方言猜测 |

## 3. 表数据与结果网格导入导出

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| E01 | Oxide 增强项 | 大表导出任务、进度、取消、原子产物和审计 | ChartDB 的 export 主要面向 schema/diagram，不提供 live table streaming | `src-tauri/src/commands/table.rs:5754` 已流式导出 CSV/JSON/JSONL/TSV/SQL，支持 progress/cancel/report；前端表工具栏统一为一个 Export 菜单，WebView 不物化整表 |
| E02 | 本阶段增强 | 查询结果导出格式和入口不完整 | ChartDB diagram JSON 在 `src/hooks/use-export-diagram.tsx`，SQL 在 `src/dialogs/export-sql-dialog/export-sql-dialog.tsx` | `src/lib/exportUtils.ts` 与 `DataGrid.tsx` 已增加 CSV、CSV BOM、JSON、JSONL、TSV、SQL INSERT template，统一下载并释放 Blob URL |
| E03 | 已对齐并增强 | XLSX 导出 | ChartDB 不提供表数据 XLSX | `src-tauri/src/commands/table.rs` 逐页读取并直接流式写 XLSX ZIP/XML，冻结表头、启用筛选、保留 boolean/number/text，超过 15 位整数按文本保护精度；复用 progress/cancel/audit/atomic finalize，WebView 不物化整表 |
| E04 | 未对齐 | Parquet/Arrow 等分析格式 | ChartDB 不提供 | DuckDB/分析型驱动可优先支持 Parquet；通用表导出需 capability gate，避免所有 driver 强制实现同一二进制格式 |
| E05 | 部分对齐 | SQL INSERT 导出应方言感知并可配置 batch/upsert | ChartDB schema SQL exporters 位于 `src/lib/data/sql-export/export-per-type/` | 表导出后端已有精确表名；仍需按 driver 处理 binary/date/JSON/identity、batch size、insert/upsert/copy strategy。查询结果使用明确的 `target_table` 占位符，避免猜错来源表 |

## 4. Diagram、整体体验与性能

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| U01 | 本阶段增强 | 图中直接创建/编辑 table、field、index、constraint、relationship、note | `src/context/chartdb-context/chartdb-provider.tsx` 各 mutation + history action；节点 UI 在 `src/pages/editor-page/canvas/` | Diagram 新增按需加载的 Structured Draft，可增删/重命名 relation，增删改 column/comment/default，增删 index/FK/CHECK，并传播 relation/column rename 引用。它不修改 captured snapshot，只生成 review-only diff；仍缺 note、drag-to-create relationship 与 draft 项目持久化 |
| U02 | 本阶段增强（最新更新） | 多选表移动到 Area、Area 内自动排列 | 最新提交修改 `src/pages/editor-page/canvas/table-node/table-node-context-menu.tsx:188`、`area-node-context-menu.tsx:39`、`src/lib/utils/area-utils.ts` | `schemaDiagramAreas.ts` 与 Diagram 工具条已支持 Ctrl/Cmd/Shift 多选、独占 move-to-area、父表优先的组内 auto-arrange、删除 Area 后表回到非分组画布；Area 当前为图表会话状态，仍缺项目持久化/重命名/拖放 |
| U03 | 本阶段增强 | 全量 undo/redo action stack | `src/context/history-context/history-provider.tsx:384` / `:399`，action schema 在 `redo-undo-action.ts` | Area 与 Structured Draft 均有 100 步 undo/redo；draft history 使用 relation-array structural sharing，单次编辑只替换受影响 relation。仍需把 Area 与 schema draft 合并为可持久化的统一画布事务历史 |
| U04 | 本阶段增强 | SVG/PNG/JPG 图像导出 | `src/pages/editor-page/top-navbar/menu/menu.tsx:83` 起，`src/context/export-image-context/export-image-provider.tsx` | Diagram 可导出 SVG/PNG/JPG，选择过滤结果或完整画布、深色/浅色/透明背景；栅格导出限制 2400 万像素并按比例缩小，右侧 inspector 可收起 |
| U05 | 本阶段增强 | 图过滤、选择聚焦、依赖高亮、lost-in-canvas 提示 | `src/pages/editor-page/canvas/canvas-filter/`、`canvas/hooks/use-is-lost-in-canvas.tsx` | Diagram 已有关系/列搜索、keys-only、选择/reveal、visible-count，并新增“选中表 + 一阶依赖”/当前 Area 范围过滤；选中表被搜索或范围隐藏时显示 `Show hidden selection`，清理过滤并居中找回 |
| P01 | 已对齐并增强 | 大结果表格虚拟化 | ChartDB 重点是 React Flow 画布 | Oxide 使用 `@glideapps/glide-data-grid`，长表不创建每个单元格 DOM；大表 export 继续走 Rust streaming |
| P02 | 本阶段增强 | 高频画布事件批处理 | ChartDB `canvas.tsx:397/:718/:967` debounce，`:1530` 用 `requestAnimationFrame` throttle；节点测量也使用 rAF | `SchemaDiagramView.tsx` 已用 rAF + 分桶 overscan 做 viewport culling，只渲染视口附近节点/关联边，并修复关联定位与实际布局列数不一致；仍需 1k/5k/10k relation 基准与极端缩放策略 |
| P03 | 本阶段增强 | 派生状态 memo 与细粒度 context | ChartDB 大量 `useMemo/useCallback`，但单一 chartdb provider 也很大 | Oxide QueryEditor/DataGrid 已缓存 metadata、虚拟化行并拆纯函数；本阶段降低 provider 注册数和补全前缀分配，并隔离 metadata-sensitive completion provider 与稳定协议 provider；后续用 profiler 定位 execution state 与 edge path 计算热点 |

## 5. 分阶段执行顺序

### 阶段 A：LSP 与智能补全（进行中）

- [x] 对齐 DBX 常用 snippet 集，补 JOIN/CASE/EXISTS/事务/EXPLAIN、方言语法、占位符跳转和精确 trigger 排序。
- [x] 保留 LSP `additionalTextEdits`、InsertReplaceEdit、commit characters、deprecated 和文档展示。
- [x] 增加用户 snippet 设置、启停、校验、恢复默认和本地持久化。
- [x] 增加版本化 JSON snippet 文件导入导出。
- [ ] 增加可选云同步（不得隐式上传本地 SQL 内容）。
- [x] 为仅返回裸函数名的 LSP completion 按 signature detail 生成参数 snippet，并保持 server textEdit 优先。
- [x] 增加 FK JOIN（出站/入站外键、复合键、跨 schema、别名避让），且复用 LSP metadata relationship index。
- [x] 增加 correlated subquery、derived table、LATERAL/APPLY 与显式 table-function column fixtures。
- [x] 同名不同 signature 的 overload 作为独立候选展示。
- [x] 记录 completion latency、discarded response、empty fallback 原因，且不保存 SQL/标识符/候选文本。
- [x] 隔离 metadata-sensitive completion/hover 与稳定 LSP provider lifecycle。
- [x] 增加智能位置/名称前缀/仅手动三种补全触发策略，并在 IPC 前抑制无效自动请求。
- [x] 增加 Unicode 与中文拼音首字母对象/列/FK JOIN 检索；拼音词典仅在命中中文 metadata 场景时动态加载。
- [x] 增加空列清单 INSERT 全列/VALUES tab-stop snippet，以及单表、多表、`alias.*` 的 metadata 星号展开。
- [x] 把命名事务 session/lifecycle 从 QueryEditor 移入独立 controller，并为 Begin/Commit/Rollback 增加防重复操作和进行中反馈。
- [x] 迁出 query/explain/parameter execution controller，统一 SQL/Elasticsearch/MongoDB 目标范围、过期异步结果丢弃与重复执行门控。
- [x] 统一 Editor/Explorer 的 SQL 脚本审阅导入，并迁出 Elasticsearch Console 文件操作；覆盖 target/digest 绑定、stale context、重复操作与导入后刷新失败语义。
- [x] 迁出 LSP virtual-document lifecycle，统一 session/URI/tab 清理并拒绝迟到 didOpen 回写。
- [x] 把 DBX CTE/derived projection scope 加入 bundled LSP native/compatibility dialect corpus，并为 local relation 扫描增加 SQL-noise 屏蔽与 512 KiB 上限。
- [x] 把 table-function、`WITH ORDINALITY`、table/subquery correlation columns、SQL Server table hint 与 JOIN 后逗号 source 纳入 bundled LSP 原生 corpus。
- [x] 迁出稳定协议 provider coordinator，并为统一注册/销毁、跨文档调用隔离与 rename 二次 gate 增加测试。
- [x] 扩大 outer correlation、LATERAL/APPLY 多方言语义 corpus，并保持内外 scope 隔离。
- [x] 扩大三/四段 catalog、SQL Server `database..table` 多方言语义 corpus，并阻止跨 catalog 同名 metadata 泄漏。
- [ ] 继续迁出 metadata-sensitive completion 与 QueryEditor view lifecycle。

### 阶段 B：迁移与结构格式

- [x] 先为 PostgreSQL → MySQL/SQL Server 增加确定性特殊类型/丢失风险说明，跨库 artifact 保持 review-only。
- [x] 为跨驱动特殊类型增加结构化 conversion issue 与迁移视图明细。
- [x] 补 PostgreSQL cast/sequence default、partial/expression/specialized index 与显式 custom type review issue。
- [x] 补独立 remediation/blocking 字段并在迁移视图标识阻断 DDL 的问题。
- [ ] 扩展 capability 驱动覆盖。
- [x] 增加 snapshot → review-only DBML export 与文件内 lossiness warnings。
- [x] 增加有界 DBML import/validation，并接入 review-only snapshot diff，不直接执行。
- [x] 增加 ChartDB metadata-query JSON 有界导入、聚合和 review-only snapshot diff。
- [x] 增加 ChartDB 8 类数据库及兼容驱动的 target-scoped metadata query 一键复制。
- [ ] 扩展外置 driver semantic DDL/migration 协议和 conformance evidence。

### 阶段 C：表格导出

- [x] 查询结果导出补 CSV BOM/JSONL/TSV/SQL 并优化入口。
- [x] 表模式 CSV/CSV BOM/JSON/JSONL/TSV/SQL 统一到一个 Export 菜单，继续使用后端流式任务。
- [x] 后端流式 XLSX export，复用 progress/cancel/audit/atomic finalize，并保护大整数精度。
- [ ] 按 capability 增加 Parquet/Arrow 与 resume/backpressure。

### 阶段 D：Diagram UX 与性能

- [x] 建立 Area/group、multi-select move-to-area、group auto-arrange 和 Area 操作 undo/redo。
- [x] 建立按需加载的 Structured Draft，把 table/field/index/FK/CHECK 与 column comment/default CRUD 接入 100 步结构共享历史。
- [x] 通过 snapshot diff 把结构化图编辑转为 reviewed migration plan，并由前端与 Rust 执行入口双重拒绝 offline draft Apply。
- [ ] 增加 note、drag-to-create relationship、draft 项目持久化，并把 Area/draft 合并为统一事务历史。
- [x] 增加 SVG export、inspector 收起与 rAF viewport culling。
- [x] 增加 PNG/JPG、过滤/完整画布范围和背景选项。
- [x] 增加依赖/Area 范围过滤与 lost-selection 找回入口。
- [x] 增加 250ms DBML Draft 诊断与 snapshot-only reviewed diff；offline artifact 禁止 Apply/Open in console。
- [ ] 增加 1k/5k/10k relation 性能基准。

## 6. 延后验证

按照当前安排，本阶段不执行真实数据库验证。需要在逻辑迁移完成后统一验证：

- PostgreSQL/MySQL/SQLite/SQL Server/Oracle/ClickHouse 的三种 LSP 触发模式、Unicode/中文 metadata、signature、textEdit、INSERT snippet 与星号展开。
- 70+ 产品的 driver 安装、连接、metadata、query、cancel、error mapping 和 migration capability 证据。
- CSV/JSON/SQL/XLSX/Parquet 的大文件、编码、NULL/binary/date/JSON、大整数、取消和原子落盘。
- PostgreSQL/MySQL/SQLite 的 migration preflight、rollback/journal 与 crash recovery。
- 1k/5k/10k relation diagram 和 100k+ row table 的渲染、内存和交互延迟。
