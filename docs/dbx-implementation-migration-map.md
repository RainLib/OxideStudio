# DBX 源码实施地图与迁移导航

> 基线日期：2026-08-01
> 主工程：`/Users/houshuai/project/ai_project/OxideStudio`
> 只读参考工程：`/Users/houshuai/project/ai_project/dbx`

## 1. 使用边界

本文是 **DBX 源码导航和迁移决策索引**，用于在实现某项能力前快速找到参考的
模块、理解其职责和选择适合 OxideStudio 的落点。

- DBX 仅作为只读参考；不修改它、不复制其源码，也不把它当作主工程。
- 路径以 DBX 根目录为基准；实现时应阅读相邻测试，而非只阅读界面组件。
- “参考原则”是要吸收的设计，不是要求保持同一技术栈：DBX 的 Vue/TypeScript/JDBC
  实现要转换成 OxideStudio 的 React + Tauri/Rust 安全边界。
- “当前状态”严格区分已交付与计划。目录中的 73 个候选产品不等于 73 个已可连接驱动。

已有的全量差距、优先级与能力事实见
[dbx-reference-gap-analysis.md](dbx-reference-gap-analysis.md)。本文侧重“做到某一块时，
应去哪里看、应保留什么边界、怎样验收”。

逐项的状态、DBX 精确实现位置、Oxide 落点和验收条件见
[dbx-detailed-gap-matrix.md](dbx-detailed-gap-matrix.md)。

## 2. 阅读顺序与迁移准则

每个领域固定按下列顺序阅读，可避免只迁移 UI 而缺少协议、缓存或测试边界：

1. 阅读 DBX 的纯模型或能力矩阵。
2. 阅读同名单元测试，识别版本差异、失败分支与恢复行为。
3. 对照 OxideStudio 的前端状态、Tauri command 和 Rust core 三层落点。
4. 先扩展 capability contract，再开放入口和按钮。
5. 以真实数据库或 driver fixture 验证；不能验证的产品只能标注为计划或降级支持。

迁移时不得把数据库产品名称当成能力开关。应由以下上下文共同决定行为：

```text
connection + pinned driver version + server version + capability contract
  -> dialect / metadata scope / query mode / mutation boundary / LSP provider
```

这也是 DBX 的 `effectiveDatabaseTypeForConnection` 与 OxideStudio 的连接级 package
capability 应共同保留的核心思想。

## 3. 领域地图

