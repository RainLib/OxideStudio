# OxideStudio 与 DBX 详细差距矩阵

> 审计基线：2026-08-02
> DBX 参考提交：`8efe83aaa`
> 参考工程：`sources/dbx`（只读）

本文所有 DBX 路径都相对 `sources/dbx/`：`lib/...` 表示
`apps/desktop/src/lib/...`，`components/...` 表示
`apps/desktop/src/components/...`；`crates/...`、`agents/...` 和 `src-tauri/...`
均可直接从 DBX 根目录定位。带 `:函数名` 或 `:行号` 的条目进一步指出核心入口。

## 1. 支持口径

- Oxide 的 `referenceDriverCatalog` 有 73 个候选产品，但候选、可安装、可连接、可浏览、
  可编辑和可迁移是六个不同状态。
- 当前无需外置包即可运行的 bundled driver 是 PostgreSQL、MySQL/MariaDB、SQLite、
  MongoDB、Redis 和 Elasticsearch。
- DBX 的 `DatabaseType` 覆盖 68 个类型，driver manifest 有 66 条描述；
  `sources/dbx/agents/drivers` 中有 45 个独立 agent 工程，另外还有 native/file/HTTP
  driver。DBX 的产品数量来自这些实际运行时，不是只来自前端枚举。
- 本文的“对齐”表示达到相同用户能力和可验证边界，不表示复制 DBX 源码或架构。

状态定义：`已对齐`、`部分对齐`、`未对齐`、`Oxide 加强项`。

## 2. Driver、连接与 70+ 数据库

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| D01 | 部分对齐：产品 capability 与运行时分层 | `crates/dbx-core/assets/database-drivers.manifest.json`；`apps/desktop/src/lib/database/databaseDriverManifest.ts` | `src/features/database-drivers/model/referenceDriverCatalog.ts`；`src-tauri/src/core/dialect.rs` | 每个公开产品由安装状态和 capability 决定入口；候选项不能显示为可连接。 |
| D02 | 部分对齐：实际 driver 数量 | `agents/drivers/*` 45 个独立工程；`crates/dbx-core/src/db/*_driver.rs` | bundled 6 个；DuckDB 侧车已在 Windows x64/DuckDB v1.5.5 通过真实 package conformance；RQLite/ClickHouse 已有 release payload，但仍缺真实 server evidence | 每个产品通过 `connect/ping/version/metadata/query/cancel/error-map` 后才从候选变为 ready。 |
| D03 | 部分对齐：外置 driver 安装、激活、回滚 | `src-tauri/src/commands/agents.rs`；`crates/dbx-core/src/agent_manager.rs`；`components/config/DriverStoreDialog.vue` | `src-tauri/src/core/driver_package.rs`；Settings Driver Manager | 保留 Oxide 的 Minisign、SHA-256、原子激活和 connection pin；补真实发布包。 |
| D04 | 部分对齐：托管 Java/JAR 产品交付宽度 | `agents/common/*`；每个 `agents/drivers/<product>/build.gradle` | managed Java/runtime、generic JDBC agent、H2 内存 conformance fixture 已具备；Agent 现以真实 sidecar wire casing 处理连接/查询/cancel，尚无 SQL Server/Oracle 等正式签名包 | vendor JAR、Java 版本、URL 模板、server range 与 conformance 同时进入签名 catalog。 |
| D05 | 未对齐：Maven/依赖获取工作流 | DBX agent driver 的 Gradle 依赖与安装流程；`DriverStoreDialog.vue` | 只接受本地签名 JAR/package，不解析任意 Maven 坐标 | 如增加在线获取，必须使用 allowlist、锁定 digest、断点缓存和许可证清单。 |
| D06 | 部分对齐：runtime 可观测性 | `crates/dbx-core/src/driver_runtime.rs`；`components/config/driverRuntimeDisplay.ts` | `ConnectionManager::external_driver_runtime_summaries` 和 Driver Manager；按 package/version 聚合当前连接/PID/不可用数、进程生命周期内的启动次数、观测到的退出次数与最近时间 | 仍需经过真实 sidecar fixture 的崩溃预算、受控重连原因与持久化脱敏诊断；绝不保存 stderr、连接信息或 SQL。 |
| D07 | 未对齐：下载断点续传与缓存回收 | DBX driver store/install UI 与 agent artifacts | Oxide 已有摘要命名缓存和损坏复验，但下载仍是整包 | 支持 range resume；缓存回收必须按 active/previous/pinned/live connection 保留集合执行。 |
| D08 | 已对齐：连接级事实源 | DBX `connectionStore.ts`、`connectionDatabaseInfo.ts` | `get_connection_database_capability_context`；`LiveConnectionCapabilitySnapshot` | package、server version、capability 和 migration mode 必须来自同一 live driver 实例。 |
| D09 | 部分对齐：复杂连接参数 | `lib/connection/oracleTnsConnection.ts`、`postgresTlsMode.ts`、`hiveKerberosOptions.ts`、`damengSslOptions.ts` | SSH、SSL、URL 与常用连接字段已支持 | 按产品包声明结构化字段；Oracle TNS、Kerberos、代理、集群地址需逐产品实现并脱敏持久化。 |
| D10 | 部分对齐：真实版本矩阵的证据门禁已落地，矩阵本身尚未覆盖 | `crates/dbx-core/tests/live_*`、各 `agents/drivers/*/src/test`、`.github/workflows/database-environments.yml` | `scripts/run-driver-conformance.mjs`、fixture/report schema、签名 catalog evidence binding；DuckDB v1.5.5 已完成本地 package 运行证据，尚未签名发布；其余真实数据库组合不足 | PostgreSQL/MySQL 最低/主流/最新；ES 6/7/8；Mongo/Redis；每个首发外置包至少两个 server 版本。 |

