# OxideStudio 与 DBX 详细差距矩阵

> 审计基线：2026-09-01
> DBX 参考提交：`d4d3995be`（v0.6.0 后续 CI/文档提交；最新产品功能提交仍为 `c4cdcbc48`）
> 参考工程：`sources/dbx`（只读）

本文所有 DBX 路径都相对 `sources/dbx/`：`lib/...` 表示
`apps/desktop/src/lib/...`，`components/...` 表示
`apps/desktop/src/components/...`；`crates/...`、`agents/...` 和 `src-tauri/...`
均可直接从 DBX 根目录定位。带 `:函数名` 或 `:行号` 的条目进一步指出核心入口。

### 最新增量审计（`5d6f66777` → `d4d3995be`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `d4d3995be`、`053f5f6dc` | release asset 同步并发化、按 module path 归属 agent release note | 只修改 DBX 自身 GitHub Actions，没有桌面、driver、LSP 或迁移运行时变化；Oxide 的 release/driver packaging workflow 有独立的矩阵、磁盘清理和 OSS 上传契约，不复制仓库专属发布脚本。 |
| `7e3db73de` | 支持数据库文档补列 ArgoDB 与 InfluxDB 3 | 产品目录已对齐：Oxide 将 DBX 当前公开 `DatabaseType` 的 80 项全部登记为候选，其中 ArgoDB 需要签名 JDBC package/evidence；bundled InfluxDB 3 已实现 SQL HTTP runtime、metadata、LSP 方言路由与静态回归。此次 DBX 提交只改文档数组，没有新运行逻辑。 |
| `fac018f16`、`b31b6845f`、`0d75456f8` | 发布 v0.6.0 与 packages 0.4.77 | 上游强制更新后的三个提交只调整 DBX 自身版本、lockfile 和发布元数据；最新产品功能提交仍为下列已审计的 `c4cdcbc48`，没有新的运行逻辑需要迁移。Oxide 不跟随 DBX 产品版本号。 |
| `8187ef9ba`（历史性能缺口复核） | MySQL routine 编辑时增量复用 lexer/block 状态，避免每个内部分号重新扫描完整语句前缀造成 O(n²) | 已完成等价并减少中间状态：Oxide 的 Rust authoritative statement scanner 在既有单次 quote/comment-aware 遍历中直接识别 routine 的有界 16-word `CREATE` 前缀，并增量维护 `BEGIN`/`CASE`/`END IF|LOOP|REPEAT|WHILE` 块栈；不为 routine 另存持续增长的 token 数组。无 `DELIMITER` 的 compound procedure/function/trigger/event 保持一个 statement，显式 custom delimiter 与普通 `CREATE TABLE` 边界不变。20,000 条内部 `SET` 的回归覆盖线性扫描路径。DBX 位置：`apps/desktop/src/lib/sql/sqlStatementRanges.ts:mysqlRoutineTokensUpTo/advanceMysqlRoutineBlockCompleteness`。Oxide 位置：`src-tauri/src/core/statement.rs:MysqlRoutineScan/split_sql_statement_spans`。真实 MySQL/MariaDB routine 执行仍归统一数据库验证阶段。 |
| `19f8736b6`（历史诊断缺口复核） | MySQL procedure/function 使用专用 syntax diagnostics，避免通用 SQL 语义分析误报 routine body | 已对齐并增加明确资源边界：Native/custom MySQL 编辑器使用 delimiter、quote、comment aware 的 O(n)/O(depth) 单次扫描，报告参数尾逗号、procedure 中非法 `RETURN`、function 中缺少表达式的 `RETURN`；`DELIMITER $$` 紧贴 `END`/`RETURN`、嵌套 `BEGIN`/`CASE`、多 routine 与普通 SQL 隔离均有回归。编辑输入按 180ms 合并，分析结果按 model/version 复用；仅 routine 精确范围内来自 `tree-sitter-sql` 的 `SYNTAX_ERROR/PARSE_ERROR` 被隐藏，OXIDE 安全/结构 inspection 继续显示。同步扫描上限为 4 MiB，超限 fail quiet；20,000 条内部语句验证不保留增长 token 列表。DBX 位置：`apps/desktop/src/lib/sql/mysqlRoutineSyntaxDiagnostics.ts`、`QueryEditor.vue:refreshSemanticDiagnostics`。Oxide 位置：`src/features/query-editor/model/mysqlRoutineSyntaxDiagnostics.ts`、`QueryEditor.tsx`。真实 MySQL 版本诊断与执行验证延期。 |
| `1e9babca4`（历史性能缺口复核） | 超大 Oracle package body 不绘制 current-statement frame，避免逐行几何探测冻结 UI | 已完成等价并覆盖 Oxide 自身实现风险：Monaco 不是 CodeMirror layer，但旧实现会为 statement 每个逻辑行生成一个 whole-line decoration，并把整段 SQL 复制进 React DML preview state。现在 statement 跨度超过 500 行时不生成 frame decorations，也不发布 preview SQL；Rust authoritative range、10,000-range 版本缓存、执行/选择语义均不改变，正好位于上限的 statement 仍绘制。DBX 位置：`apps/desktop/src/lib/editor/codemirrorCurrentStatementFrameLayer.ts:MAX_FRAME_STATEMENT_LINES/currentStatementFrameRect`。Oxide 位置：`src/features/query-editor/model/currentStatementDecoration.ts:MAX_CURRENT_STATEMENT_FRAME_LINES/currentStatementLineFrames`、`hooks/useCurrentStatementDecoration.ts:decorate`。真实 WebView 滚动帧率验证延期。 |
| `fcb6ea92d`（历史性能缺口复核） | CodeMirror SQL semantic highlight 缓存 statement windows，滚动不重复解析大语句 | 调用链不同但等价重复工作已关闭：Oxide 使用 Monaco `DocumentSemanticTokensProvider` 与 LSP full-document tokens，不在 viewport scroll 中本地扩展/解析 statement window，因此不复制 DBX 的 32-window CodeMirror cache。此前 Monaco 对同一 model version 的重复请求仍会跨 Tauri IPC 触发 LSP 全文 token scan；现在 provider 缓存单个 model/version 的 typed token array，返回克隆，编辑、切换模型、取消、dispose/release 均不复用旧结果，也不缓存 SQL 文本。DBX 位置：`apps/desktop/src/components/editor/QueryEditor.vue:buildSqlSemanticHighlightExtension/MAX_SQL_SEMANTIC_HIGHLIGHT_WINDOWS`。Oxide 位置：`src/features/query-editor/hooks/useLspCoreProviderCoordinator.ts:semanticTokensCache`。真实大文件 Monaco 请求频率/帧率验证延期。 |
| `1f274c57e` | Explorer 的刷新选中节点快捷键从裸 `F5` 扩展到 macOS `Cmd+R`、Windows/Linux `Ctrl+R` | 已按节点作用域对齐并收紧：`SchemaSidebar.tsx` 只在焦点位于可刷新 connection/database/schema/table/view 节点且不在输入框或 contenteditable 内时接管快捷键；连接、当前/远程 database、schema、表/视图分别进入既有强制 metadata 路径。跨 database schema 使用单槽、递增版本的显式 refresh request 让已挂载的远程树重新加载，状态空间不会随浏览过的 catalog 数量增长；表级刷新继续走有界 task、缓存失效和 tab refresh。导航键新增严格分段/URI decode，畸形键 fail closed。裸 `F5` 保留，带其他 modifier 的 F5 不拦截。DBX 位置：`apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue:onKeydown`、`lib/editor/keyboardShortcuts.ts:isModRShortcut`。Oxide 位置：`src/lib/keybindings.ts:isExplorerRefreshShortcut`、`src/lib/databaseNavigation.ts`、`SchemaSidebar.tsx`、`PostgresRemoteDatabaseContents.tsx`。真实 Windows/macOS WebView 默认 reload 抑制和焦点行为延期。 |
| `c4cdcbc48` | SQL 保存按钮明确区分保存到原始文件或 SQL Library | 已对齐：Query tab 根据 `fileRelativePath` 与 `savedSqlFileId` 产生可辨识的 `original-file` / `sql-library` 目标，工具栏 dirty/clean tooltip 分别说明 “Save to Original File” 或 “Save to SQL Library”，不再使用含糊的 editor file 文案；实际保存仍由 `saveEditorFileTab` 路由到项目文件原子写入或项目级 SQL Library 更新。DBX 位置：`apps/desktop/src/components/layout/EditorToolbar.vue:saveTooltip`。Oxide 位置：`src/lib/editorSaveTarget.ts`、`EditorActionBar.tsx`、`QueryEditor.tsx`。 |
| `6a7ea4ae9` | DBX 增加 Jalapeno Cloud 商业合作 AI preset、赞助标识、专属模型及 `HTTP-Referer: https://dbxio.com` | 不直接迁移 DBX 专属商业身份：该实现包含 DBX referral header、partner 文案、logo 与外部关系，复制到 Oxide 会错误冒充合作关系。Oxide 继续支持用户配置的 OpenAI-compatible endpoint/model/key，以及已独立集成的 Codex CLI / CodeBuddy CLI；若未来增加 Oxide 自有 preset，必须使用自身授权的品牌资产、Referer 和服务条款，并复用现有凭据/Provider 隔离。DBX 位置：`settingsStore.ts`、`EditorSettingsDialog.vue`、`AiAssistant.vue`、`AiProviderLogo.vue`、`crates/dbx-core/src/ai.rs`。 |
| `19be19472` | SQL Server 2008 legacy result-type probe 在改写 `SELECT TOP (0) ... FROM (...)` 时保留 CTE/comment prefix | 当前无可迁移的 Host 调用链：DBX 修复位于 native TDS driver 的 `crates/dbx-core/src/db/sqlserver.rs:SQLSERVER_RESULT_TYPE_PROBE_SQL/sqlserver_legacy_probe_with_nonce`。Oxide Host 没有 SQL Server 结果类型 probe，也不会重写外置 package 的查询文本；`ExternalDriver::query*` 将原 SQL 与显式 query context 原样交给已签名 sidecar，因此不会在 Host 丢失 CTE。正式 SQL Server package 仍须在自身 JDBC/TDS conformance 中覆盖 SQL Server 2008、CTE、前置注释、临时表与重复/未命名列，未有该 package 前不把此项计为可用能力。 |

### 上一增量审计（`264f5c483` → `5d6f66777`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `cb754cd0c` | 历史结果窗口切换及结果快照保留本地列过滤器 | 已完成有界 in-memory result runs：每个 Query tab 最多五个 completed run，切换时投影同一结果对象而不复制行；`columnFilters`/sort state 随 run 一并保存，结果切换/关闭和新执行均保持索引对齐。关闭 tab 仍释放所有 run payload，重启不持久化。DBX 的固定、磁盘 cache/恢复属于后续容量/恢复子系统，不能与当前内存历史混称。DBX 位置：`apps/desktop/src/lib/tabs/tabResultCache.ts`、`queryStore.ts`。Oxide 位置：`useTabStore.ts`、`workspaceRuntime.tsx`。 |
| `a7922b9cb` | Schema 与 Table 使用不同图标色 | 已对齐并统一复用：主树及 PostgreSQL 跨 database 树都从 `explorerObjectPresentation.ts` 读取对象角色色，schema 使用 amber、table 使用 green、view 使用 sky；连接颜色继续只表达数据源身份，pinned 状态仍可覆盖为 primary。DBX 位置：`apps/desktop/src/components/sidebar/TreeItem.vue`。Oxide 位置：`src/features/database-explorer/model/explorerObjectPresentation.ts`、`SchemaSidebar.tsx`、`PostgresRemoteDatabaseContents.tsx`。 |
| `440c41f5b` | SQL Server 本地临时表的结果总数查询复用原查询 session | 当前无同类调用链：DBX 的自动 Query Result `COUNT(*)` 会启动独立 count session，修复位于 `queryResultCountSession.ts` 与 `queryStore.ts`；Oxide 任意查询结果不自动生成第二条 count SQL，Table Page 总数由 Host 在同一次结构化分页请求内按需计算，因此不会跨 session 访问 `#temp`。若以后增加任意查询精确总数，必须先移植该 session 检测。 |
| `e9a90173a` | 外部 `.sql` 文件记忆 schema，Sidebar Locate 不再回退到错误 database-as-schema | 已完成等价目标上下文：Project `.sql` 文件首次打开绑定当前 connection/database/schema，关闭后重开恢复；切换 database/schema 会立即更新文件目标，连接删除后旧目标失效。缓存有版本、字段/路径校验和与 DBX 相同的 200 条最近使用上限，只保存目标身份，不保存 SQL、连接串或凭据；文件/目录重命名、删除及项目根目录成功切换会原子迁移或清除对应记录，根目录切换失败则保留原上下文。SQL Library 继续使用自身持久化字段。DBX 位置：`externalSqlFileTarget.ts`、`jdbcDialect.ts`、`App.vue`。Oxide 位置：`src/lib/projectSqlFileTarget.ts`、`useTabStore.ts`、`ProjectFilesSidebar.tsx`。 |
| `5d6f66777` | MySQL 迁移避免 FK 文案误删列，并在 structure-only + 既有目标时阻止缺列 | 已完成等价且 fail-closed：Oxide 不解析/删改 `SHOW CREATE TABLE` 文本，而是从结构化 constraint/index metadata 生成 reviewed post-copy DDL，因此 comment/default 中出现 `foreign key` 不会误删列；创建迁移目标继续拒绝既有同名表。向既有目标传输时，只要任一源列在目标结构中不存在，预览即拒绝，不再把 source-only 列降级为警告；目标同名 generated/hidden 列仍由数据库维护，目标端无默认值的必填列也继续拒绝。DBX 位置：`crates/dbx-core/src/transfer.rs`。Oxide 位置：`src-tauri/src/commands/table.rs:build_data_transfer_column_mapping`。真实 MySQL 5.7/8 迁移仍延期。 |

### 上一增量审计（`e43e36e7a` → `264f5c483`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `4d3d64bd3`、`1aa9f0671` | PostgreSQL arbitrary-precision NUMERIC 与 CI decoder 修复 | 已对齐：bundled PostgreSQL driver 使用 `sqlx::types::BigDecimal` 解码并以十进制字符串跨 IPC，不经过 `f64`；新增 10,000 位整数及 scale 回归。DBX 位置：`crates/dbx-core/src/db/postgres.rs`。 |
| `55611706b` | Redis 大字符串改为 bounded preview | 已对齐并增加 Host 终极边界：GET 使用 `GETRANGE` 读取 64 KiB + sentinel，并用 `STRLEN` 返回总长；大值结果带 preview/loadedBytes/totalBytes/truncated/readOnly，小值保持原字符串。DBX 位置：`crates/dbx-core/src/db/redis_driver.rs`、`RedisValueViewer.vue`。 |
| `6588f27fb` | 独立 SSH Tunnel Test，不要求目标数据库可达 | 已对齐：Rust 对 primary/jump hosts 完成真实握手、host-key 与认证验证，Tauri command、typed service 和 Connection Form 均有独立测试入口。DBX 位置：`crates/dbx-core/src/connection.rs`、`ConnectionDialog.vue`。 |
| `264f5c483` | InfluxDB 3 Core HTTP SQL engine | 已完成逻辑、静态回归并提交：新增 native `POST /api/v3/query_sql`、database/table/column metadata、Bearer token、HTTP/HTTPS、只读 capability、N+1 行上限及 32 MiB streamed response guard；连接测试走真实 query endpoint。DBX 位置：`crates/dbx-core/src/db/influxdb3_driver.rs`、`ConnectionDialog.vue`。真实 InfluxDB 3 Core/Enterprise 验证延期。 |
| `70d7a78c6` | Danger dialog 重开时保护 selection/focus | 已完成应用内等价实现：危险 SQL 改用受控 Dialog 而非阻塞式 `window.confirm`；所有完整文档、当前语句、参数化执行和历史重跑入口统一等待同一个异步确认结果。关闭时抑制 Radix 默认 trigger focus，在 animation frame 中仅当没有新确认打开且 generation 未变化时才把焦点还给 Monaco，因此连续确认不会由旧 close 事件抢焦点。DBX 位置：`DangerConfirmDialog.vue`。Oxide 位置：`DangerousSqlConfirmDialog.tsx`、`QueryEditor.tsx`、`useQueryExecutionController.ts`。真实 Tauri WebView 的滚动/选区回归仍延期。 |
| `f19439ad7` | Loading mask 只覆盖正在执行的历史 result run | 已完成 run-aware 修复：查询开始时冻结 `executingResultRunId + executingResultIndex`，只有 active run 与 active result 都匹配才显示 Grid loading mask；成功、错误、取消和重新连接中止都会清理 identity，table tab 继续遮罩唯一 live surface。DBX 位置：`apps/desktop/src/components/workspace/DataGrid.vue`、`queryStore.ts`。Oxide 位置：`queryResultLoadingState.ts`、`DataGrid.tsx`、`useTabStore.ts`。 |
| `1e75a7822` | Kingbase timezoneless datetime 不做 UTC 转换 | 已开始正式 native package：`src-tauri/drivers/kingbase` 直接实现 Oxide sidecar protocol、独立连接/查询/基础 metadata、包内只读门禁和时间值 wall-clock 序列化；`package-kingbase-driver.mjs` 与 publish workflow 会生成 manifest-bound 多平台 payload。目录保持 `native → signedSidecar`，保留 PostgreSQL-compatible LSP baseline。仍缺真实 Kingbase 版本 conformance、完整 index/constraint/routine metadata 与签名发布证据，不能宣称完整对齐。 |
| `613c4f7ca` | IoTDB 1.3 aggregate columns 与 `max_time` 格式 | native Sidecar 已有可打包请求循环：`src-tauri/drivers/iotdb` 处理 handshake/connect/disconnect/ping/version/query/metadata，metadata 返回 Explorer 所需形状。Tree dialect 的 `Time` 首列及 `max_time`/`min_time` INT64 严格归一化为服务端实际 `TIMESTAMP(ms/us/ns)`；Table dialect 不误转换；日期、RFC3339 时间、BLOB 与 NaN/Infinity 也有 JSON 安全表示及单测。连接配置覆盖 JDBC URL、多节点 cluster、Tree/Table、TLS/mTLS、TLS 1.2 最低版本、ServerName、压缩、fetch size、timezone、重试与连接超时；Session 通过官方 Go Client 打开后受控设置 Table dialect/database，并探测 `SHOW VARIABLES` 的 `TimestampPrecision`。查询最多读取 10,000 行，只允许 query 类语句，拒绝未实现的绑定参数；metadata 严格映射 Tree 的 `SHOW DEVICES`/`SHOW TIMESERIES` 与 Table 的 `SHOW TABLES DETAILS`/`DESC … DETAILS`。`package-iotdb-driver.mjs` 与发布 workflow 已覆盖三平台。仍缺真实 IoTDB 1.3+/cluster/TLS conformance、分页/cancel、完整 DDL/index/constraint/routine metadata 及签名发布证据；目录保持 native dedicated workspace。 |
| `7f9e35d1e` | RocketMQ consumer group 跨页查找 | 已建立正确的独立 workspace 基础，而非误接到 SQL Driver：`src-tauri/agents/rocketmq` 是有界 JSON-RPC Agent，实际使用 RocketMQ admin client 完成 handshake、连接/测试、cluster、topic、topic live route、bounded message preview、consumer group 与 consumer group live detail 查询；group list 会读取所有 master broker、去重、排序后才进行 offset/limit 分页，不会遗漏仅注册在非首个 broker 的 group。Topic 详情保留按 broker 的读/写队列数、权限和地址，避免在扩容或恢复期错误假设各 broker 状态相同；消息预览只读、最多 20（API 上限 100）条、单条正文最多 64 KiB，不创建 consumer/提交 offset；consumer detail 返回当前 member、client/host/language、订阅 topic 与表达式。`core/mq_agent.rs` 以每连接独立进程、固定内置二进制、`env_clear`、消息上限、超时、取消终止和不持久化 stderr 管理；Tauri commands 与 typed service 已暴露。连接右键的 **Open RocketMQ Console** 会创建独立 workspace tab，提供 Cluster、Topics、Consumer groups 与详情浏览。release workflow 会为三平台构建并校验 agent。仍缺 DBX 的 topic 统计/配置、consumer group offset reset、按 key/时间查询、消息发送、ACL、topic 变更及真实集群 conformance，不能称为完整 RocketMQ 对齐。DBX 位置：`crates/dbx-core/src/mq/adapters/rocketmq.rs`、`TopicsPanel.vue`、`MessageQueryPanel.vue`、`SubscriptionsPanel.vue`。 |

> RocketMQ 状态修正（`d4d12a4e`）：Topic route/config/partition offsets、消息预览、按 key/时间查询、ACL 只读清单和按订阅 Topic 的 consumer lag 已经完成并进入工作区。ACL 结果保留 source broker 并报告不可用 master，避免掩盖配置漂移；lag 与 stats 都有明确分区上限。仍未开放 topic/consumer/ACL 变更、offset reset 与发消息：这些操作必须先具备独立的桌面审批、一次性回执、取消/未知结果恢复和生产/未分类连接保护，不能以直连 Agent 命令替代。真实集群 conformance 仍在 deferred validation queue。

> DBX HEAD `d4d3995be` 审计（相对 `e43e36e7a`）：相关路径 `apps/desktop/src/lib/{mongo,elasticsearch}`、`components/editor` 与 `crates/dbx-core/src/lsp` 之后仅有 AI preset 与 danger-dialog focus 两项提交，没有新增 MongoDB/Elasticsearch LSP 契约。Oxide 的现有 `3ea234f1`/`3d139c68` 已覆盖 Elasticsearch JSON key replacement、REST path range 与 Mongo shell-qualified completion；本轮全量 Vitest、Rust library tests 与定向补全测试均通过。真实 MongoDB/Elasticsearch/Monaco 验证仍保留在 deferred queue，不能由静态测试替代。

### 最新增量审计（`8be503bf4` → `e43e36e7a`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `333c3a3f4` | UPDATE/INSERT/DELETE 可转换为只读 SELECT 预览影响行和新值 | 本阶段已对齐并收紧：Rust 使用当前 `sqlparser 0.59` 的产品方言解析一条 DML，UPDATE 追加或按可信 metadata 交错展示 `<column> (new)`，INSERT VALUES/SELECT 展示待写入行，DELETE 展示待删除行；拒绝多语句、`UPDATE ... FROM` 歧义、非 DML、超 1 MiB 输入/输出和异常 metadata，标识符按产品 delimiter 转义。Query Editor 直接复用 current-statement frame 的已缓存解析结果，不增加第二次光标 IPC；工具栏和 Monaco 右键仅在当前 frame 为 DML 时开放，生成独立 Preview tab 后走普通查询取消/历史链路，源文档版本变化会丢弃晚到预览。DBX 位置：`crates/dbx-core/src/dml_preview_sql.rs`、`apps/desktop/src/lib/sql/dmlChangePreview.ts`、`QueryEditor.vue`。Oxide 位置：`src-tauri/src/core/dml_preview_sql.rs`、`src/features/query-editor/model/dmlChangePreview.ts`、`QueryEditor.tsx`。真实产品 volatile function、权限和大结果验证延期。 |
| `46584ff46` | Windows Host 接受远程 Linux SQLite 绝对路径 | 已有且有 Rust 回归：`sqlite_ssh::validate_remote_absolute_path` 明确按 `/` 起始的 Linux path 校验，不使用 Windows `Path::is_absolute`；拒绝 `..`、NUL 和换行。 |
| `a751b5690` | 表数据分页不受普通查询结果行数上限截断 | Oxide 的 Table tab 使用独立 `get_table_page`/opaque document cursor 和 server total，不复用普通 `execute_query` 的 materialized result cap；深页仍按 driver 的稳定分页能力门控。真实超百万行页面验证延期。 |
| `694611aad` | 取消危险 SQL 确认后保持编辑器滚动/选区 | 已完成逻辑对齐：取消不会调度查询；Dialog close 只在不存在新 pending confirmation 时恢复 Monaco focus，工具栏 pointer-down 的 immutable snapshot 继续作为 current-statement 执行输入，避免 toolbar 焦点改变选区后误执行其他语句。真实 Tauri WebView 的 cancel/focus/scroll 回归仍需记录。 |
| `cbfa8d7a7` | 非 table 对象隐藏行数/大小统计 | Oxide Explorer 当前不会为 view/routine/schema 等对象渲染 table row/size stats，不存在同类误导展示。 |
| `c7cea5a04` | 查询结果列继承物理来源列的 formatter | **逻辑已对齐，真实产品验证延期**：Oxide 已增加按 connection/database/schema/table/physical-column 规范化的 formatter key、持久化输入清洗、日期/JSON Path/脱敏/模板显示格式，以及表数据 header 的配置入口和实时“原值 → 显示值”预览。格式化只覆盖 Glide `displayData`，不改变原始值、编辑值或提交载荷。Query Grid 现在按执行 SQL 与结果 ordinal 建立保守的 `queryDisplaySourceColumns` 等价映射：直接字段、确定 alias 和单一物理 wildcard 可继承；computed expression、CTE/derived table、集合运算、多语句、混合 wildcard、歧义 join 与三/四段字段引用严格 fail closed。数据库命名空间产品可绑定执行 database；schema 命名空间产品必须显式写出 source schema，不按当前 schema 或结果同名列猜测。MySQL-family 的规范空 schema key 与旧 mirrored schema key 仍兼容读取/清理。Oxide 位置：`src/lib/queryEditorCachedCompletion.ts`、`src/features/data-grid/model/columnFormatter.ts`、`ColumnFormatterDialog.tsx`、`DataGrid.tsx`、`appSettings.ts`。真实 Monaco 与 PostgreSQL/MySQL/SQL Server/SQLite 查询结果 metadata 验证延期。 |
| `d59b86bd5` | 多行粘贴进入新增行时自动扩展足够的 draft rows | **已对齐并收紧边界**：Glide `onPaste` 现在只在剪贴板超过一行，且目标为单个空白新增单元格、单个新增行号，或跨多行的全空白新增行选择时进入扩展路径；单行多列选择、列选择、多个行号、已有行、任一非空新增行和只读列继续由原生有界粘贴处理。扩展会复用目标之后连续的空白 draft rows，不足部分一次性分配稳定负数 row key，并通过 Store 单次状态提交写入全部值；额外预建空白行保持不变，隐藏列按可见列映射，数值文本继续使用现有无精度损失归一化。UI planner 与 Store 双层限制每批最多 1,000 行/100,000 单元格，Store 会二次校验目标存活、空白状态、列 ownership、执行状态和全空输入。Glide 多单元格普通粘贴也改为一次 `setBulkCellEdit`，避免逐单元格 Zustand 更新。纯逻辑和 Store 回归覆盖 5→10、10→10、10→5、行号优先、隐藏列、非空/已有/只读/过期目标和全空拒绝。Oxide 位置：`src/features/data-grid/model/newRowPaste.ts`、`src/components/workspace/DataGrid.tsx`、`src/store/useTabStore.ts`。真实 WebView 系统剪贴板与超大矩阵交互验证延期。 |
| `8f21e7af9` | SQL Server 未命名聚合结果列获得稳定标题 | 属于 D02/D04 的正式 SQL Server package 缺口；Host 不应在无 source ordinal/alias contract 时按表达式猜列名。需进入签名 package 和 conformance fixture。 |
| `2e8ed4b48` | Database Search 对所有表分批扫描 | **逻辑已对齐并强化信任/性能边界，真实产品验证延期**：Oxide 新增独立的 Database Search 工作台，可由 Command Palette、数据源、database、schema 和 base table 右键进入；一次搜索冻结 connection/database/schema/table、term 和 per-table limit 快照，先扫描 200 张表，再由用户继续下一批或全部剩余。schema metadata 最多 6 路并发，表查询严格串行并复用统一 query cancellation；单表失败隔离并有界收集，已完成结果在停止后保留。Host 根据 live connection driver 与签名 capability 选择 identifier quote、cast 和 TOP/FIRST/ROWS/FETCH FIRST/ROWNUM/LIMIT，不接受 renderer 传入 database type 或可执行 SQL；搜索专用命令只执行 Host 生成的 bounded SELECT，结果定位条件在 Host 每表一次批量生成。projection 仅返回 PK 与参与搜索的字段，不读取无关 BLOB；term/identifier/column/locator 输入均有 Host 上限。前端最多规划 50,000 张表、保存 5,000 条/8 MiB 命中、呈现窗口每次 200 条，结果可用 PK 或最多三列匹配值打开现有 Table tab。Oxide 位置：`src-tauri/src/core/database_search.rs`、`src-tauri/src/commands/database_search.rs`、`src/features/database-search/DatabaseSearchDialog.tsx`、`src/features/database-search/model/databaseSearch.ts`、`src/components/workspace/SchemaSidebar.tsx`。真实 70+ driver 方言、权限、超大 LOB、取消和 WebView 交互验证延期。 |
| `600af8753` | INSERT 列 inlay hints 扩展到 INSERT ... SELECT projection | 本阶段已对齐并采用更严格的 arity 边界：bundled LSP 与 Monaco 显式列 fallback 均把 INSERT target 列映射到 SELECT projection 起点，覆盖直接 SELECT、括号 SELECT、CTE source、ALL/DISTINCT、PostgreSQL `DISTINCT ON`、SQL Server `TOP (...) [PERCENT] [WITH TIES]` 和嵌套表达式；隐式 target 继续由同步 metadata 排除 identity/auto-increment、generated、hidden 后解析。任一 `*`/`source.*` 或 target/source 列数不一致时整条提示 fail closed，不按较短一侧生成误导标签。可见范围位于 PostgreSQL dollar-quoted routine body 时，LSP 和本地 fallback 会从有界窗口内的 opening tag 后解析，不改变普通字符串/注释屏蔽。server 仍保持 32 KiB 邻域、64 KiB request 和 500 hint 上限；LSP/前端单测覆盖协议映射和 UTF-16 offset。Oxide 位置：`vendor/sql-lsp/src/server.rs`、`src/lib/sqlInsertValueHints.ts`、`useLspCoreProviderCoordinator.ts`。真实 Monaco 布局和产品 metadata 验证延期。 |
| `e43e36e7a` | PIT 已创建但 `_shard_doc` 查询失败时回退到 bounded from/size | 本阶段已对齐并收紧错误边界：PIT 首个 `/_search` 保留结构化 HTTP 状态和 error tree，仅当 HTTP 400 同时明确包含 `_shard_doc` 及 no-mapping/unknown/unsupported 语义时关闭 PIT、从 `from: 0` 进入最多 10,000 行的 offset cursor，并在当前连接内记忆该能力缺失，后续首页不再重复探测。认证、其他字段 mapping、5xx 和传输错误原样失败且不会永久降级；connect/disconnect 会重置探测状态。回退请求不携带 `_shard_doc`，PIT 续页不做不安全的中途模式切换。Rust HTTP fixture 覆盖首次回退、cursor、能力记忆和无关 400 不重试。Oxide 位置：`src-tauri/src/drivers/elasticsearch.rs`。真实 ES 6/7/8、OpenSearch/Easysearch 深分页验证延期。 |