| 领域 | DBX 先看哪里 | 可吸收的实现原则 | OxideStudio 当前落点 | 当前差距与下一个验收点 |
| --- | --- | --- | --- | --- |
| 产品、驱动与方言 | `apps/desktop/src/types/database.ts`、`lib/database/databaseDriverManifest.ts`、`lib/database/jdbcDialect.ts`、`crates/dbx-core/assets/database-drivers.manifest.json`、`crates/dbx-core/src/driver_runtime.rs` | 产品类型、驱动安装、实际方言和对象能力分层；JDBC profile 可推断方言，但不会自动开启不相容元数据能力。 | `src/features/database-drivers/model/referenceDriverCatalog.ts`、`src/lib/databaseDialect.ts`、`src-tauri/src/core/driver_package.rs`、`driver_sidecar.rs` | 73 个候选产品与 executable registry 已分离；当前 bundled 为 PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis、Elasticsearch，DuckDB/RQLite/ClickHouse 仅具 sidecar 源码或受限路径。Driver Manager 已显示连接拥有的外置 sidecar 的 package、连接数与 PID 数，不暴露 URL/凭据/输出或进程控制。仍需按 driver-family rollout 发布真实可运行包与版本 conformance，并补资源/会话健康与崩溃预算。 |
| 连接、认证与生命周期 | `stores/connectionStore.ts`、`lib/database/databaseFeatureSupport.ts`、`databaseCapabilities.ts`、`databaseFileDetection.ts` | 保存的连接是“配置 + 服务端事实 + 能力快照”；连接测试、重连、可见 database/schema 和生产环境保护不可由 UI 推断。 | `src/store/useConnectionStore.ts`、`src/components/connection/ConnectionForm.tsx`、`src-tauri/src/commands/connection.rs` | 补齐各外置产品的连接、版本探测、认证失败分类、只读/生产 guard 真实 fixture。 |
| Database Explorer 与对象树 | `components/sidebar/ConnectionTree.vue`、`TreeItem.vue`、`lib/database/databaseObjectCapabilities.ts`、`databaseTree.ts`、`visibleDatabases.ts` | 对象树由产品能力表驱动；加载、空、错误、展开缓存是独立状态；schema/table/index/constraint/routine 不应混成一个临时列表。 | `src/components/workspace/SchemaSidebar.tsx`、`src/components/workspace/PostgresRemoteDatabaseContents.tsx`、`features/database-explorer/ui/TableObjectTree.tsx`、schema store/service、`src-tauri/src/commands/schema.rs` | 已有缓存、打开状态绿点和失败红点；表节点可展开列/索引/约束，外键明确显示引用目标并可打开关联表，CHECK 保留完整 tooltip。函数/过程按 `Routines → Functions / Procedures` 分组，提供限定名与调用模板复制。PostgreSQL sequence、非内部 trigger、domain、enum type、extension 与 partition 走独立只读 descriptor 列表；active 与显式选择的远程 database 都通过独立 metadata pool 查询，trigger/partition 显示所属 relation，绝不获得表编辑/DDL/迁移动作。仍需逐族补 event、synonym、package、composite/range type、权限与对象跳转；例程 DDL 查看需后端提供安全的例程定义接口后再接入。 |
| SQL 文档、Tab 与执行 | `components/editor/QueryEditor.vue`、`lib/editor/sqlCompletionPresentation.ts`、`sqlCompletionInsertion.ts`、`stores/queryStore.ts`、`lib/sql/currentStatementFrame.ts`、`sqlExecutionTarget.ts`、`queryExecutionState.ts` | 文档状态、当前语句、执行 target、结果来源与错误需拆域存储；一次执行不能销毁 editor model。 | `src/components/workspace/QueryEditor.tsx`、`src/features/query-editor/hooks/{useQueryExecutionController,useQueryTransactionController,useConsoleFileController,useLspDocumentLifecycle,useLspCoreProviderCoordinator}.ts`、`src/features/query-editor/model/{queryExecutionTarget,lspDocumentSync,lspMonacoAdapter,lspCompletionPresentation,sqlCompletionInsertion,currentStatementDecoration,mongodbCommandRanges}.ts`、`src/features/sql-script-import/`、`src/store/useTabStore.ts`、`src-tauri/src/commands/query.rs`、`src-tauri/src/core/statement.rs` | 已抽取 LSP→Monaco、completion、virtual-document lifecycle、稳定协议 provider coordinator、事务、query/explain/parameter execution、SQL 脚本审阅导入与 ES Console 文件操作。SQL、ES、Mongo 多命令文档共用显式 execution target；后台 statement/import/didOpen/provider call 在 tab、连接或 session 改变后不再触发过期操作。metadata/settings 刷新不再重建稳定 provider。下一步拆 metadata-sensitive completion/hover coordinator 与剩余 view lifecycle。 |
| 语句边界与多语句编辑 | `lib/sql/sqlStatementRanges.ts`、`currentStatementFrame.ts`、`executableStatementRangeCache.ts` 及 `lib/__tests__/sql/sqlStatementRanges.spec.ts` | 以顶层 token scanner 处理分号、过程体、注释、字符串与软边界；编辑补全边界和 Run All 边界可不同，但必须显式定义。 | `src-tauri/src/core/statement.rs`、`src-tauri/src/commands/query.rs`、`src/lib/queryEditorCachedCompletion.ts`、`src/features/query-editor/model/currentStatementDecoration.ts` | 已修复空行新语句、quoted identifier 与 PostgreSQL dollar quote 的上下文。当前 SQL frame 会按 Monaco model version 复用 Rust 一次返回的最多 10,000 个整文档权威 UTF-16 范围；跨语句/空白移动无 IPC，选区/Mongo frame 即时显示，同范围不重复刷新 decoration，exclusive end、编辑、模型和连接切换会失效。超限时有界降级为当前范围。下一步抽取 Rust/LSP 共用 statement-scope conformance fixtures，并完成真实 WebView 大文档计数验证。 |
| SQL LSP、补全与导航 | `lib/sql/semantic/README.md`、`semantic/{tokens,model,dialect,completion,references,diagnostics}.ts`、`lib/sql/sqlCompletion.ts`、`lib/editor/sqlIntentionActions.ts`、`sqlDiagnostics.ts` | token、语义模型、方言、补全、诊断、引用和结构化 intention 分别拥有单一事实源；当元数据不完整时返回 confidence/fallback，而不是伪装为精准结果。 | `src/services/lsp/`、`src/components/lsp/LspConnectionSyncer.tsx`、`src/components/workspace/QueryEditor.tsx`、`src/lib/whereCompletion.ts`、`vendor/sql-lsp/src/{parser/sql.rs,server.rs,dialects/mod.rs}` | 已支持 SQL/Mongo/Redis/ES provider 与版本路由；DBX 的 35 个声明式方言都保留厂商身份，已有专用 parser 的走 dedicated，其余注册为显式 compatibility alias。Bundled LSP local relation overlay 对 native/alias 方言共用 CTE/derived/table-function/correlation scope；支持 `WITH ORDINALITY`、partial positional rename、JOIN 后逗号 source、LATERAL/APPLY row source，以及相关子查询中被限定的外层 alias，同时保持未限定内层 completion 隔离。LSP Schema 现保留 catalog；三/四段对象名、SQL Server `database..table` 与跨 catalog 同名表按 catalog + schema + table 精确匹配，并保留 table hint 与真实 `lateral` 表 metadata。Completion bridge 现在同时覆盖 CompletionList defaults 与可选 `completionItem/resolve`：只在 server 能力允许时往返 opaque data，并以 256 KiB 上限和 owner/cancellation 门禁惰性补齐 documentation/detail/additional edits。Bundled server 会协商 client 的 documentation resolve 能力，以 8,192 项/4 MiB FIFO cache 延迟表、列、函数、约束与索引文档，单项超过 256 KiB 时保持 inline；原始 data 与候选身份在 resolve 前后保持稳定。受限同步的项目 SQL 文档进入缓存 symbol graph，DDL definition、workspace/document symbol、跨文档物理对象 references 与安全 rename 共用同一有界索引，CTE rename 保持文档内。relation alias 和限定列候选均保留原始 SQL 引号/大小写；裸列 filter 与显示 label 不牺牲精确 insertText，相关外层 alias 仍按需隔离。qualify/unqualify/batch qualify intention 只在 metadata 可证明安全时生成。比较操作符后的 completion 现按 metadata 类型提供 NULL、字符串、数字、布尔、temporal、UUID、JSON snippet 和 ENUM/SET 静态域值；不读取真实数据，类型歧义时降级为 NULL。Monaco 会传递 code-action kind，普通 lightbulb 不触发整文档 format。SQL-noise 屏蔽缓冲区在按键路径复用，512 KiB 上限约束扫描。仍需数据库族 × server version × SQL position 的端到端 matrix，并逐个用专用 parser 替换兼容别名。 |
| Mongo、Redis、Elasticsearch 工作区 | DBX 的 `types/database.ts`、connection capability 和非关系型 object provider；ES 可参考兼容类型 `elasticsearch/easysearch` 的分流 | 非 SQL 数据模型不应强塞进关系型表编辑 contract；query language、对象树和安全写入约束独立声明。 | Mongo/Redis/Elastic console、相关 driver 与 LSP provider | Mongo 编辑器与 Rust 驱动已支持单对象、顶层数组和空白分隔命令流；Run Current 与当前 command 边框不再调用 SQL scanner。Mongo aggregation stage 已按 server version 过滤。ES Console 与 bundled LSP 现在共享 ES 6/7/8 的主/次版本门控，且字符串内字段补全保留 JSON pointer 上下文。仍需真实 Mongo 版本 fixture、Redis command/key 类型矩阵，以及以真实 ES 映射与查询请求组成的容器化 6/7/8 conformance fixture。 |
| Grid、表格编辑与右键菜单 | `components/grid/*`、`lib/dataGrid/*`，优先 `dataGridRuntime.ts`、`gridSelection.ts`、`dataGridEditAdapter.ts`、`dataGridContextMenu.ts`、`dataGridConditionCompletion.ts` | 渲染、选择、值格式化、编辑适配、上下文菜单、查询控制和本地 UI 持久化要分模块；编辑权限由主键/事务/capability 决定。 | `src/components/workspace/DataGrid.tsx`、`TableDataView.tsx`、`src/features/data-grid/`、`src-tauri/src/commands/table.rs` | 需要继续补纯逻辑分包、复杂类型 cell editor、右键菜单/hover tooltip 的动作说明、服务器端筛选比较与版本化 capability 测试。 |
| WHERE、Sort 与表格条件补全 | `components/grid/DataGridConditionEditor.vue`、`lib/dataGrid/dataGridConditionCompletion.ts`、`dataGridConditionHistory.ts`、`dataGridConditionSuggestionPosition.ts` | 条件编辑器有自身 SQL 片段上下文：字段后应推荐运算符、值类型、AND/OR、括号；suggestion position 不应遮住输入和结果。 | `src/lib/whereCompletion.ts`、`src/features/data-grid/model/conditionHistory.ts`、TableDataView 的 filter/sort controls | 已覆盖字段、类型值、IN/BETWEEN/NULL、组合续写和同一行 Sort；已按 connection/database/schema/table 保存并复用已 Apply 的 WHERE 条件。下一步为历史项删除/管理、复杂括号/函数参数和真实 metadata/LSP 端到端矩阵。 |
| 数据导入、导出、转移 | `components/import/TableImportDialog.vue`、`components/transfer/DataTransferDialog.vue`、`crates/dbx-core/src/transfer.rs`、`database_export.rs`、`sql_file_import.rs` | preview/mapping 与真正执行共用明确 plan；导出是背压/取消/格式 contract，跨库转移是 source/target capability 的交集，而不是逐行 UI 拼接。 | `CsvImportDialog.tsx`、`JsonImportDialog.tsx`、`SqlScriptImportDialog.tsx`、`features/sql-script-import/`、`TableDataTransferDialog.tsx`、`TableDataView.tsx`、`src-tauri/src/commands/table.rs`、`src-tauri/src/commands/query.rs` | CSV 已有编码/分隔符/映射预览；native CSV/JSON/JSONL/XLSX preview 均计算完整源文件 SHA-256，确认导入时后端重新核验，杜绝预览后静默替换文件。JSON/JSONL 与 XLSX 首工作表先返回有界结构化样本、核对目标列，再以单一显式事务分批导入。SQL script 先返回方言分句的有界预览与内容 digest，并在专用审阅窗口确认；执行前重新读取并核验 digest。Editor/Explorer 复用同一 target-bound controller，拒绝重复预览/提交与过期上下文；脚本提交成功后立即封存原任务，metadata 刷新失败另建 introspection 失败任务，避免误导用户重复执行。导出使用稳定任务 ID，发出逐批进度，支持普通查询 backend cancel 与参数化查询协作式取消；失败或取消清理 `.partial`，仅成功 flush 后 rename 最终文件。项目级终态审计报告可按连接读取，保存对象/格式/计数/状态与安全错误摘要，不保存文件路径或查询内容。跨连接 append/overwrite/upsert 现提供结构化 `exact/safe/review/unsupported` 类型计划、显式转换说明、同路径预览转换、plan digest 复检、“有界分批写入、整次单事务提交/失败回滚”，以及稳定 transfer id、进度事件、源端 backend cancel 与协作式取消。多表复制会先按 FK 依赖完成所有映射预检，再在同一个目标事务内执行；循环依赖在尚无目标能力契约时明确拒绝。PostgreSQL 可显式启用同事务 serial/identity reseed，并将列清单和选项绑定到确认 token。执行会持久化逐对象终态报告。仍需 export backpressure/encoding/resume、import reject/resume、schema object transfer、外置驱动 semantic DDL conformance 和真实数据库 fixture。 |

