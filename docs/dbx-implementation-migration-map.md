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
| Database Explorer 与对象树 | `components/sidebar/ConnectionTree.vue`、`TreeItem.vue`、`lib/database/databaseObjectCapabilities.ts`、`databaseTree.ts`、`visibleDatabases.ts` | 对象树由产品能力表驱动；加载、空、错误、展开缓存是独立状态；schema/table/index/constraint/routine 不应混成一个临时列表。 | `src/components/workspace/SchemaSidebar.tsx`、`features/database-explorer/ui/TableObjectTree.tsx`、schema store/service、`src-tauri/src/commands/schema.rs` | 已有缓存、打开状态绿点和失败红点；表节点可展开列/索引/约束，外键明确显示引用目标并可打开关联表，CHECK 保留完整 tooltip。函数/过程按 `Routines → Functions / Procedures` 分组，提供限定名与调用模板复制。仍需逐族补 trigger、sequence、schema-level materialized view、权限与对象跳转；例程 DDL 查看需后端提供安全的例程定义接口后再接入。 |
| SQL 文档、Tab 与执行 | `components/editor/QueryEditor.vue`、`lib/editor/sqlCompletionPresentation.ts`、`sqlCompletionInsertion.ts`、`stores/queryStore.ts`、`lib/sql/currentStatementFrame.ts`、`sqlExecutionTarget.ts`、`queryExecutionState.ts` | 文档状态、当前语句、执行 target、结果来源与错误需拆域存储；一次执行不能销毁 editor model。 | `src/components/workspace/QueryEditor.tsx`、`src/features/query-editor/model/{lspMonacoAdapter,lspCompletionPresentation,sqlCompletionInsertion,executionTarget,currentStatementDecoration,mongodbCommandRanges}.ts`、`src/store/useTabStore.ts`、`src-tauri/src/commands/query.rs`、`src-tauri/src/core/statement.rs` | 已抽取 LSP→Monaco 适配、completion presentation、自动空格、execution target、当前语句边框行段与 Mongo command-at-cursor。SQL 与 Mongo 多命令文档现在分别使用各自的有界 range；QueryEditor 仍过大，下一步继续拆异步 execution controller 和 Elastic provider，保持 editor identity 稳定以避免首次执行闪动。 |
| 语句边界与多语句编辑 | `lib/sql/sqlStatementRanges.ts`、`currentStatementFrame.ts`、`executableStatementRangeCache.ts` 及 `lib/__tests__/sql/sqlStatementRanges.spec.ts` | 以顶层 token scanner 处理分号、过程体、注释、字符串与软边界；编辑补全边界和 Run All 边界可不同，但必须显式定义。 | `src-tauri/src/core/statement.rs`、`src-tauri/src/commands/query.rs`、`src/lib/queryEditorCachedCompletion.ts` | 已修复空行新语句、quoted identifier 与 PostgreSQL dollar quote 的上下文；下一步抽取 Rust/LSP 共用 statement-scope conformance fixtures。 |
| SQL LSP、补全与导航 | `lib/sql/semantic/README.md`、`semantic/{tokens,model,dialect,completion,references,diagnostics}.ts`、`lib/sql/sqlCompletion.ts`、`sqlDiagnostics.ts` | token、语义模型、方言、补全、诊断和引用分别拥有单一事实源；当元数据不完整时返回 confidence/fallback，而不是伪装为精准结果。 | `src/services/lsp/`、`src/components/lsp/LspConnectionSyncer.tsx`、`src/components/workspace/QueryEditor.tsx`、`src/lib/whereCompletion.ts`、`vendor/sql-lsp/src/dialects/mod.rs` | 已支持 SQL/Mongo/Redis/ES provider 与版本路由；DBX 的 35 个声明式方言都保留厂商身份，已有专用 parser 的走 dedicated，其余明确注册为 vendor compatibility alias 并记录 PostgreSQL/MySQL/SQLite baseline，不再把 Oracle、SQL Server 等会话直接命名成 PostgreSQL。仍需以数据库族 × server version × SQL position 建立共享的端到端 completion matrix，并逐个用专用 parser 替换兼容别名。 |
| Mongo、Redis、Elasticsearch 工作区 | DBX 的 `types/database.ts`、connection capability 和非关系型 object provider；ES 可参考兼容类型 `elasticsearch/easysearch` 的分流 | 非 SQL 数据模型不应强塞进关系型表编辑 contract；query language、对象树和安全写入约束独立声明。 | Mongo/Redis/Elastic console、相关 driver 与 LSP provider | Mongo 编辑器与 Rust 驱动已支持单对象、顶层数组和空白分隔命令流；Run Current 与当前 command 边框不再调用 SQL scanner。Mongo aggregation stage 已按 server version 过滤。ES Console 与 bundled LSP 现在共享 ES 6/7/8 的主/次版本门控，且字符串内字段补全保留 JSON pointer 上下文。仍需真实 Mongo 版本 fixture、Redis command/key 类型矩阵，以及以真实 ES 映射与查询请求组成的容器化 6/7/8 conformance fixture。 |
| Grid、表格编辑与右键菜单 | `components/grid/*`、`lib/dataGrid/*`，优先 `dataGridRuntime.ts`、`gridSelection.ts`、`dataGridEditAdapter.ts`、`dataGridContextMenu.ts`、`dataGridConditionCompletion.ts` | 渲染、选择、值格式化、编辑适配、上下文菜单、查询控制和本地 UI 持久化要分模块；编辑权限由主键/事务/capability 决定。 | `src/components/workspace/DataGrid.tsx`、`TableDataView.tsx`、`src/features/data-grid/`、`src-tauri/src/commands/table.rs` | 需要继续补纯逻辑分包、复杂类型 cell editor、右键菜单/hover tooltip 的动作说明、服务器端筛选比较与版本化 capability 测试。 |
| WHERE、Sort 与表格条件补全 | `components/grid/DataGridConditionEditor.vue`、`lib/dataGrid/dataGridConditionCompletion.ts`、`dataGridConditionHistory.ts`、`dataGridConditionSuggestionPosition.ts` | 条件编辑器有自身 SQL 片段上下文：字段后应推荐运算符、值类型、AND/OR、括号；suggestion position 不应遮住输入和结果。 | `src/lib/whereCompletion.ts`、`src/features/data-grid/model/conditionHistory.ts`、TableDataView 的 filter/sort controls | 已覆盖字段、类型值、IN/BETWEEN/NULL、组合续写和同一行 Sort；已按 connection/database/schema/table 保存并复用已 Apply 的 WHERE 条件。下一步为历史项删除/管理、复杂括号/函数参数和真实 metadata/LSP 端到端矩阵。 |
| 数据导入、导出、转移 | `components/import/TableImportDialog.vue`、`components/transfer/DataTransferDialog.vue`、`crates/dbx-core/src/transfer.rs`、`database_export.rs`、`sql_file_import.rs` | preview/mapping 与真正执行共用明确 plan；导出是背压/取消/格式 contract，跨库转移是 source/target capability 的交集，而不是逐行 UI 拼接。 | `CsvImportDialog.tsx`、`JsonImportDialog.tsx`、`SqlScriptImportDialog.tsx`、`TableDataTransferDialog.tsx`、`TableDataView.tsx`、`src-tauri/src/commands/table.rs`、`src-tauri/src/commands/query.rs` | CSV 已有编码/分隔符/映射预览；JSON/JSONL 与 XLSX 首工作表先返回有界结构化样本、核对目标列，再以单一显式事务分批导入。SQL script 先返回方言分句的有界预览与内容 digest，并在专用审阅窗口确认；执行前重新读取并核验 digest。跨连接 append/overwrite 现提供结构化 `exact/safe/review/unsupported` 类型计划、显式转换说明、同路径预览转换、plan digest 复检、“有界分批写入、整次单事务提交/失败回滚”，以及稳定 transfer id、进度事件、源端 backend cancel 与协作式取消。overwrite 使用事务内 DELETE，预览绑定待删除行数并在执行时复检。目标表不存在时，内置 PostgreSQL/MySQL/SQLite 可先审阅保守类型映射与目标方言 DDL，以独立 `CREATE <digest>` 确认创建空表，再进入普通 transfer；不伪装建表与复制为跨方言原子事务。仍需导出 resume/cancel；transfer 仍缺多表、upsert、identity/sequence/FK 计划、外置驱动 semantic DDL conformance 和持久化审计报告。 |
| Schema snapshot、diff 与 migration | `crates/dbx-core/src/schema.rs`、`schema_diff.rs`、`sql_editability.rs`；前端阅读 metadata/object capability | snapshot 应不可变、有 fingerprint；diff 先是审阅 artifact，再变成可执行 plan；migration 执行前校验依赖、目标版本与风险，不能只运行生成 SQL。 | `SchemaSnapshotDialog.tsx`、`SchemaDiffView.tsx`、`src-tauri/src/commands/schema_diff.rs`、`src-tauri/src/core/schema_diff.rs` | PostgreSQL 主路径已有 relation snapshot/diff/migration；snapshot 现同时保存函数/过程签名，例程漂移统一标为人工审阅、阻止自动执行，且不读取例程 body 或生成泛化 DDL。后续仍需为更多关系族定义 introspection、DDL renderer、transaction/rollback 能力和 data-loss preflight。 |
| 数据库管理命令 | `lib/database/createDatabaseSql.ts`、`databaseNamespaceCreation.ts`、`databaseUserAdmin.ts`、`dbAdminSql.ts`、`processListDrivers.ts`、`serverMetrics.ts` | 创建库、用户、权限、会话、指标都是按能力展开的管理动作，输入语义化 option，后端负责方言 SQL 与错误提示。 | connection/admin commands、`src-tauri/src/commands/*` | PostgreSQL/MySQL 基础管理已覆盖；下一个批次是 session/process、role/privilege、参数与 job，先只读监控再开放写操作。 |
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
- [ ] 把 connection/package/server-version 的 capability 读取统一为一个 queryable contract。
- [ ] 将 `QueryEditor.tsx` 拆为 model lifecycle、LSP adapter、execution controller 和 view（LSP→Monaco 及 completion presentation adapter 已完成；其余仍待拆分）。
- [ ] 为 Grid filter/sort 建立语法位置、typed literal 和 multi-predicate 测试矩阵。