### 上一增量审计（`d69cf9da7` → `8be503bf4`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `8be503bf4` | 应用更新包在关闭对话框后继续后台下载，并在工具栏持续显示状态 | 本阶段已对齐并补充性能/安全边界：下载状态移入全局 Store，点击后立即关闭对话框但不取消请求；标题栏提供可重新打开的 available/downloading/downloaded 状态入口，已知总量显示环形进度，未知总量显示 indeterminate 动画。下载 chunk 只按 100ms 或 total/完成边界发布，避免 AppBar 高频重渲染。安装/重启前前后两层检查 Workbench `running/waiting` 任务，存在查询、迁移、导入导出或 Agent 审批时保持 downloaded，不调用 updater。Tauri 签名校验和 active `Update` handle 仍由既有 service 所有。 |
| `23f0b1255` | Oracle Data Compare 允许显式选择 schema | Oxide 已由 capability 而非产品 allowlist 覆盖：`TableDataCompareDialog` 对不声明 database catalog 的任意关系驱动读取 `getSchemas` 并显示目标 schema，下游 column/table/compare endpoint 都携带所选 schema；声明 catalog 的驱动则按 database→schema 选择。正式 Oracle package 与真实 schema 权限验证仍延期，不能以候选身份冒充可运行能力。 |
| `d79d35792` | SQL Library 默认折叠分组并提供 Collapse All | 已完成等价边界并强化批量性能：Oxide 新增独立于 Project Files/Query History 的项目级私有 SQL Library，SQLite 保存 folder/file、连接和 database/schema 作用域、打开次数与时间；树节点首次进入项目时默认折叠并提供 Collapse All。支持搜索时临时展开祖先、自然排序/最近使用、创建/重命名/递归删除、同连接作用域移动、拖入 Monaco 光标、Search Everywhere、标签复用和 dirty save。启动只加载摘要，打开文件才加载 SQL；导入使用 Host 有界目录扫描后一次 IPC/单事务写入，导出一次批量加载后由 Host 原子落盘。旧 `saved-queries` 只在默认项目成功批量落库后删除。DBX 位置：`apps/desktop/src/components/layout/SqlLibraryPanel.vue`、`apps/desktop/src/stores/savedSqlStore.ts`、`crates/dbx-core/src/saved_sql.rs`、`src-tauri/src/commands/saved_sql.rs`。Oxide 位置：`src/components/workspace/SqlLibraryPanel.tsx`、`src/store/useSavedQueryStore.ts`、`src-tauri/src/core/store.rs`、`src-tauri/src/commands/saved_sql_io.rs`。Project Files 继续代表用户工作区内真实 `.sql` 文件，不与私有 Library 自动镜像，避免双写和来源歧义。 |
| `5f9ba5176` | Tab bar 位置、分组和排序可配置 | 已对齐并收紧交互语义：Oxide 持久化 top/bottom/left/right、none/database-type/connection 与 manual/created/title 设置；普通工作区和 Split Editor 共用同一布局，纵向 split 使用紧凑宽度。纯函数先隔离 pinned/regular，再稳定分组和自然排序；旧 tab 缺失创建时间时按原始顺序迁移。只有 manual 模式开放拖动，且禁止跨 pinned 或跨显式分组投放。Close Left/Right 现在接收当前可见顺序生成的精确 ID 集合并一次确认，不会在排序后按 Store 原数组误关标签。DBX 位置：`apps/desktop/src/stores/settingsStore.ts`、`components/layout/AppTabBar.vue`、`composables/useTabDrag.ts`、`App.vue`。Oxide 位置：`src/lib/tabOrganization.ts`、`src/components/workspace/TabBar.tsx`、`SplitEditor.tsx`、`src/pages/workspaceRuntime.tsx`。 |

### 上一增量审计（`f075caef2` → `d69cf9da7`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `69a032ed6` | Explorer 多选表批量操作、拖入 SQL Editor 与批量加入 AI 上下文 | 已完成 Oxide 全链路对齐：除原有显式选择模式外，Ctrl/Cmd/Shift 点击可直接进入同 schema 的有界多选；拖动已选表使用与 DBX 相同的阈值、跟随标签、命中光标和全局精确落点生命周期，载荷版本化、64 KiB 封顶且不含 URL/凭据，Monaco 只在普通可写 SQL 文档接受，并按源 capability 的 identifier quote 插入 schema-qualified 引用。mousemove 不触发 QueryEditor React 重渲染，命中检测每帧只执行一次，多表标签只显示首表和数量。批量工具条和表右键都可将一张或多张表加入共享 Assistant；入口先切换并确认目标连接/database/schema，再复用或创建匹配的 Query Tab。目标上下文变化会清空旧引用，同一上下文则合并；最多 200 个、总计 64 KiB 的去重标识符作为可移除 chip 加入当前草稿。提交时标识符进入明确的 non-instructional JSON 数据块，用户可见消息仍只显示原始问题，Chat/Plan/Agent 的既有权限边界不变。解析器拒绝畸形、超长和控制字符载荷，Assistant 请求不会覆盖现有草稿。纯函数、Store、拖动生命周期和完整 Assistant UI 回归覆盖 quoting、载荷上限、合并去重、chip 消费及最终 Host prompt。 |
| `ba11e4be8` | Editor settings 的实时预览固定在设置滚动区上方，并修复异步预览生命周期 | 已按 Oxide 的 Monaco 架构对齐且避免额外编辑器实例：Editor 设置页顶部新增固定实时 SQL 预览，设置列表单独滚动；预览同步反映字号、Tab、换行模式、Minimap、Vim 相对行号以及 keyword/function case、FROM/逻辑运算符布局。预览由纯数据函数生成，不注册 Monaco model/provider、不改变全局 Monaco theme，也不接触项目或数据库。组件与 Dialog 结构测试覆盖布局、大小写、换行、Minimap、字号和相对行号。 |
| `42c0dc7f8` | API 型 AI Provider 支持自定义 HTTP Header | 已对齐并强化凭据边界：OpenAI Compatible Assistant 与行内补全分别提供紧凑的 gateway/tenant Header 编辑器；`Authorization` 可在默认 Bearer 之后覆盖，`Host`、`Content-Length`、`Content-Type`、`Connection`、`Transfer-Encoding`、`Proxy-Authorization` 等 framing/代理头由 Host 保留。名称、值、大小、条数与大小写重复均由前后端校验。Header 值不进入 Zustand/localStorage、项目、日志、Agent sidecar 或 checkpoint，只在显式打开设置时读取，并按 `assistant`/`inline` + destination 存入当前用户私有 Rust credential file。Agent Host 与 inline command 在发送前重新装载；renderer 即使注入 `customHeaders` 也会被反序列化边界丢弃。API Key 同步升级为 Assistant/Inline 独立作用域，旧 URL-only credential 可读取迁移，显式删除以空私有 marker 阻止旧凭据回退。 |
| `40a806a24` | 分页表格排序必须由数据库执行并从第一页重载 | Oxide 已有等价且边界更清晰：表 Tab 的 header/context sort 永远调用 `loadTablePage(tabId, 0, ..., sortOverride)`，Host 生成带结构化 `TableSort` 的分页查询；后续翻页从 tab `gridState` 继续携带同一 sort。只有非表的已物化查询结果使用本地稳定排序，因此不会把“当前一页重排”伪装成全表排序。 |
| `662037295` | Tab 菜单支持关闭左侧 Tabs | 已有等价能力：`TabBar` 根据可见顺序计算 `canCloseLeft`，菜单提供 Close to the Left；Store 保留 pinned tabs、对所有将关闭的 dirty tab 统一确认、释放 document cursor，并且不改变仍有效的 active tab。Close Right/Others/All 共享相同约束。 |
| `5eb071bc2`、`f9ff9245c` | 表引用 hover 可配置 DDL 预览，并支持在表结构内容中搜索 | 已按 Monaco 架构对齐：列/索引 metadata hover 始终保留，独立设置只控制额外 DDL 获取；开启时复用 project/connection/database/schema/table/object-type 绑定的 24 小时 source cache，不在普通列 hover 或关闭设置时增加请求。DDL 预览最多 160 行/24 KiB Unicode 字符，动态 Markdown fence 防止数据库 source 关闭代码块，晚到结果受文档版本、连接 owner、metadata revision 和设置状态共同丢弃。完整 DDL 页新增显式 Search 按钮并调用 Monaco 原生 Find，保留高亮、上下条结果、键盘和可访问性语义；超长 hover 明确引导到完整页搜索，不复制一套脆弱的 Monaco hover DOM。 |
| `cd008b2d5` | DDL/结构信息可显式刷新，并可选择打开时获取最新 DDL | 已对齐并保持 cache-first 默认：表 DDL 页原有 Refresh 始终以 `force=true` 越过 24 小时 cache；新增默认关闭的“打开 DDL 页时刷新”设置，开启后首次打开直接 force load。结构 metadata 的显式刷新继续使 DDL/view source cache 失效；普通 tab 切换和 Explorer hydration 不产生额外 DDL 请求。 |
| `49926f25f` | MySQL SQL dump 中 `_binary` 原始字节可安全导入 | 已对齐并补强现有审阅导入：MySQL/MariaDB 方言在文本解码前把 `_binary '<raw bytes>'` 规范化为 `X'<HEX>'`，覆盖 NUL、无效 UTF-8、MySQL 反斜线转义和双引号逃逸；字符串、反引号标识符、`#`/`-- ` 行注释及块注释中的相似文本不改写，未闭合 binary literal fail closed。UTF-8 BOM、UTF-16 LE/BE 和严格 GB18030 fallback 继续支持，预览 digest 与最终执行使用同一规范化内容，文件变化仍会被拒绝。 |
| `14ad5ef9b` | MySQL VARBINARY 文本值复制为原始字符串 | 已对齐到 Oxide 查询网格：仅对活动 MySQL/MariaDB 连接、声明为 VARBINARY 且值为 Host canonical `0x<hex>` 的单元格尝试严格 UTF-8 解码；必须无危险控制字符并 byte-for-byte 回编码一致才复制文本。任意二进制、NUL、非法 UTF-8、BINARY/BLOB、SQL Server VARBINARY、普通文本及 SQL 文件导出继续保持无损 hex，不做启发式猜测。Copy All、选区复制和表头设置共用同一序列化路径。 |
| `ef2fdb941` | Oracle 列定义中检测位于 `NOT NULL` 之后的 `DEFAULT` | 已对齐 Oracle 与 OceanBase Oracle 的编辑期诊断：覆盖 `CREATE TABLE`、`ALTER TABLE ... ADD`、多列、嵌套括号与多语句，诊断精确标记违规 `DEFAULT`。分词器跳过字符串、引号标识符、Oracle q-quote 和注释，排除表级约束及非建表语句；其他方言不产生该 marker。诊断使用独立 Monaco owner，不覆盖 LSP 与执行错误 marker。 |
| `d69cf9da7` | 数据详情对话框使用方向键浏览相邻行/列 | 已按 Oxide 单值详情架构对齐：只读 Value Editor 在标题区提供上一/下一行及上一/下一列按钮，并支持 ↑/↓/←/→；边界不循环，隐藏列后的可见顺序和过滤/排序后的 visual row 顺序均被保留。Monaco、输入框、可编辑内容、菜单/listbox 与带修饰键操作不会被劫持；可编辑单元格继续把方向键留给编辑器，避免静默丢失草稿。纯函数测试覆盖方向映射、越界和 native-control 门禁。 |
| `bc41e8d76` | macOS 定时导出持久化目标卷身份，避免相同路径落到错误挂载卷 | 已对齐到 Oxide 的 Host-owned 定时 SQLite 备份边界并覆盖 Windows/Linux：用户保存计划时记录不可由 renderer 提交的目标卷身份；macOS 优先使用持久 volume UUID，Windows 使用打开目录/文件 handle 的 volume serial，其他 Unix 使用 device id。执行前重新解析 canonical directory 并比较，发布后再从已打开的最终文件核对；身份缺失、无法读取或改变都会 fail closed，已发布到错误卷的产物会删除且不会形成成功回执。旧计划必须显式重新保存，不能在升级后静默认领当前挂载卷。 |
| `d411f0497` | Elasticsearch REST 请求风险按 method/path 分类，读请求不再被误判为 mutation | 已对齐并保持更严格删除策略：前端与应用内 Agent Host 现在共同接受 GET/HEAD/OPTIONS，以及 POST `_search/_count/_sql/_msearch/_field_caps/_terms_enum/_validate/_explain/_rank_eval/_search_shards`、EQL/async search/scroll；多请求取最高风险，未知 POST fail closed。`#`、`//` 和跨行块注释中的伪请求不参与分类。DELETE 仍按 Oxide 的 destructive confirmation 处理，不因 DBX 把单文档删除列为普通 write 而削弱确认。 |
| `cb3de0ef4` | Elasticsearch JSON key completion 不遗留自动闭合引号，并区分已有 `:` 的 key | Oxide 原 Monaco provider 已能覆盖紧邻 closing quote，本阶段把逻辑抽成 UTF-16 model offset 可验证的完整 key replacement：同时替换旧 key 后缀与 closing quote；若右侧已有 `:`，只替换 key，不再插入第二份 value scaffold。quoted filter text 与纯逻辑回归保证首次、再次补全和 key 中间光标一致。 |

### 当前差距补齐记录（2026-09-01）

| 差距 | 本轮补齐 | 验证状态 |
| --- | --- | --- |
| PostgreSQL sequence `is_called` 与 ownership 状态 | DBX 与旧 Oxide 都只读取 `last_value` 并生成 `setval(..., true)`。Oxide 现在在具备 `SELECT`/`USAGE` 权限时同时捕获 state value 与 `is_called`；从未调用的 sequence 使用 start value + `false` 恢复。Schema Diff 将同名 sequence 的结构变化与状态变化分离，可审阅地恢复 `OWNED BY <table.column>`、`OWNED BY NONE` 和精确 `setval`，不会再把纯状态差异误判为不可执行的对象定义变更。旧快照未包含 `sequenceIsCalled` 时继续按历史 `true` 语义读取。SQL 备份也保留相同状态，权限不足时不猜测。 | 新增/更新 Rust 单元测试覆盖 never-called export、同名 sequence 状态恢复、owner 解除、只读 catalog 查询和旧快照 fallback；真实 PostgreSQL 版本/权限 fixture 仍按统一数据库验证阶段执行。此记录取代下文 T05/M01 中“仍缺 `is_called` 逻辑”的旧残差描述。 |
| MongoDB shell 编辑器与 Host 执行契约 | DBX 的 `lib/mongo/mongoCompletion.ts` 与 `crates/dbx-core/src/mongo_shell.rs` 使用 shell 风格；旧 Oxide 只有原生 JSON completion/execution。Oxide 保留 JSON 契约，同时新增专用 Monaco `mongodb-console` 语言、实时 collection/method/chain/字段/操作符/stage/options 补全、多行及顶层分号命令范围，以及 Host 结构化 parser。可执行 shell 面现覆盖 DBX 主 collection surface：有界 `find/findOne/count/countDocuments/aggregate/distinct/getIndexes/stats/dataSize/storageSize/totalIndexSize`，`insertOne/insertMany/insert`、`updateOne/updateMany/update`、`deleteOne/deleteMany`、`findOneAnd*`、index create/drop、collection drop、`show databases`、`db.version/runCommand/createUser`，以及 `sort/skip/limit/collation/explain`。常用 options 经白名单进入 Host-owned find/aggregate 或精确 native command；未知 options fail closed。构造器覆盖 `ObjectId/ISODate/NumberLong/NumberInt/NumberDecimal/Timestamp/BinData`，字符串中的相似文本不会被改写。Shell delete/drop、`runCommand` 和 `$out/$merge` 会与 JSON 形式一样进入破坏性确认。Run Current 与 Run All 使用相同范围/解析边界。本阶段继续对齐 DBX 的 completion 状态机：`db.audit.` 可在同一结果中优先解析 `audit.logs` 与直接 collection method，统一替换 `db.` 后的完整 qualified prefix；`find().count()` 只在 Host 真正接受的单链位置出现，已有 sort/skip/limit 链不误提示；`//`、`--`、块注释和 method-shaped string 均不会触发幽灵候选。 | Rust/前端单元测试覆盖 native JSON 回归、shell→native contract、dotted collection、Extended JSON、字段级 argument routing、options、写方法、破坏性分类、链式分页、多命令/注释/字符串分号和补全范围。DBX 的 `use <database>` 需要与 Oxide tab/database selector 形成单一状态源后再开放，不能只改变 driver 内部状态造成 UI/执行目标漂移；真实 MongoDB 版本、权限、write concern/index options 和并发 mutation 验证仍按统一数据库阶段执行。 |
| Elasticsearch Console 传输与最小权限探活 | 对齐 DBX `crates/dbx-core/src/db/elasticsearch_driver.rs` 和 `lib/connection/elasticsearchKibanaProxy.ts`：`_bulk`、`_msearch`、`_msearch/template` 逐行验证 JSON、补终止换行并使用 `application/x-ndjson`。连接可选择直连或 Kibana/OpenSearch Dashboards Console Proxy；代理固定 POST `/api/console/proxy`，保留原始 method/path，发送 `kbn-xsrf`/`osd-xsrf`，并读取 `x-console-proxy-status-code` 作为真实 ES 状态。连接表单提供链路示意、部署 base path、受限 GET 探活路径和显式跳过探活；配置进入 Rust 持久化模型，内部参数在驱动解析后从真实请求 base URL 删除。自定义探活成功后仅 best-effort 读取根版本，不因 `/` 权限不足推翻成功；跳过探活时 server version 保持未知，不伪造版本。 | Rust 定向测试覆盖选项解析/剥离、路径越界拒绝、代理 URL/method/XSRF、代理状态码、NDJSON、禁用探活与旧连接迁移；前端测试覆盖 URL 序列化、大小写兼容、旧参数清除和粘贴 GET 规范化。真实 Kibana/OpenSearch Dashboards base path、反向代理认证、ES 6/7/8/OpenSearch 最小权限账号仍按统一真实产品阶段验证。 |

### 最新增量审计（`1d98eca99` → `f075caef2`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `8f3134dce` | Elasticsearch 索引 mapping/settings/stats 查看与保留索引的安全清空 | 本阶段完成并强化：Explorer 只对活动 bundled Elasticsearch 的真实 `index` descriptor 暴露入口；mapping/settings/stats 通过封闭 enum 和 driver-owned API 读取，不允许 renderer 提交任意 endpoint。清空先重新读取活动 catalog，生成绑定连接、server version、索引目标和固定 `_delete_by_query?conflicts=proceed&refresh=true` 请求的审阅 token；通配分组必须键入 `CLEAR <pattern>`。Host 拒绝 `_all`、裸 `*`/`?`、逗号多目标、路径逃逸、外置 package 和连接身份不一致。结果明确返回 total/deleted/version conflicts/timeout/有界 failure，任一不完整条件显示为 partial；成功后刷新匹配的已打开 document tab 和 Explorer 计数。真实 Elasticsearch 6/7/8、OpenSearch 权限与并发写入验证延期。EasySearch 当前仍是候选外置产品，不能借 Elasticsearch UI 绕过签名 package/conformance 门禁。 |
| `4baa46ca8` | GaussDB/openGauss transfer 可选关闭目标列名引用 | 已完成并强化：单表与批量迁移请求增加向后兼容、默认开启的 `quoteTargetColumnNames`，并纳入预览确认摘要和批量计划摘要。UI 只对活动 external GaussDB/openGauss 且已声明 reviewed transfer capability 的目标显示选项；Rust Host 再次绑定 live connection driver id、签名 package capability 与 PostgreSQL transfer dialect，普通 PostgreSQL、内置驱动、身份缺失或 capability 不足均拒绝关闭引用。Host 的参数化 INSERT、UPSERT、冲突键和更新列统一使用同一 resolved policy；简单名称可不引用，保留字、空格及其他不安全名称仍强制引用。旧请求反序列化继续默认引用。新 Rust/前端契约测试覆盖默认迁移、确认令牌变化、安全名称、保留字、INSERT/UPSERT 一致性以及 UI capability 门禁。由于 Oxide 对 external package 暂不开放 Host-generated table DDL，本阶段对齐现有目标表的数据迁移路径，不伪装成可创建 GaussDB 表；真实 GaussDB/openGauss package 与大小写折叠验证延期。 |
| `f075caef2` | MCP Streamable HTTP、bearer token 与连接/数据库细粒度授权 | 已完成并强化：公开 `oxide-agent mcp http` 与 stdio 复用同一个严格只读 `ToolRuntime`，项目、连接、数据库、工具、行数、结果字节数和超时均成为不可由工具输入扩大的进程 grant；未授权工具不出现在 `tools/list`，runtime 仍会二次拒绝直接调用。HTTP token 只从普通、非 symlink 的私有文件读取，不接受命令行明文；默认 loopback bind，并由 RMCP Host 校验、Oxide bearer middleware 与同源 Origin/CORS predicate 联合保护。远程 bind 必须同时显式启用并配置 Host/Origin allowlist。Desktop Settings 新增服务管理、token 轮换、readiness、异常重启和有界脱敏诊断，`oxide-agent` 作为 target-specific external binary 随包发布。真实网络协议测试覆盖 initialize/initialized/tools-list 和工具过滤；公开 HTTP token 与应用内 CLI 的短期审批写 bridge 完全隔离。 |
| `f075caef2` | read query 的跨数据库对象范围扫描 | 已完成并接入公开只读 runtime：新增共享 Rust `core::query_scope`，在原有只读语句验证后扫描 `FROM`、`JOIN`、顶层逗号 relation、SQL Server `CROSS/OUTER APPLY`、引用标识符以及 SQL Server 三/四段式对象名；字符串、普通注释、MySQL executable comment 与 PostgreSQL dollar quote 使用同一有界清洗边界。公开 `oxide-agent mcp stdio/tools call` 增加不可由工具输入扩大的 `--database`/`OXIDE_DATABASE` allowlist；唯一授权数据库自动成为执行目标，多个数据库要求显式选择。read query 与 estimated EXPLAIN 在执行前同时校验目标数据库和 SQL 内对象范围，跨库或派生 relation 无法可靠分类时 fail closed。PostgreSQL 两段名称继续按 schema 解释，不误判为跨库。Rust tests 覆盖 JOIN、逗号 FROM、引用名称、注释/字面量、派生表、APPLY 和 SQL Server 四段式引用。 |

### 上一增量审计（`dc2e16ffafbc` → `1d98eca99`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `f70fe38a4`、`1d98eca99` | Win7 离线制品和静态 browser release 构建接入 sccache | 本阶段对齐并扩大到 Oxide 的 tag CI 与四平台桌面 release：Rust job 禁用 incremental，通过固定 commit 的 `mozilla-actions/sccache-action` 安装固定 `v0.10.0`，使用无需仓库凭据的 GitHub Actions backend。`swatinem/rust-cache` 不再恢复 release target tree，避免与 compiler cache 同时占用大量 runner 磁盘；quality/CI 的显式 `cargo clean` 仍保留以约束峰值磁盘，而后续重编译可命中 sccache。每个作业始终输出 cache stats，契约测试锁定 action/binary pin、无 S3/AWS secret 和 `cache-targets: false`。 |
| `4605e4c32` | Dameng agent 版本从 0.1.57 更新至 0.1.58 | 只有 DBX 私有/独立 driver 制品版本变化，没有可迁移源码行为。Oxide 当前 Dameng 仍为候选外置产品；在取得签名 package、entrypoint digest、server-version conformance 与运行证据前，不复制版本号或把候选误标为 ready。 |

### 最新增量审计（`eba4e95a0` → `dc2e16ffafbc`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `27f62fe6e` | 数值单元格按运行时 locale 解释单个逗号 | 本阶段对齐：`cellInputCoercion.ts` 从 `Intl.NumberFormat.formatToParts` 获取小数和分组符，只对 numeric family 规范化输入；`114,870` 在英文 locale 保持整数精度并去分组，在小数逗号 locale 转为 `114.870`，非数值列与未知逗号语义不改写。实现不经过 JavaScript `Number`，因此 bigint/decimal 文本不会丢精度。 |
| `0e9f92c91` | 复制 NULL 单元格时生成空字段 | 已有等价行为并补回归：前端选区 TSV/CSV 和 Rust 流式导出均把 SQL NULL 写成空字段，保留分隔符，不再复制字面量 `NULL`；JSON/SQL 等格式仍按各自格式契约处理。 |
| `d144e1bc0` | WHERE 与 ORDER BY 撤销历史解耦 | 按 Oxide 架构等价对齐：WHERE 输入拦截 Ctrl/Cmd+Z 与 Ctrl+Y 的向上冒泡但保留浏览器原生文本撤销；ORDER BY 是结构化下拉选择，没有共享文本历史，因此不会消费 WHERE 的 undo stack，也不复制一套全局 history。 |
| `0812e57cf` | 长文本单元格使用视口安全的悬浮编辑器 | 本阶段对齐到现有 Value Editor：多行、超过 160 字符、JSON/array/binary 与结构值不再打开 Glide 小 overlay，而由普通激活、Shift+Enter 和右键统一进入可调整大小、受视口约束的完整值编辑器。短标量仍保留快速内联编辑。 |
| `f489db4f0` | Windows 含空格路径在 Explorer 中可靠定位 | 已有等价能力：文件导出与备份入口直接调用 `@tauri-apps/plugin-opener` 的 `revealItemInDir`，由 Windows Shell item API 定位，不拼接 `explorer /select,<path>` 命令行。 |
| `e0746a2db` | 连接树字体层级和当前登录 schema 权重修正 | 本阶段对齐：连接节点使用 variable weight 480，普通 schema/object 层使用 430，Oracle-family 当前登录 schema 使用 600；产品识别继续复用既有 login-schema 门禁，避免 PostgreSQL/MySQL 同名 schema 被误强调。 |
| `99c3bd0f4` | Sidebar/toolbar 增加状态反馈动画 | 本阶段按 Oxide 设计系统对齐：工具按钮提供短按压和 active 反馈，定位动作每次重播有界 pulse，树展开 chevron 使用 180ms settle；全局 `prefers-reduced-motion` 继续把动画和 transition 降到近零。没有为静态装饰增加持续动画。 |
| `bcea953a5` | Windows Server 2012 R2 使用 Win7 离线安装器兼容链 | 当前不属于已声明支持目标，不能标为对齐。DBX 依赖 `vendor/wry/src/webview2/mod.rs` 的旧内核补丁、WebView2 109 fixed runtime、旧 loader 和专用远端验证 workflow；Oxide 使用标准 Tauri/wry/WebView2 crates。只有产品明确新增 legacy Windows 发行目标后，才应以独立制品、依赖审计和真实 Server 2012 R2 机器验证接入，不能把普通 Windows bundle 冒充兼容包。 |