## 3. SQL Editor、语义分析与 LSP

DBX 这一领域的核心不是独立 LSP，而是 CodeMirror + TypeScript semantic model。Oxide
应把其中的语义场景加入 bundled LSP/Monaco contract tests，不应把前端解析器原样搬入。

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| L01 | 已对齐：多语句/软边界 | `lib/sql/sqlStatementRanges.ts`；`lib/sql/semantic/tokens.ts` | Rust current-statement scanner、bundled LSP statement scope、前端 fallback | 无分号双 SQL、CTE、INSERT SELECT、EXPLAIN、过程体、引号和注释使用同一 fixture corpus。 |
| L02 | 部分对齐：完整 semantic model | `lib/sql/semantic/model.ts`、`references.ts`、`diagnostics.ts` | bundled LSP + `src/lib/sqlAnalysis.ts` + cached completion | 补 CTE shadow、correlated subquery、table function、lateral/apply、projection alias、三段 catalog 限定组合测试。 |
| L03 | 部分对齐：方言关键词与类型 | `lib/sql/sqlCompletion.ts` 中 `DATABASE_SQL_KEYWORDS`、函数签名和 dialect sets | bundled LSP dialect registry、`databaseDialect.ts`、常用 snippet fallback | Oracle/SQL Server/ClickHouse/DB2/Dameng 由 package product identity 选择，generic JDBC 不伪造诊断。 |
| L04 | 部分对齐：函数签名帮助 | `sqlCompletion.ts:getSqlFunctionSignatureHelp` 与 per-dialect signature maps；对应 `sqlCompletion.signature.spec.ts` | LSP signature help 基础路径 | 覆盖 overload、可选参数、嵌套调用、routine metadata、server-version gating。 |
| L05 | 部分对齐：对象/列补全 | `sqlCompletion.ts:buildSqlCompletionItems*`；`metadata/completionTreeIndex.ts` | LSP schema sync、metadata cache fallback、WHERE completion | alias、同名表、跨 schema/catalog、CTE、临时表和多表歧义均有确定行为。 |
| L06 | 部分对齐：INSERT values inlay hints | `lib/sql/insertValueHints.ts`；`codemirrorInsertValueHints.ts` | Monaco inlay provider 现合并 LSP hints 与 `sqlInsertValueHints`：对显式 `INSERT INTO t (a, b) VALUES ...` 的每个值标注列名，支持多行 VALUES、嵌套表达式、注释/字符串隔离；不因输入触发 metadata 读取 | 无列清单时按需、受限地取 metadata；增加用户开关与更广方言语法 corpus。 |
| L07 | 未对齐：跨 console symbol/reference index | `lib/sql/semantic/references.ts` 和本地 semantic fixtures | 项目 SQL 虚拟文档同步已存在，但没有项目级 symbol graph | 支持 table/view/routine/CTE 引用查找和安全 rename preview；migration/view definition 可成为只读来源。 |
| L08 | 未对齐：真实值采样补全 | `sqlCompletion.ts:buildComparisonValueItems` | Oxide 只提供类型安全的值模板 | 新 capability 必须显式 opt-in，限定列/行数/字节数，不把样例值无条件送到 LSP 或 Agent。 |
| L09 | 已对齐：常用命令 snippet | `lib/sql/sqlSnippetTemplates.ts`；`sqlCompletion.snippet.spec.ts` | `features/query-editor/model/sqlCommandSnippets.ts` | 按产品选择 LIMIT/TOP/ROWNUM/FETCH/ROWS、DDL 与 mutation 语法；接受历史按连接排序。 |
| L10 | 部分对齐：补全展示和插入 | `lib/editor/sqlCompletionPresentation.ts`、`sqlCompletionInsertion.ts` | LSP→Monaco adapter、usage ranking、snippet insertion | textEdit/additionalTextEdit、quote policy、自动 alias、触发后链式补全形成 provider 集成测试。 |
| L11 | 部分对齐：结构化编辑 intentions | `lib/editor/queryEditorTextEdits.ts`、`sqlInListPaste.ts`、`sqlQuoteCaret.ts` | 已有格式化、星号展开和危险语句 guard；`sqlEditorIntentions` 提供 quote/unquote identifier 和 clipboard→IN-list，Monaco 对所有非空选区原子应用，任一选区无法安全转换即不修改 | 仍缺 metadata 驱动的列清单展开、JOIN/WHERE 重写 preview、以及更复杂的结构化多光标编辑。 |
| L12 | 部分对齐：编辑器模块边界 | DBX 已拆出 `lib/editor/*`、`lib/sql/*`，但主组件仍大 | `QueryEditor.tsx` 仍承担 model/LSP/execution/view 多重职责 | 提取 model lifecycle、execution controller 和 provider coordinator；组件测试不加载完整 Monaco。 |
| L13 | 已对齐：进程恢复遥测 | DBX 本地 semantic model不依赖独立进程 | `useLspSemanticStatusStore` 按连接记录 LSP restart/恢复耗时、schema sync failure 与 stale response drop 的无内容计数；session registry 和同步器在对应路径写入，状态栏 schema 语义提示的 title 展示最新趋势，不记录 SQL/对象内容 | 保持计数有界、仅会话内；如需跨会话分析另建脱敏诊断导出。 |