阶段 128：新增 `export_database_sql` / `exportDatabaseSql`。这是内置 PostgreSQL 的受限整 schema SQL 备份：逐关系生成结构并以有界分页 SQL INSERT 写入同一原子发布文件，复用取消 token 与进度事件；外置驱动被拒绝。返回值显式列出未涵盖的 views、materialized views、routines、sequences、extensions、grants 与 foreign key constraints，避免将该初始关系备份误报为完整逻辑 dump。DBX 对应 `crates/dbx-core/src/database_export.rs` 的整库导出内核。
| Schema snapshot、diff 与 migration | `crates/dbx-core/src/schema.rs`、`schema_diff.rs`、`sql_editability.rs`；前端阅读 metadata/object capability | snapshot 应不可变、有 fingerprint；diff 先是审阅 artifact，再变成可执行 plan；migration 执行前校验依赖、目标版本与风险，不能只运行生成 SQL。 | `SchemaSnapshotDialog.tsx`、`SchemaDiffView.tsx`、`src-tauri/src/commands/schema_diff.rs`、`src-tauri/src/core/schema_diff.rs` | PostgreSQL 主路径已有 relation snapshot/diff/migration；snapshot 现同时保存函数/过程签名，例程漂移统一标为人工审阅、阻止自动执行，且不读取例程 body 或生成泛化 DDL。后续仍需为更多关系族定义 introspection、DDL renderer、transaction/rollback 能力和 data-loss preflight。 |
| 数据库管理命令 | `lib/database/createDatabaseSql.ts`、`databaseNamespaceCreation.ts`、`databaseUserAdmin.ts`、`dbAdminSql.ts`、`processListDrivers.ts`、`serverMetrics.ts` | 创建库、用户、权限、会话、指标都是按能力展开的管理动作，输入语义化 option，后端负责方言 SQL 与错误提示。 | `features/database-admin`、connection/admin commands、`src-tauri/src/commands/database_admin.rs` | PostgreSQL/MySQL 基础管理、会话与用户已覆盖；只读 metrics 面板通过固定后端语义查询显示连接数、活动查询、容量，PostgreSQL 另有缓存命中率与事务累计计数。锁等待页不含 SQL 文本：MySQL 8 使用 `performance_schema.data_lock_waits`，旧 MySQL/MariaDB 受控回退至 `information_schema.innodb_lock_waits`。Roles 页以固定查询展示角色成员边，不含权限或凭据。外部包被拒绝宿主生成的管理命令。仍需 privilege/grant diff、参数与 job，以及经产品契约审核的 maintenance/backup/restore。 |
| Driver/连接迁移与导入 | `lib/imports/{datagripImport,dbeaverImport,navicatImport}.ts`、`lib/__tests__/imports/*` | 外部配置导入必须是解析→预览→凭据处理→用户确认→持久化；未知字段保留为诊断，不静默伪造可用连接。 | `connection-import` feature、`ConnectionImportDialog.tsx`、connections persistence、driver package installer、connection form | DataGrip XML 与 DBeaver JSON 已走原生选择器（2 MiB 上限）→脱敏候选预览→逐项勾选保存；不读密码、token、SSH/private-key 或本机 driver path，且仅 ready/active runtime 可导入。仍缺 Navicat、folder/group 映射、冲突合并策略和更完整 fixture corpus。 |
| Agent 与安全执行 | `crates/dbx-core/src/{agent_catalog,agent_tools,agent_runtime,agent_loop,agent_events,agent_service}.rs` | Agent tool catalog、runtime、事件和服务层分离；数据库工具必须是有界 action 并带语境。 | `src-tauri/src/agent/`、Agent Host、command policy、Assistant 组件 | Oxide 的审批、文件 diff、shell policy 与 Git 面板更完整；继续把数据库 capability、连接 scope、审计和异常恢复写入每个 Agent tool contract。 |
| 视觉、键盘、tooltip 与可访问性 | DBX 各领域组件旁的 composables/tests；重点看 grid navigation、editor search、sidebar runtime host | 交互说明属于动作语义，不应复制成常驻文字；hover/focus/keyboard/IME 状态由同一 action metadata 生成。 | Workbench headers、tooltip、Vim/keymap、settings theme | 需统一快捷键 tooltip、hover-reveal actions、面板 pin 与焦点环；为跨窗体 Vim 导航建立可测试的 focus router。 |