### 最新增量审计（`9190554e5` → `eba4e95a0`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `d424ea38f` | AI 流式 delta 在发送到 WebView 前合批 | 本阶段对齐：`src-tauri/src/agent/host.rs` 对连续 `answer.delta` 使用 100ms/64KiB 有界批次；非 delta 与 turn 清理会先 flush，reset 语义、最新 sequence 和尾批次有单元测试。原始 reasoning 与环境变量仍不进入 renderer。 |
| `c305325e3` | Agent/JDBC 制品下载按整百分比或时间节流进度事件 | Oxide 的签名 driver package 下载目前不向 WebView 逐 HTTP chunk 发事件，CLI 托管安装只报告阶段，因此不存在同类 IPC 洪泛；若后续增加字节进度，必须复用 1%/500ms/未知总长 1MiB 的门禁。 |
| `b3fcb3a6f` | 定时备份增加 gzip 与历史过滤 | 本阶段对齐到 Oxide 的 Host-owned SQLite schedule：旧计划默认 `none`，用户可选 `gzip`；SQLite 完整性校验后在 blocking worker 中以 1MiB 缓冲压缩、协作取消、临时文件+原子发布，持久报告只记录最终路径/压缩后大小/安全校验摘要。保留和删除门禁同时接受 `.sqlite`/`.sqlite.gz`；前端按状态、名称、路径、错误或触发方式筛选最近 50 条。真实大文件、磁盘不足和多平台恢复验证延期。 |
| `0a239bddb`、`a849979dd` | Xugu public synonym scope 与 scheduler job 浏览/管理 | 仍是 D02/D04 的产品运行时缺口：Oxide 只有 Xugu 候选身份和 LSP compatibility route，没有已签名 Xugu package，不能暴露未验证的 synonym/job mutation。DBX 位置：`agents/drivers/xugu/main.go`、`lib/database/xuguSchedulerJobSql.ts`、`lib/sidebar/xuguPublicSynonyms.ts`。 |
| `8da9905ed` | OceanBase Oracle view DDL 预览复用 Oracle formatter | 编辑器格式化已由 bundled LSP 统一提供，`oceanbase-oracle` 保留产品 identity 并进入 SQL formatter/preferences 路径；Oxide 当前没有 DBX 同类 hover DDL formatter surface。正式 OceanBase package 仍需用真实 view DDL 证明 Oracle 语法保真，不能用 PostgreSQL compatibility parser 冒充产品 conformance。 |
| `8e2e8c1b8` | 连接关闭后同步 flush 已持久化 tab，避免旧 tab 立即恢复 | 不适用当前 Oxide：`useTabStore` 是非持久化运行时 Store，断开连接不会从磁盘恢复旧 tab；没有可 flush 的 tab storage。将来若恢复 tab persistence，必须把 close/disconnect 与 durable flush 绑定并移植 DBX 的 immediate-restore regression。 |
| `d1046d54f` | 导出核心移入 blocking pool | 已有等价/更细边界：`commands/table.rs` 使用容量 2 的 page channel，并以 `spawn_blocking(write_table_export_stream)` 执行 CSV/JSON/XLSX/Parquet 等同步编码和文件 I/O；异步 producer 保持查询分页、取消和 backpressure。 |
| `b7d33e375` | InfluxDB 合并 compat query series，并引用显式列 | 已对齐 native HTTP runtime：V1 response 会合并全部 series 的列并集、把 tag 提升为稳定列、缺失值保留 `null` 并由 `QueryResult::rows_limited` 执行硬上限；measurement metadata 的 `SHOW ... FROM` 参数仅接受有界名称并转义双引号，V2 继续使用单独 Flux string escape。该产品保持专用 time-series workspace，不伪装为关系型 table SQL 或 SQL LSP。DBX 位置：`crates/dbx-core/src/db/influxdb_driver.rs`、`sql_dialect/table_select.rs`；Oxide 位置：`src-tauri/src/drivers/influxdb.rs`。`v1_series_merge_preserves_tags_and_limits_rows` 已覆盖静态合并边界；真实 InfluxDB 1.x/2.x query/权限验证仍延期。 |
| `1c0e97b52` | Oracle routine 参数 metadata alias 使用双引号 | Oxide 的 Oracle/Dameng/OceanBase routine metadata 由外置 driver descriptor 提供，Host 不执行 `ALL_ARGUMENTS` 查询；对应修复必须进入该产品 package 和 conformance fixture。未发布 package 前入口保持不可用。 |
| `0c8b796c8` | Oracle-family schema 树突出当前登录用户 | 本阶段对齐：`src/lib/loginUserSchema.ts` 仅对 Oracle、Dameng、OceanBase Oracle mode 做大小写不敏感匹配，Explorer 将对应 schema 加粗并标注 current login user；PostgreSQL/MySQL 的同名 schema 不会误判。 |
| `d45962814`、`eba4e95a0` | GBase JDBC 与 Doris-family MySQL transfer 可选择、方言映射 | Oxide transfer 入口由 live signed capability `supportsTableDataTransfer` 控制，不靠产品名 allowlist，因此 package 一旦通过 transaction/transfer conformance 即自动可选；目前 GBase/Doris 只有候选/LSP route，没有正式签名运行包和 server evidence，继续保持不可执行。 |
| `d96da5dec` | SQL Server trigger 支持多事件、AFTER/INSTEAD OF 与 disabled state 编辑 | 未对齐的明确产品差距：Oxide 没有 ready SQL Server package，也没有 DBX 的 table-structure trigger editor；需要 package 输出结构化 event/timing/enabled metadata，并在受审 DDL/事务或补偿策略下编辑。DBX 位置：`crates/dbx-core/src/db/sqlserver.rs`、`table_structure_sql/triggers.rs`、`TableStructureEditor.vue`。 |
| `e690298dc` | 大型 JSON Tree 使用虚拟列表 | 本阶段对齐并加强：Value Editor 使用 iterative flatten、RFC 6901 稳定 path、24px 固定行和 overscan，只挂载视口行；100,000 logical row 硬上限提示切换完整 text view，避免深层递归栈和宽对象 DOM 爆炸。5,000 字段 fixture 验证挂载节点少于 100。 |

### 最新增量审计（`cd78c0ae1` → `9190554e5`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `73a7b3f4c` | Elasticsearch 通过 PIT + `search_after` 跨越 10k result window | 已迁移为 native opaque cursor 协议；Grid 分页、fallback 与 cursor 清理逻辑完成，真实 ES 6/7/8 验证延期。 |
| `5a11b8f14` | MongoDB 创建数据库预览和确认 | 已迁移为严格 JSON 预览与后端固定初始化 collection 的语义命令，避免执行 shell source；真实权限/竞争验证延期。 |
| `eafc0b2b1` | Grid 筛选列搜索固定在下拉顶部 | 已对齐：通用 Select 支持固定 header，Data Grid 的字段选择器在可滚动列列表上方提供可访问搜索框；匹配真实 identifier 与显示名、保持原 metadata 顺序、空结果有状态提示，关闭列表会清除临时关键词。 |
| `22775f363` | Grid 跳转到列支持搜索与键盘导航 | 已对齐：工具栏和 Ctrl/Cmd+G 打开锚定在数据网格上的紧凑列定位器，按视觉列顺序搜索列名、类型/注释和一基序号；↑/↓ 循环选择、Enter 平滑横向定位并回焦 grid、Esc 关闭。隐藏列不伪装为可定位列，空结果有明确状态。 |
| `45fb7fb7e` | Grid 的精确总数改为显式刷新，避免每次分页都阻塞在 count | 已对齐：默认预览只获取当前页；仅用户点击总数刷新时才运行精确 `COUNT(*)`。翻页保留同一筛选/排序范围内已知总数，筛选或排序变更会失效旧数值；有未提交编辑时禁用统计，避免为计数刷新而丢失草稿。真实大表/复杂筛选的时延与资源曲线延期。 |
| `bd3e58562`、`143be57d4` | completion popup 多选列并批量生成 SELECT/INSERT | 逻辑已对齐：Monaco 建议列表末尾提供 batch action，独立选择面板支持搜索、checkbox 与可访问焦点；SELECT 按 metadata 顺序插入，INSERT 生成可 Tab 导航的 VALUES snippet。batch action 的上下文复用当前 statement boundary 与 SQL noise mask，因此注释、字面量和 PostgreSQL dollar quote 中的 `;`/`FROM`/`INSERT` 不会误触发；普通单列继续作为默认 Enter 目标，不耦合 Monaco 私有 DOM。真实 WebView/IME 验证延期。 |
| `d5f4eadf7` | 工具栏执行前冻结 SQL selection | 已对齐：pointer-down 捕获 immutable snapshot，执行目标不再受 focus transition 影响。 |
| `e6f8b2187` | MCP 全局查询超时覆盖 | 已对齐到 Oxide 的独立公开 MCP 架构：`oxide-agent mcp stdio` 与 `tools call` 共用 `--query-timeout-secs` / `OXIDE_MCP_QUERY_TIMEOUT_SECS` 进程级策略；省略保持 30 秒，`0` 表示不自动截止。查询与 estimated EXPLAIN 共用该边界，模型不能通过工具参数扩大期限，公开 MCP 仍严格只读。 |
| `4ac362453` | PostgreSQL 对只读用户通过 `pg_catalog` 读取外键 | 已对齐并补足旧服务端兼容：约束与反向外键均只读取 `pg_constraint`、`pg_class`、`pg_namespace`、`pg_attribute`，不依赖可能受权限过滤的 `information_schema`；PostgreSQL 9.3 及不支持 `WITH ORDINALITY` 的兼容服务端改用 `generate_subscripts` 保持复合外键列顺序。真实只读角色和 PostgreSQL 9.3/兼容服务端验证延期。 |
| `7a4edb6c1` | PostgreSQL schema context 保留连接配置的 `search_path` | 已对齐：schema 上下文查询和事务会读取当前 `search_path`，把选中 schema 置前并保留 `$user`、extensions 等配置项；只在原路径未显式包含时追加 `pg_catalog`。读取 baseline 失败时安全回退到仅选中 schema，连接池在非事务路径仍会 `RESET search_path`。真实 PostgreSQL 的 role/database 级 path、用户 SQL 修改会话 path 与连接池复用验证延期。 |
| `1d71a5fc2` | Schema Diff 显示比较阶段与下一步 | 已对齐到 Oxide 的 snapshot→live review 流：比较明确报告“读取 live target metadata”“分析 schema differences”“打开 migration review”三项真实阶段，Task Center 同步更新当前阶段；弹窗内显示当前阶段及确定的下一步，但不伪造百分比或对象计数。 |
| `7ba30ae76` | SQL 文件树创建、重命名、删除 | 已有等价能力：Project Files 树支持新建文件/目录、保存、重命名和带确认删除；Rust 端规范化相对路径、限制 project root、拒绝 symlink 逃逸，并在重命名/删除后同步 tab 与 LSP 虚拟文档。 |
| `9491ab08d` | AI 生成 SQL 追加时去重 | Oxide 的生产 Assistant 不直接追加或执行消息代码块，而是创建绑定当前 editor revision 的 patch preview，用户审阅后才应用；重复点击不能绕过 revision 校验，也不会形成 DBX 的直接 append 重复路径。 |
| `f664918e9` | Schema Diff deploy script 执行门禁 | Oxide 的 apply 不执行前端展示脚本；后端按 immutable source、target fingerprint、plan id、动态确认和风险选择重新生成/校验计划，外置 driver 还需 session/token/Host recapture。前端 `supportsSafeApply` 仅作入口收窄，不能扩大后端权限。 |
| `469bd88c3` | HighGo 优先使用 LIMIT/OFFSET 避免 JDBC cursor 先物化全量结果 | 当前 HighGo 仍是未安装的候选产品，没有签名运行包，因此 Oxide 不会暴露 query/export 能力，也不存在伪安全 cursor。正式接入 HighGo package 时，必须在 sidecar conformance 中证明 server pagination，并禁止以 cursor 页大小冒充数据库执行上限。 |
| `694c34427` | CLI 安装默认 rustls crypto provider | Oxide 当前依赖图只有 `ring` provider，没有 DBX 同类多 provider 歧义；`cargo tree -i rustls -e features` 已确认 MongoDB、Tonic、Updater/Reqwest 共用 ring。若后续引入 aws-lc 等第二 provider，CLI/main 必须显式安装唯一 provider 并增加启动 smoke。 |
| `9190554e5` | SQLite-over-SSH worker、远程文件访问、查询与备份错误校验 | Oxide 通过版本固定、Minisign 校验的 Linux musl worker 提供远程查询、元数据、事务、备份/恢复和取消；连接、Assistant 与定时备份复用同一 Host 驱动。现已支持最多四跳的 SSH `direct-tcpip` 链和逐制品 SHA-256 上传授权；真实 SSH/大文件/多平台验证延期。 |

### 最新增量审计（`bd08fb630` → `cd78c0ae1`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `044bedaab` | SQL 保存后增加飞入 Library 的动画与 toolbar 图标 morph | Oxide 已有保存动作、持久化和结果反馈；按紧凑工具型 UI 原则不迁移装饰性飞行动画。后续只在用户无法判断保存去向时增加非阻塞状态反馈，并保持 reduced-motion。 |
| `3663dc4d7` | 可关闭单个查询结果并释放对应 result session，关闭页签快捷键优先清空结果 | Oxide 已在 `workspaceRuntime.tsx`/`useTabStore.ts:closeResultAt` 支持逐结果关闭；查询结果当前为一次性 materialized payload，不持有 DBX 同类 result session，因此无需复制 session release。后续大结果 streaming/session 化时必须绑定逐结果资源释放。 |
| `cc7112b24` | IoTDB native agent 内置时区数据 | 属于外置产品运行时打包/conformance，不改变 SQL LSP；Oxide 对 IoTDB 的候选声明不能替代签名 package 与真实时区查询证据，继续进入 driver rollout。 |
| `a5ce8510e` | MongoDB clone/save 通过 canonical Extended JSON 保留 BSON 类型，并跟踪 clone source/edited columns | **已对齐并强化**：Mongo `command/find/aggregate/insert/update/delete` 统一显式使用 BSON Extended JSON decoder，结果统一输出 relaxed Extended JSON；ObjectId/Date/Int64/Decimal128/Binary 与 nested 值可 round-trip，`ISODate(...)`/`ObjectId(...)` 字符串不会被猜测执行。Grid 工具栏和行菜单均可打开 `MongoDocumentCloneDialog`：Host 首次读取 source 后返回 canonical draft、精确 edited-field ledger 与 source digest；执行前重新读取并比对 source digest，再以已审阅 draft 插入。默认移除 `_id`，仅当草稿明确提供新 `_id` 才使用它；刷新失败不会把已提交 clone 伪装成失败或重试。DBX 位置：`crates/dbx-core/src/db/mongo_driver.rs`。Oxide 位置：`src-tauri/src/{drivers/mongodb.rs,commands/document.rs}`、`src/features/data-grid/ui/MongoDocumentCloneDialog.tsx`、`TableDataView.tsx`。 |
| `cd78c0ae1` | Grok CLI 通过 ACP 动态发现 reasoning effort | 属于 AI provider adapter，不改变本轮 LSP、迁移和 Grid 数据导出事实源；不迁移到数据库协议层。 |

### 上一增量审计（`27f3ea728` → `bd08fb630`）

| DBX 提交 | 最新变化 | OxideStudio 结论 |
| --- | --- | --- |
| `bd08fb630` | 已安装 JDBC plugin 后仍允许本地离线包覆盖更新，并把 Agent 离线包入口限制在 Agent 页签 | Oxide 的 Driver Manager 始终显示独立的 `Import package…` 与 `Import Java runtime…`，不因同产品已有 active/installed 版本隐藏；离线包由签名、SHA-256、版本目录、原子激活和 previous rollback 约束，且没有 Agent/JDBC 共用入口，因此逻辑已等价覆盖。真实旧版→新版 package 更新与 Windows 占用验证继续延期。 |
| `3f74fc37f` | MQTT TLS 证书读取失败不再导致客户端崩溃 | 与 SQL LSP、数据库迁移、Grid 和驱动打包链路无交集；已纳入最新基线，但本阶段无需迁移。 |
| `a83f32d13` | 空白行可选执行全部 SQL，并在没有当前语句时给出反馈 | 本阶段对齐：Rust scanner 不再把物理空白行归给下一条语句；默认关闭的设置可显式回退整篇，状态栏提供可访问反馈。 |
| `150d0108b` | Query Editor 右键菜单增加 Cut/Paste | 已有等价能力：Monaco 原生菜单被显式保持启用，继续统一处理 clipboard permission、read-only、multi-cursor 和 undo，不注册第二套冲突动作。 |
| `ef1fba2d1` | MySQL 保存既有 view 时把 `CREATE [OR REPLACE] VIEW` 改写为 `ALTER VIEW` | 本阶段对齐：Create 仍生成 `CREATE VIEW`；Edit/Replace 对 MySQL/MariaDB 生成 `ALTER VIEW`，PostgreSQL 继续使用 `CREATE OR REPLACE VIEW`，避免把不同产品的替换语义混用。 |
| `1ca2de42a` | SQL Server 复杂查询的 qualified `ORDER BY` 分页避免失去排序表达式 | 当前 Host 没有原生 SQL Server query-result pagination builder；外置 JDBC/package 的分页 SQL 由受审 driver runtime 所有。待引入 Host-owned SQL Server 分页时必须迁移该安全判定和 fixtures，不借用 PostgreSQL 路径。 |
| `deba5db2f`、`585e2f3c5`、`ad9075e18` | Oracle clone 保留 index/trigger metadata，并展开 Oracle/Xugu package members | 继续落在 D02/D04/M08 的逐产品运行时和迁移证据缺口；在签名 package、结构化 metadata 与真实版本证据齐备前不伪装为可迁移能力。 |
| `37f13018d` 等 | Consul 全栈工作台及 KV lazy-tree 增强 | Oxide 已有 bundled、固定端点且有界响应的只读 Consul KV browser，连接和精确 value preview 不再是候选能力；DBX 的 KV mutation、service discovery、ACL/namespace 等全栈工作台仍是专用产品差距，不能借只读 browser 暴露。该项不改变 SQL LSP。 |

## 1. 支持口径

- Oxide 的 `referenceDriverCatalog` 有 85 个候选产品（DBX 当前公开的 80 项，加 5 项
  明确标注的 wire-compatible 产品）；候选、可安装、可连接、可浏览、可编辑和可迁移是
  六个不同状态。目录本身不授予连接能力，只有 bundled runtime、明确兼容 profile 或已激活
  的签名 package 才能显示连接入口。
- 当前无需外置包即可运行的独立 bundled runtime 有 13 个：PostgreSQL、MySQL/MariaDB、
  SQLite、MongoDB、Redis、Elasticsearch、InfluxDB 1/2、InfluxDB 3、VictoriaMetrics、
  Consul、etcd、Nacos 与 Meilisearch；另有 TiDB、CockroachDB、YugabyteDB、TimescaleDB、
  Greenplum、Easysearch、Amazon Redshift、GaussDB、openGauss 九个受限 compatibility profile。
- DBX 当前基线已新增 ArgoDB；driver manifest、产品枚举和 agent 路由会继续随上游演进；
  `sources/dbx/agents/drivers` 中有 45 个独立 agent 工程，另外还有 native/file/HTTP
  driver。DBX 的产品数量来自这些实际运行时，不是只来自前端枚举。
- 本文的“对齐”表示达到相同用户能力和可验证边界，不表示复制 DBX 源码或架构。

状态定义：`已对齐`、`部分对齐`、`未对齐`、`Oxide 加强项`。

## 2. Driver、连接与 80 项 DBX 产品目录

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| D01 | 部分对齐：产品 capability 与运行时分层 | `crates/dbx-core/assets/database-drivers.manifest.json`；`apps/desktop/src/lib/database/databaseDriverManifest.ts` | `src/features/database-drivers/model/referenceDriverCatalog.ts`；`src-tauri/src/core/dialect.rs` | 当前 DBX 的 80 个公开产品均有候选记录，另有 5 项显式 wire-compatible 产品；目录候选本身不能显示连接，入口由 bundled runtime、compatibility profile 或安装状态与 capability 决定。 |
| D02 | 部分对齐：实际 driver 数量 | `agents/drivers/*` 45 个独立工程；`crates/dbx-core/src/db/*_driver.rs` | 13 个独立 bundled runtime，另有 9 个明确的 DBX wire/API-compatible profile：TiDB 复用 MySQL；CockroachDB、YugabyteDB、TimescaleDB、Greenplum、Amazon Redshift、GaussDB、openGauss 复用 PostgreSQL；Easysearch 复用 Elasticsearch 的受限 REST/browser runtime。Redshift 保留 `dev`/5439 默认值，GaussDB/openGauss 保留 5432 与产品身份；共享 PostgreSQL 路径不推断厂商专有元数据或 DDL。profile 保留原产品连接身份与保守 LSP baseline，不启用未经核对的厂商专有功能；Easysearch 保持 native Elasticsearch DSL workspace，不能误作 SQL LSP。新增 InfluxDB 1/2、VictoriaMetrics、Consul、etcd 和 Nacos native HTTP runtime。Consul、etcd 是固定端点、有界响应、凭据脱敏的严格只读浏览器。Nacos 浏览器仍只允许 v1/v2 OpenAPI 的配置列表与精确内容预览；另有独立、受审查的配置迁移协议：完整源快照、目标冲突计划、哈希确认、覆盖确认短语、写前 revision 复核和 `casMd5`。该协议不把 POST 暴露给通用编辑器，也不开放服务注册、命名空间、ACL 或其他管理 API。MetricsQL 不伪装为 SQL LSP。Meilisearch 仍采用固定 health/index/`documents/fetch` 的只读 browser，带安全 filter/sort cursor。DuckDB 侧车已在 Windows x64/DuckDB v1.5.5 通过真实 package conformance；RQLite/ClickHouse 已有 release payload，但仍缺真实 server evidence | 每个产品通过与其宣称 capability 匹配的 `connect/ping/version/metadata/query/cancel/error-map` 后才从候选变为 ready。 |
| D03 | 部分对齐：外置 driver 安装、激活、回滚 | `src-tauri/src/commands/agents.rs`；`crates/dbx-core/src/agent_manager.rs`；`components/config/DriverStoreDialog.vue` | `src-tauri/src/core/driver_package.rs`；Settings Driver Manager | 保留 Oxide 的 Minisign、SHA-256、原子激活和 connection pin；补真实发布包。 |
| D04 | 部分对齐：托管 Java/JAR 产品交付宽度 | `agents/common/*`；每个 `agents/drivers/<product>/build.gradle`；schema/catalog 切换参考 `agents/common/src/main/java/com/dbx/agent/JdbcSchemaSwitcher.java` 与 `plugins/jdbc/.../DbxJdbcPlugin.java:applyExecutionContext` | managed Java/runtime、generic JDBC agent、H2 内存 conformance fixture 已具备。profile 现在显式区分 catalog 与 schema，Oracle/Hive/Argo/generic 不再产生虚假 catalog 层；SQL Server/PostgreSQL/MySQL/H2 的 query context 会在单连接串行执行边界内应用并读回 `setCatalog/setSchema`，结束后恢复，无法证明应用或恢复时关闭连接。Host 同时要求签名 manifest 与 runtime handshake 两方声明 database scope。尚无 SQL Server/Oracle 等正式签名包 | vendor JAR、Java 版本、URL 模板、server range 与 conformance 同时进入签名 catalog。 |
| D05 | 逻辑已对齐并收紧：签名 Maven/JDBC 依赖获取 | DBX `crates/dbx-core/src/jdbc.rs`、`src-tauri/src/commands/plugins.rs` 与 `DriverStoreDialog.vue` 支持 resolver、Maven Central/自定义仓库、bundle 清单及离线包 | 签名 catalog 可为 Java package 声明固定 Maven 坐标、classpath 路径、精确大小/SHA-256、SPDX 许可证和 HTTPS 许可证链接；仅允许 Maven Central 固定路径，坐标/URL/manifest classpath 必须一致。依赖使用摘要命名断点缓存，安装 staging 注入后再次校验，Driver Manager 展示数量、体积、坐标和许可证 | Oxide 不接受 renderer 提交任意坐标或仓库，避免未审依赖直接进入数据库 sidecar。真实 Maven Central 代理、断点和供应商 JDBC 发布验证延期。 |
| D06 | 逻辑已对齐并收紧：runtime 可观测性与恢复 | `crates/dbx-core/src/driver_runtime.rs`；`components/config/driverRuntimeDisplay.ts` | `ConnectionManager::external_driver_runtime_summaries`、持久化 `driver_runtime_telemetry` 和 Driver Manager；按 package/version 聚合当前连接/PID/不可用/退出状态，并跨重启保留启动、退出、重连成功/失败/预算阻断计数和稳定事件码。只允许显式重连已退出 sidecar，同一连接 5 分钟最多 3 次且每批最多 32 个 | Oxide 不展示或保存 sidecar stderr，也不允许按 PID stop/kill 健康的 connection-owned runtime。真实 sidecar crash/restart、磁盘故障与多连接并发恢复验证延期。 |
| D07 | 逻辑已对齐：下载断点续传与缓存回收 | DBX driver store/install UI 与 agent artifacts | 摘要绑定的 `.partial` 文件支持严格 HTTP Range 续传；206 必须精确延续 offset，200 自动安全回退全量，416 仅在完整摘要匹配时发布；最终 SHA-256 复验后原子进入缓存。Settings 可清理归档缓存，后端串行化下载/清理，仅删除 64-hex 摘要命名的普通文件，并保留 active、previous、connection-pinned 与 live-sidecar 版本；未知内容和符号链接不递归触碰 | 延期在真实 CDN/代理下验证 206/200/416、中断恢复、错误 Content-Range、摘要不匹配与 Windows 文件占用；不连接数据库。 |
| D08 | 已对齐：连接级事实源 | DBX `connectionStore.ts`、`connectionDatabaseInfo.ts` | `get_connection_database_capability_context`；`LiveConnectionCapabilitySnapshot` | package、server version、capability 和 migration mode 必须来自同一 live driver 实例。 |
| D09 | 部分对齐：复杂连接参数 | `lib/connection/oracleTnsConnection.ts`、`postgresTlsMode.ts`、`hiveKerberosOptions.ts`、`damengSslOptions.ts` | SSH、SSL、URL 与常用连接字段已支持 | 按产品包声明结构化字段；Oracle TNS、Kerberos、代理、集群地址需逐产品实现并脱敏持久化。 |
| D10 | 部分对齐：真实版本矩阵的证据门禁已落地，矩阵本身尚未覆盖 | `crates/dbx-core/tests/live_*`、各 `agents/drivers/*/src/test`、`.github/workflows/database-environments.yml` | `scripts/run-driver-conformance.mjs`、fixture/report schema、签名 catalog evidence binding；声明 `supportsDatabaseCatalogs` 的 package 现在必须额外提交显式 `databaseScope` 查询和精确首行证据，handshake 也必须证明 runtime scope，不能再由 `getCatalogs` 枚举推断。H2 2.3.232 协议 fixture 已在本机完整通过 apply/reject/restore；DuckDB v1.5.5 已完成本地 package 运行证据，尚未签名发布；其余真实数据库组合不足 | PostgreSQL/MySQL 最低/主流/最新；ES 6/7/8；Mongo/Redis；每个首发外置包至少两个 server 版本。 |
| D11 | 本阶段逻辑已对齐，真实兼容产品验证延期：PostgreSQL backend identity | DBX `crates/dbx-core/src/db/postgres.rs`（`a3cf5fe25`）将 PID/port 转为文本并以 fallible decode 避免兼容数据库连接崩溃 | native PostgreSQL driver 以 `CAST(pg_backend_pid() AS TEXT)` 归一化兼容产品返回类型并安全解析正 `i32`；无法读取、解析或超出范围时仅关闭该请求的 server-side cancellation tracking，正常查询不失败。active-query mutex poison 也恢复为可用 map，不再引发二次 panic | 延期在 CockroachDB/YugabyteDB/兼容代理等受控 fixture 验证原生、numeric/text-like、缺失和越界 PID；只有成功取得标准 PID 时才声明 cancellation evidence。 |
| D12 | 本阶段逻辑已对齐，真实兼容产品验证延期：MySQL scalar metadata 与 connection identity | DBX `crates/dbx-core/src/db/mysql.rs`（`195c88009`）只转换标量结果的第一列，忽略兼容服务端附加列 | SQLx `query_scalar` 原生只解码第一列，已结构性覆盖附加列问题；native MySQL driver 进一步以 `CAST(CONNECTION_ID() AS CHAR)` 归一化连接 ID 并安全解析正 `u64`。缺失、畸形或不兼容值只关闭该请求的 `KILL QUERY` tracking，正常查询不失败；active-query mutex poison 可恢复 | 延期在 MySQL/MariaDB/TiDB/OceanBase/兼容代理 fixture 验证附加列、numeric/text-like、缺失与畸形 ID；仅成功取得标准 ID 的组合声明 cancellation evidence。 |
| D13 | 核心逻辑已对齐，真实环境验证延期：SQLite-over-SSH 文件型 worker | DBX `crates/dbx-core/src/db/sqlite_worker.rs`、`crates/dbx-sqlite-worker/src/{protocol,runtime}.rs`、`src-tauri/src/commands/{connection,sqlite_backup}.rs`；连接 UI 位于 `apps/desktop/src/components/connection/ConnectionDialog.vue` | 独立 `oxide-sqlite-worker` crate 已覆盖版本握手、绝对路径门禁、参数化 query/execute、metadata、online backup/restore、有界 JSONL/行/BLOB 和竞态安全 interrupt，并拒绝 ATTACH/DETACH、扩展加载和 SQLCipher 密钥语句。桌面 Host 以严格 known_hosts、Linux x64/arm64 平台探测、不可变版本仓库和 Minisign 公钥校验解析 worker；支持 session/persist/preplaced placement、上传同意与**精确 worker SHA-256**共同门禁、原子远端发布、摘要复验、SSH stdio、精确长度下载、远程清理和诊断。连接页现支持 primary + 最多 3 个后续 hop；Host 在 hop 间不经本地临时端口，而在每一前序 SSH session 上开 `direct-tcpip` 后协商下一条会话，逐 hop 按自身 `known_hosts` 身份校验、认证并在关闭时回收全部 session。所有 hop 的 password/key passphrase 均进入既有加密凭据记录，绝不保存在 connection config；改变任何 hop 会撤销 Remote SQLite worker 的上传授权。用户需在当前 SSH 目标 Prepare 后取得该 digest；更新到不同已签名 worker 不会继承上传权限。连接测试/打开、Assistant 只读与审批写入、事务、metadata、手动及定时 backup/restore 均复用同一最终 hop 驱动。 | 真实单跳与多跳 Linux x64/arm64、口令/私钥、known_hosts、WAL/并发写入、大文件/磁盘不足、取消/断线/恢复和更新换代验证记录于 `docs/sqlite-backup-deferred-validation.md`。 |