## 4. Explorer、metadata 与数据库管理

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| E01 | 部分对齐：对象类型宽度 | `lib/database/databaseObjectCapabilities.ts`；`ConnectionTree.vue` | tables/views/materialized views/indexes/constraints/routines；PostgreSQL 另走只读 `SchemaObjectInfo` descriptor 通道展示 sequence、非内部 trigger（标明所属 relation）、domain、enum type、composite/range/multirange type、extension 与 partition | 按产品补 event、synonym、package、权限与对象跳转；对象 presence 不能推导 DDL、编辑或迁移能力。 |
| E02 | 部分对齐：metadata cache 与失效 | `metadata/metadataLoadScope.ts`、`metadataResultCache.ts`、`metadataLoadCoordinator.ts`、`tableMetadataCache.ts` | schema/LSP metadata caches 和 refresh | 所有 key 包含 connection/package/database/schema/catalog；late response 在 invalidation 后不得回写。 |
| E03 | 部分对齐：对象 DDL/source cache | `metadata/objectDdlCache.ts`；`editor/hoverTableSql.ts` | 表/视图 DDL 有限；PostgreSQL routine 现通过参数化 `pg_get_functiondef` 读取只读 source，单条和 overload 数均有上限，UI 仅提供复制；外置 driver 明确不走此路径。 | 为每个声明 objectSource 的 driver 提供可失效 source cache；不泛化生成 routine DDL。 |
| E04 | 未对齐：批量对象动作 | `ObjectSelectionTree.vue`、`sidebarExportRuntime.ts`、`useSidebarTreeToolRuntime.ts` | Explorer 主要是单对象动作 | 批量刷新/导出/删除必须按 descriptor/capability 生成，并提供逐对象结果。 |
| E05 | 部分对齐：大 catalog | `metadataTaskLimiter.ts`、cache coordinator、tree load handles | cache-first 与显式 refresh 已有 | 建立 10k schema/table 压测、并发上限、取消、失败节点重试与虚拟化指标。 |
| A01 | 部分对齐：Session/Process | `components/admin/ProcessListPanel.vue`；`postgresProcessList.ts`、`mysqlProcessList.ts` | PostgreSQL/MySQL session list 和 kill/cancel 已有；锁等待页通过固定只读协议显示 waiting session → blocking session edge，不含 query SQL。MySQL 8 优先读取 `performance_schema.data_lock_waits`，旧 MySQL/MariaDB 回退至 `information_schema.innodb_lock_waits`。 | 补自动刷新策略、权限错误分类和 server identity 确认。 |
| A02 | 部分对齐：User/Role | `DatabaseUserAdmin.vue`；`databaseUserAdmin.ts` | PostgreSQL/MySQL 用户基础管理；管理页新增只读 Roles 视图，PostgreSQL 读取 `pg_auth_members`，MySQL 8 读取 `mysql.role_edges`，MariaDB/旧 MySQL 受控回退至 `mysql.roles_mapping`；固定命令可列出可见 table privilege。 | 增加 database/schema privilege、grant diff 和审计摘要。 |
| A03 | 部分对齐：Dashboard/metrics | `PostgresDashboard.vue`、`MySqlDashboard.vue`；`serverMetrics.ts`、`*ServerStatus.ts` | Database Administration 增加固定、只读的 native metrics 通道；PostgreSQL 提供连接数、活动查询、共享缓存命中率、提交/回滚累计与库容量，MySQL/MariaDB 提供连接数、活动非空闲查询与当前 schema 容量。外部 package 显式拒绝宿主生成的管理命令。 | 仍缺历史/图表、锁等待、MySQL/MariaDB 经版本与权限审核的缓存/事务指标、统一 capability protocol 与真实 server 证据。 |
| A04 | 未对齐：Job/Event | `DamengJobAdmin.vue`、`damengJobAdmin.ts`；MySQL EVENT 在 transfer/object 逻辑中 | 尚无统一 scheduler 管理 | 独立 capability；创建/启停/删除均走后端语义命令和动态确认。 |
| A05 | 未对齐：Maintenance | DBX dashboard/admin SQL modules | 缺 Vacuum/Analyze/Optimize/统计信息工作流 | 以 descriptor 注册 server identity、对象范围、预计锁影响和确认，不从前端拼任意 SQL。 |
| A06 | 未对齐：Backup/Restore | `sqlite_backup.rs`、`scheduledDatabaseBackup.ts`、`ScheduledDatabaseBackupSettings.vue`、database export | 以导出/迁移为主，无完整备份恢复编排 | SQLite 先行；PG/MySQL 使用受控外部工具时需版本绑定、路径隔离、进度、取消和恢复验证。 |