### 3.1 DBX 连接迁移的可迁移设计

DBX 的三个解析器应被视为**不可信的离线输入适配器**，而不是连接创建捷径：

| DBX 输入 | 已验证的解析内容 | 必须剥离或降级的内容 | Oxide 迁移设计 |
| --- | --- | --- | --- |
| DataGrip `dataSources.xml` / `dataSources.local.xml` | driver ref、JDBC URL、host/port/database、user、group/layout | local storage 中的密码、任意 driver class/path、未知 XML macros | 解析为 `ConnectionImportCandidate`；识别 raw XML 和 DBX `datagrip-import` envelope，但只读取 `dataSources`，忽略 `dataSourcesLocal` 的任何潜在敏感字段。只有已激活 package 的 driver 才能进入可导入候选，未知 driver 留在诊断列表。 |
| DBeaver `data-sources.json` | provider/driver、configuration、folders、可识别 JDBC URL | 加密凭据文件、driver add-on、执行属性 | 识别 raw JSON 和 DBX `dbeaver-import` envelope；只读取嵌入的 `dataSources`，默认不读/不解密 `credentialsBase64`。保留 folder 仅作可选 project group 映射；URL 作为待审核文本而非直接连接。 |
| Navicat profiles | endpoint、database、folder、认证字段存在性 | 密码/密钥、SSH 私钥路径、同步/任务脚本 | 只导入非秘密 endpoint；SSH 与 driver package 需在 Connection Form 中重新选择。 |

正确的 Oxide 链路是：`选择文件 → 有界解析 → 脱敏 preview → 按 driver package 可用性分组 → 用户勾选 → 重新输入/确认凭据 → 持久化 → 可选 Test Connection`。
不得自动测试或连接导入项；导入项目也不得自动下载 JAR、sidecar 或 SSH 密钥。每个解析器需要
fixture 覆盖 IPv6、JDBC 参数、文件数据库路径、未知 vendor、重复名称及密码脱敏。

## 4. DBX 的整体架构：应借鉴什么，避免什么

### 4.1 借鉴：以纯逻辑层围住复杂 UI

DBX 的价值不在某一个大页面，而在它把高变更规则下沉到纯模块并用大量小测试固定：

```text
connection/product facts
  -> capability + dialect
  -> metadata/object tree + SQL semantic model
  -> editor/grid/transfer UI
  -> runtime command and error state
```

尤其值得迁移的拆分方式：

- SQL：tokenization → active statement → semantic model → completion/diagnostics/navigation。
- Grid：selection → cell coercion/formatting → edit adapter → query controls → context menu。
- Database：product capability → object capability → feature support → UI route。
- Transfer：选择 → mapping/type conversion → executable plan → progress/cancel/report。

OxideStudio 应把这些转换为可跨 React、LSP 和 Rust Host 使用的明确 contract，而不是将
DBX 的 Vue store 或集中式 switch 直接迁入。

### 4.2 避免：产品名称驱动的巨型分支和组件

DBX 的 `connectionStore.ts`、`queryStore.ts` 和大型 UI 组件展示了成熟功能覆盖，也说明
集中式状态会造成高耦合。OxideStudio 的目标结构应是：

```text
src/features/<domain>/model       # 可测试纯规则、capability adapter
src/features/<domain>/ui          # React 展示和可访问性
src/services                       # Tauri / LSP transport
src/store                          # 跨 Tab、跨工具窗的持久 UI 状态
src-tauri/src/core                 # 无 UI 的安全策略、dialect、plan、driver runtime
src-tauri/src/commands             # 薄 Tauri command 适配层
```

一个产品要增加能力时，优先新增或扩展 capability adapter 与 conformance fixture；只有
fixture 通过，才在 connection form、Explorer、Editor 或 Grid 中显露入口。

## 5. 数据库驱动与 70+ 产品的真实支持口径

DBX 的 `DatabaseType` 是广泛产品目录，并非“所有产品在每个功能都相同”。OxideStudio
同样不应以目录数来宣传支持度。每个候选产品都要标记为下列之一：

| 状态 | 含义 | 创建连接页中的行为 |
| --- | --- | --- |
| `bundled` | 内置 runtime 已通过核心连接/查询测试 | 搜索目录标记 Ready；可测试、保存和连接 |
| `package-ready` | 签名包可安装、激活、握手并通过产品 conformance | 搜索目录标记 Ready；可测试、保存和连接 |
| `catalog-only` | 仅有图标、产品信息和发布计划 | 仍可搜索并打开连接页；明确提示安装签名包，测试/保存/连接被禁用 |
| `experimental` | 有受限 adapter 或预览能力，显式列出限制 | 仅在实验开关下标记 Ready，否则按需要安装处理 |
| `unsupported` | 无可验证 runtime | 可作为目录事实显示，但连接页明确不可用且不伪造连接能力 |

每一个 `bundled` 或 `package-ready` 版本至少要通过：

1. connection、ping、server version、认证/网络错误分类；
2. metadata（database/schema/table/column，及其支持的对象）；
3. query、parameter、cancel、timeout 和错误位置；
4. dialect/identifier/placeholder 的 LSP 与执行一致性；
5. Grid 的分页、筛选、排序；若宣称可编辑，还需主键 mutation、transaction 与 rollback；
6. snapshot/diff/migration（若宣称支持 schema 变更）。

各产品族批次与现状以
[driver-family-rollout.md](driver-family-rollout.md) 和
[database-family-conformance-matrix.md](database-family-conformance-matrix.md) 为准。

## 6. LSP、编辑器与表格的对齐路线

### 6.1 一个语句范围合同

编辑器高亮、当前语句执行、completion、diagnostic、WHERE/SORT 条件补全必须基于相同
的语句/光标事实。DBX 的 `sqlStatementRanges.ts` 是参考入口；OxideStudio 目前在 Rust
`core/statement.rs` 和前端 cached completion 维护等价规则。下一步不是继续复制 parser，
而是建立一份共享 fixtures。首批跨端 fixture 已位于
`tests/fixtures/sql-statement-scope.json`，由前端
`sql-statement-scope-conformance.test.ts` 和 Rust `commands/query.rs` 同时读取：