## 3. SQL Editor、语义分析与 LSP

DBX 这一领域的核心不是独立 LSP，而是 CodeMirror + TypeScript semantic model。Oxide
应把其中的语义场景加入 bundled LSP/Monaco contract tests，不应把前端解析器原样搬入。

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| L01 | 已对齐：多语句/软边界 | `lib/sql/sqlStatementRanges.ts`；`lib/sql/semantic/tokens.ts` | Rust current-statement scanner、bundled LSP statement scope、前端 fallback | 无分号双 SQL、CTE、INSERT SELECT、EXPLAIN、过程体、引号和注释使用同一 fixture corpus。 |
| L02 | 部分对齐：完整 semantic model | `lib/sql/semantic/model.ts:308-427`、`references.ts`、`diagnostics.ts`；correlation columns、table function 与 SQL Server hint 解析位于 `model.ts:308-419` | bundled LSP + `src/lib/sqlAnalysis.ts` + cached completion；LSP local relation overlay 已覆盖 CTE 显式列/推导 projection、derived table projection、table function / `WITH ORDINALITY` 输出列、table/subquery positional correlation columns 与本地 shadow；解析器同时识别 JOIN 后的逗号 row source、LATERAL/APPLY 派生表与函数，并按需导入相关子查询引用的外层 alias，未限定列仍隔离在内层 scope；`catalog` 已从前端 metadata 配置保留到 Rust Schema，三/四段限定和 SQL Server `database..table` 会按 catalog + schema + table 精确消歧；缓存降级路径现在也保留 `database..table` 的空 schema，并按 SQL scope 让 alias 优先于同名物理表，已起别名的 relation 不再通过原名误绑定；SQL Server table hint 和真实 `lateral` 表名不会误判；UTF-16 cursor 仅在入口转换一次 | 继续扩大嵌套 query-block、大小写敏感 alias collision 和结构化意图 corpus；真实 metadata 验证延期。 |
| L03 | 本阶段增强：方言关键词、类型、内建函数与 system value | `lib/sql/sqlCompletion.ts` 中 `DATABASE_SQL_KEYWORDS`、`activeFunctionSignatures`、`ORACLE_SYSTEM_VALUE_NAMES`、函数 snippet 和 dialect sets | bundled LSP dialect registry、`databaseDialect.ts`、常用 command snippet 与方言内建目录。表达式位置主动提供带 tab stop 的函数候选；FROM/JOIN relation target、注释、字符串和限定列位置不会混入。实时 routine metadata 优先，同名旧硬编码候选被更完整的 signature item 替换；原始 product identity 保证 SQL Server/Manticore 等 compatibility parser 不误用 PostgreSQL 目录。MySQL/MariaDB 现已完整迁移 DBX 的静态 signature map，补齐日期、字符串、数学、JSON 和会话函数，并保持前缀查询有界及其它方言隔离；Manticore Search 已对齐 DBX 的 31 个产品签名，覆盖转换、地理、hash 与日期时间函数；SQLite 增加 `NOW()`，Cloudflare D1 则保持 DBX 的过滤边界且不会从 SQLite/MySQL 兼容基线泄漏 `NOW()`。静态产品目录会清理不属于该产品的 parser-baseline 函数，但不会覆盖实时 Schema routine。Oracle/OceanBase Oracle 的 9 个 system value 现以独立 Value 候选裸插入，避免 `SYSDATE()`。DB2 现在保留独立 product identity，并提供裸插入的 `CURRENT DATE`/`CURRENT TIMESTAMP`/`CURRENT USER`、underscore aliases、`SYSDATE` 等特殊寄存器及常用日期函数；达梦则按其文档将 `SYSDATE()`/`CURRENT_DATE()`/`CURRENT_TIMESTAMP()` 等保留为带括号函数。二者均与函数共同受单次 100 项和 64 KiB 扫描上限约束 | 继续基于产品/version fixture 扩大 Oracle、DB2、Dameng 长尾目录；generic JDBC 只取 portable common 集，不伪造 vendor 函数、system value 或诊断。 |
| L04 | 核心逻辑已对齐，真实版本验证延期：函数签名帮助 | `sqlCompletion.ts:getSqlFunctionSignatureHelp`、`findActiveFunctionCall`、per-dialect signature maps 与 `sqlCompletion.signature.spec.ts`；ClickHouse 参数化聚合见 `lib/sql/clickhouse/{regularFunctions,aggregateFunctions}.ts` | bundled LSP 现在以实时 routine metadata 为第一事实源；缺失时回退到 DBX 同类的 common/PostgreSQL/MySQL/SQLite/SQL Server/Manticore 内建签名目录，并覆盖关键 ClickHouse 普通/参数化函数。Manticore 的 31 个 DBX 产品签名、SQLite `NOW()` 与 Cloudflare D1 的无 `NOW()` 边界在 completion 和 signature-help 共用同一原始产品身份。调用扫描会屏蔽注释、转义/美元字符串和 quoted identifier，支持嵌套、限定/Unicode 名称及 ClickHouse 多参数组；overload 按当前参数槽可接受性稳定排序，可选参数在签名中显式显示。扫描限定 64 KiB、返回最多 50 个 overload，已知 server version 会门控已声明最低版本的内建函数 | 延期用真实 PostgreSQL/MySQL/SQLite/SQL Server/ClickHouse/Manticore/Cloudflare D1 metadata 验证 overload/default/variadic 还原与版本边界；继续从 DBX ClickHouse registry 扩大长尾静态签名，但静态目录不得覆盖实时 metadata。 |
| L05 | 部分对齐：对象/列补全 | `lib/sql/sqlCompletion.ts:1398-1401,3503-3521` 的 relation alias item、`lib/sql/semantic/completion.ts:102-113` 的 `aliasSql`，以及最新 `868f7961e` 的 `sourceQualifierSql`/多源列修复；另见 `lib/metadata/completionTreeIndex.ts`、`lib/common/pinyin.ts`、`lib/common/completionMatch.ts` | LSP schema sync 与 metadata cache 现在合并而非互斥；对象、列和 FK JOIN 支持 Unicode identifier、拼音首字母、camel/fuzzy 排序。临时表/CTE/derived/table-function/correlated relation overlay 会按 SQL 局部形状覆盖同名远端对象；partial correlation names 与剩余 metadata 列按位置合并。跨 catalog 同 schema/table、四段 SQL Server 名称与 `database..table` 已有精确 contract，错误 catalog 不会复用列 metadata。relation alias 与 `alias.column` 列候选现在都同时保存规范名和原始 SQL 拼写：label 保持易读、裸列名保持可过滤，insertText 精确保留双引号/反引号/方括号和大小写；缓存 FK JOIN 同样复用源 alias 的原始 SQL spelling，不把双引号、反引号或方括号静默改写成另一种 delimiter；相关子查询只导入实际被限定的外层 alias，且不增加第二次 parser pass。多源 `SELECT *` 已按 alias 展开全部来源列 | 仍需更广嵌套 scope 与大小写敏感 quoting corpus；真实中文 metadata 验证延期。 |
| L06 | 本阶段增强：INSERT values/select hints/snippet | `apps/desktop/src/lib/sql/insertValueHints.ts`、`insertValueHintColumns.ts`、`apps/desktop/src/lib/editor/codemirrorInsertValueHints.ts`、`lib/sql/sqlCompletion.ts` | `textDocument/inlayHint` 同时覆盖显式/省略列清单的 `INSERT ... VALUES` 与 `INSERT ... SELECT`。显式 quoted 列保持原名；省略列清单从已同步 catalog/schema 精确定位 target，按可写物理列顺序排除 auto-increment/identity、generated、hidden。SELECT 支持直接、括号、CTE、ALL/DISTINCT/DISTINCT ON/TOP 和嵌套 projection；通配符或 arity 不一致整条 fail closed。PostgreSQL dollar-quoted routine 内的可见 statement 会在 opening tag 后进入同一有界解析器。server 与 Monaco fallback 均只扫描 viewport 附近 32 KiB，server 另限制 64 KiB request 和 500 个 hint；LSP 失败时本地路径只处理显式列，不触发 metadata scan。空列清单 `INSERT INTO t (` 继续由 bundled LSP 生成两级 `VALUES` snippet/tab stops；语句起始 `in…` / `ins…` 继续按 schema 生成具体表的“必填/全部可写列”完整代码块，保持 32 表 × 64 列上限。 | 待统一验证：三类原生数据库真实 metadata、identity/generated/default/hidden 组合、Monaco hint 布局/滚动刷新/Tab 导航及更广方言语法；按既定顺序留到全部逻辑迁移完成后执行。 |
| L07 | 逻辑已对齐：跨 console symbol/reference index | `lib/sql/semantic/references.ts` 和本地 semantic fixtures | 已同步项目 SQL 文档进入按内容缓存的有界 symbol graph；table/view/function/procedure DDL 提供 document/workspace symbol 和 metadata 缺失时的 definition fallback，物理 relation/routine usage 支持同 schema/项目的 references 与安全 rename。注释、字符串、无关同名列不进入图；CTE rename 保持单文档作用域；quoted/UTF-16/SQL Server `database..table` 范围和 `includeDeclaration` 有协议测试。单文档 512 KiB、256 文档、10,000 occurrence、2,000 result 为 LSP 硬上限，renderer 的 128 文件/128 KiB/5 MiB 同步上限更严格 | 延期用真实大项目验证缓存命中、超限降级、重复 migration definition 选择及 PostgreSQL/MySQL/Hive/ClickHouse 方言行为；同步集合之外不做隐式磁盘扫描。 |
| L08 | 本阶段已对齐并澄清：比较值类型模板 | `sqlCompletion.ts:buildComparisonValueItems`；DBX 当前根据列类型提供 NULL、字符串、数字和布尔模板，并不查询真实行样本 | bundled LSP 的 `dialects/common.rs:add_column_value_items` 在操作符、`IN (` 后从当前 metadata 列类型生成带 tab stop 的安全模板；覆盖 text/numeric/boolean/date/time/timestamp/UUID/JSON，并保留最多 64 个 ENUM/SET 声明域值。PostgreSQL、MySQL、SQLite、Hive、ClickHouse 在 WHERE/HAVING/JOIN ON/UPDATE SET 共用该逻辑；类型歧义时只返回始终安全的 NULL，不读取、缓存或传输真实行值 | 用真实 metadata 验证 vendor type spelling；若以后增加真实值采样，必须是独立显式 opt-in capability，限定列/行/字节并禁止无条件送入 LSP 或 Agent。 |
| L09 | 本阶段增强：常用命令 snippet | `lib/sql/sqlSnippetTemplates.ts`；`sqlCompletion.snippet.spec.ts` | `features/query-editor/model/sqlCommandSnippets.ts` | 按产品选择 LIMIT/TOP/ROWNUM/FETCH/ROWS、DDL 与 mutation 语法；接受历史按连接排序；补全行直接展示 trigger，支持 descriptive initials/fuzzy 查找。Oracle/OceanBase Oracle 额外提供不含 `AS` alias 的 `MERGE` 块和带异常分支的匿名 PL/SQL 块；DB2 提供裸特殊寄存器 `VALUES` 块，达梦提供带括号日期函数块。全部支持 tab stop、keyword case 和同 id 用户覆盖，并严格按产品隔离。 |
| L10 | 本阶段增强，真实 provider 验证延期：补全触发、展示、插入与惰性解析 | `lib/sql/sqlCompletionTriggerPolicy.ts`、`sqlCompletion.ts:HIGH_FREQUENCY_KEYWORDS`、`sqlCompletion.ts:shouldChainSqlCompletionAfterAccept`、`components/editor/QueryEditor.vue:markCompletionAccepted`、`lib/editor/sqlCompletionPresentation.ts`、`sqlCompletionInsertion.ts` | 三种触发模式、语义门控、usage ranking 与 snippet insertion 保持原链路；DBX 的 40 项高频关键字层已进入 bundled LSP 的标准 completion 和 inline candidate 路径，仅在既有语义分组内调整顺序，并让 Monaco 数字 usage rank 保持更强优先级。端到端保留 Completion 协议。client 现声明并实现 `completionItem/resolve` 的 documentation/detail/additionalTextEdits 子集，记录 server `resolveProvider`，opaque `data` 原样往返；只给真实 server 候选附加 resolve identity，context adapter 的对象 spread 仍保留它，语法/cache fallback 不会误发。bundled LSP 同时声明 resolve，并仅在 client 显式支持 documentation resolve 时移除首包文档；8,192 项/4 MiB FIFO cache 与 256 KiB 单文档门限限制内存和协议体积，原始 data 可恢复，淘汰/未知 identity 仍保留可用候选。bridge resolve item 上限 256 KiB，owner/cancellation 门禁阻止迟到结果。documentation 的 Markdown/plaintext 类型不再丢失，Markdown 禁用 trusted command/HTML。server text edit 保持权威；接受 `schema.` 或 SQL Server `USE ` 后在当前 owner/scope 内重开下一层候选；`Variable` 候选不误追加空格 | 延期以真实 Monaco + 大 catalog 验证 resolve 重启/淘汰、incomplete 重触发、insert/replace 接受边界、代码块缩进、文档渲染、quote policy、多层 schema/table/column 链与常用关键字/个人 usage 组合排序；在超大文档验证有界触发扫描。 |
| L11 | 核心逻辑已对齐，真实产品验证延期：结构化编辑 intentions 与列所有权 | `apps/desktop/src/lib/editor/sqlIntentionActions.ts`、`queryEditorTextEdits.ts`、`sqlInListPaste.ts`、`sqlQuoteCaret.ts`；generated/hidden 参考 `lib/sql/insertValueHintColumns.ts`、`crates/dbx-core/src/data_grid_sql.rs:is_grid_insert_omitted_column`、`db/sqlserver.rs:SqlServerColumnMetadata`、`db/cloudflare_d1/mod.rs:list_columns` | 已有格式化、危险语句 guard、Unicode quote/unquote identifier、clipboard→IN-list、metadata 星号展开、qualify/unqualify/batch qualify 与 FK-aware `OXIDE002`。本阶段新增跨 Host/TS/LSP 的 `is_generated`/`is_hidden` 契约：PostgreSQL/MySQL/SQLite 原生 metadata 精确分类，MySQL 不再把 `DEFAULT_GENERATED` 误判成 computed，SQLite/rqlite 改用 `table_xinfo`；JDBC Agent 转发标准 `IS_GENERATEDCOLUMN`，ClickHouse 分类 `MATERIALIZED`/`ALIAS`/`EPHEMERAL`。旧 package 缺生成字段时 INSERT fail-closed，迁移还要求生成/隐藏两项都明确。INSERT/全列 snippet 排除 generated/hidden，星号展开只排除真正 hidden 列，普通补全仍显示并标注所有权；结构化字段存在时不再重复查询 generated catalog | generated/hidden 主路径已闭环；仍需 SQL Server/Oracle/DuckDB 等产品的 hidden/生成表达式专用 metadata、更多外置产品结构化字段、更复杂的多光标编辑及真实 Monaco edit-preview/undo 验证。 |
| L12 | 主路径已对齐：编辑器模块边界 | DBX `components/editor/QueryEditor.vue:791-924` 将 execution request 编排建立在 `lib/sql/sqlExecutionTarget.ts` 上 | 命名事务、query/explain/parameter execution、文件 workflow、LSP virtual-document lifecycle 与稳定协议 provider coordinator 已独立。metadata-sensitive relation/field/FK JOIN fallback、Monaco viewport/selection、current-statement decoration 和 Console auto-suggest 均有独立 lifecycle；滚动 rAF 合并、offset 有界夹取、authoritative range cache、45ms Console 合并与 stale model/version gate 不再由组件持有。owner key 继续拒绝跨连接/schema/LSP 状态/设置边界的迟到结果；`QueryEditor.tsx` 约 3,253 行 | 已识别 lifecycle 拆分完毕；补真实 Monaco/provider 组合验证，组件测试继续避免加载完整 Monaco。 |
| L13 | 已对齐：进程恢复遥测 | DBX 本地 semantic model不依赖独立进程 | `useLspSemanticStatusStore` 按连接记录 LSP restart/恢复耗时、schema sync failure 与 stale response drop 的无内容计数；session registry 和同步器在对应路径写入，状态栏 schema 语义提示的 title 展示最新趋势，不记录 SQL/对象内容 | 保持计数有界、仅会话内；如需跨会话分析另建脱敏诊断导出。 |
| L14 | 逻辑已对齐：当前语句 frame 缓存与响应 | DBX `lib/sql/executableStatementRangeCache.ts`、`lib/sql/currentStatementFrame.ts`、`lib/editor/codemirrorCurrentStatementFrameLayer.ts`；`components/editor/QueryEditor.vue:1519-1533,4519-4558` | SQL 首次 miss 由 Rust driver-aware scanner 一次返回当前范围及最多 10,000 个有序 UTF-16 文档范围；同一 Monaco model version 内在实际 statement range 中直接复用。物理空白行先由 Monaco 行模型清除 frame，不会被 range cache 错归到下一条语句，也不增加 IPC；精确 exclusive end、其他间隙、编辑和模型/连接切换仍交回 authoritative scanner。超出 10,000 范围时自动降级为仅缓存当前范围。选区和 Mongo command frame 同步显示，同范围不重复提交 decorations，过期响应不能覆盖新光标 | 延期以大文档和真实 WebView 记录 IPC/decorations 次数，并验证超过 10,000 条语句时的有界降级；前端不复制第二套 SQL parser。 |
| L15 | 逻辑已对齐，真实 metadata 验证延期：SQL Server 默认 schema | DBX `apps/desktop/src/components/editor/QueryEditor.vue` 的 `completionMetadataTarget`、`metadataSchemaForConnection`、`ensureColumnsForTable`；最新 `868f7961e` 在无显式 schema 且首次列 metadata 为空时从缓存 schema（含 `dbo`）恢复 | `connectionDatabaseNamespacePreference` 明确区分 SQL Server catalog 与 schema；Explorer 的缓存/远端 schema 选择和 `createLspSyncPlan` 共用 `selectPreferredNamespace`。用户显式选择优先，否则在已发现 schema 中选择大小写保真的 `dbo`，并避免把 `sys`/`INFORMATION_SCHEMA` 作为普通 fallback；query document 仍绑定原 catalog | 延期连接真实 SQL Server，验证默认登录 schema、无 `dbo` 权限、自定义默认 schema、多 catalog 同名表和 metadata refresh 后的列推荐；不得为寻找 schema 发送额外无界查询。 |
| L16 | 逻辑已对齐，真实 Monaco 交互验证延期：格式化布局 | DBX `apps/desktop/src/lib/sql/sqlFormatter.ts:applySqlFormatterLayout`、`sqlFormatterConfig.ts`、`components/editor/SqlFormatterSettingsPanel.vue`；最新 `868f7961e` 增加 logical operator `none` 与 FROM source 同行布局 | Settings 增加 `before/after/none` 和 `newLine/sameLine`，经 `LspConnectionSyncer`、配置摘要和 `workspace/didChangeConfiguration` 进入 bundled LSP；整篇与选区格式化共用 parser-mask 安全的线性后处理。字符串、注释、quoted identifier 中的关键词不改写，derived table 与注释开头 source 保持多行；随应用 binary/manifest 已重建 | 延期在真实 Monaco/WebView 验证 selection、undo、光标恢复、超大 SQL 响应和各 dialect formatter 输出；不得复制第二套前端 parser，也不得让布局后处理退化为逐行删除的平方复杂度。 |
| L17 | 逻辑已对齐，真实键盘交互验证延期：Insert Line Below | DBX `apps/desktop/src/components/editor/QueryEditor.vue:insertLineBelow`、`lib/editor/shortcutRegistry.ts`，最新 `868f7961e` 默认 `Shift+Enter` | `editor.insertLineBelow` 已进入共享 action/keymap/command palette；活动 QueryEditor 接收事件后调用 Monaco 原生 `editor.action.insertLineAfter`，由编辑器内核统一处理继承缩进、multi-cursor、selection、undo 和 read-only；`Ctrl/Cmd+Shift+Enter` 继续执行当前语句 | 延期在真实 Monaco + Vim insert/normal mode、IME 和 completion popup 打开时验证优先级；快捷键冲突仍由 Keymap 页显示，不硬编码第二套按键监听。 |
| L18 | 逻辑已对齐并加强，真实 provider 验证延期：过期补全取消 | DBX `apps/desktop/src/components/editor/QueryEditor.vue:3348-3384` 通过 CodeMirror `CompletionContext` abort 事件递增 epoch，在 debounce 和异步结果边界丢弃旧候选 | Monaco cancellation token 现贯通 completion 与 `completionItem/resolve`；renderer 为每次调用生成会话内 token，Tauri 映射到 JSON-RPC request id，Rust writer 删除 pending response 并发送标准 `$/cancelRequest`。取消先于请求注册或先于 writer 写出的竞态都有有界 tombstone，旧请求不会继续占用 provider 队列；重复/迟到取消保持幂等，token 长度与字符集受限 | 延期使用受控慢 provider 连续快速输入，确认旧 completion/resolve 收到 `$/cancelRequest`、新请求无饥饿、进程重启与会话切换不串 token；不需要连接数据库。 |
| L19 | 本阶段逻辑已对齐，真实 Monaco 验证延期：空白行执行与编辑菜单 | DBX `components/editor/QueryEditor.vue:requestExecuteFromView`、`lib/sql/sqlExecutionTarget.ts:executionCandidateForMode`（`a83f32d13`）；Cut/Paste 见 `150d0108b` | Rust UTF-16 scanner 对物理空白行返回无当前语句；“运行当前语句”默认明确 no-op，并在状态栏显示 3 秒 `aria-live` 反馈。设置可显式启用整篇 fallback，仍经过参数、危险 SQL、事务和重复执行门禁。Monaco 原生 context menu 显式开启 Cut/Copy/Paste，复用 read-only/multi-cursor/undo/clipboard 语义 | 延期在真实 Tauri WebView 验证 Windows/macOS/Linux 剪贴板权限、Vim 模式、空白行前后软边界、状态反馈和设置持久化；不得在 React 层复制 Monaco 原生剪切/粘贴编辑。 |
| L20 | 本阶段逻辑已对齐，真实 Monaco/AI provider 验证延期：inline 智能候选与代码块 | DBX `lib/sql/sqlCompletion.ts:buildKeywordItems`、`lib/sql/sqlSnippetTemplates.ts`、`components/editor/QueryEditor.vue` 的 completion context/accept 链路 | bundled LSP 的 popup 与 `oxide/inlineCompletionContext` 现共用单一有界增强管线：产品函数、窗口块、ClickHouse/Oracle relation function、metadata-safe INSERT 代码块、alias、completed-keyword/qualified edit、casing、去重和排序不再分叉。inline 最多保留排序后的 32 项，并把权威 text edit 的 `newText` 作为插入事实；本地 ghost text 支持 `u.` member、`FROM` 后零宽空格续写和去 tab-stop 的多行 snippet。 | 延期在真实 Monaco/WebView 验证 popup/ghost 同时出现时的 Tab 优先级、IME、Vim、multi-cursor、undo、AI fallback/cache、慢 provider 取消和 32 项截断；不得让 inline 路径重新查询数据库或维护第二套候选生成器。 |
| L21 | 本阶段逻辑已对齐，真实 Monaco 验证延期：用户/产品 command snippet 的 popup-inline 一致性 | DBX `lib/sql/sqlSnippetTemplates.ts`、`lib/sql/sqlCompletion.ts`、`components/editor/QueryEditor.vue` 的 snippet 建议与接受链路 | 前端 command snippet 继续由 `sqlCommandSnippetCompletions` 单点处理用户启停/改写、关键字大小写和 Oracle/Manticore/Db2/Dameng 产品隔离；popup 与 inline 现在都从 `sqlSyntaxFallbackCompletions` 消费该事实源。exact trigger 位于独立语义层，LSP 候选保持原顺序，个人 usage 只在同层排序；按插入内容去重并统一截断为 32 项。LSP 尚未 ready/restarting 时，SQL 产品仍可提供本地多行 ghost text，非 SQL 产品不会注入 SQL block。 | 延期在真实 Monaco/WebView 验证用户自定义/禁用 snippet 热更新、产品切换、exact/fuzzy/usage 组合排序、多行 Tab/undo/IME/Vim，以及 LSP restart 窗口内的本地接受行为；不得连接数据库来生成 snippet。 |
| L22 | 本阶段逻辑已对齐，真实 Monaco/产品格式化验证延期：格式化与补全共享大小写设置 | DBX `apps/desktop/src/lib/sql/sqlFormatterConfig.ts:41-70,183-195,256-258`、`components/editor/SqlFormatterSettingsPanel.vue:99-101,520-544`、`components/editor/QueryEditor.vue:3347-3409,3676-3677,4137-4138` | `SqlFormattingSettings` 现为 `keywordCase`/`functionCase` 的运行时事实源，旧 completion 字段仅承担向后兼容迁移；Settings、popup、inline、本地 command snippet、缓存候选与 `workspace/didChangeConfiguration` 均消费同一值。bundled LSP 对全篇与选区格式化分别应用关键字和函数大小写；函数只改写 Tree-sitter `invocation` 名称，保留 relation、类型、参数/模板占位符、字符串、注释及 quoted function。非 SQL dialect 不受 SQL formatter preference 污染。 | 延期在真实 Monaco/WebView 验证全篇/选区格式化、undo/光标恢复、超大 SQL 响应、quoted/schema-qualified/user routine，以及 PostgreSQL/MySQL/MariaDB/SQLite/ClickHouse/Hive 与兼容/JDBC 产品输出；不得以当前 13 项 packaged protocol test 代替真实产品 conformance。 |
| L23 | 本阶段逻辑已对齐，真实 Oracle/JDBC 验证延期：执行错误范围提示 | DBX `apps/desktop/src/lib/sql/sqlDiagnostics.ts:oracleInvalidIdentifierRange,sqlErrorDecorationRange`、`components/editor/QueryEditor.vue:sqlErrorDecorationRange`，来源提交 `a1dfc81d4` | `queryErrorPresentation.ts` 在原生 PostgreSQL one-based structured position 之外，识别 Oracle Agent 的 zero-based `error occur(red) at position`；`ORA-00904` 会按消息中的标识符和报告位置选择最近的 Unicode token，并保持 quoted identifier 大小写。range 经当前执行语句的 UTF-16 `sourceStartOffset` 映射回整份多语句文档，`QueryEditor.tsx` 复用现有 `database-query` Monaco marker 并高亮完整 token，而非相邻点号/星号；越界或畸形消息 fail-closed。 | 延期用真实 Oracle/OceanBase Oracle 与 JDBC/ODBC package 验证 Agent offset 口径、非 ASCII/quoted/schema-qualified identifiers、多语句选区、文档编辑后的 marker 清理、hover/Problems 展示和多个错误；本阶段不连接数据库。 |
| L24 | 本阶段逻辑已对齐，真实 Monaco 验证延期：pending completion 的 Tab 接受 | DBX `apps/desktop/src/components/editor/QueryEditor.vue:acceptCompletionOrNextSnippetField,waitForCompletionTab`，来源提交 `fe10790bb` | `editorOptions.ts` 对 `positional`/`require-prefix` 启用 Monaco 原生 `tabCompletion`。Monaco 内核在 Tab 时等待 completion model，接受最佳且确实产生 edit 的候选；空结果、取消或不适用候选回退标准 `tab` 命令，snippet mode 则优先下一 tab stop。`manual` 模式显式关闭，因此 Tab 不会绕过用户的手动补全选择。该实现复用 popup、inline、undo、selection 与 cancellation 的内核上下文，不在 React 层加入 16ms polling timer。 | 延期在真实 Monaco/WebView 用慢 LSP 验证 pending→candidate、pending→empty、取消、快速二次输入、inline/popup 同现、snippet 内字段补全、Vim insert/normal、IME、多光标和 read-only；不需要连接数据库。 |
| L25 | 本阶段逻辑已对齐，真实 metadata/Monaco 验证延期：relation alias 匹配与普通大小写语义 | DBX `lib/sql/sqlCompletion.ts:buildReferencedAliasItems`、`lib/sql/semantic/completion.ts:sourceQualifierSql`，来源提交 `868f7961e` | bundled LSP 让 relation alias 与列名共用有界 exact/prefix/缩写/subsequence 匹配；候选按匹配等级稳定排序。普通未引用 alias 依 SQL 语义按大小写不敏感方式解析到 metadata relation，因此 `FROM users UserAlias` 后输入 `useralias.` 仍能补全列。候选去重同时比较 label 与 insertText，故 `u` 与 quoted `"U"` 保持两条可接受候选，且精确插入原始引号/大小写。PostgreSQL/MySQL/Hive/ClickHouse 的 schema-aware column path 均复用这一解析入口。 | 延期用真实 PostgreSQL/MySQL/SQL Server 及其大小写/引用设置验证 alias/name collision、bracket/backtick/double-quote、中文 metadata、跨 schema relation 和 Monaco 接受后的继续 `.` 触发；带相同规范名的 quoted/unquoted alias 仍须由真实 SQL parser/产品语义确认，不假装无歧义。 |
| L26 | 逻辑已对齐并按原生协议增强，真实 MongoDB/Elasticsearch/Monaco 验证延期：非 SQL Console 补全 | DBX `apps/desktop/src/lib/mongo/{mongoCompletion,mongoCompletionTables}.ts`、`lib/elasticsearch/elasticsearchCompletion.ts`、`components/editor/QueryEditor.vue` | MongoDB 同时保留严格 JSON/Extended JSON 命令契约和受限、Host 同构的 shell parser；补全区分嵌套 field predicate、逻辑数组、`$expr`、update field、`$push/$addToSet` modifier、group accumulator、expression、完整固定 stage options、collection/field reference 和非字符串 value。Shell completion 只暴露 Host 可执行 method/options，点号 collection 与直接 method 共用完整 qualified replacement range，注释/字符串不误触发，`find().count()` 受真实 parser chain 约束。metadata 候选最终限制 256 项，普通连接不经过远程 SQLite preparation 的异步边界。Elasticsearch 保留多请求、版本门控、mapping 字段、inline、诊断和后台分析；method prefix 在纯注释之后及完成请求之后正确开启，body 首行不误开第二个 method popup。Index metadata completion 现在使用 REST path 专用 replacement range，在光标位于 `GET /ord/_search` 中间时替换 `/ord`、保留 `/_search` 且不会产生双斜杠；JSON 自动闭合 quote 仍走独立 key/string range。 | 本阶段完整前端 304 文件、1,608 测试通过，Mongo/Elasticsearch 定向 bundled LSP 方言测试分别 3/6 通过，production build 通过。仍需真实 MongoDB 4.4–8、Elasticsearch 6/7/8/OpenSearch/EasySearch metadata 与 Monaco popup/Tab/IME/中间光标验证；`use <database>` 在与 tab/database selector 建立单一事实源前继续不提示，避免 UI 与执行目标漂移。 |