## 5. Grid、导入导出与数据迁移

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| G01 | 部分对齐：filter/sort builder | `useDataGridFilterBuilder.ts`、`dataGridConditionCompletion.ts`、`dataGridSort.ts` | SQL WHERE、visual filters、sort、typed completion 已有 | 建立 dialect × literal type × operator × multi-predicate × quote 的测试矩阵。 |
| G02 | 未对齐：专用值查看器 | `JsonValueTable.vue`、binary/image/geometry/spatial modules | JSON tree、value editor、transpose 已有 | XML、array/map、binary hex、image、geometry 分别有大小预算和只读/编辑边界。 |
| G03 | 未对齐：expression cell/default preview | DBX grid edit adapter、cell generation 与 bulk edit modules | 普通 typed cell mutation | 表达式必须显式切换；generated/default 在提交预览中区分“不发送”“NULL”“表达式”。 |
| G04 | 未对齐：全量数据 compare | DBX `dataGrid/dataCompare.ts` 与批量数据工具 | 仅 loaded-page compare | 后端 keyset 分页、稳定 key、断点、冲突/重复 key 报告和可恢复 artifact。 |
| I01 | 部分对齐：CSV/JSON/XLSX import | `crates/dbx-core/src/table_import.rs`；`TableImportDialog.vue`；`lib/table/tableImport.ts` | preview、mapping、原生事务流式导入已存在；native CSV/JSON/XLSX preview 现返回完整文件 SHA-256，确认写入时回传并核验，文件在预览后变化会被拒绝。 | 增加 reject-row 文件、错误行隔离、resume token、mapping snapshot 和失败报告。 |
| I02 | 部分对齐：连接导入 | `lib/imports/navicatImport.ts`、`dbeaverImport.ts`、`datagripImport.ts` | DataGrip、DBeaver 与 Navicat XML/NCX 已有；Navicat 仅读取非敏感 endpoint 属性，密码/令牌/本地路径永不导入，folder/group 会显示诊断。相同 driver/host/port/database/user 的候选项采用“保留已有本地连接、跳过导入项”的确定性 merge，不覆盖本地凭据或配置。 | 补更多 Navicat 版本/加密导出格式，以及 SSH/TLS/代理等不支持字段的逐项诊断。 |
| X01 | 部分对齐：流式 export | `crates/dbx-core/src/table_export.rs`、`database_export.rs`；`useDataGridExport.ts`；`table_export.rs` | CSV/JSON/SQL 导出已有；本地导出使用稳定任务 ID，逐批发出行数/批次数进度，普通查询绑定 backend query cancellation，参数化筛选在查询 future 与批次边界协作式中断；表数据页与 Explorer 右键菜单均提供取消入口。产物先写同目录唯一 `.partial`，flush 后才 rename，失败或取消由 guard 清理。每次有有效 project ID 的终态导出均保存可查询审计记录（ID、对象、格式、计数、状态、受控错误摘要），不保存路径、SQL、筛选、参数、行值、URL 或凭据。 | 仍需 bounded channel/backpressure、编码/BOM 与 resume contract。 |
| T01 | 部分对齐：单表 transfer | `crates/dbx-core/src/transfer.rs:5734 transfer_table`；`DataTransferDialog.vue` | 单表 preview/确认/type map/事务/取消/append/overwrite | 保持同一 target transaction；失败和取消必须回滚；源端 query cancellation 有 fixture。 |
| T02 | 本轮已对齐：主键 upsert | `transfer.rs:2984 generate_upsert`、`:3515 keyset_pagination_sql` | `commands/table.rs:build_upsert_mutation`；Transfer Dialog | 仅 bundled PG/MySQL/SQLite；目标必须有完整映射的 PK；token 绑定 key；外置包默认拒绝。 |
| T03 | 部分对齐：多表/object transfer | `transfer.rs:TransferObjectSelection`、`transfer_schema_objects`；`ObjectSelectionTree.vue` | `preview_table_data_transfer_batch_plan` 一次接收选表、读取 FK、生成全局顺序和确认 token；`execute_table_data_transfer_batch` 在重新计算并比对该计划后，以一个目标事务执行全部表，并写入逐对象终态报告 | schema object transfer、Explorer 通用多选入口和真实跨库 fixture 仍待补齐。 |
| T04 | 部分对齐：FK 依赖排序 | `transfer.rs:5375 sort_tables_by_fk_dependency` | `table_data_transfer_batch_plan` 对同 schema 被选表构图，父表优先拓扑排序，循环 FK 返回 `cyclicTables` 并拒绝生成顺序 | deferred/disable policy 必须由目标 driver capability 决定；当前无该契约时不自动执行循环。 |
| T05 | 部分对齐：sequence/identity/ownership | `transfer.rs:PostgresOwnedSequence`、`PostgresSequenceSnapshot`、ownership preview；`DataTransferDialog.vue` ownership flow | PostgreSQL 目标可显式启用 serial/identity generator 同事务同步；受影响列、选项和确认 token 均进入预览。未声明 identity/serial 的目标仅给出 warning，不会伪造成功 | 仍缺 owned-sequence 当前值/owner preview、跨产品 ownership plan、提交后最大键复核和真实 fixture。 |
| T06 | 未对齐：schema objects transfer | `transfer.rs:ordered_transfer_object_kinds`、`transfer_postgres_schema_dependencies`、`transfer_postgres_schema_objects` | schema snapshot/diff 与 data transfer 是分离路径 | view/function/trigger/sequence 只在同族且有 source/DDL conformance 时开放。 |
| T07 | 部分对齐：持久化 transfer report | `useExportTracker.ts` 有后台任务、失败明细上限和终态；DBX 当前主要是会话级任务 | `TableDataTransferReport` 已按项目和目标连接保存 terminal report；单表与多表执行都写入逐对象终态。Transfer 对话框显示目标的最近历史，并且仅在当前源端点/库/schema/表完全一致时可用历史记录预填一次重试。重试会生成新 transfer id，且仍强制重新 preview/确认。overwrite 成功后会在提交后只读核对目标行数；并发写入或无法读取时只标为 `needsReview`，绝不伪装为失败或触发第二次写入。报告包含哈希 plan digest、端点标识、模式、行数、批次、终态和安全错误摘要，不保存 URL/凭据/SQL/参数/行值 | append 的稳定 baseline 验证，以及真实多表迁移报告 fixture 仍待完成；不保存行值或凭据。 |
| M01 | 部分对齐：schema snapshot/diff | `crates/dbx-core/src/schema.rs`、`schema_diff.rs`；`components/diff/*` | relation/index/constraint/routine signature snapshot/diff；新增 descriptor-only `schemaObjects` 快照及 create/drop/modify 差异，PostgreSQL sequence/trigger/domain/enum/composite/range/multirange/extension/partition 在可见时进入快照。所有 descriptor 对象均无 DDL、无 preflight、强制 manual-review。 | 补逐产品 event/synonym/package，以及具有受审核 source/DDL conformance 后才可能开放的可执行对象迁移。 |
| M02 | 部分对齐：migration apply | DBX `SchemaDiffDeployStep.vue`、`deployTxResult.ts` | PG transactional；MySQL journal + post verify；其余 review-only | sidecar 协议增加 semantic `plan/preflight/apply/verify` 前，不给外置包发送 Host DDL。 |
| M03 | 未对齐：SQLite rebuild planner | DBX SQLite schema/transfer 与 backup 实现可作行为参考 | SQLite schema diff review-only | 生成临时表→复制→索引/约束→rename 的有界计划；执行前备份和 FK check，失败恢复。 |
| M04 | 未对齐：跨产品 schema mapping | `transfer.rs:map_column_type`、`generate_create_table_ddl`、`convert_cross_family_object_ddl` | 创建单目标表已有受限类型映射 | 只从显式 mapping profile 生成；unsupported/review 类型不得自动执行。 |