- 多语句、有无分号、空行软边界；
- CTE、INSERT SELECT、EXPLAIN、procedural body、dollar quote；
- 反引号、方括号、转义 identifier；
- PostgreSQL dollar quote、MySQL backtick、SQL Server bracket identifier 等已覆盖方言特例；
- 光标为 UTF-16 offset 的 emoji、中文和组合字符。

### 6.2 metadata-first，但允许可信降级

DBX 的 semantic model 支持 confidence/fallback。OxideStudio 应同样明确地向用户和
调用方区分：metadata 同步中、缓存命中、完整 schema、通用 SQL 降级。缺 metadata 时可
推荐关键词和方言 snippet，不能伪造表字段；有 connection-local package/version 后，
才使用其 schema、dialect 与 object capability。

当前编辑器已在语句边界提供可由 Tab 导航的常用命令模板，并按实际产品选择分页与 DDL
语法：SQL Server/Access 使用 `TOP`，Oracle 系使用 `ROWNUM`，DB2/Dameng 使用
`FETCH FIRST`，Firebird 使用 `ROWS`，ClickHouse 使用 `ALTER TABLE ... UPDATE`；未知
JDBC 不猜测分页语法。模板与普通 completion 共用 connection-scoped usage ranking，且在
Redis/MongoDB/Elasticsearch 等非 SQL 文档中完全关闭。

### 6.3 Grid 条件语言是独立小型 LSP

WHERE 与 SORT 输入不是普通文本框。应复用同一个 dialect/metadata contract，并按光标
状态给出：

| 上下文 | 建议 |
| --- | --- |
| 空条件或 `AND/OR/(` 之后 | 字段、函数、`NOT` |
| 字段之后 | `=`, `<>`, `>`, `IN`, `BETWEEN`, `IS NULL`, `LIKE` 等兼容运算符 |
| 运算符之后 | 类型化 literal、参数、子查询/列表片段 |
| 完整谓词之后 | `AND`、`OR`、`)`、排序/应用动作 |
| Sort 区域 | 字段、`ASC/DESC`、`NULLS FIRST/LAST`（由方言能力决定） |

当前 WHERE 本地 fallback 已覆盖字段后的运算符、`IS`/`NOT` 分支、`IN`/`BETWEEN`
续写，并按已知的 boolean、temporal、numeric、text 类型提供安全的值片段；LSP 元数据
返回时仍优先用其 detail 覆盖本地候选。下一步是将真实值采样做成明确 opt-in capability，
而不是把数据内容无条件送入 completion 服务。

## 7. 迁移工作清单（从这里进入实现）

### 7.1 P0：先收敛事实源

- [x] 增加首批跨 Rust 与 LSP 的 statement-scope fixture corpus；持续扩展 Oracle、ClickHouse
  与 procedural body 覆盖。
- [x] `get_connection_database_capability_context` 已把 live connection、精确 package version、
  server version、签名 capability 与 schema migration mode 统一为单次只读快照；LSP sync
  与 Query Editor 优先读取该快照，重连时不复用旧 server/package 组合。
- [x] 将 `QueryEditor.tsx` 的已识别 model lifecycle、LSP adapter、execution controller 和 view lifecycle 拆入独立模块；Console auto-suggest 已完成 focus/model-version 门禁和清理，真实 Monaco/provider 组合验证延期。
- [x] 为 Grid filter/sort 建立语法位置、typed literal 和 multi-predicate 测试矩阵；
  覆盖 NOT/IS NOT、quoted identifier、BETWEEN/IN 零宽续写、类型化值候选，以及
  ResultSet 类型驱动的任意精度数值、日期、自然文本、NULL-last 和稳定本地排序。
  真实 Monaco 与各产品数据库排序/谓词语义继续进入延期验证队列。
- [x] 将 DBX `sqlCompletion.ts:HIGH_FREQUENCY_KEYWORDS` 的常用关键字层迁入 bundled LSP；
  该层仅在既有语义分组内排序，并保留 connection-scoped usage ranking 的更高个人优先级。
  标准 completion 与有界 inline candidate 共用同一逻辑，真实 Monaco 接受顺序继续延期验证。
- [x] 将 popup 与 inline 智能提示收敛到同一候选增强管线；产品函数、窗口/表函数、表级
  INSERT 代码块、alias、权威 edit、casing、去重和排序不再只存在于 popup。inline 仍限制为
  32 项，ghost text 能处理限定 member、零宽空格续写和去 tab-stop 的多行 snippet。
- [x] 将用户配置与产品专属 command snippet 接入同一 popup/inline 事实源；exact trigger、
  connection-scoped usage、插入内容去重和 32 项上限保持有界，LSP 启动/恢复期间仍可本地推荐，
  Oracle/Manticore/Db2/Dameng 代码块不会泄漏到其他产品或非 SQL 编辑器。

### 7.2 P1：以产品族推进，而不是堆菜单项

- [ ] 为 DuckDB、ClickHouse、SQL Server、Oracle 建立 package conformance harness。
- [ ] 为 PostgreSQL/MySQL 的版本线补充 metadata、LSP、DDL 与 Grid 组合 fixture。
- [ ] 为 Elasticsearch 6/7/8、Mongo server/aggregation 和 Redis key type 建立容器化版本 fixture；当前前端与 bundled LSP 已有 ES 6/7/8 版本门控单元覆盖，但尚未替代真实服务验证。
- [ ] 新增产品只有通过 `connect → metadata → query → cancel → error map` 后才可公开。

### 7.3 P2：完善数据生命周期

- [x] CSV/JSON/XLSX/SQL import 已统一为 preview 后 native execution；SQL import 使用专用审阅窗口、方言分句预览和执行前 digest 复检。Native table import 以稳定 ID 保存对象、格式、mapping 配置摘要、计数、终态和安全错误摘要；源路径与文件 digest 不持久化。
- [ ] Export 已补稳定任务 ID、进度、backend/cooperative cancellation、原子产物、脱敏终态审计、Explorer/表数据页取消入口，以及 CSV 的 UTF-8/UTF-8 BOM 选择；仍需背压与 resume。
- [x] 跨库 transfer 已把基础类型兼容性、显式转换、unsupported 阻止、确认 digest 与整次事务 rollback 变成可审阅 plan。
- [x] Transfer 已提供稳定 ID、批次进度、源端 backend cancellation、协作式取消与取消后整次事务回滚。
- [x] Transfer overwrite 已使用事务内 DELETE、目标行数硬上限、确认摘要绑定与执行时 affected-row 复检，避免 TRUNCATE 隐式提交。
- [x] bundled PostgreSQL/MySQL/SQLite 的单表 transfer 已支持以目标完整主键为冲突身份的
  upsert；确认摘要绑定 key columns，外置包在 semantic conflict-write protocol 完成前拒绝。