## 4. Explorer、metadata 与数据库管理

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| E01 | 部分对齐：对象类型宽度 | `lib/database/databaseObjectCapabilities.ts`；`ConnectionTree.vue` | tables/views/materialized views/indexes/constraints/routines；PostgreSQL 另走只读 `SchemaObjectInfo` descriptor 通道展示 sequence、非内部 trigger（标明所属 relation）、domain、enum type、composite/range/multirange type、extension 与 partition | 按产品补 event、synonym、package、权限与对象跳转；对象 presence 不能推导 DDL、编辑或迁移能力。 |
| E02 | 逻辑已对齐，规模验证延期：metadata cache 与失效 | `metadata/metadataLoadScope.ts`、`metadataResultCache.ts`、`metadataLoadCoordinator.ts`、`tableMetadataCache.ts` | 表 metadata/DDL/view source 与 database catalog refresh 已共用作用域代次；force refresh、invalidate/clear 会立即淘汰旧请求，持久化与删除按作用域串行，late response 不能在删除后重新落盘或通知 UI。v3 table key 与 v2 catalog key 固定包含 project、connection、driver package、连接默认 database、显式 catalog、schema/table；未显式传入时从当前保存连接补全，换包或原位改库不会命中旧资源。schema/LSP cache 原有 generation/owner gate 保持。Mongo/Elasticsearch 文档元数据另有跨标签共享的 TTL/single-flight/LRU cache；后台 stale refresh 完成会只重触发原活动补全，并以 provider token、model/version、cursor、focus 四重门禁阻止迟到误弹 | 补 10k catalog 并发/失效压测与真实 WebView 指标；真实数据库验证延期。 |
| E03 | 逻辑已对齐，真实产品验证延期：对象 DDL/source cache 与 view 保存 | `metadata/objectDdlCache.ts`；`editor/hoverTableSql.ts`；MySQL view 保存修复 `ef1fba2d1` 位于 `crates/dbx-core/src/object_source_sql.rs:executable_mysql_view_ddl` | 表/视图 DDL 与 view definition 复用 v3 table metadata 持久化作用域，并补齐 DBX 同类的并发 single-flight、force/normal reader 合流、24 小时/5 MiB 边界和 generation 失效；迟到响应、连接原位换包/改库均不能重新写回，object type 分离且空 source 可命中。PostgreSQL routine 通过参数化 `pg_get_functiondef` 读取全部有界 overload source，并进入按 project/connection/package/database/schema/name 分区的 24 小时、5 MiB、256 项 LRU/single-flight cache；Explorer metadata refresh 会使其失效，迟到或换包响应不落入新会话。外置 driver 未声明 source capability 时明确不走此路径。MySQL/MariaDB 的既有 view 编辑和显式 Replace 生成 `ALTER VIEW`，新建仍为 `CREATE VIEW`；PostgreSQL Replace 保持 `CREATE OR REPLACE VIEW`，SQLite 继续拒绝不支持的 Replace。 | 真实 MySQL/MariaDB fixture 验证 algorithm/definer/security 属性和依赖关系保持；真实 PostgreSQL 验证 overload、权限错误与刷新失效，不泛化生成 routine DDL。 |
| E04 | 部分对齐，真实产品验证延期：批量对象动作 | `ObjectSelectionTree.vue`、`sidebarExportRuntime.ts`、`useSidebarTreeToolRuntime.ts` | Explorer 的关系表组已提供有序多选、Shift 区间选择、全选/取消和 200 对象硬上限；批量 metadata refresh 以 6 并发执行并汇总成功/失败任务状态，不让大 catalog 无界启动 Tauri 命令。失败对象按原选择顺序保留表名与单行有界错误摘要，最多展示 20 条并在工具条内按需展开，避免大错误集撑爆侧栏。选中的精确表集合可直接进入既有多表迁移 plan/review/确认流程，迁移对话框会过滤已消失对象且不会把用户子集静默扩成整个 schema。内置 PostgreSQL 还可把精确选择导出为单个 data-only SQL 文件：Host 重新核验上限、重复项、对象存在性和 base-table 类型，只恢复选中表数据及其 owned sequence state，沿用原子 `.partial` 发布、进度与取消。视图/物化视图不伪装为可迁移或批量数据导出的基础表，入口继续受 connection/package capability 门禁。 | 仍缺多格式批量导出和安全批量删除；真实 WebView 下的键盘/焦点、多选后 metadata 变化、失败详情展开、导出取消和跨库迁移 fixture 延期。 |
| E05 | 本阶段增强，规模验证延期：大 catalog | `metadataTaskLimiter.ts`、cache coordinator、tree load handles | cache-first、显式 refresh 与 LSP 有界 batching 已有；table metadata 现额外按 project/connection/package/database/catalog 限制为每作用域 2 个活动任务和最多 512 个排队任务，交互式对象展开/补全优先于 LSP 后台 hydration。队列溢出 fail-fast；force/invalidate 和连接原位换包/改库会让尚未启动或迟到的旧任务在访问数据库/发布前失败，单节点失败移出 in-flight 后可重试 | 补 10k schema/table 的真实 WebView/IPC 压测、树虚拟化帧率和已在执行的 Tauri command 取消指标；真实数据库验证延期。 |
| A01 | 逻辑已对齐，真实 server 验证延期：Session/Process | `components/admin/ProcessListPanel.vue`；`postgresProcessList.ts`、`mysqlProcessList.ts` | PostgreSQL/MySQL session list 和 kill/cancel 已有；锁等待页通过固定只读协议显示 waiting session → blocking session edge，不含 query SQL。MySQL 8 优先读取 `performance_schema.data_lock_waits`，旧 MySQL/MariaDB 回退至 `information_schema.innodb_lock_waits`。Session、Metrics、Locks 三个只读实时页可显式开启 10 秒自动刷新；窗口不可见或管理 mutation 期间暂停，同一连接/视图不重叠请求，后台刷新保留旧数据避免闪屏。Host 现在以活动连接保存的 driver identity 二次确认 SQL 方言，拒绝 renderer driver mismatch；固定只读 identity 查询返回实际 database/account/server version。权限不足、连接失效、能力缺失、输入拒绝与普通查询失败具有稳定 code/context，界面显示针对性说明和仅对可重试连接错误提供重试。错误响应不回传可能包含口令的 mutation SQL/driver error。 | 真实低权限账户、长时间运行、窗口切换、server 重启/重连与 MySQL/MariaDB 版本回退验证延期。 |
| A02 | 部分对齐：User/Role | `DatabaseUserAdmin.vue`；`databaseUserAdmin.ts` | PostgreSQL/MySQL 用户基础管理；管理页新增只读 Roles 视图，PostgreSQL 读取 `pg_auth_members`，MySQL 8 读取 `mysql.role_edges`，MariaDB/旧 MySQL 受控回退至 `mysql.roles_mapping`；固定命令可列出可见 table privilege。 | 增加 database/schema privilege、grant diff 和审计摘要。 |
| A03 | 部分对齐：Dashboard/metrics | `PostgresDashboard.vue`、`MySqlDashboard.vue`；`serverMetrics.ts`、`*ServerStatus.ts` | Database Administration 增加固定、只读的 native metrics 通道；PostgreSQL 提供连接数、活动查询、共享缓存命中率、提交/回滚累计与库容量，MySQL/MariaDB 提供连接数、活动非空闲查询与当前 schema 容量。外部 package 显式拒绝宿主生成的管理命令。 | 仍缺历史/图表、锁等待、MySQL/MariaDB 经版本与权限审核的缓存/事务指标、统一 capability protocol 与真实 server 证据。 |
| A04 | MySQL/MariaDB EVENT 逻辑已对齐，整体仍部分对齐：Job/Event | DBX `crates/dbx-core/src/mysql_event_sql.rs`、`crates/dbx-core/src/db/mysql.rs`、`DamengJobAdmin.vue`、`damengJobAdmin.ts` | Database Administration 的 MySQL/MariaDB Events 视图通过固定 `information_schema.EVENTS` 参数化查询列出当前数据库的有界事件，不返回 event body。创建仅接受 once/interval 闭集 schedule、受限 interval unit、一个 INSERT/UPDATE/DELETE/REPLACE/CALL body；Host 重新确认活动 bundled MySQL-family driver、事件存在性/缺失状态和 current metadata marker，再生成 CREATE/ALTER ENABLE/DISABLE/DROP SQL。所有 mutation 先返回 SQL/risk 预览，token 绑定 connection、server version、事件 metadata、action 和 SQL，执行时重新规划并要求动态确认短语。 | 真实 MySQL/MariaDB 多版本、低权限、`event_scheduler` OFF/DISABLED、时区/DST 与并发触发验证记录于 `docs/database-admin-events-deferred-validation.md`。复合 `BEGIN...END` body 暂不开放。达梦 `SYSJOB` 依赖可信外置驱动 capability、存储过程版本与 transaction/receipt 契约，当前入口保持关闭；仍缺 PostgreSQL/Oracle 等 scheduler。 |
| A05 | 逻辑已对齐并扩展，真实 server 验证延期：Table Maintenance | DBX `crates/dbx-core/src/db_admin_sql.rs:build_vacuum_table_sql`、`apps/desktop/src/components/objects/ObjectBrowser.vue:requestVacuumTable/confirmVacuumTable`、`components/sidebar/SidebarTreeRuntimeHost.vue` | Explorer 的本地表和 PostgreSQL 远端 database 表右键均提供 `Maintain Table...`。Renderer 只提交受限 operation enum；Host 重新确认活动连接 driver、signed-package 边界、server version、database/schema/table 精确身份和 base-table 类型，再生成 PostgreSQL `ANALYZE`/`VACUUM`/`VACUUM FULL` 组合或 MySQL/MariaDB `ANALYZE TABLE`/`OPTIMIZE TABLE`。预览返回固定 SQL、锁影响、风险和 maintenance-window 建议；执行重新生成计划并校验绑定连接/版本/目标/操作的 SHA-256 token 与动态确认短语。可能包含口令或原始 SQL 的 driver error 不返回 UI。 | 延期以真实低权限账户和 PostgreSQL/MySQL/MariaDB 多版本验证锁等待、长任务、取消、server restart、引擎差异及统计变化；在有可验证 cancellation receipt 前不声明可安全中断。 |
| A06 | SQLite 本地与单跳远程逻辑已对齐并增强，真实环境验证延期：Backup/Restore | DBX `crates/dbx-core/src/sqlite_backup.rs`、`src-tauri/src/commands/sqlite_backup.rs`、`scheduledDatabaseBackup.ts`、`ScheduledDatabaseBackupSettings.vue`、database export；SQLite SSH 通道见 `crates/dbx-core/src/db/sqlite_worker.rs` 与 `crates/dbx-sqlite-worker` | SQLite 连接根节点已提供审阅式 Backup/Restore；本地快照使用原生 online-backup API，不复制打开中的 WAL 文件，先写同目录随机 partial、完整性检查并 fsync 后才替换目标。单跳远程连接通过已签名、版本固定的 SSH worker 执行同一 online-backup/restore 语义，下载时校验声明长度与摘要，取消会同时中断 worker 操作和传输。设置页提供项目隔离的 hourly/daily/weekly 计划、1–100 保留策略、下一次执行、手动运行、Host 进度/取消与运行时间轴；计划和运行回执保存在应用私有目录，损坏状态先隔离，重启时 running 转 interrupted。Renderer 只唤醒到期任务，Host 重新确认 enabled/due、活动连接身份和 canonical destination；输出文件名由 Host 生成，保留和删除只能触及运行记录自身绑定目录内带 Oxide 前缀的普通文件。后台恢复连接不会切换当前编辑器数据源，调度单飞串行且窗口隐藏时暂停。 | 本地/远程 SQLite WAL、大文件、低磁盘、并发写入、DST/休眠唤醒、取消/崩溃恢复与保留删除的真实验证记录于 `docs/sqlite-backup-deferred-validation.md`。DBX 的 PostgreSQL/MySQL scheduled export 仍缺受控外部工具、版本绑定、凭据隔离、进度、取消和恢复验证。 |