## 6. 架构与测试差距

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| C01 | 部分对齐：统一 driver conformance runner 与 catalog 证据门禁已落地 | 各 `agents/drivers/*/src/test`、`crates/dbx-core/tests/live_*` | `scripts/run-driver-conformance.mjs`、`docs/database-driver-conformance-*.schema.json`、`DriverPackageConformanceEvidence` | bundled/external 对同一 fixture contract 运行；catalog 只能引用 CI 产生的版本证据。 |
| C02 | 未对齐：跨层契约 fixture | DBX backend/api types 与 app tests | TS/Rust/sidecar 类型各有测试 | 同一 JSON fixture 验证 TS decode、Rust serde、sidecar schema 和 backward compatibility。 |
| C03 | 未对齐：failure injection | DBX worker/process、SSE replay、transfer/export cancellation tests | driver handshake、下载摘要、LSP stale response已有部分覆盖 | 增加 crash/restart、下载中断、partial import、transfer rollback、stale metadata 和 reconnect 压测。 |
| C04 | 部分对齐：巨型模块拆分 | DBX 虽有纯模块，但 `transfer.rs`、主 Vue 组件同样较大 | `QueryEditor.tsx`、`SchemaSidebar.tsx`、`DataGrid.tsx`、`commands/table.rs` 仍大 | 新能力先进入 feature/application/domain 模块；禁止继续把 vendor switch 堆到 UI。 |

