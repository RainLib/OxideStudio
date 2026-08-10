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
- SQL 智能提示的协议、snippet、函数参数、JOIN/外键推导和主要作用域 fallback 已补齐；事务、query/explain execution、文件 workflow，以及 LSP document/provider/completion/hover、metadata fallback、Monaco view、current-statement decoration 和 Console auto-suggest lifecycle 均已从 `QueryEditor.tsx` 移出。已识别的编辑器生命周期主路径完成拆分，剩余工作转为真实 Monaco/provider 组合验证与持续控制组件体积。
- 迁移侧最大的可迁移逻辑是“确定性类型映射 + 不支持特性清单”，而不是 ChartDB 的 AI 生成兜底。Oxide 的可执行迁移必须继续受 capability、预检、确认摘要和 journal 约束。

## 1. SQL Editor、LSP 与智能提示

| ID | 状态 | 差距/能力 | ChartDB / DBX 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| L01 | 已对齐并增强 | 编辑器内容与语义引擎持续同步 | ChartDB `src/components/code-snippet/dbml/dbml-completion-provider.ts:34` 创建长生命周期 `Compiler`；`src/pages/editor-page/side-panel/dbml-section/table-dbml/table-dbml.tsx:101` 持续更新 source | `useLspDocumentLifecycle.ts` 与 `lspDocumentSync.ts` 维护 didOpen/didChange FIFO、已确认 text/version shadow、session owner 与关闭清理；tab/连接/session 改变后迟到的 didOpen 会被丢弃并主动 didClose，补全前仍强制同步当前版本 |
| L02 | 本阶段增强，真实 provider 验证延期 | LSP CompletionItem/CompletionList 协议字段曾被裁剪，且缺少惰性 `completionItem/resolve` 会让候选文档和附加编辑停留在半成品状态 | ChartDB DBML provider 直接复用 Monaco completion contract；DBX `apps/desktop/src/lib/editor/sqlCompletionPresentation.ts` | bridge 现端到端保留双范围 edit、additional edits、commit characters、`isIncomplete`、`itemDefaults`（含 LSP 3.17 list-level opaque `data`）、label details、insert mode、deprecated 与 documentation kind；仅在 server 明确声明 `resolveProvider` 时保留 opaque `data` 并由 Monaco 惰性解析 documentation/detail/additional edits。bundled LSP 也已声明 resolve，并只对显式支持 documentation resolve 的 client 延迟候选文档；服务端 FIFO cache 限定 8,192 项/4 MiB，单文档超过 256 KiB 时保持 inline，未知或淘汰 identity 不破坏原候选。Host transport 双向限制 32 MiB，并兼容大小写不敏感的 Content-Length 与可选 Content-Type headers；单次最多向 Monaco 传 2,000 项且单项不超过 256 KiB，截断/拒绝项会把 `isIncomplete` 置真以允许缩小前缀后重取。server 主动请求不再悬挂：configuration 保持逐项 null、无 workspace folders、进度/消息请求安全确认、workspace edit 明确拒绝，未知方法返回 JSON-RPC MethodNotFound。bridge resolve 请求同样限定 256 KiB，tab/连接/session owner 改变或 Monaco 取消后不回写；fallback 候选不会误发给 server。Markdown 以不信任命令/HTML的 Monaco 内容呈现，plaintext 不解释 Markdown。server `textEdit.newText` 保持权威，append-space 仅作用于普通候选 |
| L03 | 逻辑已对齐，交互验证延期 | 常用 SQL 代码块数量不足，触发词展示和精确匹配排序不够稳定 | DBX `apps/desktop/src/lib/sql/sqlSnippetTemplates.ts:11`、`apps/desktop/src/lib/sql/sqlCompletion.ts:4041` | `sqlCommandSnippets.ts` 已补 `join/case/exists/not exists/transaction/explain`，精确 trigger 优先且支持名称首字母/fuzzy 匹配；Monaco 原生补全行展示 trigger 与 “SQL snippet”，支持方言分页/ALTER/事务、keyword case、Manticore 专属模板及设置页自定义/启停/恢复默认 |
| L04 | 本阶段增强 | 用户可新增、修改、禁用并同步 SQL snippet | DBX `apps/desktop/src/stores/settingsStore.ts:832`、`apps/desktop/src/components/config/EditorSettingsDialog.vue`、`docs/content/docs/sql-snippets.cn.mdx` | `src/lib/appSettings.ts` 与 `SettingsDialog.tsx` 已增加 snippet schema、设置 UI、唯一 id/prefix 校验、启停/删除/恢复默认、本地持久化及版本化 JSON 导入导出；仍缺可选云同步 |
| L05 | 核心逻辑已对齐，真实版本验证延期 | 函数/存储过程候选应带参数占位符和签名帮助 | DBX `apps/desktop/src/lib/sql/sqlCompletion.ts:getSqlFunctionSignatureHelp`、`activeFunctionSignatures`、`findActiveFunctionCall`，`apps/desktop/src/lib/editor/sqlSignatureTooltip.ts` | `sqlCompletionInsertion.ts` 已在 server 仅返回裸函数名但 detail 含签名时生成 Monaco 参数占位符；已有 snippet/textEdit 与光标后已有 `(` 时保持 server/用户文本优先；同名不同 signature 的 overload 不再被 fallback merge 去重。外部 provider 的裸名签名现用 16 KiB/64 参数有界解析，正确跳过 quoted/default/array-bound/STRUCT/nested-type 内部逗号并提取 PostgreSQL/MySQL/SQL Server 引号参数名。bundled LSP 现在优先使用实时 routine metadata，并提供有 server-version gate 的方言内建签名 fallback；同一目录会在表达式位置主动生成可编辑 snippet（单次最多 100 项），但不会污染 relation target、注释、字符串或 `alias.` 列补全。嵌套/quoted、可选参数、重载排序及 ClickHouse 多参数组均走同一条 64 KiB 有界解析路径 |
| L06 | 本阶段增强 | 基于 FK、别名、CTE 和子查询作用域生成 JOIN/字段候选 | DBX `apps/desktop/src/lib/sql/semantic/completion.ts`、`apps/desktop/src/lib/sql/semantic/model.ts:308-427`、`apps/desktop/src/lib/sql/sqlCompletion.ts:2909` | `sqlJoinCompletion.ts` 已按外键生成完整 `JOIN … ON …`；缓存 fallback 识别 correlated outer alias、derived subquery、LATERAL/APPLY 与显式 table-function output columns。Bundled LSP 的 local relation overlay 现原生覆盖 CTE/derived/table-function/correlation scope、`WITH ORDINALITY`、partial positional rename、JOIN 后逗号 source、LATERAL/APPLY 派生表与函数；相关子查询只按需解析被限定的外层 alias，未限定列不泄漏。前端传入的 `catalog` 现由 Rust Schema 保留，三/四段限定、SQL Server `database..table` 和跨 catalog 同名表按 catalog + schema + table 消歧；table hint 和真实 `lateral` 表名不会误判。单一 SQL-noise 缓冲区和 512 KiB 上限约束按键路径 |
| L07 | 逻辑已对齐，真实 provider 验证延期 | 补全触发与排序应避免“空列表、重复候选、过期响应覆盖新输入”，接受限定词后应继续下一层联想 | ChartDB trigger 字符位于 `src/components/code-snippet/dbml/dbml-completion-provider.ts:19`；DBX `lib/sql/sqlCompletionTriggerPolicy.ts`、`lib/common/completionMatch.ts`、`sqlCompletion.ts:shouldChainSqlCompletionAfterAccept` 与 `QueryEditor.vue:markCompletionAccepted` | 三种触发模式在 LSP 请求前门控；live/cache 合并支持 Unicode、拼音、camel/fuzzy 与 FK JOIN。触发门控现按 driver 区分 MySQL/MariaDB `#` comment、MySQL backslash string 与 PostgreSQL `E'...'`，同时保留 SQL Server `#temp` 前缀补全。接受以 `.` 结尾的 schema completion 或 SQL Server `USE ` 后，通过同一 owner/scope 受控命令重新打开 Monaco 候选，程序化插入不再依赖键盘 trigger；迟到响应、跨 tab 命令和重复候选继续被拒绝 |
| L08 | 本阶段增强 | SQL/DBML 编辑差异预览的细粒度防抖与可撤销应用 | ChartDB `src/pages/editor-page/side-panel/dbml-section/table-dbml/table-dbml.tsx:265` 使用 debounce，`:284` 应用，`:306` 撤销 | Diagram 的 DBML Draft 对当前 snapshot 生成文本，250ms 防抖解析 relation/warning，确认后只调用 snapshot compare 打开只读 diff；offline plan 同时禁用 Apply 和 Open in console。textarea 原生 undo 可用；仍缺逐项接受和结构化 schema CRUD history |
| L09 | 主路径已对齐 | `QueryEditor.tsx` 曾承载过多 provider 和视图生命周期 | DBX 将 semantic、presentation、insertion、execution target、keymap 分文件；ChartDB 将 completion manager 单独封装 | completion 已分层，事务、执行和文件 workflow 已有独立 controller；LSP document/provider/completion/hover、metadata fallback、Monaco view state 与 current-statement decoration 均有独立 owner/lifecycle。Console auto-suggest 现独立管理 focus 门禁、45ms 合并、语义触发、同 model/version 迟到结果拒绝和卸载清理。`QueryEditor.tsx` 已降至约 3,253 行；后续只新增 feature/application 模块，并以真实 Monaco/provider 组合验证生命周期边界。 |
| L10 | 本阶段已对齐并增强 | 比较操作符后的值联想缺少列类型驱动的代码块 | DBX `apps/desktop/src/lib/sql/sqlCompletion.ts:buildComparisonValueItems` | bundled LSP 现从当前 metadata 列类型生成 NULL、text、numeric、boolean、date/time/timestamp、UUID、JSON 的安全 snippet/tab stop，并继续提供 ENUM/SET 声明域值；WHERE/HAVING/JOIN ON/UPDATE SET 在 PostgreSQL、MySQL、SQLite、Hive、ClickHouse 共用有界实现。歧义类型只给 NULL，绝不读取真实行样本。 |