## 5. Grid、导入导出与数据迁移

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| G01 | 核心逻辑已对齐，真实产品/Monaco 验证延期：filter/sort builder | `useDataGridFilterBuilder.ts`、`dataGridConditionCompletion.ts`、`dataGridSort.ts` | SQL WHERE、visual filters、sort 与 typed completion 已有；纯逻辑矩阵现覆盖空条件/AND/OR/括号、前缀 NOT 与列后 NOT、IS/IS NOT、quoted identifier、PostgreSQL ILIKE 边界、boolean/numeric/temporal/text literal、BETWEEN/IN 零宽续写和完成谓词续写。查询结果本地排序迁入独立 model，按 ResultSet 类型对任意精度数值文本排序、自然文本/日期排序、NULL 双向置后并以源行号稳定打破相等值。 | 在真实 Monaco/WebView 与 PostgreSQL/MySQL/SQLite/SQL Server/Oracle 产品版本中验证接受、光标、IME、键盘、数据库端排序语义和服务端返回顺序；live value sampling 继续保持显式 opt-in。 |
| G02 | 逻辑对齐，真实驱动验证延期：专用值查看器 | `JsonValueTable.vue`、binary/image/geometry/spatial modules | Value Editor 已区分 NULL/空串/未加载，提供有界 JSON/array/map/XML/geometry 树预览与严格 binary hex 编辑；XML 拒绝 DTD/entity，geometry 只做 WKT 摘要，image 只接受惰性 raster data URL 并拒绝 SVG。所有预览都有字符/节点/层级或数据大小预算，且不重写原始数据库文本。 | PostgreSQL/PostGIS、MySQL spatial、SQLite SpatiaLite、Mongo binary/image 等真实类型与大值渲染验证延期。 |
| G03 | 逻辑对齐，真实驱动验证延期：cell expression/default preview | DBX grid edit adapter、cell generation 与 bulk edit modules | 值编辑器区分未加载/default、NULL、空值、普通值和显式 expression；生成、隐藏或未分类写入元数据的列在前后端双重禁写，普通值保持参数化。 | PostgreSQL/MySQL/SQLite/SQL Server/Oracle 的生成/隐藏列元数据与 mutation 行为纳入后续真实驱动矩阵。 |
| G04 | 逻辑已对齐，真实产品验证延期：全量/降级数据 compare、批量选择、缺表迁移串联与安全同步 | DBX `crates/dbx-core/src/data_compare.rs`、`apps/desktop/src/components/diff/DataCompareDialog.vue` | Host 先读取两端精确计数；不超过 100,000 行时按两端均声明唯一、NOT NULL 的共享 key 参数化 keyset 分批读取，且会拒绝“计数与实际抓取行数不一致”的静默截断。100,001–10,000,000 行自动降级为最多每端 10,000 个首尾极值键：先合并两端确定性键集合，再用同一组有界绑定参数回查两端，避免 DBX 当前独立随机样本可能把存在的行伪报为缺失；每批不超过 800 个参数，SQLite/rqlite 不注入 PostgreSQL cast。结果区分 `full/sample/skip_with_risk`，报告 coverage、method、sample-local counts 和逐列 SHA-256；极值样本不伪造统计置信度或全表相等结论。超过 10,000,000 行只返回精确计数和明确 skip 状态。Renderer 仍只接收每状态最多 1,000 条明细。每次执行由稳定 compare ID 标识并发送 validating/counting/sample-key/fetch/compare/terminal 有界事件；取消同时请求两端活动 backend query，并在参数化抽样批次与本地 diff/checksum 循环中协作式中止。Explorer 现在从单表、Schema、数据库默认 Schema 和多选表工具条打开同名表批量对比，最多并发两个 Host compare；same/different/missing/error 独立显示，差异表可打开无需预加载数据页的 endpoint-backed compare tab，目标缺表则携带目标连接/库/Schema 转入既有受审阅迁移向导。用户可显式忽略易变的共享 value column，key 始终保留；这覆盖 DBX 当前同名共享列模型，DBX 未提供跨列名映射。精确、未截断且差异不超过 3,000 行时，用户可按逻辑差异行全选、清空或逐条选择；每次选择变化会废弃旧预览，再由 Host 生成 4 MiB 内审阅 SQL，同时冻结不含字面量值的参数化执行计划、完整目标元数据指纹、计划 digest、动态确认短语和 5 分钟单次令牌。Renderer 不能回传 SQL 执行。UPDATE/DELETE 的 WHERE 同时绑定 key 与全部已比较旧目标值，执行前复核连接、relation capability 和 metadata digest，全部语句在一个目标事务中执行且每句必须恰好影响 1 行，否则整体回滚；INSERT 仍通过完整目标 metadata 校验所有未提供的必填列，忽略列不会绕过 NOT NULL/default 约束。令牌在任何执行尝试时消费，过期、重放、目标漂移均 fail closed。commit acknowledgement 失败会明确标记结果未知并禁止自动重试。sample/skip/truncated 结果禁止生成或执行同步计划。相比 DBX 当前 renderer 批量执行字面量 SQL，Oxide 保留更强的 Host 参数化事务边界。DBX Data Compare 本身没有进程恢复 checkpoint，因此不再把该项误列为参考能力。 | 需在真实 PostgreSQL/MySQL/SQLite/DuckDB 与已签名 transaction-capable package 上验证复合键、权限、backend cancellation、并发变更、commit 断连和大宽表内存/时延。 |
| G05 | 主链路逻辑已对齐，真实版本验证延期：MongoDB BSON 类型保真与可视化 mutation | DBX `crates/dbx-core/src/db/mongo_driver.rs:{insert_document_extended_json,update_document,delete_document}`、`document_ops.rs`、`useDataGridEditor.ts:newRowMeta`、`DocumentBrowser.vue`，来源 `a5ce8510e` | MongoDB 结果网格支持单文档 Edit、Clone、Delete 工具栏与右键入口，三者均使用独立审阅面而非通用关系网格写回。Host 不信任渲染行：按选中 `_id` 重读原始文档，草稿不暴露可写 `_id`，从原始 BSON 复制未编辑字段，只解码真实变化的顶层字段；source identity、完整 BSON 指纹、edited fields、server version 与最终文档共同绑定确认 token。Edit/Delete 执行时除重新校验指纹外，还以 `_id` + `$expr` 完整源 BSON 比较作为数据库原子过滤条件，删除另要求 Host 动态确认短语。外置驱动不能借用 bundled MongoDB 协议。Rust contract 覆盖 `_id` 不可变、ObjectId/Date/Int64/Decimal128 保真、字段新增/修改/删除、action/token 分离与完整源过滤；前端 contract 覆盖预览失效、exact-token execute 和删除短语。 | 真实 MongoDB 4.4/5/6/7/8 的 round-trip、timezone、binary subtype、regex/timestamp/code、自定义 `_id`、权限不足、源并发变更、`$expr` 兼容性和 WebView 大文档编辑记录于 `docs/mongodb-document-clone-deferred-validation.md`。批量 edit/delete 暂不开放，避免在缺少逐文档 receipt 与有界预览时伪装为安全。 |
| G06 | 逻辑已对齐，真实产品验证延期：Elasticsearch 索引 metadata 与安全清空 | DBX `crates/dbx-core/src/db/elasticsearch_driver.rs:{get_index_mapping,get_index_settings,get_index_stats,delete_all_documents}`、`ElasticsearchIndexMetadataDialog.vue`、`elasticsearchIndexActions.ts`，来源 `8f3134dce` | `core::driver` 暴露封闭的 `SearchIndexMetadataKind` 与结构化 clear receipt；bundled Elasticsearch 实现 mapping/settings/stats 和固定 delete-by-query。`commands/document.rs` 二次确认 bundled/active driver、重新解析真实 index catalog、绑定审阅 token并对通配目标要求动态短语。Explorer 提供 code-split metadata/clear 对话框，partial 结果如实展示并刷新受影响的 document tabs。 | 真实 ES 6/7/8、OpenSearch/EasySearch 的 least-privilege metadata、wildcard grouping、version conflict、timeout/shard failure 与清空后 refresh 验证延期；EasySearch 未取得签名 runtime 前保持候选。 |
| I01 | 部分对齐：CSV/TSV/分隔文本、JSON/XLSX import | `crates/dbx-core/src/table_import.rs`；`TableImportDialog.vue`；`lib/table/tableImport.ts` | preview、mapping、原生事务流式导入已存在；native CSV/JSON/XLSX preview 返回完整文件 SHA-256，确认写入时回传并核验，文件在预览后变化会被拒绝。原生分隔文本已迁移 DBX 的严格增量转码边界：支持自动或显式 UTF-8、UTF-16 LE/BE、GB18030/GBK，自动检测验证完整文件而非仅猜测前缀，非法字节不会被 U+FFFD 静默替换；`.tsv` 默认 Tab，`.csv/.txt` 默认 comma，也可显式选择分隔符。预览与 Host 共同实现一基 `titleRow`、`dataStartRow`、`lastDataRow` 和 `trimValues`，支持跳过前言、独立标题行和尾注；范围校验、编码、delimiter、header、trim、空值和列映射共同进入 mapping digest。确认后先以完全相同的 reader/range 完成严格全文件预检，再进入单事务流式导入。无标题行时预检和执行都保留驱动返回的目标列顺序，不再由 `BTreeMap` 字典序替换。CSV/JSON/XLSX 对话框现在统一提供 append 与 replace-all；replace mode 进入预检摘要和脱敏报告，Host 只在首个有效批次内执行同事务 `DELETE + INSERT`，空源不清表，失败/取消整体回滚，避免 MySQL 原生 `TRUNCATE` 的隐式提交。每次 native import 使用前端生成且 Host 单一注册的稳定 import ID；Host 在逐行读取、每批写入和 commit 前检查协作取消，批次进度通过统一事件进入表视图与 Explorer 任务中心。JSON array/XLSX 的有界物化已移到 blocking worker，不再占用 Tokio command worker，并在文件读取、工作簿阶段边界和逐行转换时观察同一取消标志；取消发生在写入前会直接终止，不会开启目标事务。取消会回滚当前显式事务并生成 `cancelled` 脱敏终态报告；晚到取消不能把已成功提交的任务误标为取消。新建表工作台可从同一 native file 提取**仅列定义**，用户可编辑推断后的列再创建；CSV 会保留已审阅 mapping，JSONL/NDJSON 的类型扫描保持流式。内置 PostgreSQL/MySQL/SQLite 映射 boolean、integer、decimal、date、timestamp、JSON 与 text 到其原生安全类型，外置/未知 driver 不开放推断建表。创建后导入仍会重验文件 digest；DDL 与导入不能在所有方言上承诺一个原子单元，失败会明确保留已创建但未写入的表。 | 继续对齐 PostgreSQL COPY/SQL Server bulk 等逐驱动 fast path，以及独立 preview/preflight 的中断和 Calamine 工作簿内部 shared-string 解包期间的细粒度取消；需要在真实 PostgreSQL/MySQL/SQLite fixture 验证从文件建表、类型选择、创建后导入失败提示与 JSONL 大文件内存边界。纯浏览器 fallback 仍不生成 native report，也不会开放 replace-all。DBX 当前同样没有 reject-row artifact 或 resume token，因此不再把这两项误列为 DBX 已有能力。 |
| I02 | 部分对齐：连接导入 | `lib/imports/navicatImport.ts`、`dbeaverImport.ts`、`datagripImport.ts` | DataGrip、DBeaver 与 Navicat XML/NCX 已有；Navicat 仅读取非敏感 endpoint 属性，密码/令牌/本地路径永不导入，folder/group 会显示诊断。相同 driver/host/port/database/user 的候选项采用“保留已有本地连接、跳过导入项”的确定性 merge，不覆盖本地凭据或配置。 | 补更多 Navicat 版本/加密导出格式，以及 SSH/TLS/代理等不支持字段的逐项诊断。 |
| X01 | 主链路已对齐，安全恢复延期：流式 export | `crates/dbx-core/src/table_export.rs`（`SQL_INSERT_BATCH_SIZE`）、`database_export.rs`（`build_export_insert_statements`）；`useDataGridExport.ts`；`table_export.rs` | CSV/JSON/SQL 导出已有；Oxide 的本地导出使用稳定任务 ID，普通查询绑定 backend query cancellation，参数化筛选在查询 future 与批次边界协作式中断。数据库分页生产者与阻塞编码/写盘线程之间使用容量为 2 的有界页通道：磁盘、XLSX 或 Parquet 压缩变慢时查询端自然等待，内存不会无界增长，Tokio worker 不执行同步文件 I/O；进度只在写入器完成整页后发出。CSV/TSV/Markdown 逐行编码复用单一缓冲区，不再为每行创建字段字符串数组和 join 结果；JSON/JSONL 直接序列化借用列名与行值，避免构造逐行对象副本。XLSX 继续逐行压缩写盘，并允许用户明确选择是否写入表头 auto-filter，默认保持开启。SQL INSERT 已迁移 DBX 的 100 行批处理，支持 25–1,000 行配置并增加 512 KiB 语句体积上限；原生 PostgreSQL/MySQL/SQLite 可显式生成方言正确的 conflict-skip 或基于完整主键的 conflict-update，分别使用 `ON CONFLICT ... DO UPDATE` / `ON DUPLICATE KEY UPDATE`，默认仍为严格 INSERT。无主键、主键被 generated 排除、外置/未知方言都由 Host 拒绝。分页兼容方言与字面量方言分离，当前静态覆盖 PostgreSQL array/bytea、MySQL binary/控制字符和 SQLite BLOB。新增 Arrow IPC file 与 Snappy Parquet 编码器、声明类型驱动的安全类型计划、源类型 field metadata 和有界降级提示；Parquet row group 同时受 50,000 行/64 MiB 限制。产物只有在生产端显式发送 `Finish`、footer/flush/`sync_all` 成功后才从唯一 `.partial` rename，通道中断、写入失败或取消均由 guard 清理。每次有有效 project ID 的终态导出仍保存脱敏审计记录。 | OFFSET 分页无法证明数据变化期间的 exactly-once 恢复，因此不签发伪 resume token；需在 driver 声明稳定 cursor/keyset + snapshot contract 后开放恢复。SQL 仍待 COPY、更多产品 identity/generated 策略与 typed-literal conformance。 |
| X02 | 本阶段已对齐：有界查询包装保留 execution hint | DBX `crates/dbx-core/src/query_result_sql.rs` 最新 `11c47d125` 的 `restore/split_leading_execution_hint`，覆盖 pagination/count/sort | 原生驱动通过结果读取上限截断，不重写用户 ad-hoc SQL；需要为 Headless Agent Host 增加 server-side limit 时，`core/statement.rs` 只识别开头 `/*+`、`/*@`、`/*&` execution/routing hint，并把它保留在外层有界 SELECT 前。普通注释仍留在原子查询内；拆分共用 UTF-8 安全 scanner，避免正则改写字符串或正文 | 延期用 MySQL compatible routing proxy/optimizer hint 与 Agent Host 受控 fixture 确认 hint 生效、普通注释不提升、max row 与 read-only transaction 不回退；表格分页由结构化 identifier/filter 生成，不接受任意 hint。 |
| T01 | 部分对齐：单表 transfer | `crates/dbx-core/src/transfer.rs:5734 transfer_table`；`DataTransferDialog.vue` | 单表 preview/确认/type map/事务/取消/append/overwrite | 保持同一 target transaction；失败和取消必须回滚；源端 query cancellation 有 fixture。 |
| T02 | 本轮已对齐：主键 upsert | `transfer.rs:2984 generate_upsert`、`:3515 keyset_pagination_sql` | `commands/table.rs:build_upsert_mutation`；Transfer Dialog | 仅 bundled PG/MySQL/SQLite；目标必须有完整映射的 PK；token 绑定 key；外置包默认拒绝。 |
| T03 | PostgreSQL 逻辑已对齐，其他产品部分对齐：多表与 schema-object transfer | `transfer.rs:TransferObjectSelection`、`transfer_schema_objects`；`ObjectSelectionTree.vue` | `preview_table_data_transfer_batch_plan` 同时接受显式表和对象选择；表按 FK 父子关系排序，对象复用 catalog-backed Schema Diff 的依赖顺序和 DDL，不接受调用方原始 DDL。目标已有同 identity 对象会明确 `skipExisting`，定义、父对象或外部依赖无法证明时阻断。执行前重新捕获两端快照并比对整个确认计划；PostgreSQL 在同一目标事务中先复制表数据、再创建 sequence/view/materialized view/routine/trigger，失败统一回滚，避免复制期间触发新 trigger，且 `WITH DATA` materialized view 读取最终行。表和对象都写入不含 DDL、参数或行值的逐对象终态报告。Explorer 的表、Schema、数据库三级入口共享同一选择器和精确 namespace 边界。 | MySQL/MariaDB、Oracle、SQL Server 等对象执行仍保持 blocked，需分别完成可验证 source DDL、依赖图与事务/补偿语义；真实产品 fixture 延期。 |
| T04 | PostgreSQL/MySQL 逻辑已对齐，真实验证延期：FK 依赖排序与循环恢复 | `transfer.rs:sort_tables_by_fk_dependency_with_foreign_keys`、`generate_mysql_foreign_key_alter_statements` | `table_data_transfer_batch_plan` 对同 schema 被选表构图，非循环部分父表优先；无法拓扑消解的表保持用户选择的确定性顺序。原生 PostgreSQL 只有在循环内每条 FK 都确认未存在于目标、且精确 DDL 已绑定到一次性批量确认 token 时才可执行；所有表数据成功后再统一创建 FK，仍处于同一目标事务。原生 MySQL 使用相同的缺失/冲突/完整 deferred-FK 门禁，但不会把 `ALTER TABLE` 伪装为事务步骤：行批次先在目标事务中提交，普通 index/constraint 随后逐条执行，所有 FK 最后执行。每条成功后累计 privacy-bounded receipt；首个失败或提交后的取消立即停止后续 DDL，返回已成功数/总数和 `needsManualReview`，逐表报告标记 `manualReviewRequired`，UI 保留现场并禁用历史便捷重试。数据库错误、SQL 和行值不进入回执/报告。 | 真实 PostgreSQL/MySQL/MariaDB 的循环图、DDL implicit commit、断连、权限失败、取消竞态与人工恢复验证延期。 |
| T05 | 本阶段逻辑已对齐，跨产品与真实验证延期：sequence/identity/ownership | `transfer.rs:PostgresOwnedSequence`、`PostgresSequenceSnapshot`、ownership preview；`DataTransferDialog.vue` ownership flow | PostgreSQL 目标可显式启用 serial/identity generator 同事务同步；单表和批量预览均通过 catalog 精确解析目标 sequence schema/name、owner schema/table/column、当前 last value 与目标表最大值，并在界面逐列展示。对象身份、owner 和数值状态绑定一次性确认 token；执行不再重新猜测 sequence 名称，而是在同一目标事务内对已审阅的 qualified sequence 按写入后的 `MAX(column)` 同步。提交后仍以只读布尔比较确认 generator 不落后于对应表最大键；逐表持久报告只保存列名与 verified 状态，不保存 sequence 数值、SQL 或行值。owner 不匹配、计划变化和无 attached generator 均 fail closed；提交后的权限/读取失败转为 `needsReview`，不会回滚已提交数据或伪造成功。备份/Schema Diff 已额外捕获并恢复 PostgreSQL `is_called`；从未调用的 sequence 使用 start value + `false`，旧快照保持历史 `true` 语义。 | 仍缺跨产品 ownership plan 和真实 fixture；旧 PostgreSQL、权限不足、never-called sequence 及提交断连时必须验证 review-only/needs-review 降级。 |
| T06 | PostgreSQL 主路径已对齐：安全 schema-object 审阅与受限 native DDL | `transfer.rs:ordered_transfer_object_kinds`、`transfer_postgres_schema_dependencies`、`transfer_postgres_schema_objects` | schema snapshot/diff 现同时服务独立迁移和数据 transfer 的显式对象选择。内置 PostgreSQL（regular/materialized）和 MySQL（regular）snapshot 读取 view 的 SELECT body；PostgreSQL materialized view 同时记录 `relispopulated`，创建时按源状态生成 `WITH DATA` 或 `WITH NO DATA`，旧快照/不可读状态保守使用 `WITH NO DATA`，不自动 `REFRESH`。变更的 PostgreSQL materialized view 会生成无 `CASCADE` 的 review-gated `DROP` + `CREATE`，属于 destructive、不可逆计划，必须再确认；其相同快照内、拥有可验证 SELECT source 的普通依赖 view 会按依赖链显式 `DROP` 后重建，且任何缺失/已变更的依赖均会阻断 materialized view 操作，绝不使用 `CASCADE`。MySQL 从 `information_schema.TRIGGERS/EVENTS` 暴露 trigger/event descriptor，并从安全字段重建**不带 DEFINER**的单语句 trigger 和 Event create DDL。Event 必须是 `SYSTEM` 时区、一次或受限 interval schedule、明确 ENABLED/DISABLED、明确 completion policy，且 body 经既有单语句 DML/CALL 白名单复验；触发器/事件含 compound `BEGIN/END` body 因需要 delimiter-aware 协议而保持 blocked。PostgreSQL 从 `pg_rewrite`/`pg_depend` 捕获同 schema direct relation 依赖，并以限定 `schema.relation` 保留跨 schema 依赖；当用户明确选择不同的 native PostgreSQL 源/目标 schema 时，已在 view、index、列类型/默认值（含 `regclass`）、constraint/FK preflight、routine、trigger 和 sequence 的可验证 catalog identifier 位置执行一对一映射，且整个计划保持 review-gated。普通字符串、注释和 dollar-quoted routine body 不改写，动态 SQL、外部依赖和跨数据库映射必须人工验证。`pg_get_functiondef`、`pg_get_triggerdef`、`pg_sequence` 提供 function/procedure、trigger、sequence 原生 DDL；trigger 通过 `tgfoid` 建立至其 callback routine 的精确计划边。sequence 会在引用 `nextval()` 的新关系之前创建，再以独立、review-gated 后置 change 恢复 `OWNED BY` 与可读的整数 last value；权限不足或未调用的 sequence 则只迁移结构。仅同方言 catalog-backed create/replace/create 进入 migration SQL，删除及任何无法验证的定义继续阻断。 | 继续补跨数据库映射及真实目标验证、materialized view 的权限/index/外部对象依赖 conformance、MySQL compound trigger/Event 的 delimiter/依赖 conformance，Oracle/SQL Server object-source conformance与真实 fixture。 |
| T07 | 本阶段增强：持久化 transfer report 与 append baseline | `useExportTracker.ts` 有后台任务、失败明细上限和终态；DBX 当前主要是会话级任务 | `TableDataTransferReport` 已按项目和目标连接保存 terminal report；单表与多表执行都写入逐对象终态。Transfer 对话框显示目标的最近历史，并且仅在当前源端点/库/schema/表完全一致时可用历史记录预填一次重试。重试会生成新 transfer id，且仍强制重新 preview/确认。overwrite 成功后会在提交后只读核对目标行数；append 在 preview 捕获目标行数、将其绑定 confirmation token，并在提交后核对 `baseline + copied rows`。并发写入、计数不可读或溢出均只标为 `needsReview`，绝不伪装为失败或触发第二次写入。报告包含哈希 plan digest、端点标识、模式、追加/覆盖的目标基线、行数、批次、终态和安全错误摘要，不保存 URL/凭据/SQL/参数/行值 | 真实多表、并发写入和跨驱动迁移报告 fixture 仍待完成；不保存行值或凭据。 |
| M01 | 部分对齐：schema snapshot/diff | `crates/dbx-core/src/schema.rs`、`schema_diff.rs`；`components/diff/*` | relation/index/constraint/routine signature snapshot/diff；PostgreSQL/MySQL 的 view relation 额外读取 catalog SELECT body，未获取到 source 时保留明确 warning。PostgreSQL materialized view 额外快照 `relispopulated`，缺失 relation 会用相同的填充状态创建；状态不可读或来自旧快照时强制 `WITH NO DATA` 并要求人工 refresh。其 source/population 状态变更会生成无 `CASCADE` 的 destructive、review-only `DROP MATERIALIZED VIEW` + `CREATE MATERIALIZED VIEW`，需显式 destructive approval；当同快照内所有普通依赖 view 未变且其 SELECT source 完整时，计划会显式按反向 drop / 正向 recreate 依赖链重建它们；任一不可安全重建的依赖会阻断 materialized view change。单独 refresh 则保留在 Explorer 的专用操作。PostgreSQL 同 schema 依赖写入 snapshot，并将同一计划中的 table/view DDL 拓扑排序；明确的 native PostgreSQL schema→schema 映射现可在 catalog-backed view/index/column/default `regclass`/constraint/FK/routine/trigger/sequence DDL 中受审阅地重写到目标 schema，字符串、注释和 dollar-quoted body 保持不变。相同 native dialect 的常规 view create/replace 生成 review-required DDL；PostgreSQL function/procedure、trigger、sequence 也在 catalog definition 可用时生成 review-required 原生 DDL。sequence 本体会排在捕获的 `nextval()` table dependency 之前；当 catalog 可读时，会在 owning relation 创建后通过独立 review change 恢复 `OWNED BY` 和整数 `setval` state。未调用/不可读 state 只保留结构，drop 和任何未捕获 definition 仍为 blocked manual review。新增 `schemaObjects` 快照及 create/drop/modify 差异，PostgreSQL sequence/trigger/domain/enum/composite/range/multirange/extension/partition 在可见时进入快照。 | 补跨数据库映射与真实 target conformance、materialized view 的权限/index/外部对象依赖 conformance、sequence `is_called`/权限降级的真实 fixture、逐产品 event/synonym/package，并为 MySQL/Oracle/SQL Server object source 建立同等的受审核 source/DDL conformance 与真实 fixture。 |
| M02 | Host 产品主路径已对齐，逐产品实现/证据延期：migration apply | DBX `SchemaDiffDeployStep.vue`、`deployTxResult.ts` | PG transactional；MySQL journal + post verify。外置 sidecar 使用 descriptor-only semantic `plan/preflight/token-bound apply/verify`、签名/runtime/evidence 三门禁；Host-only 15 分钟单次 session 隐藏全部 sidecar token，执行前重抓 target，执行后同时要求 sidecar verify 与 Host recapture 通过。partial/count mismatch 强制失败；journal 不保存 token/DDL/原始 observed 文本 | 为每个外置产品实现协议并取得精确 package/entrypoint/platform/server-version evidence；没有证据的产品保持 review-only。 |
| M03 | 逻辑已对齐，真实文件/SSH 验证延期：SQLite existing-table rebuild | DBX SQLite schema/transfer 与 backup 实现可作行为参考 | live snapshot 额外读取 `sqlite_schema` table definition 作为完整性证据；仅对 metadata 完整、可由同名列无损复制，且 catalog 证明不含无法精确重建的 CHECK/COLLATE/generated/AUTOINCREMENT/UNIQUE/STRICT/WITHOUT ROWID/deferrable/action、复合 PK 或高级 index 语义的 existing-table modify，生成临时表→复制→drop→rename→兼容索引重建的单一 review/destructive change。catalog-only drift 可见但保持 blocked；必填新列无 default、定义不完整、create/drop/view/product object 同样 fail closed。Host 执行前重抓 target 并校验 plan/fingerprint/确认短语；驱动独占文件操作，暂停并复核 FK、创建经完整性验证的迁移前 online backup、`BEGIN IMMEDIATE` 执行、`foreign_key_check`、commit/rollback 后恢复 FK。内存库在加写锁前从独占连接备份；文件库和 SSH worker 在写锁下从独立只读连接捕获稳定的已提交快照。备份回执写入持久 journal，异常结果不声称已回滚而要求重新捕获 live target。Renderer 禁止把 rebuild SQL 旁路打开到普通 Console。 | Rust 已覆盖 planner/catalog fail-closed、复合 FK metadata、内存成功/FK 失败回滚、真实本地文件 snapshot connection，以及 worker 在 `BEGIN IMMEDIATE` 下的 committed snapshot。真实 WAL/并发写入、低磁盘、commit/断连、SSH 下载和多平台恢复继续延期。 |
| M04 | 本阶段增强、仍为部分对齐：跨产品 schema mapping | `transfer.rs:map_column_type`、`generate_create_table_ddl`、`convert_cross_family_object_ddl` | 单目标表创建使用显式 `<source>-to-<target>/v1` profile：同产品保留原类型并标记 exact/review；跨产品仅为 PostgreSQL/MySQL/SQLite 的已识别标量族生成 DDL，每列返回 exact/safe/review/unsupported；unsupported 不生成 DDL、无确认 token且后端拒绝执行，review 只能经显式预览和键入确认后执行。受支持的同产品 auto-increment/identity 会创建新的 target-owned generator，并明确不复制源 generator 名称和当前值；PostgreSQL bundled metadata 结构化区分 `GENERATED ALWAYS`、`BY DEFAULT` 与 sequence-backed serial，目标计划/确认 token/DDL 精确保留已证明的 mode；旧外置 payload 未证明 mode 且没有 `nextval()` evidence 时不重建 identity。跨产品、生成列、SQLite 非单一 INTEGER 主键等场景把源值物化为普通列。默认值现使用 Host-owned 审阅映射：同产品仅保留通过 16 KiB、有界单表达式扫描的原表达式；PostgreSQL/MySQL/SQLite 跨产品仅保留 NULL、布尔/数值/标准单引号字面量和 CURRENT_DATE/TIME/TIMESTAMP。生成列、`nextval()`、注释、语句分隔符、未闭合引用和其他产品函数均 fail closed 并显式标记 omitted。逐列保留状态、原因和最终 DDL 共同绑定确认 token，所有默认值计划提升为 Review。同 native PostgreSQL 或 MySQL-family、同表名的数据迁移可显式启用二级 schema-object 恢复：Host 从两端 catalog 冻结 index/constraint metadata，冲突时 fail closed，数据写入后按普通 constraint → index/comment → FK 顺序执行并把最终 DDL 纳入确认 token；同产品可保留 catalog-backed 定义，native PostgreSQL↔MySQL 则只从结构化 metadata 重建普通 BTREE、UNIQUE 和 FK，拒绝 CHECK 原表达式、expression/partial/include/comment/non-BTREE 索引、`NULLS NOT DISTINCT`、deferrable/match/validation 等未结构化语义。MySQL metadata 现在把 functional/prefix/descending key 标记为不可由纯列名恢复，不能再静默弱化。PostgreSQL 保持同事务，MySQL 在行提交后使用 T04 的逐语句部分完成回执。约束 backing index 不重复创建。任意 native SQLite→SQLite 新目标都读取 `sqlite_schema` 原始 table/index DDL，Host 重建目标 schema/table identity 并校验单语句、引号、注释、括号和允许的 table option；改名时只在词法证明的 `REFERENCES` target token 上重写自引用 FK，字符串、注释和外部表引用保持原样，schema-qualified 歧义引用 fail closed。显式索引保留 expression/filter 并在表改名时获得确定性的目标作用域名称，目标 index namespace 冲突会在预览期阻断；CHECK/FK/UNIQUE/generated/collation/STRICT/WITHOUT ROWID 与 expression/partial index 均在一个目标事务中执行。 | 仍需补充 owned sequence/当前值的跨产品映射、cross-product CHECK/trigger、advanced index/cast/function、扩展/自定义类型依赖和更多逐产品 profile；真实产品版本验证已记录到 deferred queue。 |

## 6. 架构与测试差距

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| C01 | 部分对齐：统一 driver conformance runner 与 catalog 证据门禁已落地 | 各 `agents/drivers/*/src/test`、`crates/dbx-core/tests/live_*` | `scripts/run-driver-conformance.mjs`、`docs/database-driver-conformance-*.schema.json`、`DriverPackageConformanceEvidence` | bundled/external 对同一 fixture contract 运行；catalog 只能引用 CI 产生的版本证据。 |
| C02 | 本阶段增强：迁移/全量比对跨层契约 fixture | DBX backend/api types 与 app tests | `tests/fixtures/table-data-transfer-report.json` 由 TypeScript 与 Rust 共同读取，覆盖 append baseline、post-commit verification 和旧报告缺失字段；`tests/fixtures/table-data-compare-result.json` 同时锁定精确总数、有界明细、degradation level、coverage、method、counts exactness 与 sampled key count；`tests/fixtures/table-data-transfer-preview.json` 再锁定 preview 的 target baseline、identity 标记、精确 confirmation token 与 unsupported 映射不可执行。所有 fixture 都不含 URL、凭据、SQL、参数或行值。 | 将同一模式扩展到 sidecar migration、driver capability 与真实跨驱动 transfer fixture。 |
| C03 | 部分对齐：failure injection | DBX worker/process、SSE replay、transfer/export cancellation tests | `commands/table.rs` 的假驱动覆盖成功只 commit、批次失败只 rollback、rollback 本身失败时明确要求人工核对目标；取消与 rollback 的终态报告也已覆盖。assistant event broker 回归覆盖共享面板隐藏期间的 tool start/finish、delta、final/status 重放。 | 仍需真实 crash/restart、下载中断、partial import、stale metadata、reconnect 与跨驱动压力测试；这些不能由 fake driver 替代。 |
| C04 | 部分对齐：巨型模块拆分 | DBX 虽有纯模块，但 `transfer.rs`、主 Vue 组件同样较大 | `QueryEditor.tsx`、`SchemaSidebar.tsx`、`DataGrid.tsx`、`commands/table.rs` 仍大；单表与多表迁移已收敛到同一个 transaction executor，统一 overwrite、source cancellation、参数化写入、identity reseed 和批次进度，移除约 130 行会漂移的重复执行循环 | 继续按 feature/application/domain 拆出 export/transfer 模块；禁止把 vendor switch 堆到 UI，也不得为单表/批量入口复制第二套执行语义。 |
| C05 | 本阶段已修复：参考源码导致的前端构建性能退化 | DBX 的 monorepo 不应参与 Oxide 的产品 CSS content scan | Tailwind v4 改为 `source(none)` 后显式只扫描 `src/`；`sources/` 下的 DBX 等参考仓库、构建产物和外部目录不再扩大 Tailwind utility 生成。回归脚本锁定 source scope。本机 production build 从 1m11s 降至 8.32s，并完成 bundle startup-cycle 校验。 | 持续在 CI 记录冷/热构建时间与峰值内存；新增产品源码必须位于明确 source scope 内。 |

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

1. 继续把 DBX semantic fixtures 转换为 Oxide LSP contract corpus；CTE/derived projection scope 已覆盖 native 与 compatibility dialect。
2. 补函数签名、INSERT inlay hints、correlated subquery/table-function/reference 场景。
3. QueryEditor 已完成 Console auto-suggest lifecycle 拆分；后续补真实 Monaco/provider 组合测试。

### 批次 3：数据生命周期

1. 多表 transfer plan、FK 拓扑排序、cycle policy。
2. sequence/identity/ownership preview 与 post-verify。
3. 持久化 transfer report；import reject rows/resume；export backpressure/cancel/cleanup。
4. SQLite rebuild 的 backup/FK/rollback runtime contract 已完成逻辑闭环；签名 sidecar semantic migration 协议已完成，随后补逐产品实现与真实 evidence。

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

因此，85 个 catalog candidate（80 项 DBX 产品 + 5 项明确标注的兼容产品）只有在逐项产生上述证据后，才能转换为“70+ 数据库可用”。

## Phase 114 增量：函数大小写与全方言补全偏好

| 差距 | DBX 实现位置 | OxideStudio 对齐位置 | 状态 |
| --- | --- | --- | --- |
| 关键字和函数名只能共用一种大小写语义 | `apps/desktop/src/lib/sql/sqlCompletion.ts:1314,1376,1440,3177-3201,4271-4300`；配置默认值在 `apps/desktop/src/lib/sql/sqlFormatterConfig.ts:43,70` | `src/lib/appSettings.ts`、`src/components/settings/SettingsDialog.tsx`、`src/components/lsp/LspConnectionSyncer.tsx`、`src/services/lsp/syncPlan.ts` | 逻辑已对齐：新增独立 `functionCase = preserve/upper/lower`，旧配置默认 preserve |
| 所有 SQL compatibility route 需要共享偏好，同时不得改写 Elasticsearch/MongoDB/Redis 等非 SQL DSL | DBX `SqlCompletionSource` 仅为 SQL editor 传入 `keywordCase/functionCase` | `vendor/sql-lsp/src/server.rs:completion_candidates_at` | 已对齐：所有注册 SQL baseline 进入统一 preference pass；非 SQL dialect 保持自己的命令/字段拼写 |
| 内置函数、窗口函数、system value、Oracle/ClickHouse 表函数大小写不一致 | DBX `applySqlFunctionCase`、`applyGeneratedSqlTemplateKeywordCase`、`buildOracleTableFunctionItems`、`buildFunctionSnippetItems` | `vendor/sql-lsp/src/server.rs:apply_completion_preferences`；`src/features/query-editor/model/sqlCommandSnippets.ts` | 已对齐；实时数据库 routine metadata 和用户修改的命令模板保持原始拼写 |

本阶段只执行纯逻辑测试和构建，不连接数据库。真实 Oracle/OceanBase Oracle、ClickHouse、
Dameng、Db2 及兼容产品的 Monaco 接受行为与 server-version 语法仍按统一后置清单验收。

## Phase 115 增量：DBX `f075caef2` 最新体验差异