## 7. 执行顺序

### 批次 0：已经完成

1. live connection capability snapshot；LSP 与 Query Editor 使用同一 package/server contract。
2. dialect-aware 常用 SQL snippet 与 connection-scoped usage ranking。
3. 单表 transfer 的主键 upsert：preview 校验完整 PK 映射、确认摘要绑定 conflict key、
   target transaction、外置包默认拒绝；PostgreSQL 可额外显式启用同事务 identity/serial reseed。

### 批次 1：把“候选”变成“可验证驱动”

1. 已建立可复用 driver conformance runner、隐私受限证据文件格式和 catalog hash binding。
2. 先发布 DuckDB、ClickHouse、RQLite；随后 SQL Server、Oracle/H2 JDBC。
3. 每个包至少验证两个 server 版本，并覆盖 metadata/catalog/schema、参数、取消和错误映射。

### 批次 2：编辑器语义对齐

1. 把 DBX semantic fixtures 转换为 Oxide LSP contract corpus。
2. 补函数签名、INSERT inlay hints、CTE/subquery/table-function/reference 场景。
3. 拆 QueryEditor lifecycle 与 execution controller，补真实 provider 组合测试。

### 批次 3：数据生命周期

1. 多表 transfer plan、FK 拓扑排序、cycle policy。
2. sequence/identity/ownership preview 与 post-verify。
3. 持久化 transfer report；import reject rows/resume；export backpressure/cancel/cleanup。
4. SQLite rebuild planner；随后扩展签名 sidecar semantic migration 协议。

### 批次 4：Explorer 与 Admin

1. sequence/trigger/event/type/domain 等对象 descriptor。
2. Sessions/Locks、Roles/Privileges、Metrics、Maintenance、Backup/Restore。
3. 大 catalog 与长任务 failure-injection 测试。

## 8. 70+ 可用的最终验收定义

单个数据库产品只有同时满足以下条件才计入“可用”：

1. 存在 ready bundled driver 或已签名、可安装、可回滚的外置 package。
2. 至少一个受支持 server 版本通过 connect、ping、version、metadata、query、cancel、
   parameter 和 error mapping。
3. Editor 使用正确 product identity；专用方言或明确显示 generic/compatibility，不误报。
4. Explorer 只展示实际 capability；无数据编辑能力时保持只读。
5. 宣称 mutation 时通过 transaction、PK mutation、rollback；宣称 transfer/migration 时
   额外通过对应 semantic conformance。
6. 连接凭据、SQL 正文和结果值不进入 driver 日志、遥测或迁移报告。

因此，73 个 catalog candidate 只有在逐项产生上述证据后，才能转换为“70+ 数据库可用”。