## 2. 数据库结构、导入与迁移

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| M01 | Oxide 增强项 | ChartDB 只定义 Generic + 8 个数据库产品 | `src/lib/domain/database-type.ts:1`，capability 在 `src/lib/domain/database-capabilities.ts:11` | Oxide `src/features/database-drivers/model/referenceDriverCatalog.ts` 有 70+ 候选并区分安装/运行/能力；真实可用性仍以签名包和 conformance 证据为准 |
| M02 | 已对齐并增强 | 一条可复制的 metadata query 将数据库结构转成统一 JSON | `src/lib/data/import-metadata/scripts/scripts.ts:22` 到 `:30` 覆盖 PostgreSQL/MySQL/SQLite/SQL Server/MariaDB/ClickHouse/CockroachDB/Oracle；最新 CSV/嵌入引号修复位于 `src/lib/data/import-metadata/utils.ts`（`3442936`）；schema 位于 `metadata-types/database-metadata.ts` | `chartDbMetadataQueries.ts` 为同一 8 类数据库及兼容驱动生成 target-scoped、read-only、单 JSON cell 查询；Snapshot 对话框可一键复制。`chartDbMetadataImport.ts` 先保留严格 JSON 语义，再有界接收 JSON-string transport、单字段 CSV 双引号转义和已知的未转义 `metadata_json_to_import` wrapper；合法 embedded quote/backslash 不被破坏，其他畸形输入仍拒绝。文件限制 16 MiB，并保持 review-only/Apply 禁用 |
| M03 | 本阶段增强 | SQL DDL 离线导入和方言自动识别 | `src/lib/data/sql-import/index.ts:121` 检测 PostgreSQL dump、SQL Server、MySQL、SQLite、Oracle，`:178` 路由到同目录 dialect importers；各 dialect importer 将 view 作为只读 table，并由 PostgreSQL importer 保留 enum custom type | `projectDdlSnapshot.ts` 现以有权重的语法证据识别同 5 类方言，并结合连接 driver 处理 portable SQL；支持项目 SQL 集合或独立 `.sql` 文件（8 MiB）导入，解析 `CREATE TABLE`、`VIEW`/`MATERIALIZED VIEW`、`TYPE ... ENUM`、`SEQUENCE`、独立/表内 index、主键/唯一键/表级与列内外键、常用自增和多词/精度类型。view 仅从显式列清单或简单顶层 SELECT 安全推断列名，类型固定为 `UNKNOWN` 并告警；enum/sequence 进入 descriptor-only `schemaObjects` 并参与离线 fingerprint，Rust diff 强制 Manual Review。generated expression 会被识别并阻断式告警，绝不伪装成 default。线性 tokenizer 可区分注释、转义字符串、SQL Server bracket identifier 与 PostgreSQL dollar quote，避免真实 dump 中的分号/注释文本误分句；保存来源与方言后进入 diagram/structured draft/live diff。产物继续强制 review-only；完整方言 grammar、partition、generated expression 无损模型、依赖图和可执行源 DDL 仍未对齐 |
| M04 | 本阶段增强 | DBML 导入、导出、校验和 apply diff | `src/lib/dbml/dbml-import/`、`src/lib/dbml/dbml-export/`、`src/lib/dbml/apply-dbml/`；ChartDB exporter 的 `generateEnumsDBML` 与 importer `customTypes` 保留 enum 名称/值，完整 DBML grammar 由 `@dbml/core` 提供；最新 `1a1df6e` 在混合模型中将 MySQL 类型归一化后交给编译器并单独恢复 index comment | `schemaDbml.ts` 导出 review-only DBML；`schemaDbmlImport.ts` 有界解析 table/column/default、复合或单列 index、表级/列内复合 FK，并保留 `ON DELETE/UPDATE` 动作供审阅；现可往返同 schema `Enum` 名称、引号值和列类型引用，enum 作为 descriptor-only `ENUM TYPE` 参与 fingerprint/diff，value note/settings 明确告警但不伪装为可执行元数据；SQL DDL enum 的受限 `Values:` 描述也可导出 DBML。`TablePartial` 按官方“本地 table > 最后注入 partial > 更早 partial”规则展开字段和 index，支持嵌套复用，并对缺失/cycle、深度、注入数、单表展开量和全局 cache 设界；partial table setting 继续告警丢失。最新 ChartDB 的混合方言类型和 comment 修复已按 Oxide 的 review-first 模型增强对齐：不把 `longtext/tinyint/text[]` 归一化为有损公共类型，而是由有界 parser 原样往返；table/index/column comment 贯通 snapshot fingerprint 与 DBML。表 comment 修改由 PostgreSQL/MySQL 语义 DDL 执行；index 仅 comment 改变仍生成 blocked review-only change，绝不自动 drop/recreate。校验 target schema、重复对象/值、source/target table/column 与冲突 FK，保留 source warning，再从 Snapshot 对话框进入 diagram/structured draft/live diff。DBML 和 SQL DDL 均强制禁用 Apply；仍缺 ChartDB 全语法编译器、Project Note、enum value note/partial table setting 无损模型、module import 和编辑器内逐项即时 apply diff |
| M05 | 产品主路径逻辑已对齐，逐产品实现/证据延期 | 确定性跨方言 DDL 转换 | `src/lib/data/sql-export/cross-dialect/index.ts:33` 目前仅 PostgreSQL → MySQL/MariaDB/SQL Server；完整类型表在 `postgresql/type-mappings.ts` | `src-tauri/src/core/schema_diff.rs` 已把 ChartDB 有损映射面迁为 PostgreSQL → MySQL/SQL Server 的结构化 review plan，覆盖 array、JSON/JSONB、UUID/binary/boolean、money、time/timestamp zone、network、interval、bit string、serial、geometry、full-text、range、XML 与 target index/default 表示；跨库 Host 产物仍不生成/执行 DDL。外置驱动已有签名 `schemaMigration` contract、descriptor-only snapshot、sidecar-owned plan/preflight/apply/verify token 与 evidence runner。四步调用现贯通 `DatabaseDriver`、`ConnectionManager`、`ExternalDriver` 和 Schema Diff UI；Agent read-only 连接禁用。Host 限制 snapshot 结构/大小并拒绝 SQL/DDL key，catalog 安装持久化并重验 Host-owned receipt，只有精确 package/entrypoint/platform/server-version migration evidence 才开放。`compare_schema_snapshots` 为 verified external driver 创建 15 分钟、最多 64 个的进程内单次会话；renderer 只收到 Host plan id 和有界 preview，不收到 sidecar plan id/token/DDL。apply 前重验连接进程、证据、模式、审批与 fresh target fingerprint，单次消费会话后执行 preflight/apply/verify，再由 Host recapture 做第二重 fingerprint 核验；partial/count mismatch 强制 verification failure。没有证据仍生成 review-only plan 并清空可执行 SQL。剩余差距仅为逐产品 sidecar 语义实现、精确真实版本 evidence 与数据库验证 |
| M06 | 已对齐并增强 | 转换前枚举不支持特性并把告警写入产物 | `src/lib/data/sql-export/cross-dialect/unsupported-features.ts:36` 检测 array/custom type/default/index 等 | `SchemaConversionIssue` 现显式区分 `type/array/default/index/customType/schema`，记录 relation/object、source/target representation、safe/review/unsupported、原因、remediation 和 `blocksAutomaticConversion`；迁移视图按类别展示并明确标识 `blocks DDL`。默认值包含 sequence/UUID/array/cast/session state，索引包含 partial/expression 与 GIN/GiST/SP-GiST/BRIN/HASH；未知族仍给出 schema 级阻断项而不猜测 |
| M07 | Oxide 增强项 | 可执行迁移预检、确认、事务/非事务边界和 journal | ChartDB `src/lib/data/sql-export/export-sql-script.ts:154` 主要生成 SQL，不负责安全执行 | Oxide `src-tauri/src/commands/schema_diff.rs` 执行，`src-tauri/src/core/schema_diff.rs` 规划；PostgreSQL 事务、MySQL 显式非事务、SQLite review-only rebuild、Host-owned journal 已存在。verified external driver 使用进程内 opaque-token session、target-owned preflight/apply/verify 和 Host post-recapture；journal 不保存 token、DDL 或 sidecar preflight observed 原文 |
| M08 | 协议/证据门禁已对齐，逐产品实现与证据延期 | 70+ 产品的 migration capability 仍需逐产品语义实现 | ChartDB 不覆盖此规模 | 外置 driver 已有 descriptor-only `plan/preflight/token-bound apply/verify` 协议、签名 `schemaMigration` contract、runtime 双重握手门禁、Host-owned catalog evidence receipt 和 migration evidence runner；旧包、手工目录包及没有精确 platform/server-version evidence 的产品继续保持 review-only，不借用相似方言猜测。 |