| 差距 | DBX 实现位置 | OxideStudio 对齐位置 | 状态 |
| --- | --- | --- | --- |
| 克隆行被统一追加到底部，脱离源行上下文 | `apps/desktop/src/composables/useDataGridEditor.ts:clonedRowMeta/cloneRow`（`b60f04ea6`） | `src/lib/dataGridRows.ts`、`src/store/useTabStore.ts:cloneRows`、`src/components/workspace/DataGrid.tsx` | 已对齐并增强：关系型表格补回 Clone Row/Rows；克隆草稿以稳定负 row key 锚定源行，排序/过滤时不篡改查询结果；源被过滤或删除时安全降级到底部。自增/生成列不复制，复制、编辑、提交与草稿重排共享同一 visual-row 映射。 |
| 编辑操作或查询结果动作出现后工具栏横向溢出且尾部动作不可见 | `apps/desktop/src/components/grid/DataGrid.vue:updateDataGridTopbarWidth`（`a84cb637b`） | `src/components/workspace/TableDataToolbar.tsx`、`DataGrid.tsx`、`src/lib/toolbarOverflow.ts` | 已完整对齐：表数据与普通查询结果工具栏都由 ResizeObserver + MutationObserver 观测真实 action list，并共享带滞回的宽度状态；溢出时只折叠 Submit/Revert 或 Transpose/Copy/Export 文字，图标、title、aria-label 和菜单入口始终保留，达到原展开所需宽度后才自动恢复，避免边界宽度来回闪动。 |
| 外部 SQL 文件浏览仅固定识别 `.sql` | `apps/desktop/src/components/layout/SqlFilePanel.vue`、`src-tauri/src/commands/list_sql_files.rs`（`f725c50b2`） | `src/components/workspace/ProjectFilesSidebar.tsx`、`src/lib/projectFileFilter.ts` | 按 Oxide 项目工作区架构对齐：文件面板提供持久化的大小写不敏感 glob/正则过滤和错误校验，默认 `*` 保留 SQL、脚本、文档和 AI 项目上下文；目录仍按需加载，因此过滤不会触发全树扫描。LSP 继续只同步受限 SQL 后缀，不因 UI 过滤扩大文档授权。 |
| Elasticsearch index mapping/settings/stats/clear | `ElasticsearchIndexMetadataDialog.vue`、`elasticsearchIndexActions.ts`、`document_ops.rs`（`8f3134dce`） | `src/features/data-grid/ui/ElasticsearchIndexMetadataDialog.tsx`、`ElasticsearchIndexClearDialog.tsx`、`src-tauri/src/commands/document.rs`、`drivers/elasticsearch.rs` | 已在此前阶段对齐并更严格：metadata kind 为闭集，index path segment 编码；clear 走 preview/token/目标重验，通配目标要求动态确认短语，响应必须包含完整 shard 结果。ES 6 typed mapping 与 ES 7/8 typeless mapping 均有契约测试。 |

本阶段不引入 DBX 的 S3 sccache 或 Kafka/Dameng package 版本号：前者属于其 CI/对象存储基础设施，后者属于 DBX 发布目录，不是 Oxide 产品能力差距。

## Phase 129 增量：DBX 桌面窗口与按压反馈

| 差距 | DBX 实现位置 | OxideStudio 对齐位置 | 状态 |
| --- | --- | --- | --- |
| 鼠标从非活动窗口首次点击按钮只激活窗口，不传递到 WebView | `src-tauri/tauri.conf.json`（`554be11ae`） | `src-tauri/tauri.conf.json` | 已对齐：主窗口启用 Tauri `acceptFirstMouse`；配置由 `tauri info` 成功解析。 |
| macOS 关闭时 WKWebView teardown 可能短暂闪屏 | `src-tauri/src/commands/app_settings.rs`、`src-tauri/src/lib.rs`（`554be11ae`） | `src-tauri/src/commands/window.rs` | 主关闭入口已对齐：macOS 先隐藏当前窗口，等待 250ms 后再关闭；Windows/Linux 保持原行为。Oxide 当前没有 DBX 的托盘/关闭确认/restart 多出口，因此未复制其应用级状态机。 |
| 共用按钮只有 hover，无 pointer-down 即时反馈 | `apps/desktop/src/components/ui/button/index.ts` 与 `buttonPressFeedback.spec.ts`（`554be11ae`） | `src/components/ui/button.tsx`、`src/styles/variants/button.ts`、`src/components/ui/button.test.ts` | 已对齐并覆盖普通、图标、工具栏、页签按钮；只改变颜色/透明度，不使用 scale/translate，避免目标跳动。 |
| DBX 最新产品提交包含 Oracle、SQL Server、Xugu、ArgoDB、Kafka 等专用运行时行为 | `8cc04f3af`、`c7c420bbd`、`afe3b3f3c`、`351a8b699`、`2fe26052a` 等 | Oxide signed driver package catalog/conformance | 未伪造为已完成：这些能力必须随精确签名 package、entrypoint、server-version evidence 交付；Host 目录占位或 generic compatibility 不能计为对齐。 |
| Redis 未知命令提示、portable user-data 导入属于 DBX 特有写入/启动路径 | `9a5aae49c`、`2779a435c` | Oxide Redis 目前只读；Oxide 无 DBX portable 数据库导入入口 | 当前不适用。未来若增加 Redis hash-field mutation 或 portable profile import，需重新纳入差距，而不能复用本次结论。 |

本阶段运行了 7 个前端按压反馈测试、3 个 Rust 窗口命令测试、前端生产构建和
Tauri 配置解析；macOS 真实首击、关闭动画和多窗口行为仍进入统一的系统验证清单。

## Phase 130 增量：DBX `d69cf9da7` 最新前端差距复核

| DBX 增量 | OxideStudio 当前证据 | 状态 |
| --- | --- | --- |
| 详情弹窗方向键导航 `d69cf9da7` | `src/features/data-grid/model/dataGridDetailNavigation.ts`、`ValueEditorDialog.tsx`（`301d3547`） | 已对齐；输入、Monaco、菜单和 listbox 保留原生方向键。 |
| MySQL VARBINARY/二进制 dump `14ad5ef9b`、`49926f25f` | `src/lib/exportUtils.ts`、`src-tauri/src/commands/query.rs`（`7a91bc44`） | 已对齐；剪贴板仅把可逆 UTF-8 VARBINARY 显示为文本，导入在字节层将 `_binary` 原始字面量转换为 lossless hex。 |
| DDL 按需刷新与 hover 开关 `cd008b2d5`、`5eb071bc2` | `TableDdlView.tsx`、`TableDataView.tsx`、`SettingsDialog.tsx`、`useLspHoverProviderCoordinator.ts`（`e7a76120`） | 主路径已对齐；刷新绕过缓存，默认打开策略和 hover DDL 请求可独立关闭。 |
| Elasticsearch JSON key 尾引号 `cb3de0ef4` | `src/lib/elasticsearchConsole.ts`、`elasticsearchCompletionRange.ts`（`3ea234f1`、`3d139c68`） | 已对齐；接受候选会消费自动闭合引号，已有 `:` 时不重复插入值 scaffold。 |
| AI API 自定义 Header `42c0dc7f8` | `src-tauri/src/commands/ai.rs`、`agent/model.rs`、`SettingsDialog.tsx`（`bef53c0a`） | 已对齐并加强：Header 值进入 Rust 凭据存储，不进入前端状态、日志或 provider 快照。 |
| 左侧页签关闭、分页服务端排序、Gauss 未引号迁移标识符 `662037295`、`40a806a24`、`4baa46ca8` | `useTabStore.ts`、`TabBar.tsx`、`TableDataView.tsx`、`DataGrid.tsx`、`commands/table.rs` | 已在前序阶段对齐；dirty/pinned tab 保留防丢失边界，关系表排序进入分页请求，Gauss policy 有独立测试。 |
| View options/长内容 popover 越出窗口 `b41dac461` | `src/components/ui/popover.tsx`、`popover.test.ts` | 本阶段已对齐到共享 primitive：默认 8px collision padding，使用 Radix 可用高度变量，横向裁剪、纵向滚动；调用方仍可显式覆盖尺寸/overflow。 |
| DDL hover 内联搜索 `f9ff9245c` | `useTableDdlHoverSearchWidget.ts`、`queryEditorTableHover.ts` | 本阶段已按 Monaco 架构对齐：关系表 hover 使用受控 content widget，不开启任意 Markdown HTML/command trust；320ms 延迟后复用有界 metadata/DDL cache，支持字面量、大小写不敏感搜索与安全 `<mark>` 高亮。鼠标在标识符任意字符上均使用同一对齐起点；同表移动只重排 widget，不重新请求。连接、文档、metadata revision、编辑、滚动或目标变化会关闭 widget，迟到结果不能复活。DDL 不可用时降级为最多 200 列的 metadata 结构。 |

这次实现保留标准 LSP hover 处理列/表达式语义；只有已确认的 relation target 由可搜索
widget 接管，从而避免原生 hover 与交互式 hover 重叠，也不重复发送 metadata/DDL/LSP 请求。

## Phase 132 增量：消息队列连接表单契约

| 差距 | DBX 实现位置 | OxideStudio 对齐位置 | 状态 |
| --- | --- | --- | --- |
| MQ 连接仍展示可编辑 URL，与 broker/bootstrap 等结构化字段形成两个事实源 | `apps/desktop/src/components/connection/ConnectionDialog.vue`（`23f511de2`） | `src/features/database-drivers/model/connectionFormVisibility.ts`、`src/components/connection/ConnectionForm.tsx` | 已按签名 capability 对齐：`dataModel=queue` 时隐藏 URL 行和 URL 专属说明；Host 仍从结构化字段和 package URL grammar 构建内部传输地址。判断不依赖 `mq` 字符串，因此未来 Kafka/RabbitMQ/RocketMQ 等独立 package 也遵守同一契约；其他八类 data model 保留 URL 编辑器。 |

该变化不让尚未安装的 MQ catalog candidate 变为可连接驱动；选择、连接和发布状态仍完全
由 ready/verified/active 的签名 package 控制。

## Phase 133 增量：定时备份目标卷身份

| 差距 | DBX 实现位置 | OxideStudio 对齐位置 | 状态 |
| --- | --- | --- | --- |
| 定时任务只保存目标路径；可移动卷或网络挂载被替换后，相同路径可能写入错误文件系统 | `crates/dbx-core/src/database_export.rs`（`bc41e8d76`） | `src-tauri/src/commands/sqlite_backup_schedule.rs` | 已对齐并扩展到三平台：保存计划时由 Host 捕获持久卷身份；运行前比较 canonical directory，完成后从打开的产物 handle 再比较。macOS 使用 volume UUID，Windows 使用 volume serial，Unix 使用 device id；旧计划、未知身份和身份改变均拒绝自动运行。 |

本阶段新增 identity round-trip、旧计划迁移门禁、不同卷拒绝以及目录/打开文件一致性测试；
与 CI 相同的 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
和完整 Rust lib 测试（747 passed、2 ignored）均通过。真实 macOS removable/APFS volume、Windows
盘符重用、Linux bind/network mount 的换卷竞态进入延期验证清单。

## Phase 134 增量：查询结果工具栏自适应紧凑模式

DBX `a84cb637b` 的真实溢出测量此前只覆盖 Oxide 的表数据工具栏；普通查询结果仍可能在
右侧/拆分面板变窄时裁掉 Copy 或 Export。本阶段让 `DataGrid.tsx` 复用
`resolveToolbarOverflowState`：尺寸与动态文案变化都会重新测量，紧凑状态使用展开态所需宽度
作为恢复阈值。紧凑时仅隐藏文字，结果数、截断告警图标、Transpose/Copy/Export 图标、菜单和
可访问名称保持可用。定向 4 个测试和生产前端构建通过；真实 WebView 拆分拖动、缩放与
系统字体变化记录在延期验证清单。

## Phase 135 增量：缓存补全的 alias collision 与 SQL Server 空 schema

DBX semantic completion 会同时保留规范化 relation identity 与 `aliasSql`，并依靠当前
query block 的 source binding 消除 alias/表名冲突。Oxide 的 bundled LSP 主路径已经具备该
契约，但 LSP 未就绪时的 metadata fallback 仍会把 relation alias 和物理表名放在同一次反向
查找中。例如 `FROM audit.orders users JOIN public.users u ... users.` 会错误加载
`public.users` 的列；已经写成 `orders o` 的 relation 也仍能被无效的 `orders.` 命中。

本阶段让 fallback 分两次绑定：先解析 alias，再只在未起别名的 relation 中解析表名；CTE
在尚未写外层 `FROM` 时仍可提供声明列，但显式起别名后同样不能用原 CTE 名访问。relation
引用额外保存精确 `aliasSql`，FK JOIN 生成器沿用用户原有的双引号、反引号或方括号 spelling。
SQL Server `database..table` 与 `server.database..table` 的空 schema segment 也不再丢失，
因此 fallback 不会把 database 误当成 schema 并查询错误 metadata scope。

新增 collision、隐藏 base name、escaped bracket alias、`database..table` 和 JOIN insertion
契约；全量前端测试为 309 files / 1,646 tests，生产构建和 bundle cycle verifier 均通过。
真实 SQL Server catalog、大小写敏感 PostgreSQL/MySQL alias 以及 Monaco 接受行为继续进入
统一的真实数据库/WebView 延期验证清单。

## Phase 136 增量：MySQL/MariaDB DBX 长尾函数目录

逐项比较 DBX `MYSQL_FUNCTION_SIGNATURES` 与 bundled LSP 后，确认现有目录只覆盖基础日期、
字符串和少量 JSON 函数，缺少 DBX 已提供的日期计算、三角/进制数学、JSON mutation、会话与
identity 函数。现在已迁移剩余签名，包括 `MONTHNAME`、`WEEK`、`ADDTIME`、`MAKEDATE`、
`POSITION`、`MAKE_SET`、`LOG2`、`ATAN2`、`CONV`、`JSON_OBJECT`、`JSON_INSERT`、
`JSON_REMOVE`、`DATABASE`、`LAST_INSERT_ID`、`UUID_SHORT` 等完整类别。

目录仍遵守既有边界：实时 routine metadata 优先；JSON 函数继续使用 server-version gate；
具体 prefix 先过滤再受单次 100 项上限约束；PostgreSQL、Oracle、DB2、达梦和 SQL Server
不会继承 MySQL-only 候选。新增目录级 signature/隔离测试和 server completion snippet 测试。
SQL LSP 完整测试、`cargo clippy --all-targets -- -D warnings` 与 release build 均通过；真实
MySQL/MariaDB 多版本接受行为仍按统一数据库验证计划延期。

## Phase 137 增量：迁移建表默认值的受审阅映射

DBX 的跨产品 `map_column_type` 会在生成目标 DDL 时处理默认值；Oxide 此前虽然把默认值存在
逐列预览中，却无条件省略最终 CREATE TABLE 默认表达式。本阶段把默认值纳入 Host-owned
目标建表计划，同时不扩大 renderer 或外置驱动的 SQL 权限：

- 同产品只保留通过 quote-aware、括号平衡、16 KiB 上限的单表达式；未引用的分号、注释、
  NUL/控制字符、未闭合引用和不平衡括号均拒绝。
- PostgreSQL/MySQL/SQLite 跨产品只映射可证明可移植的 NULL、布尔、数值、标准单引号字面量
  以及 CURRENT_DATE、CURRENT_TIME、CURRENT_TIMESTAMP；产品函数和非标准转义保持 omitted。
- target-owned identity 不复制源 generator；生成列和 PostgreSQL `nextval()` 即使同产品也不
  作为普通默认值重放，避免引用不存在或错误 ownership 的源 sequence。
- 默认值表达式只由 Rust 计划生成器加入 DDL，逐列 `defaultRetained`/reason、最终 statements
  和一次性确认 token 保持同一事实源；SQLite 与 PostgreSQL/MySQL 使用相同审阅输入。