### 7.2 P1：以产品族推进，而不是堆菜单项

- [ ] 为 DuckDB、ClickHouse、SQL Server、Oracle 建立 package conformance harness。
- [ ] 为 PostgreSQL/MySQL 的版本线补充 metadata、LSP、DDL 与 Grid 组合 fixture。
- [ ] 为 Elasticsearch 6/7/8、Mongo server/aggregation 和 Redis key type 建立容器化版本 fixture；当前前端与 bundled LSP 已有 ES 6/7/8 版本门控单元覆盖，但尚未替代真实服务验证。
- [ ] 新增产品只有通过 `connect → metadata → query → cancel → error map` 后才可公开。

### 7.3 P2：完善数据生命周期

- [x] CSV/JSON/XLSX/SQL import 已统一为 preview 后 native execution；SQL import 使用专用审阅窗口、方言分句预览和执行前 digest 复检。
- [ ] 增强 export 的背压、取消、编码与审计报告。
- [x] 跨库 transfer 已把基础类型兼容性、显式转换、unsupported 阻止、确认 digest 与整次事务 rollback 变成可审阅 plan。
- [x] Transfer 已提供稳定 ID、批次进度、源端 backend cancellation、协作式取消与取消后整次事务回滚。
- [x] Transfer overwrite 已使用事务内 DELETE、目标行数硬上限、确认摘要绑定与执行时 affected-row 复检，避免 TRUNCATE 隐式提交。
- [ ] 继续补齐 transfer 的 identity/sequence、FK、upsert、多表依赖顺序、外置驱动 semantic DDL conformance 和持久化报告。
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

## 9. 文档维护规则

当某项能力状态发生变化时：

1. 更新本文件的“当前差距与验收点”或 checklist；
2. 更新 `dbx-reference-gap-analysis.md` 中的事实/优先级；
3. 为真实可用的产品更新 conformance matrix，不以 UI 目录项作为证据；
4. 在实现 PR/提交中写明参考的 DBX 路径和新增的 OxideStudio 测试。

这样可以在数月后继续实施某个领域时，仍能从原理、源码、当前边界和验收条件四个方向
快速恢复上下文。