## 3. 表数据与结果网格导入导出

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| E01 | Oxide 增强项 | 大表导出任务、进度、取消、原子产物和审计 | ChartDB 的 export 主要面向 schema/diagram，不提供 live table streaming | `src-tauri/src/commands/table.rs:5754` 已流式导出 CSV/JSON/JSONL/TSV/SQL，支持 progress/cancel/report；前端表工具栏统一为一个 Export 菜单，WebView 不物化整表 |
| E02 | 本阶段增强 | 查询结果导出格式和入口不完整 | ChartDB diagram JSON 在 `src/hooks/use-export-diagram.tsx`，SQL 在 `src/dialogs/export-sql-dialog/export-sql-dialog.tsx` | `src/lib/exportUtils.ts` 与 `DataGrid.tsx` 已增加 CSV、CSV BOM、JSON、JSONL、TSV、SQL INSERT template，统一下载并释放 Blob URL |
| E03 | 已对齐并增强 | XLSX 导出 | ChartDB 不提供表数据 XLSX | `src-tauri/src/commands/table.rs` 逐页读取并直接流式写 XLSX ZIP/XML，冻结表头、启用筛选、保留 boolean/number/text，超过 15 位整数按文本保护精度；复用 progress/cancel/audit/atomic finalize，WebView 不物化整表 |
| E04 | 已对齐并增强 | Parquet/Arrow 等分析格式 | ChartDB 不提供 | Host 已用 Apache Arrow Rust 实现逐页 Arrow IPC file 与 Parquet 编码器，继续复用容量为 2 的反压通道、取消、进度和原子发布。Parquet 使用 Snappy，并以 50,000 行或 64 MiB 约束 row group；原生 PostgreSQL/MySQL/SQLite 与受审 DuckDB 声明分析格式。PostgreSQL/MySQL/DuckDB 类型计划覆盖布尔、整数、浮点、日期、微秒时间戳和 binary；DECIMAL/JSON/数组/custom 等无法无损映射的值保留为精确 UTF-8/JSON。SQLite 因动态 storage class 对所有列使用可靠 UTF-8/JSON 表示。全部降级列均在 Arrow field metadata 与导出结果中返回源类型/原因。菜单、签名能力交集和后端命令继续三重门禁；通用 JDBC/RQLite 在没有 canonical value conformance 前不声明分析格式。 |
| E05 | 本阶段增强、策略仍部分对齐 | SQL INSERT 导出应方言感知并可配置 batch/upsert | ChartDB schema SQL exporters 位于 `src/lib/data/sql-export/export-per-type/`；DBX `crates/dbx-core/src/table_export.rs:SQL_INSERT_BATCH_SIZE`、`database_export.rs:build_export_insert_statements` | Host 表导出已按精确表名生成可回放 SQL；每条 INSERT 同时受 100 行和 512 KiB 双阈值限制。字面量方言与分页兼容方言已分离，避免 SQLite/DuckDB 因复用 PostgreSQL 引号规则而误用 PostgreSQL 数组语法；当前覆盖 PostgreSQL array/bytea、MySQL binary/控制字符、SQLite BLOB，并对缺失行值显式补 NULL。SQL replay 现由原生 PostgreSQL/MySQL/SQLite catalog 精确排除 generated column，并按 DBX 策略排除 PostgreSQL `tsvector`；筛选同步作用于列和值，外置驱动默认不猜测。仍需通用 identity 策略、用户可配置 batch、upsert/copy 以及更多产品的 temporal/spatial/vector conformance。查询结果继续使用明确的 `target_table` 占位符，避免猜错来源表。 |