定向迁移测试覆盖同产品函数、跨产品 portable 值、危险表达式、generated/sequence 默认值及
SQLite renderer。完整 Rust lib 测试为 751 passed、2 ignored；GitHub Actions 同款
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` 通过。真实数据库
默认值接受、时区/precision、SQL mode、sequence ownership 和 server-version 差异继续按统一
延期验证清单执行。

## Phase 138 增量：PostgreSQL identity generation mode 保真

DBX 通过列 `extra` 区分 `GENERATED ALWAYS AS IDENTITY`、`GENERATED BY DEFAULT AS IDENTITY`
和 sequence-backed serial；Oxide 过去只保留 `isAutoIncrement` 布尔值，因此新目标表一律生成
`BY DEFAULT`，会弱化 ALWAYS identity 的写入约束。本阶段改为端到端结构化契约：

- bundled PostgreSQL catalog 从 `pg_attribute.attidentity` 输出 `always`/`byDefault`；serial 仍由
  `nextval()` default 独立识别。MySQL、SQLite、MongoDB、Elasticsearch 不伪造该字段。
- `ColumnInfo` 的新字段是向后兼容可选项；旧外置驱动未提供 mode 时，只有可验证的 PostgreSQL
  `nextval()` 才按 serial→BY DEFAULT 重建，其他 identity-like 元数据物化为普通列。
- 迁移列预览同时返回 source/target mode，界面显示 `(always)` 或 `(by default)`；两端 mode、
  最终 DDL 和 statements 一起进入现有一次性确认 token。
- Schema Snapshot fingerprint 和列结构比较包含 mode；新增关系可生成精确 identity DDL，既有列
  mode 变化只生成无 SQL 的人工审阅项，旧/非法 mode 不会被降级成较弱的 BY DEFAULT。
- Host renderer 只允许 PostgreSQL identity 接收 mode；非 identity 列、MySQL 目标和未知 mode
  全部拒绝，避免 renderer 传入矛盾语义。

新增回归覆盖 ALWAYS、显式 BY_DEFAULT 规范化、serial fallback、未证明 identity 降级、非法 mode
和 camelCase wire contract。前端生产构建与 bundle cycle verifier 通过；完整 Rust lib 测试为
754 passed、2 ignored。真实 PostgreSQL 10–18 identity insert/override、partition inheritance、
sequence options/ownership 仍按统一真实数据库验证清单延期。

## Phase 139 增量：数据复制后的索引与约束恢复

对照 DBX `transfer.rs` 的 PostgreSQL index/FK catalog 捕获和数据写入后恢复顺序，本阶段把
Oxide 原先“只复制列和主键”的边界扩展为显式、可审阅且默认关闭的二级 schema-object 恢复：

- PostgreSQL index metadata 新增 partial predicate、INCLUDE 列、key/expression provenance，并
  保留 `pg_get_indexdef` 精确定义；MySQL/SQLite/MongoDB 同步输出向后兼容的空结构字段。
- PostgreSQL 与 MySQL foreign key metadata 结构化保存 `ON UPDATE`/`ON DELETE`；SQLite 同步
  采集 PRAGMA 动作，Schema Diff 会检测 referential action 漂移并生成受审阅 replacement DDL。
- 仅同一 native PostgreSQL 或 MySQL-family、同表名且非 external package 的 transfer 可启用；
  Host 重新读取两端 metadata，同名异构对象、匿名对象、缺失 FK target/column 或无法精确生成的
  对象全部 fail closed。
- 精确恢复计划按非 FK constraint、secondary index（PostgreSQL 含 comment）、FK 的顺序执行，
  并在行复制和 identity reseed 之后、同一目标事务提交之前完成。计划 DDL、开关和目标共同绑定
  一次性确认 token；结果只记录恢复数量，不保存 DDL 或数据字面量。
- 迁移界面为可用组合提供明确开关，并在单表及批量预览中展示完整后置 DDL；新建同名目标表时
  默认选择恢复，已有表仍由用户显式开启。constraint backing index 会去重，避免重复创建。

本阶段纯逻辑回归覆盖 PostgreSQL 顺序/schema rewrite/INCLUDE/filter/comment、MySQL FK action、
同名 drift 拒绝和 backing-index 去重。循环 FK 仍由现有拓扑计划阻断；SQLite rebuild、跨产品
object mapping、trigger/collation/extension dependency 和真实 PostgreSQL/MySQL 权限/版本验证继续
留在统一延期验证清单中。

## Phase 140 增量：循环外键的事务内延迟恢复

DBX 对 MySQL-family 使用先建表/复制、最后 `ALTER TABLE ADD FOREIGN KEY` 的方式绕开循环依赖；
Oxide 此前只返回 `cyclicTables` 并完全阻断。本阶段先闭环具备事务 DDL 的原生 PostgreSQL：

- Kahn 排序仍优先输出可消解的父表；未消解集合不再丢失，按用户选择顺序稳定追加，因此预览、
  执行复算和确认摘要拥有相同顺序。
- index、UNIQUE/CHECK 与 FK 恢复计划在 Host 内部分层；批量执行逐表恢复非 FK 对象，但把所有 FK
  聚合到全部表数据及 identity 同步之后统一执行。单表入口仍在本表复制后执行完整计划。
- 循环不因开关本身自动放行。Host 逐条核对循环依赖的 owner table/constraint name，只有对应
  目标约束确实缺失且同一 FK 精确出现在 deferred plan 中才允许；已有约束、metadata 缺失、同名
  drift 或未启用恢复都会阻断。
- 循环表集合、确定性顺序、逐表完整 DDL 和可执行状态继续共同进入批量确认 token；执行时再次
  捕获元数据并比对逐表 plan digest，避免预览后约束被创建或修改。
- MySQL-family 循环保持明确 blocked：其 `ALTER TABLE` 会隐式提交，不能复用“失败后整批回滚”的
  PostgreSQL 语义。后续必须增加 row-commit 与 DDL receipt、partial/needs-review 终态和禁止自动
  重试边界后再开放，不能用 `FOREIGN_KEY_CHECKS=0` 掩盖非原子事实。

纯函数回归覆盖确定性循环顺序、完整 deferred FK 集合放行以及缺少任一循环约束时的精确阻断；
真实 PostgreSQL mutual/self FK、权限失败和 commit 断连验证仍按统一真实数据库阶段延期。

## Phase 141 增量：SQLite 新目标的精确目录结构保留

此前 SQLite “创建迁移目标”只根据列 metadata 合成 DDL，会丢失表级 CHECK/FK/UNIQUE、generated、
collation、STRICT/WITHOUT ROWID 和显式 expression/partial index。本阶段为可证明安全的同名迁移
补齐原生目录路径：

- 仅 bundled native SQLite、source/target schema 等价且 table 名完全相同时启用；改名、跨 schema、
  外置 package 与 virtual table 继续 fail closed 或使用明确标注的 column-only 计划，避免错误重写
  self-reference 与 package 方言。
- 本地与 SSH SQLite index metadata 读取 `sqlite_schema.sql`。建表计划读取完整 table DDL，但不信任
  catalog 中的对象名前缀；Host 使用冻结的目标 schema/table/index 重建前缀，只保留经过单语句、
  quote/comment、括号平衡、statement separator 和尾部 clause 校验的结构主体。
- table 主体保留 table-level constraints、generated/hidden、collation 与合法的 STRICT/WITHOUT ROWID；
  自动 PK/UNIQUE backing index 已在 table 主体内，不重复创建。显式 unique/expression/partial index
  使用精确 catalog 定义重建；缺少定义时阻断而不是静默丢失。
- table 与全部显式 index DDL、逐列计划和目标 identity 一起绑定现有一次性确认 token；执行改为单个
  SQLite target transaction，任一 index 失败都会回滚新表，commit outcome 不确定时禁止自动重试。
- 触发器、virtual-table shadow objects、改名/跨 schema 约束重写和既有目标 rebuild 仍未开放；真实
  SQLite/Remote SQLite 版本、外键依赖、磁盘不足和 commit 断连验证进入统一延期清单。

纯逻辑与内存 SQLite 回归覆盖 CHECK/FK/generated/STRICT、字符串内分号、表达式/partial index、
恶意第二语句、括号/尾部 clause 校验以及 catalog DDL 计划组装。

## Phase 142 增量：应用更新后台下载与安全重启

对照 DBX `8be503bf4`，Oxide 原更新对话框要求用户停留并手动开始下载，且安装前没有绑定
Workbench 活动任务。本阶段调整为全局生命周期：

- 用户点击“Download in Background”后对话框立即关闭，下载仍由全局 Update Store 和 Tauri
  `Update` handle 持续持有；重新打开对话框可查看同一进度，不会重新检查或启动第二个下载。
- 标题栏在 available/downloading/downloaded 状态显示独立入口。已知 content length 使用环形进度，
  未知总长使用 indeterminate 状态；Settings 菜单同步显示百分比或后台下载文案。
- 网络 chunk 进度在 renderer 侧按 100ms、总量变化或完成边界合并，避免每个 chunk 同时触发
  AppBar、Settings 和对话框订阅更新。
- 下载不因查询、迁移、Agent 或导出任务而阻塞；安装并重启前则重新读取 Workbench Task Store，
  任一 `running`/`waiting` 任务都会保持 downloaded 状态并拒绝调用 updater。UI 同时禁用安装按钮
  并显示精确活动任务数量，renderer 绕过按钮直接调用 Store 也无法扩大权限。
- updater 签名、公钥、超时、active update handle 与安装/重启仍复用既有 Tauri service；本阶段不把
  关闭对话框误实现为下载取消，也不声称底层插件提供未验证的断点续传。

单元测试覆盖进度节流、并发下载单飞、后台完成状态、活动任务阻断和终态任务放行。真实签名
update、未知 content length、网络中断、Windows installer/macOS bundle/Linux AppImage 以及安装
瞬间新增任务的竞态进入更新延期验证清单。

## Phase 143 增量：标签位置、分组、排序与可见顺序操作

对照 DBX `5f9ba5176` 的 `settingsStore.ts`、`AppTabBar.vue`、`useTabDrag.ts` 和 `App.vue`，
Oxide 将标签组织从单一组件内的数组遍历拆为可测试的确定性模型：

- Editor Settings 新增并持久化 top/bottom/left/right 位置、无分组/数据库类型/连接分组，以及
  手动/创建时间/标题排序；非法旧值在读取时回退到 top + none + manual。
- pinned 和 regular 永远是两个排序域；分组只能改变域内顺序。自然标题排序识别数字，创建时间排序对
  旧 session 中没有 `createdAt` 的 tab 使用保持原始顺序的迁移时间，不把旧 tab 随机插入新 tab 之后。
- 普通工作区按设置改变 TabBar 与内容区 flex 方向；Split Editor 的每个 group 复用同一位置与组织方式，
  左右纵向布局缩窄为紧凑栏，避免多 pane 时重复占用完整宽度。
- manual 模式使用原生 desktop drag/drop；自动排序模式明确关闭 draggable。拖动只允许相同 pinned
  状态和相同显式 group，Store 在最终提交时再次校验 pinned 边界。
- Close Left/Right 不再依赖内部数组位置，而是从当前排序/过滤后的可见序列生成精确、去 pinned 的
  ID 集合，由 Store 一次确认和关闭；单 tab 关闭也优先激活可见相邻 tab。Split Editor 的 query-only
  Close Others/All 不再误关闭不可见的 table/schema 工具页。
- 标签组织与索引均使用 memoized 线性结构，移除了 render 内逐 tab `findIndex` 的二次复杂度；overflow
  菜单复用相同的组织结果，ResizeObserver 只更新是否溢出，reduced-motion 时活动标签滚动不做动画。

单元/组件测试覆盖设置迁移、pinned 边界、两种分组、三种排序、自然标题顺序、旧 tab 时间迁移、
精确批量关闭、拖动 Store 约束、右侧纵向布局与 DOM 可见顺序。真实 Tauri WebView 下的鼠标拖动、
不同 DPI、触控滚动和数百 tab 压力交互记录到延期验证清单。

## Phase 144 增量：项目级 SQL Library 与批量导入导出

对照 DBX `d79d35792` 及当前 `SqlLibraryPanel.vue`、`savedSqlStore.ts`、`saved_sql.rs`、
`commands/saved_sql.rs`，Oxide 不再把旧的扁平 localStorage Saved Queries 当作 SQL Library：

- Rust MetaStore 新增 project-scoped folder/file 表和树索引，文件记录保留 connection、database、schema、
  order/opened metadata；删除项目会显式清理 Library。启动查询不读取 SQL 正文，单文件打开和完整导出
  分别使用单条内容查询和一次全量内容查询。
- Host 校验项目、ID、名称、时间/顺序、16 MiB 单文件、64 MiB 批次、5,000 项、128 层树、父子连接
  作用域、循环和同目录不区分大小写冲突。目录删除使用递归 CTE；批量导入在一个 SQLite transaction
  内写入，任一文件失败会整体回滚。
- SQL Library 作为 First/Second Panel 共用的 tool window 接入标题栏与 Settings，打开同侧其他工具会替换
  当前工具，关闭后不会露出旧面板。文件夹首次进入项目默认折叠，Collapse All、搜索强制展开命中祖先、
  folder/recent 排序与长列表 `content-visibility` 保持一致。
- 文件与文件夹支持创建、重命名、确认删除和同 connection scope 移动；有界版本化 drag payload 不携带
  SQL 正文，Monaco 在 drop 时才懒加载内容并建立 undo 边界。Command Palette/Search Everywhere 和编辑器
  快捷入口复用已有 saved-SQL tab；Ctrl+S、Vim `:w` 与工具栏 Save 使用同一保存函数和 dirty 状态。
- 导入只接受 canonical root 内非 symlink 的 UTF-8 `.sql`，限制 32 层、5,000 文件、16 MiB/文件和
  64 MiB 总量；renderer 一次构造确定性 folder/file batch，Host 单事务保存。导出拒绝绝对路径、`..`、
  重复路径与符号链接，先写 sibling staging directory 并同步文件，再原子 rename 为新的唯一目录。
- 旧 Zustand `saved-queries` 只迁移到默认 `sqls` 项目；批量持久化并重新加载成功后才移除旧键，失败时
  保留原数据。Project Files 仍是用户选择目录下的真实文件，SQL Library 是应用私有数据，二者不自动
  双向同步。

单元测试覆盖摘要/懒加载、批量导入单 IPC、批量导出单查询、旧数据安全迁移、跨项目迟到响应、默认
折叠与搜索祖先、确定性命名、共享 Second Panel 关闭语义、Host 路径边界、symlink 忽略、原子导出、
事务回滚、层级/连接约束和递归删除。真实 WebView 文件选择器、超大目录压力、Windows/macOS/Linux
文件权限与可视拖放验证进入延期验证清单。

## Phase 145 增量：签名 JDBC/Maven 依赖获取

对照 DBX `8be503bf4` 的 `crates/dbx-core/src/jdbc.rs`、`src-tauri/src/commands/plugins.rs` 和
`DriverStoreDialog.vue`，Oxide 为正式 Java driver package 补齐在线依赖交付，但不把 DBX 的任意坐标、
任意自定义仓库直接暴露给 renderer：

- 签名 catalog entry 可声明最多 64 个依赖；每项固定 Maven 坐标、package 内 classpath 路径、下载
  URL、精确大小、SHA-256、SPDX license 和 HTTPS license URL。单项限制 128 MiB、合计 256 MiB。
- Maven 坐标只接受固定版本的 3/4/5 段 GAV/JAR/classifier 形式，拒绝 `LATEST`、`RELEASE`、
  `*-SNAPSHOT` 和非 JAR packaging；下载 URL 必须是 Maven Central allowlist 上与坐标精确对应的
  `/maven2/<group>/<artifact>/<version>/<artifact>-<version>[-classifier].jar`，不接受 redirect、
  query、fragment 或凭据。
- catalog dependency 必须逐项匹配独立签名 package manifest 的 Java classpath path 与 digest；native
  package、缺失 classpath 或 digest 不同均在依赖下载前失败。package 自带同路径 JAR 时也必须满足
  catalog 的精确大小和摘要，不能以归档内容覆盖受审依赖。
- 依赖以 SHA-256 命名进入全局缓存；已有完整文件在复制前重算摘要，污染缓存会删除。续传只接受与
  当前 offset 和签名总长完全一致的 206 `Content-Range`，200 安全重启，416 仅在 partial 已完整且
  摘要正确时发布；流式写入不能超过签名大小，完成后同步、摘要复验并原子 rename。
- 安装下载与缓存清理复用 registry 的异步互斥，避免清理正在写入的 partial。清理仅删除 dependency
  cache 根下 64-hex 摘要命名的普通 `.jar`/`.jar.partial`，未知文件、目录和 symlink 保留；已安装
  package 持有自己的验证副本，不依赖可清理缓存。
- Driver Manager 在签名发行条目内按需展开依赖数量、总大小、坐标、classpath 位置和许可证链接；
  renderer 只展示签名返回值，不能覆盖 dependency URL、digest 或 repository。

Rust 回归覆盖仓库 allowlist、坐标/URL 绑定、动态版本、packaging、SPDX、体积和重复路径，Java
manifest 绑定、归档内污染、缓存复用/污染/保守清理、Content-Range 与真实 loopback 断点续传；
前端 typed Tauri boundary 保留完整依赖和许可证元数据。真实 Maven Central、企业代理、网络中断、
磁盘不足、Windows 文件占用以及正式 Oracle/SQL Server 等签名 JDBC package 发布记录为延期验证。

## Phase 146 增量：外置 Driver Runtime 恢复与脱敏事件账本

对照 DBX `8be503bf4` 的 `crates/dbx-core/src/driver_runtime.rs` 和 `DriverStoreDialog.vue`，Oxide 在
保留 connection-owned sidecar 隔离边界的前提下补齐运行时恢复：

- `DatabaseDriver` 新增只对外置 runtime 生效的 reconnect hook。`ExternalDriver` 仅在子进程已经退出时
  使用当前内存中的已验证 package 与连接配置重新握手、连接、读取 server version 并刷新 runtime
  capabilities；健康进程返回 no-op，不能通过 Driver Manager 被停止或重启。
- Driver Manager 以精确 driver + package version 触发恢复，Host 再次枚举当前连接，只处理
  `external_runtime_is_healthy() == Some(false)` 的项目。每批最多 32 个，同一连接滚动 5 分钟窗口最多
  3 次尝试；恢复命令全局串行，阻止重复点击形成并发 crash loop。
- 恢复失败不把 sidecar、JDBC 或数据库错误返回 renderer，也不会把已退出 handle 清成“未知”；它继续
  显示 exited，供预算窗口后的人工重试。成功后才记录新 launch 并清除当前退出 observation。
- MetaStore 新增最多 256 行、180 天保留的 package-level telemetry。只存 driver/package、固定事件码、
  启动/退出/重连成功/失败/预算阻断计数及时间戳；schema 明确没有 connection id、URL、stderr、SQL
  或 message 字段。乱序事件只累加计数，不允许 last-event 时间倒退。
- Driver Manager 展示累计退出和重连成功/尝试数，只在存在 exited runtime 时显示恢复入口；达到预算
  后禁用入口并说明 crash-loop 限制。公开 API 返回聚合计数和固定 `process-exited` 原因，不返回连接身份。

Rust 回归覆盖成功恢复、失败计数、第四次预算阻断、跨 `ConnectionManager` 实例的持久计数合并、
telemetry schema 禁止敏感字段和非法 package identity；前端 typed Tauri boundary 覆盖精确包恢复。
真实外置 sidecar 强制崩溃、握手失败、重连中应用退出、32 连接压力和 Windows PID/文件占用验证延期。

## Phase 147 增量：关闭标签后的查询结果与元数据世代释放

对照 DBX `81c3cc15d` 的 `queryStore.ts`、`objectBrowserRowsCache.ts` 和
`dataGridFilterBuilderPersistence.ts`，Oxide 按 Zustand/React 生命周期补齐等价资源回收：

- 关闭、批量关闭或丢弃项目文件标签时，先为最近关闭历史建立不含结果集、原始响应、执行状态、
  Explain Plan、游标和未提交表格草稿的轻量快照，再清空仍可能被卸载中 DataGrid 引用的结果对象。
  重新打开标签保留 SQL、连接和编辑器上下文，但不会把已关闭的大结果重新带回内存。
- 活动查询随标签关闭按 query id 去重取消；MongoDB、Elasticsearch 等文档分页游标仍按原有连接范围
  释放。所有关闭入口和项目目录切换的丢弃入口使用同一释放路径，避免只修复单标签关闭。
- 通用 `MetadataCacheGenerationRegistry` 从无界 scope Map 改为 512 项有界 LRU。世代值使用全局单调
  令牌，scope 被淘汰后重新出现也不会与早期在途请求的令牌碰撞，旧响应不能重新发布缓存。

前端回归覆盖结果对象原位释放、最近关闭标签轻量化、重新打开不恢复结果、scope 上限、LRU 刷新和
淘汰后旧世代拒绝；331 个测试文件、1,759 项测试以及生产前端构建均通过。真实 WebView 下关闭超大
结果时的堆快照、驱动取消延迟和浏览器 GC 时序记录为延期验证。

## Phase 148 增量：大规模迁移对象列表虚拟化

对照 DBX `affcb7fa7` 的迁移对象列表窗口化实现，Oxide 的数据库/表迁移流程不再为超大源表或
schema 对象清单一次性创建全部 React 节点：

- 源表清单和 schema 对象分组超过 200 项后切换为固定 24px 行高的窗口渲染，前后各保留 8 行
  overscan；滚动容器只挂载当前可见窗口，完整选择状态仍保存在原有 Set 中。
- 窗口计算会约束负数、过期和超过末尾的 scrollTop；筛选、切换连接或列表缩短后重置滚动位置，
  不会因为旧偏移显示空白内容。
- 小列表保留普通 DOM，避免为日常迁移增加额外滚动层；虚拟化只改变展示成本，不改变数据库级、
  schema 级和表级迁移的预览、选择、审批或执行语义。

纯模型回归覆盖 50,000 项窗口上限、overscan、列表缩短后的偏移约束和非法尺寸。真实 WebView 的
超大对象滚动、键盘/触控选择与不同 DPI 行高记录为延期验证。

## Phase 149 增量：带引号标识符补全与数据库执行路径复核

对照 DBX `9b4f94cbb`、`9c90edabe` 和 `b198dd132`，Oxide 补齐 Monaco 缓存回退路径中最后一个
带引号标识符边界，并复核数据库侧相关差异：

- 双引号、MySQL 反引号和 SQL Server 方括号内的未完成 table/column 前缀作为一个 replacement
  fragment；接受建议时从 opening delimiter 开始替换，自动转义名称中的 delimiter 并补齐闭合符。
- 光标后已经存在闭合符时，replacement range 会一并消费该字符，因此不会生成重复引号；完整闭合
  标识符不会被误判为新的未完成前缀。relation、CTE/derived column 和物理 column 使用同一逻辑，
  join 生成器继续使用其驱动感知的完整 SQL 片段。
- PostgreSQL `WITH ... UPDATE/INSERT/DELETE` 已由 `effective_statement_kind_with_offset` 解析 outer
  statement；无 `RETURNING` 走 affected-row execute，有 `RETURNING` 才 fetch rows，且已有 Rust 回归。
  CTE 补全也只暴露声明/推导列，不加载同名物理表，因此 DBX 对应修复在 Oxide 已等价覆盖。
- DBX 的 Elasticsearch `from + size <= 10000` 修复在 Oxide 的 PIT + `search_after` 主路径及受限 offset
  fallback 中已覆盖；Oracle 查询执行不做 DBX 曾有的阻塞索引/主键预取，因此一秒 metadata preflight
  限制不适用于 Oxide 的执行路径。

单元测试覆盖未闭合/已有闭合/已完整闭合标识符、转义前缀和 replacement range。真实数据库标识符、
输入法组合事件及各驱动 LSP/Monaco 建议合并顺序仍按既定策略延期到逻辑全部完成后验证。

## Phase 150 增量：MySQL 循环外键迁移的部分完成回执

对照 DBX 的 MySQL 后置外键恢复能力并修复 Oxide 自身事务语义，MySQL schema-object transfer 不再把
会隐式提交的 `ALTER TABLE` 当作可回滚事务步骤：

- 单表和多表行写入先在明确的目标事务中完成并提交；只有 commit acknowledgement 成功后才开始
  schema DDL。普通 constraint/index 保持审阅顺序，跨表 FK 统一最后执行。
- 每条 DDL 独立执行并累计到按表和全局的有界 receipt。首个失败立即停止，后续 DDL 不执行；取消若在
  行提交后到达，同样产生 partial receipt，不能把已经提交的数据描述为已回滚。
- partial receipt 只包含总语句数、成功数和固定指导，不记录 SQL、参数、行值或数据库错误。终态报告
  标记 `manualReviewRequired`；历史 Retry setup 不再可用，用户必须先检查目标索引/约束，再手工发起
  全新的预览和确认。
- 循环 FK 仅在每条环内约束都已证明目标不存在、精确 catalog DDL 已绑定确认 token、且恢复选项明确
  开启时开放；冲突、缺失 metadata、外置 package 或其他产品继续 fail closed。PostgreSQL 原有同事务
  恢复路径不变。

Rust 回归覆盖完整/失败/取消回执、首错停止、逐表成功计数、错误脱敏和旧报告默认策略；前端回归覆盖
legacy/fresh report 可重新预览以及 manual-review report 禁止便捷重试。真实 MySQL/MariaDB 隐式提交、
权限失败和断连恢复记录到延期验证。

## Phase 151 增量：SQLite 改名目标的 catalog DDL 保真迁移

Oxide 的 native SQLite→SQLite 新表迁移不再要求源与目标 schema/table 名完全一致；改名和 attached
schema 目标现在继续使用 catalog-backed table/index definition，而不是退化为仅列定义：

- Host 仍先验证 `sqlite_schema` 返回的是单条、括号平衡、引号/注释闭合且 table option 受限的
  `CREATE TABLE/INDEX`，然后从冻结的目标 endpoint 重建对象身份，不复制 catalog 内的对象名前缀。
- 表改名时使用有界词法扫描，只在真正的 `REFERENCES <identifier>` token 上将源表自引用重写为目标表；
  字符串、quoted identifier 内容、注释和其他表的 FK 不修改。SQLite 不支持可移植的跨 attached-schema
  FK，遇到 schema-qualified target 直接阻断，不猜测语义。
- 表名未改变时结构后缀保持逐字不变；表名改变时显式索引保留 expression、sort/filter 等结构，并使用
  `<target-table>__<source-index>` 的确定性名称，避免同连接同 schema 复制时与源索引冲突。Host 在预览期
  查询目标 index namespace，任何冲突都会阻断计划。
- 最终 table/index statements、目标 identity 和列映射共同进入确认 token；创建仍在一个目标事务中执行，
  任一语句失败整体回滚。trigger、virtual-table implementation object 和既有目标表 rebuild 仍不开放。

Rust 回归覆盖同名定义逐字保持、改名 self-FK 重写、外部 FK/字符串隔离、qualified target 拒绝、表达式
索引改名，并在内存 SQLite 上实际执行改名后的 table/index DDL。真实 attached database、复杂 Unicode
identifier、外键开启状态、索引命名冲突竞态和大 catalog 验证进入延期清单。

## Phase 152 增量：PostgreSQL 与 MySQL 的可证明 schema-object 转换

对照 DBX `transfer.rs` 的结构化 PostgreSQL index/FK 和 MySQL deferred-FK 路径，Oxide 不再把 native
PostgreSQL↔MySQL 的全部二级对象恢复关闭，也不直接执行另一产品的 catalog DDL：

- 单表和多表迁移可在两个 native family 间开启 schema-object restore。Host 只从 `IndexInfo`/
  `ConstraintInfo` 结构化字段生成目标方言 SQL；源 `definition` 不进入目标 SQL，但最终生成的语句、
  metadata 和目标 baseline 仍共同绑定确认 token。
- 当前可转换闭集为普通 BTREE index、无附加语义的 UNIQUE constraint，以及列映射、引用表/列和
  ON DELETE/UPDATE 动作完整的 FK。目标表列和 FK 引用列在预览时重新读取并验证，foreign key 最后执行。
- CHECK 原表达式、expression/partial/include/comment/non-BTREE index、PostgreSQL `NULLS NOT DISTINCT`、
  deferrable/initially/not-valid/match 等未被结构化协议完整表达的语义一律 fail closed，不以“相似 SQL”
  代替等价性。
- MySQL index metadata 额外读取 key 数量语义：functional key、prefix length 和 descending key 均标记为
  不能从普通列名恢复。共享 DDL planner 也检查该 provenance，避免同产品恢复路径静默生成较弱索引。
- 目标为 PostgreSQL 时恢复仍属于目标事务；目标为 MySQL 时沿用 Phase 150 的 commit 后逐语句执行、
  部分完成 receipt 和 manual-review retry block。前端只对 native PostgreSQL/MySQL family 显示入口，
  并明确区分 same-product exact review 与 cross-product portable review。

Rust 回归覆盖 PostgreSQL→MySQL 的 BTREE/UNIQUE/FK 目标 SQL、源 dialect DDL 隔离、FK action/schema
mapping，以及 expression index、CHECK、`NULLS NOT DISTINCT` 的精确阻断；前端纯模型覆盖双向 family
入口、外置 package/SQLite/改名目标禁用和审阅文案。真实 PostgreSQL/MySQL/MariaDB 多版本、NULL 唯一
语义、functional/prefix/descending index 和 post-commit failure 仍进入延期验证清单。

## Phase 153 增量：SQLite 既有表的受控重建执行

Oxide 将既有的 SQLite rebuild 审阅产物收紧为可执行闭集，并补齐不能由普通 SQL Console 保证的
备份、事务和外键边界：

- live snapshot 读取 `sqlite_schema` table definition 作为目录完整性证据。只有 metadata 完整、目标是
  existing-table modify、所有数据都可从同名源列复制，且不含当前结构化协议无法精确保留的高级表/
  索引语义的计划进入 Host 执行；目录定义缺失、catalog-only 高级 drift、新增必填且无 default 的列、
  create/drop、view 和产品对象继续 review-only/blocked。
- rebuild 作为一个 relation-level change 绑定 target fingerprint、review/destructive approval 与动态确认
  短语；临时表、复制、drop、rename 和索引语句不包含 renderer 可改变的 PRAGMA 或事务控制。
- 本地与 SSH SQLite 驱动独占 file-operation 边界，确认没有命名事务后暂停 FK，创建经完整性校验的
  迁移前备份，再以 `BEGIN IMMEDIATE` 执行全部语句及 `foreign_key_check`。失败请求 rollback，结束后
  恢复进入操作前的 FK 状态。
- 内存数据库在取得独占连接且尚未加写锁时备份；文件数据库与 SSH worker 则在写锁保护下从第二个
  只读连接捕获最后提交快照，既避免同连接 online-backup 的 `database is locked`，也阻止并发写入
  穿过备份与迁移之间的窗口。
- verified backup 的路径、大小和 integrity receipt 写入持久 migration journal。异常发生在可能已提交
  的阶段时只标记 verification failed，要求重新捕获 live target，不声称已自动回滚或允许历史重放。
  rebuild SQL 不能通过“Open in console”旁路安全执行器。

Rust 回归覆盖 planner/catalog fail-closed、复合 FK 顺序/action metadata、内存成功、FK 失败回滚、本地文件独立 snapshot connection 和 worker
在 `BEGIN IMMEDIATE` 下的 committed snapshot。真实 WAL、并发进程、磁盘不足、commit/SSH 断连、远程
下载与多平台恢复按用户要求留在统一延期验证队列。

## Phase 154 增量：DBX `d4d3995be` 上游复审

以 DBX `d4d3995be`（2026-09-02 本地参考仓库 HEAD）重新审计 `d69cf9da7..d4d3995be` 的
产品变更。该区间的实际能力差异不以提交数量计数；每项均以 Oxide 当前可达代码路径、测试或明确的
交付前置条件为准：

| DBX 变更 | Oxide 结论与可追溯证据 | 状态 |
| --- | --- | --- |
| `1f274c57e` Explorer `Cmd/Ctrl+R` refresh | `src/lib/keybindings.ts:isExplorerRefreshShortcut`、`SchemaSidebar.tsx` 和 `keybindings.test.ts` 已按焦点/输入框/IME 边界接管。裸 `F5` 仍可用。 | 逻辑对齐；真实各平台 WebView reload 抑制延期。 |
| `5d6f66777` MySQL transfer 防止静默丢列 | 所有 transfer plan 在执行前经过 `commands/table.rs:build_data_transfer_column_mapping`；目标缺少任一源列即明确失败，错误文本与 Rust 回归锁定“不静默丢弃”。 | 已对齐。 |
| `600af8753` INSERT SELECT inlay hint | Phase 100 已覆盖语法；Phase 154 前的 `76c0ba80`/`3ed486ee` 进一步修正超过 viewport 的 PostgreSQL dollar-quoted routine。扫描按 64 KiB chunk 有界，且按 Monaco model version/visible range 缓存，不会为了找到 opening tag materialize 整份文档。 | 已对齐；真实多方言 metadata/Monaco 布局延期。 |
| `e9a90173a` SQL file schema restore / `c4cdcbc48` save target 文案 | `projectSqlFileTarget.ts`、`useTabStore.ts` 和 `editorSaveTarget.test.ts` 保留 project SQL 文件的 connection/database/schema 目标；保存提示只反映当前实际目标。 | 已对齐。 |
| `6588f27fb` 单独 SSH tunnel test | `core/ssh.rs:test_ssh_tunnel` 由 `commands/connection.rs`、Tauri command 和 `ConnectionForm.tsx` 的独立入口调用；probe 不依赖数据库连接。 | 已对齐；真实 SSH server/host-key/auth 组合延期。 |
| `333c3a3f4` DML readonly preview、`55611706b` Redis bounded preview、`e43e36e7a` Elasticsearch `_shard_doc` fallback、`264f5c483` InfluxDB 3 | 分别由 `core/dml_preview_sql.rs`、`drivers/redis.rs`、`drivers/elasticsearch.rs`、`drivers/influxdb3.rs` 提供并已有 fixture/unit coverage；详见本矩阵 Phase 相关条目。 | 已对齐；真实服务版本矩阵延期。 |
| `19be19472` / `440c41f5b` / `8f21e7af9` SQL Server CTE/temp-table/result-column 修复 | Oxide 的产品目录可以显示 SQL Server 候选，但 native/JDBC SQL Server runtime 尚未作为签名 package 交付；因此不存在可安全修补却未修补的执行路径。不得以 generic fallback 假装支持该产品。`D04` 继续要求签名 manifest、runtime handshake 和 conformance fixture 后才开启。 | 明确未交付，受运行时前置条件阻断。 |
| `6a7ea4ae9` Jalapeno Cloud partner preset | 这是 DBX 的商业身份、Referer、品牌资产与服务条款，不属于可复制的技术能力；Oxide 已有独立 OpenAI-compatible/Codex CLI/CodeBuddy CLI provider。 | 有意不迁移。 |

因此，本轮没有发现需要凭猜测新增的 DBX 逻辑。下一轮工程工作应集中在已登记的正式外置驱动包与真实服务
验证，而不是为 SQL Server 等尚未可用 runtime 增加不可达的前端/解析分支。所有真实数据库、SSH、WebView
和 70+ 驱动矩阵验证仍统一保留在 `dbx-alignment-deferred-validation.md`，不得将上述静态/fixture 回归表述为
实库验收。

## Phase 155 增量：多结果集本地 Grid 筛选隔离

复审 DBX `cb754cd0c` 后发现 Oxide 的 query tab 虽已有本地列筛选和排序，但它们此前挂在 tab 单例
`gridState` 上：一个多语句查询在 Result 1 设定筛选后切换到 Result 2，会错误复用该条件。现改为：

- query tab 把轻量 `columnFilters`/sort state 按 active result index 保存到 `resultGridStates`；不复制 rows、
  columns 或 backend payload，因此关闭 tab 的 runtime payload 释放和内存上限不受影响。
- 切换结果集先冻结离开结果的 presentation state，再恢复目标结果状态；从未筛选过的结果不分配空对象。
  关闭一个结果集时，后续 result index 的状态同步左移，当前可见结果恢复对应筛选，避免索引错位。
- 新一次 query execution 清除旧 result state，防止不同 SQL 的筛选条件意外落到新结果上。table tab 保持既有
  server-side sort/filter 行为，不混入 query-local state。

`useTabStore.organization.test.ts` 覆盖跨结果集隔离、关闭中间/当前结果后的索引重映射；前端 production
build 已验证 TypeScript 和 bundle。真实 Grid 交互（虚拟滚动、键盘筛选菜单、WebView 焦点）仍按统一延期
清单执行。

## Phase 156 增量：按需 Vim 运行时不再阻塞开发冷启动

构建审计确认 `monaco-vim` 通过 `lib/vimMode.ts:attachVimMode` 的动态 import 保持为独立 production
chunk，用户未启用 Vim 时不进入 workspace startup graph。此前 Vite 的 `optimizeDeps.include` 又强制在每次
开发服务器冷启动预构建该多 MiB 依赖，造成不必要的首开工作；现将它移出显式预构建清单：

- 普通 Tauri/Vite 开发首开只预处理默认互动工作台依赖；首次启用 Vim 时才解析其已有动态 import。
- production bundle 仍由 `npm run build` 验证：`monaco-vim` 未合并进 startup module，bundle verifier 保持
  单一 startup module 和无静态 import cycle。
- 此变更不改变 Vim 功能、用户设置或 production 代码拆分；真正的 Vim 首次启用延迟仍应在 packaged
  WebView 性能矩阵中实测，而不是用本机构建耗时替代。

## Phase 157 增量：仅遮罩正在执行的查询结果集

对照 DBX `f19439ad7`，Oxide 原先把 query tab 的 `isExecuting` 直接用于整个 DataGrid：多结果集查询在
执行期间切换到另一份已完成结果也会被 loading overlay 遮住。现引入瞬态 `executingResultIndex`：

- 查询开始时冻结当前 active result index；Grid 的 `aria-busy`、空态和 busy indicator 只在 active index
  与该值相同时显示。用户可在同一执行期间查看其他已完成结果，编辑仍由原有 `isExecuting` 门禁禁止。
- 成功、错误、取消和连接恢复被中止时都会清理该索引；新执行替换 results 后也清理，避免旧 execution
  identity 泄漏到下一次结果集。
- table tab 继续遮罩唯一的 live table-data surface；旧持久化/in-memory tab 没有该字段时保持保守遮罩，首次
  新执行后即迁移到精确行为。

`queryResultLoadingState.test.ts` 覆盖 query index matching/mismatch、table 与 legacy fallback；production
build 验证 DataGrid 选择器和 TypeScript。真实 WebView 下并行切换、焦点和动画继续进入延期矩阵。

## Phase 158 增量：危险 SQL 的可恢复应用内确认

对照 DBX `70d7a78c6` 与 `694611aad`，Oxide 原先由同步 `window.confirm` 决定危险 SQL 是否执行；它无法
参与桌面 Dialog 的焦点生命周期，也无法在连续确认时隔离已关闭窗口的 autofocus 回调。现改为：

- `DangerousSqlConfirmDialog` 显示明确风险说明、取消与 destructive execute 操作；关闭、Escape、遮罩点击和
  取消都拒绝该次执行，只有明确 Execute SQL 才解析为批准。
- Query Editor 给每个 pending confirmation 分配 generation；关闭默认 autofocus 被抑制，下一 animation frame
  只有在没有新的 pending confirmation 且 generation 仍匹配时恢复 Monaco focus。因此先关闭再打开第二个确认时，
  第一个 Dialog 的延后回调不会劫持第二个 Dialog 的焦点。
- 全文运行、当前 statement、参数编译 SQL 与 History rerun 都通过同一 `boolean | Promise<boolean>` gate；执行租约
  在确认期间已占用，重复快捷键不会开多个确认或抢先下发 query。参数窗口仅在批准后关闭，取消时保留用户填写值。

`DangerousSqlConfirmDialog.test.tsx` 覆盖明确 Execute/Cancel 决策，
`useQueryExecutionController.test.tsx` 覆盖 async confirmation 未批准前不 dispatch。`npm run build` 通过；真实
Tauri WebView 下的滚动、选区和 reduced-motion 动画仍在延期验证清单中，不能以 happy-dom 取代。

## Phase 166 增量：有界 Query Result Run 历史

对照 DBX `queryStore.ts` 与 `tabResultCache.ts` 的 result run 模型，Oxide 原先只保存当前 query execution；重新运行后，
之前的结果只能从 Query History 再执行。现增加轻量的当前会话 result history：

- 一个 Query tab 最多保留五个普通 run 与三个明确固定的 run。每个 run 只引用既有 `QueryResult` 对象，不复制
  rows/columns/raw response；普通 run 超出上限时遗忘最早的引用，固定入口有独立上限，避免把“保留”变成无界内存。
  关闭 tab 时所有引用仍进入现有单次 payload release，closed-tab history 与应用重启均不保留结果。
- Results 面板在多个 run 时显示紧凑 Run selector，切换会投影该 run 的 results、SQL、active result index 及 local
  filter/sort state；关闭 run 自动选择相邻 run，关闭最后一个则清空结果 surface。
- execution loading identity 从单独 result index 升级为 `runId + resultIndex`。用户在执行中打开同编号的旧 run 时不会被新
  execution 的 loading mask 遮住；legacy tab 没有 identity 时仍保守遮罩。

`useTabStore.organization.test.ts` 覆盖 run projection、固定、状态保留、相邻回退与 payload reference identity；
`queryResultLoadingState.test.ts` 覆盖跨 run loading isolation，`npm run build` 已通过。DBX 的 pin、磁盘 cache、
跨重启恢复与 session-backed payload eviction 属于后续独立容量/恢复工程，当前不伪装成已实现。