- [ ] 继续补齐 transfer 的 owned-sequence/ownership preview、循环 FK policy、schema object transfer、外置驱动逐产品 semantic migration 实现/evidence 和真实数据库验证；descriptor-only plan/preflight/token-bound apply/verify 协议、签名/runtime/exact-evidence 门禁、Host-only 单次 session、UI apply 主路径和双重 post-verify 已落地，多表依赖顺序、同事务执行、PostgreSQL identity/serial reseed 与持久化逐对象报告已落地。
- [ ] 按 capability 扩展 snapshot/diff/migration，禁止未实现的方言生成可执行 DDL。

### 7.4 P3：工作台体验

- [x] Explorer 已提供连接打开绿点、失败红点、metadata loading/stale/error 状态，以及 cache-first 对象树与显式刷新；表节点可展开 columns/indexes/constraints。后续对象类型覆盖（trigger、sequence、权限等）仍按驱动能力逐族补齐。
- [ ] Grid hover/右键菜单以统一 action metadata 提供简洁说明和快捷键。
- [ ] Vim 跨区域导航由 focus router 管理，并覆盖 editor/grid/sidebar/tool-window。
- [ ] 主题、字体和高级外观设置由 token 层驱动，不向功能组件散落颜色值。

## 8. DBX 源码快速索引

以下路径适合直接搜索对应原理；测试文件通常紧邻同一目录下的
`lib/__tests__/<domain>/`：

```text
apps/desktop/src/types/database.ts                    产品与连接数据模型
apps/desktop/src/lib/database/databaseCapabilities.ts 产品能力定义
apps/desktop/src/lib/database/databaseObjectCapabilities.ts
                                                        Explorer 对象目录
apps/desktop/src/lib/database/databaseFeatureSupport.ts 功能开关/降级
apps/desktop/src/lib/database/jdbcDialect.ts           JDBC → 有效方言
apps/desktop/src/components/sidebar/ConnectionTree.vue Explorer 树 UI
apps/desktop/src/lib/sql/sqlStatementRanges.ts          语句范围 scanner
apps/desktop/src/lib/sql/currentStatementFrame.ts       当前语句 frame
apps/desktop/src/lib/sql/semantic/README.md             SQL semantic 分层说明
apps/desktop/src/lib/sql/semantic/*.ts                  语义、补全、诊断、导航
apps/desktop/src/components/editor/QueryEditor.vue      编辑器编排
apps/desktop/src/stores/queryStore.ts                   查询/结果状态（阅读时注意高耦合）
apps/desktop/src/lib/dataGrid/*.ts                      Grid 纯逻辑
apps/desktop/src/components/grid/*.vue                  Grid 视图与小型交互
apps/desktop/src/components/import/TableImportDialog.vue CSV/表导入 UI
apps/desktop/src/components/transfer/DataTransferDialog.vue
                                                        跨库转移 UI
apps/desktop/src/lib/imports/*.ts                       外部客户端配置导入
crates/dbx-core/src/driver_runtime.rs                   driver runtime
crates/dbx-core/src/{schema_diff,schema,transfer}.rs    schema/transfer 后端模型
crates/dbx-core/src/{agent_catalog,agent_tools,agent_runtime}.rs
                                                        Agent 边界
```

## Phase 114：函数大小写迁移映射

- DBX `apps/desktop/src/lib/sql/sqlFormatterConfig.ts:functionCase` →
  Oxide `src/lib/appSettings.ts:SqlCompletionSettings.functionCase` 与 Settings 的 SQL completion 行。
- DBX `QueryEditor.vue` 向 `SqlCompletionSource` 传递 `functionCase` →
  Oxide `LspConnectionSyncer.tsx` → `configDispatch.ts` → bundled LSP workspace configuration。
- DBX `applySqlFunctionCase` / `applyGeneratedSqlTemplateKeywordCase` →
  Oxide `vendor/sql-lsp/src/server.rs:apply_completion_preferences`。该 pass 同时服务 popup 与
  inline candidates，不建立第二套补全事实源。
- DBX `buildOracleTableFunctionItems` / `buildFunctionSnippetItems` →
  Oxide bundled/window/ClickHouse/Oracle generated items；live routine metadata 不改写。
- Oxide 本地 product command blocks 在 `sqlCommandSnippets.ts` 使用同一 `functionCase`，但只转换
  未经用户修改的内置模板，以保留用户配置的 SQL 正文。

## Phase 115：格式化大小写单一事实源迁移映射

- DBX `apps/desktop/src/lib/sql/sqlFormatterConfig.ts:41-70,183-195,256-258` 的
  `keywordCase`/`functionCase` 默认值、规范化和 formatter 参数映射 → Oxide
  `src/lib/appSettings.ts:SqlFormattingSettings`、设置持久化规范化与
  `src/services/lsp/syncPlan.ts:LspFormattingPreferences`。
- DBX `components/editor/SqlFormatterSettingsPanel.vue:99-101,520-544` → Oxide
  `src/components/settings/SettingsDialog.tsx` 的 SQL formatting 分组；写入时同步旧 completion
  字段以兼容既有用户配置，但运行时只读取 formatting 字段。
- DBX `components/editor/QueryEditor.vue:3347-3409,3676-3677,4137-4138` 将 formatter case
  同时传入 popup、inline 和 SQL template → Oxide `QueryEditor.tsx`、
  `useCachedSqlCompletionSource.ts` 与 `LspConnectionSyncer.tsx` 共用同一 formatting case。
- DBX formatter 的独立 keyword/function case → Oxide
  `vendor/sql-lsp/src/dialects/common.rs:format_sql_pretty_with_keyword_case` 与
  `apply_formatter_function_case`。后者只改写 Tree-sitter `invocation` 名称，避免触碰 relation、
  data type、placeholder、字符串、注释和 quoted identifier。
- `vendor/sql-lsp/src/server.rs` 对全篇与 range formatting 使用同一处理管线；MongoDB、Redis、
  Elasticsearch 等非 SQL dialect 继续调用自身 formatter，不继承 SQL 大小写设置。
- 来源 LSP 171 项测试、Clippy 与主项目 bundled subprocess 13 项测试通过；真实 Monaco 和各产品
  formatter conformance 仍按延期清单统一验证，本阶段未连接数据库。

## Phase 116：Oracle Agent 执行错误范围迁移映射

- DBX `apps/desktop/src/lib/sql/sqlDiagnostics.ts:oracleInvalidIdentifierRange` → Oxide
  `src/lib/queryErrorPresentation.ts:oracleInvalidIdentifierRange`：从 `ORA-00904` 提取标识符，
  在执行 SQL 中按报告位置选择最近的 Unicode identifier，quoted identifier 保持大小写。