## 4. Diagram、整体体验与性能

| ID | 状态 | 差距/能力 | ChartDB 实现位置 | OxideStudio 当前落点与下一步 |
| --- | --- | --- | --- | --- |
| U01 | 主路径已对齐 | 图中直接创建/编辑 table、field、index、constraint、relationship、note | `src/context/chartdb-context/chartdb-provider.tsx` 各 mutation + history action；节点 UI 在 `src/pages/editor-page/canvas/` | Diagram 的 Structured Draft 可增删/重命名 relation，增删改 column/comment/default，增删 index/FK/CHECK，并传播 relation/column rename 引用。草稿按 project + connection + database + schema 自动保存；同 fingerprint 恢复、旧 snapshot 防串用、串行 flush 和二次确认丢弃已具备。字段可从源列拖到目标列，经 1 KiB 载荷和 snapshot 对象复核后预填唯一 FK，view/foreign table 被拒绝，仍须用户确认且只生成 review-only diff。独立 Note 节点支持 4,000 字内容、五种颜色、缩放感知拖动、编辑和二次确认删除，明确不进入 DDL。 |
| U02 | 已对齐（最新更新） | 多选表移动到 Area、Area 内自动排列 | 最新提交修改 `src/pages/editor-page/canvas/table-node/table-node-context-menu.tsx:188`、`area-node-context-menu.tsx:39`、`src/lib/utils/area-utils.ts` | `schemaDiagramAreas.ts` 与 Diagram 工具条已支持 Ctrl/Cmd/Shift 多选、独占 move-to-area、父表优先的组内 auto-arrange、删除 Area 后表回到非分组画布；关系节点右键菜单可批量移动到现有/新 Area 或 `No area`，Area 标题右键可重命名、自动排列/删除，全部复用同一 100 步历史。重命名阻止空名和大小写等价的重复名。Area 与 Note 现按 project/connection/database/schema 共用有界资源持久化；snapshot 刷新会过滤已不存在的 Area relation，但保留 Note。 |
| U03 | 已对齐（逻辑） | 全量 undo/redo action stack | `src/context/history-context/history-provider.tsx:384` / `:399`，action schema 在 `redo-undo-action.ts` | Area、Note 与 Structured Draft 已合并到同一 100 步画布事务历史，按实际操作顺序 undo/redo，并使用不可变引用和结构共享。指针移动与缩放只在 release 提交一次，键盘连续调整在 key-up 提交；工具栏、草稿对话框与 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z/Ctrl+Y 共用同一路径，输入框保留原生文本撤销。持久化仍按职责隔离：Area/Note 保存为画布资源，draft 作为 snapshot-fingerprint 绑定的 review-only schema artifact 单独保存；恢复草稿不会制造伪历史，snapshot 更新会清理旧 fingerprint 草稿及无效 undo step，会话重挂载不会被画布加载覆盖。 |
| U04 | 本阶段增强 | SVG/PNG/JPG 图像导出 | `src/pages/editor-page/top-navbar/menu/menu.tsx:83` 起，`src/context/export-image-context/export-image-provider.tsx` | Diagram 可导出 SVG/PNG/JPG，选择过滤结果或完整画布、深色/浅色/透明背景；Note 会以 XML 安全文本和固定调色板进入矢量/栅格产物并扩展画布边界。栅格导出限制 2400 万像素并按比例缩小，右侧 inspector 可收起。 |
| U05 | 本阶段增强 | 图过滤、选择聚焦、依赖高亮、lost-in-canvas 提示 | `src/pages/editor-page/canvas/canvas-filter/`、`canvas/hooks/use-is-lost-in-canvas.tsx` | Diagram 已有关系/列搜索、keys-only、选择/reveal、visible-count，并新增“选中表 + 一阶依赖”/当前 Area 范围过滤；选中表被搜索或范围隐藏时显示 `Show hidden selection`，清理过滤并居中找回 |
| P01 | 已对齐并增强 | 大结果表格虚拟化 | ChartDB 重点是 React Flow 画布 | Oxide 使用 `@glideapps/glide-data-grid`，长表不创建每个单元格 DOM；大表 export 继续走 Rust streaming |
| P02 | 离线主路径已对齐，真实 WebView 验证延期 | 高频画布事件批处理 | ChartDB `canvas.tsx:397/:718/:967` debounce，`:1530` 用 `requestAnimationFrame` throttle；节点测量也使用 rAF | `SchemaDiagramView.tsx` 已用 rAF + 量化 overscan 更新视口，并新增布局级二维空间桶与 relation→edge 邻接索引：滚动只检查相交桶和可见关系的相邻边，edge layer 复用全局 relation map。Note 拖动/缩放只更新节点本地状态，pointer-up 才向统一历史提交一次；Area/Note 持久化 450ms 防抖、串行写入并在 tab 离开时 flush。布局和 Area 自动排列共用 `O((V+E) log V)` 稳定最小堆拓扑遍历，外部关系判定改为 Set，移除了 10k relation 下的重复全量排序、数组头删除和 edge×relation 扫描。`npm run benchmark:diagram` 固定生成 1k/5k/10k relation + 近似等量 FK，并测 layout、空间索引和 100 次 viewport query；当前 Windows 主机 10k 结果约为 67ms / 4ms / 2ms | 延期在真实 Tauri WebView 记录 React commit、SVG edge path、极端缩放帧率和内存；基准数值不是跨机器 SLA。 |
| P03 | 本阶段增强 | 派生状态 memo 与细粒度 context | ChartDB 大量 `useMemo/useCallback`，但单一 chartdb provider 也很大 | Oxide QueryEditor/DataGrid 已缓存 metadata、虚拟化行并拆纯函数；稳定协议、hover、completion provider 均有独立生命周期。Diagram 的 relation lookup、隐藏选择判断和 inspector 关联边已复用布局级 Map/adjacency，不再在每次选择时扫描完整 relation/node/edge 列表；后续用 profiler 定位 execution state 与 edge path 计算热点 |

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
- [x] 迁出 metadata-sensitive relation/field/FK JOIN completion source，并隔离其缓存失效边界。
- [x] 增加独立 Monaco view-state lifecycle，对齐 DBX 的 tab 级 viewport/selection 保存恢复和 rAF 滚动同步。
- [x] 迁出 current-statement decoration lifecycle，保留 authoritative range cache、过期响应丢弃和 Mongo 本地范围。
- [x] 迁出 Console auto-suggest lifecycle，并增加 focus、45ms 合并、model/version 迟到拒绝和卸载清理。

### 阶段 B：迁移与结构格式

- [x] 先为 PostgreSQL → MySQL/SQL Server 增加确定性特殊类型/丢失风险说明，跨库 artifact 保持 review-only。
- [x] 为跨驱动特殊类型增加结构化 conversion issue 与迁移视图明细。
- [x] 补 PostgreSQL cast/sequence default、partial/expression/specialized index 与显式 custom type review issue。
- [x] 补独立 remediation/blocking 字段并在迁移视图标识阻断 DDL 的问题。
- [x] 对齐 ChartDB PostgreSQL → MySQL/SQL Server 的有损类型、默认值与 index mapping 面，并为 conversion issue 增加 feature category。
- [ ] 扩展 capability 驱动覆盖。
- [x] 增加 snapshot → review-only DBML export 与文件内 lossiness warnings。
- [x] 增加有界 DBML import/validation，并接入 review-only snapshot diff，不直接执行。
- [x] 增加 DBML Enum descriptor 导入/导出、列类型引用、fingerprint 与 Manual Review diff；value note/settings 保持显式有损告警。
- [x] 增加 DBML TablePartial 字段/index 展开、官方冲突优先级、嵌套 cycle/missing 诊断和 expansion/cache 上限。
- [x] 保留 DBML 混合方言原始类型并贯通 table/column/index comment；表 comment 使用 PostgreSQL/MySQL 语义迁移而非重建。
- [x] 保留 DBML string/number/boolean/NULL/expression 默认值语义；bare string 标识符导出为字符串，不生成无效 PostgreSQL 默认表达式。
- [x] DBML 大模型解析移除 block 两两包含判断和宽表 column/index 重复线性查找，保持近线性导入路径并加入 2,000 table 回归夹具。
- [x] 增加 ChartDB metadata-query JSON 有界导入、聚合和 review-only snapshot diff。
- [x] 增加 ChartDB 8 类数据库及兼容驱动的 target-scoped metadata query 一键复制。
- [x] 增加 PostgreSQL/MySQL/SQL Server/SQLite/Oracle DDL 自动识别、独立文件导入和有界 relation/index/constraint baseline 解析。
- [x] 扩展外置 driver descriptor-only semantic migration 协议、签名/runtime 双门禁和 conformance evidence runner；逐产品实现与真实版本证据延期。