- DBX `sqlErrorDecorationRange` 对 `error occur(red) at position` 的 zero-based offset 支持 →
  Oxide `oracleAgentErrorRange`；它只在没有原生 structured position 时回退，畸形和越界值不生成
  marker，PostgreSQL one-based character position 继续走原契约。
- DBX CodeMirror decoration → Oxide `extractQueryExecutionError` 将 execution range 加上当前语句
  `sourceStartOffset`，生成整文档 `documentOffset`/`documentEndOffset`；`QueryEditor.tsx` 的既有
  `database-query` Monaco owner 消费完整范围，不注册第二套诊断 provider。
- `tests/frontend/query-error-presentation.test.ts` 覆盖多语句 + emoji UTF-16 偏移、多字符标识符、
  quoted case、zero offset、越界拒绝和原生 PostgreSQL位置；完整前端 237 文件/1,261 项测试及
  生产构建通过。本阶段未连接数据库。

## Phase 117：MongoDB Extended JSON / BSON 类型保真映射

- DBX `crates/dbx-core/src/db/mongo_driver.rs:insert_document_extended_json` → Oxide
  `src-tauri/src/drivers/mongodb.rs:json_to_bson/json_to_document`：使用 BSON crate 的专用
  Extended JSON decoder，而非依赖未声明的通用 Serde 表现。
- DBX canonical document clone payload → Oxide `bson_to_json` 显式输出 relaxed Extended JSON；
  `command/find/aggregate/count/insert/update/delete` 全部复用同一输入边界，结果 grid 和后续 mutation
  不维护第二套类型转换。
- Rust contract 覆盖 ObjectId、DateTime、Int64、Decimal128、Binary、nested ObjectId 和完整
  encode/decode equality；Mongo shell-like `ISODate(...)`/`ObjectId(...)` 保持普通字符串，不执行
  或猜测 shell 语法。
- `cargo clippy --lib -- -D warnings` 与锁定依赖的最小 Rust executable round-trip 通过。正式
  `oxide_studio_lib` 单测已成功编译，但当前 Windows 宿主在运行任何该测试二进制前报
  `STATUS_ENTRYPOINT_NOT_FOUND`；未把它记为测试通过，已进入延期验证记录。本阶段未连接数据库。
- Oxide 当前没有 DBX `DocumentBrowser.vue` 的可视化 clone surface；后续新增时必须携带源 document
  identity 和 edited-field metadata，并复用本阶段原生边界，不能在前端重新解释 BSON。

## Phase 118：pending completion 的 Tab 接受迁移映射

- DBX `apps/desktop/src/components/editor/QueryEditor.vue:acceptCompletionOrNextSnippetField` /
  `waitForCompletionTab`（`fe10790bb`）→ Oxide
  `src/features/query-editor/model/editorOptions.ts:buildQueryEditorOptions`。
- DBX 在 CodeMirror 层以 16ms timer 等待 pending completion，并在超时/空结果时恢复普通 Tab；
  Oxide 使用 Monaco 已有的 `tabCompletion: on` command contract：等待 suggest model、只接受确实
  产生 edit 的最佳候选、无候选回退 `tab`，避免在 React 生命周期再复制 pending/timer 状态机。
- Monaco 的 `inSnippetMode` 上下文先于 tab completion，因此 INSERT/函数/command 代码块的 tab stop
  不会被新请求抢占；popup 与 inline suggestion 仍按编辑器内核的标准上下文决定 Tab 接受者。
- `manual` 模式显式设置 `tabCompletion: off`，保留“仅 Ctrl+Space/显式动作触发”的用户契约；
  `positional` 与 `require-prefix` 模式启用等待逻辑。
- `editorOptions.test.ts` 固定三种触发模式的配置边界。真实慢 provider、IME、Vim、多光标、
  read-only、popup/ghost 同现与原子 undo 进入统一延期验证；本阶段不连接数据库。

## Phase 119：relation alias 匹配与引用语义迁移映射

- DBX `lib/sql/sqlCompletion.ts:buildReferencedAliasItems`、
  `lib/sql/semantic/completion.ts:sourceQualifierSql`（`868f7961e`）→ Oxide
  `vendor/sql-lsp/src/server.rs:add_referenced_alias_completions`、
  `parser/sql.rs:resolve_relation_alias` 与
  `dialects/{postgres,mysql,hive,clickhouse}.rs`。
- DBX 把 source qualifier 的显示名、精确插入 SQL 与底层 relation 分开保存；Oxide 的
  `RelationAlias { name, sql, relation }` 延续同一边界，并把普通未引用 alias 的 lookup
  收敛为 case-insensitive，而 quoted alias 的原始 SQL 拼写继续只由 `sql` 提供。
- alias 候选现在复用列名的 exact/prefix/缩写/subsequence rank，排序稳定且有界；去重键同时
  包含 label 和 insertText，因此 `u`、`"U"`、`` `U` `` 或 `[U]` 不会因展示名相同被压扁。
- 新增 library 与 PostgreSQL schema-aware contract，覆盖大小写普通 alias、quoted collision
  候选、fuzzy alias 与 `alias.` 到 metadata column 的解析。真实服务端 quotation/case setting、
  IME/Monaco 接受和中文 live metadata 继续进入统一延期队列。

## Phase 120：Elasticsearch 索引分组与最小权限发现迁移映射

- DBX `crates/dbx-core/src/db/elasticsearch_driver.rs`、
  `apps/desktop/src/lib/connection/elasticsearchKibanaProxy.ts`、
  `ConnectionDialog.vue`（`901f5ca3d`）→ Oxide
  `src-tauri/src/drivers/elasticsearch.rs`、
  `src/components/connection/ConnectionForm.tsx`、
  `src/store/useConnectionStore.ts`。
- 连接表单新增可选 `indexGroupingPattern`。它经已持久化的 connection config 进入 URL query，
  bundled driver 只在建立 client 时读取；不会透传到 Elasticsearch request path 或日志。
- Explorer 先使用 `_cat/indices`；401/403 时按 `_resolve/index/*`、`_alias` 依次降级，
  因此仅有 index metadata/read 权限的账号仍可得到可见 index/data stream。内部 `.` 索引被过滤，
  collection 名称去重排序。正则分组将时间序列尾部折为 `*` 并聚合已知 document count。
- 真实 Elasticsearch 6/7/8、Kibana proxy、受限 role、data stream/wildcard mapping、非法正则、
  group 后 Console/LSP field completion 与大索引列表性能继续延期验证；本阶段不连接集群。

## Phase 121：对象浏览器表 Tab 复用策略迁移映射