### 阶段 C：表格导出

- [x] 查询结果导出补 CSV BOM/JSONL/TSV/SQL 并优化入口。
- [x] 表模式 CSV/CSV BOM/JSON/JSONL/TSV/SQL 统一到一个 Export 菜单，继续使用后端流式任务。
- [x] 后端流式 XLSX export，复用 progress/cancel/audit/atomic finalize，并保护大整数精度。
- [x] 表数据导出增加容量为 2 的有界页通道，将编码/压缩/写盘移出异步 worker，并以显式 `Finish` 约束原子发布。
- [x] 增加签名 `tableExportFormats`、当前构建编码器交集、菜单过滤和后端格式门禁。
- [x] 实现 Parquet/Arrow 安全类型计划、流式编码器、Snappy/row-group 内存边界和 UI 降级提示；resume 仅在 driver 提供稳定 cursor/keyset + snapshot contract 时开放。

### 阶段 D：Diagram UX 与性能

- [x] 建立 Area/group、multi-select move-to-area、group auto-arrange 和 Area 操作 undo/redo。
- [x] 对齐最新 ChartDB relation/Area 右键入口，包括多选移动、新建 Area、No area、自动排列和删除。
- [x] 增加 Area 重命名、空值/重复名门控，并索引化节点选择与 inspector 关联边查询。
- [x] 建立按需加载的 Structured Draft，把 table/field/index/FK/CHECK 与 column comment/default CRUD 接入 100 步结构共享历史。
- [x] 通过 snapshot diff 把结构化图编辑转为 reviewed migration plan，并由前端与 Rust 执行入口双重拒绝 offline draft Apply。
- [x] 为 Structured Draft 增加项目级自动保存、snapshot fingerprint 防串用、串行 flush 与安全丢弃。
- [x] 增加画布字段拖拽建 FK：有界载荷、对象复核、唯一名称预填和 review-only 确认。
- [x] 增加项目 Note 的创建/编辑/颜色/拖动/安全删除，以及包含 Note 的 SVG/PNG/JPG 导出。
- [x] 把 Area/Note/draft 合并为统一 100 步事务历史，并增加 Note resize 的撤销能力、持久化基线 hydration 与 snapshot rebase。
- [x] 增加 SVG export、inspector 收起与 rAF viewport culling。
- [x] 将 viewport culling 改为布局级空间桶和关系邻接索引，移除滚动热路径的全量节点/边扫描。
- [x] 增加 PNG/JPG、过滤/完整画布范围和背景选项。
- [x] 增加依赖/Area 范围过滤与 lost-selection 找回入口。
- [x] 增加 250ms DBML Draft 诊断与 snapshot-only reviewed diff；offline artifact 禁止 Apply/Open in console。
- [x] 增加 1k/5k/10k relation 的可重复 layout/index/viewport benchmark，并移除布局与 Area 自动排列的平方复杂度热点。

## 6. 延后验证

按照当前安排，本阶段不执行真实数据库验证。需要在逻辑迁移完成后统一验证：

- PostgreSQL/MySQL/SQLite/SQL Server/Oracle/ClickHouse 的三种 LSP 触发模式、Unicode/中文 metadata、signature、textEdit、INSERT snippet 与星号展开。
- 70+ 产品的 driver 安装、连接、metadata、query、cancel、error mapping 和 migration capability 证据。
- CSV/JSON/SQL/XLSX/Parquet/Arrow 的大文件、编码、NULL/binary/date/JSON、大整数、类型降级提示、取消和原子落盘。
- PostgreSQL/MySQL/SQLite 的 migration preflight、rollback/journal 与 crash recovery。
- PostgreSQL/MySQL/SQL Server/SQLite/Oracle 的真实 dump DDL corpus、方言误判率、复杂对象 lossiness 与 8 MiB 导入交互。
- 1k/5k/10k relation diagram 和 100k+ row table 的渲染、内存和交互延迟。