- DBX `apps/desktop/src/App.vue:onClickTable/onViewTableData` 与
  `composables/useNavigationTargets.ts:openObjectBrowserTableTarget`
  （`04580355d`）→ Oxide `SchemaSidebar.tsx` 与
  `useTabStore.ts:findOrCreateTableTab`。
- Data Grid 设置现在提供 `same-table`（默认）、`always-new` 与 `active-tab`。本地树和
  PostgreSQL remote database 入口将策略显式传给同一 tab-store action，避免右键、双击、
  导入前打开和远程 database 路径形成不同的 reuse 行为。
- `active-tab` 只重定向同连接/同 database 的闲置、无 pending edit 表 Tab；重定向前清除
  relation-specific results/filter/metadata，防止旧表数据短暂显示。执行中、带编辑或跨数据库
  的 Tab 都 fail-safe 新建，绝不丢弃用户工作。
- 真实 WebView 的双击、右键菜单、键盘 command palette、Tab restore、multi-window 和
  PostgreSQL 多 database 开关进入延期验证；本阶段不连接数据库。

## Phase 122：LSP alias 到 metadata schema 解析收口

- DBX `lib/sql/semantic/completion.ts:sourceQualifierSql` 与
  `sqlCompletion.ts:buildReferencedAliasItems` → Oxide
  `vendor/sql-lsp/src/parser/sql.rs:resolve_relation_alias`、
  `server.rs:schema_for_table_column_at_position`、
  `dialects/common.rs:referenced_table_names_at_position`。
- server-level schema selection 与 scope helper 不再使用只支持精确 key 的旧 alias map；
  它们复用同一 ordinary-unquoted case-insensitive resolver，保证 popup、inline、schema
  inference 与 metadata column lookup 不会因为路径不同给出冲突结果。
- library contract 覆盖 `FROM audit.events EventAlias ... eventalias.`，保持 UTF-16 光标
  语义。真实 PostgreSQL/MySQL/SQL Server 的 quoted/unquoted collision、case setting 与
  live metadata refresh 继续在延期队列验证；本阶段不连接数据库。

## Phase 123：quoted alias 的 code-action 身份收口

- DBX `lib/sql/semantic/completion.ts:sqlSemanticReferencedTables` 的 `aliasSql` 与
  `sqlCompletion.ts:buildReferencedAliasItems` → Oxide
  `vendor/sql-lsp/src/server.rs:column_qualification_sources`、
  `qualification_sources_are_equivalent`、`source_matches_qualifier`。
- 限定/取消限定列的 source 去重与 qualifier match 现在共享 SQL identifier 边界：普通
  alias 仍按大小写不敏感匹配，任一方为双引号、反引号或方括号的 alias 则按原始 SQL
  拼写精确匹配。`u` 和 `"U"` 因而可以同时提供正确的 `u.id`/`"U".id` action，
  未加引号的 `U.total` 不会错误解除 `"U".total` 的限定。
- library contract 覆盖 quoted/unquoted collision 与错误 quote 形式；真实 Monaco
  code-action 菜单、各 dialect quote policy 和 live metadata 继续延期验证，本阶段不连接数据库。

## Phase 124：Grid 显式 SQL expression cell

- DBX grid edit adapter、cell generation 与 bulk edit modules → Oxide `ValueEditorDialog`、
  `DataGrid`、`useTabStore:commitEdits`、`commands/table.rs:build_update_mutation`。
- Value Editor 将 `Value`、`NULL`、空字符串、未加载/default 与 `Expression` 区分；expression
  仅面向已有行。网格以 `ƒx` 标记 draft，不将其误用为筛选值、FK 导航值或数值聚合；新行仍通过
  未发送列取得数据库 default，不能把 expression marker 降级为 JSON 参数。
- 普通 value 继续以目标列类型参数化。expression 由 UI 初筛，Rust 使用 dialect-aware
  `validate_sql_filter_expression` 复验，且不允许 value/expression 同列混用；不实现任意 SQL
  拼接或多语句执行。

## 9. 文档维护规则

当某项能力状态发生变化时：

1. 更新本文件的“当前差距与验收点”或 checklist；
2. 更新 `dbx-reference-gap-analysis.md` 中的事实/优先级；
3. 为真实可用的产品更新 conformance matrix，不以 UI 目录项作为证据；
4. 在实现 PR/提交中写明参考的 DBX 路径和新增的 OxideStudio 测试。

这样可以在数月后继续实施某个领域时，仍能从原理、源码、当前边界和验收条件四个方向
快速恢复上下文。
# Phase 125 -- full table compare mapping

| DBX reference | OxideStudio implementation | Deliberate boundary |
| --- | --- | --- |
| `crates/dbx-core/src/data_compare.rs:prepare_data_compare_from_tables` | `src-tauri/src/commands/table.rs:compare_table_data_full` | Both count before reading, page in stable key order and fail on duplicate keys. Oxide accepts only the existing reviewed transfer dialect/capability contract. |
| `data_compare.rs:fetch_compare_rows` | `fetch_full_data_compare_rows` | 100--5,000 row host batches; 100,000 rows per side hard cap avoids a partial result masquerading as full compare. |
| `apps/desktop/src/components/diff/DataCompareDialog.vue:startCompare` | `src/components/workspace/DataCompareView.tsx` | Loaded-result compare stays available for query/table snapshots; the new explicit action is table-to-table only and labels host/full scope. |
# Phase 126 -- latest DBX hover-layout convergence

- Re-fetched DBX `origin/main` at `7b3f4875e3cd3f2f7a99bd3ce47ab3d413bcdc64`; ChartDB remains `c24936a402bb3e24b4858f05282d69a04fcfe25b`. DBX's only new editor change since the prior baseline is `apps/desktop/src/lib/editor/sqlHoverLayout.ts`, which constrains CodeMirror table-DDL tooltip dimensions and supplies a custom horizontal scroll track.
- Oxide Monaco owns hover container layout, so DBX's DOM/lifecycle helper is not transferable directly. Its metadata hover already has a 24-column / 3-index ceiling; `src/lib/queryEditorTableHover.ts` now closes the remaining equivalent failure mode by Markdown-escaping database-owned identifiers, compacting long default values, and showing at most eight columns per index. The payload therefore remains readable and cannot turn a database name, default, or wide index into malformed/unbounded hover content.
# Phase 127 -- completion merge revision guard

- LSP completion already rejected a stale server response, but its subsequent cached field and FK JOIN enrichment was asynchronous and could publish after the user had edited the Monaco model. `completionRequestGuard.ts` now binds every live/cache merge to cancellation, the captured model version and request generation. A stale result is discarded instead of inserting an out-of-date column, relation or code block.
- This aligns with DBX's editor lifecycle principle (late completion work must not win over current input) while preserving Oxide's Monaco-specific owner/model gates. It applies to both live LSP and startup/error fallback paths.
