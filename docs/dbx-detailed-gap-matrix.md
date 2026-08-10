# OxideStudio 与 DBX 详细差距矩阵

> 审计基线：2026-08-10
> DBX 参考提交：`27f3ea728`
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
| D07 | 逻辑已对齐：下载断点续传与缓存回收 | DBX driver store/install UI 与 agent artifacts | 摘要绑定的 `.partial` 文件支持严格 HTTP Range 续传；206 必须精确延续 offset，200 自动安全回退全量，416 仅在完整摘要匹配时发布；最终 SHA-256 复验后原子进入缓存。Settings 可清理归档缓存，后端串行化下载/清理，仅删除 64-hex 摘要命名的普通文件，并保留 active、previous、connection-pinned 与 live-sidecar 版本；未知内容和符号链接不递归触碰 | 延期在真实 CDN/代理下验证 206/200/416、中断恢复、错误 Content-Range、摘要不匹配与 Windows 文件占用；不连接数据库。 |
| D08 | 已对齐：连接级事实源 | DBX `connectionStore.ts`、`connectionDatabaseInfo.ts` | `get_connection_database_capability_context`；`LiveConnectionCapabilitySnapshot` | package、server version、capability 和 migration mode 必须来自同一 live driver 实例。 |
| D09 | 部分对齐：复杂连接参数 | `lib/connection/oracleTnsConnection.ts`、`postgresTlsMode.ts`、`hiveKerberosOptions.ts`、`damengSslOptions.ts` | SSH、SSL、URL 与常用连接字段已支持 | 按产品包声明结构化字段；Oracle TNS、Kerberos、代理、集群地址需逐产品实现并脱敏持久化。 |
| D10 | 部分对齐：真实版本矩阵的证据门禁已落地，矩阵本身尚未覆盖 | `crates/dbx-core/tests/live_*`、各 `agents/drivers/*/src/test`、`.github/workflows/database-environments.yml` | `scripts/run-driver-conformance.mjs`、fixture/report schema、签名 catalog evidence binding；DuckDB v1.5.5 已完成本地 package 运行证据，尚未签名发布；其余真实数据库组合不足 | PostgreSQL/MySQL 最低/主流/最新；ES 6/7/8；Mongo/Redis；每个首发外置包至少两个 server 版本。 |
| D11 | 本阶段逻辑已对齐，真实兼容产品验证延期：PostgreSQL backend identity | DBX `crates/dbx-core/src/db/postgres.rs`（`a3cf5fe25`）将 PID/port 转为文本并以 fallible decode 避免兼容数据库连接崩溃 | native PostgreSQL driver 以 `CAST(pg_backend_pid() AS TEXT)` 归一化兼容产品返回类型并安全解析正 `i32`；无法读取、解析或超出范围时仅关闭该请求的 server-side cancellation tracking，正常查询不失败。active-query mutex poison 也恢复为可用 map，不再引发二次 panic | 延期在 CockroachDB/YugabyteDB/兼容代理等受控 fixture 验证原生、numeric/text-like、缺失和越界 PID；只有成功取得标准 PID 时才声明 cancellation evidence。 |
| D12 | 本阶段逻辑已对齐，真实兼容产品验证延期：MySQL scalar metadata 与 connection identity | DBX `crates/dbx-core/src/db/mysql.rs`（`195c88009`）只转换标量结果的第一列，忽略兼容服务端附加列 | SQLx `query_scalar` 原生只解码第一列，已结构性覆盖附加列问题；native MySQL driver 进一步以 `CAST(CONNECTION_ID() AS CHAR)` 归一化连接 ID 并安全解析正 `u64`。缺失、畸形或不兼容值只关闭该请求的 `KILL QUERY` tracking，正常查询不失败；active-query mutex poison 可恢复 | 延期在 MySQL/MariaDB/TiDB/OceanBase/兼容代理 fixture 验证附加列、numeric/text-like、缺失与畸形 ID；仅成功取得标准 ID 的组合声明 cancellation evidence。 |

## 3. SQL Editor、语义分析与 LSP

DBX 这一领域的核心不是独立 LSP，而是 CodeMirror + TypeScript semantic model。Oxide
应把其中的语义场景加入 bundled LSP/Monaco contract tests，不应把前端解析器原样搬入。

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| L01 | 已对齐：多语句/软边界 | `lib/sql/sqlStatementRanges.ts`；`lib/sql/semantic/tokens.ts` | Rust current-statement scanner、bundled LSP statement scope、前端 fallback | 无分号双 SQL、CTE、INSERT SELECT、EXPLAIN、过程体、引号和注释使用同一 fixture corpus。 |
| L02 | 部分对齐：完整 semantic model | `lib/sql/semantic/model.ts:308-427`、`references.ts`、`diagnostics.ts`；correlation columns、table function 与 SQL Server hint 解析位于 `model.ts:308-419` | bundled LSP + `src/lib/sqlAnalysis.ts` + cached completion；LSP local relation overlay 已覆盖 CTE 显式列/推导 projection、derived table projection、table function / `WITH ORDINALITY` 输出列、table/subquery positional correlation columns 与本地 shadow；解析器同时识别 JOIN 后的逗号 row source、LATERAL/APPLY 派生表与函数，并按需导入相关子查询引用的外层 alias，未限定列仍隔离在内层 scope；`catalog` 已从前端 metadata 配置保留到 Rust Schema，三/四段限定和 SQL Server `database..table` 会按 catalog + schema + table 精确消歧；SQL Server table hint 和真实 `lateral` 表名不会误判；UTF-16 cursor 仅在入口转换一次 | 继续扩大 alias/name collision、dialect quoting 和结构化意图 corpus；真实 metadata 验证延期。 |
| L03 | 本阶段增强：方言关键词、类型与内建函数 | `lib/sql/sqlCompletion.ts` 中 `DATABASE_SQL_KEYWORDS`、`activeFunctionSignatures`、函数 snippet 和 dialect sets | bundled LSP dialect registry、`databaseDialect.ts`、常用 command snippet 与方言内建函数目录。表达式位置现在主动提供带 tab stop 的函数候选；FROM/JOIN relation target、注释、字符串和限定列位置不会混入。实时 routine metadata 优先，同名旧硬编码候选被更完整的 signature item 替换；原始 product identity 保证 SQL Server/Manticore 等 compatibility parser 不误用 PostgreSQL 目录，单次最多补 100 项 | Oracle/DB2/Dameng 等长尾目录仍需基于产品/version fixture 扩大；generic JDBC 只取 portable common 集，不伪造 vendor 函数或诊断。 |
| L04 | 核心逻辑已对齐，真实版本验证延期：函数签名帮助 | `sqlCompletion.ts:getSqlFunctionSignatureHelp`、`findActiveFunctionCall`、per-dialect signature maps 与 `sqlCompletion.signature.spec.ts`；ClickHouse 参数化聚合见 `lib/sql/clickhouse/{regularFunctions,aggregateFunctions}.ts` | bundled LSP 现在以实时 routine metadata 为第一事实源；缺失时回退到 DBX 同类的 common/PostgreSQL/MySQL/SQLite/SQL Server/Manticore 内建签名目录，并覆盖关键 ClickHouse 普通/参数化函数。调用扫描会屏蔽注释、转义/美元字符串和 quoted identifier，支持嵌套、限定/Unicode 名称及 ClickHouse 多参数组；overload 按当前参数槽可接受性稳定排序，可选参数在签名中显式显示。扫描限定 64 KiB、返回最多 50 个 overload，已知 server version 会门控已声明最低版本的内建函数 | 延期用真实 PostgreSQL/MySQL/SQLite/SQL Server/ClickHouse metadata 验证 overload/default/variadic 还原与版本边界；继续从 DBX ClickHouse registry 扩大长尾静态签名，但静态目录不得覆盖实时 metadata。 |
| L05 | 部分对齐：对象/列补全 | `lib/sql/sqlCompletion.ts:1398-1401,3503-3521` 的 relation alias item、`lib/sql/semantic/completion.ts:102-113` 的 `aliasSql`，以及最新 `868f7961e` 的 `sourceQualifierSql`/多源列修复；另见 `lib/metadata/completionTreeIndex.ts`、`lib/common/pinyin.ts`、`lib/common/completionMatch.ts` | LSP schema sync 与 metadata cache 现在合并而非互斥；对象、列和 FK JOIN 支持 Unicode identifier、拼音首字母、camel/fuzzy 排序。临时表/CTE/derived/table-function/correlated relation overlay 会按 SQL 局部形状覆盖同名远端对象；partial correlation names 与剩余 metadata 列按位置合并。跨 catalog 同 schema/table、四段 SQL Server 名称与 `database..table` 已有精确 contract，错误 catalog 不会复用列 metadata。relation alias 与 `alias.column` 列候选现在都同时保存规范名和原始 SQL 拼写：label 保持易读、裸列名保持可过滤，insertText 精确保留双引号/反引号/方括号和大小写；相关子查询只导入实际被限定的外层 alias，且不增加第二次 parser pass。多源 `SELECT *` 已按 alias 展开全部来源列 | 仍需更广 alias/name collision 与 dialect quoting corpus；真实中文 metadata 验证延期。 |
| L06 | 本阶段增强：INSERT values hints/snippet | `lib/sql/insertValueHints.ts`、`codemirrorInsertValueHints.ts`、`lib/sql/sqlCompletion.ts` | 显式列清单继续提供 Monaco inlay；空列清单 `INSERT INTO t (` 由 bundled LSP 基于 metadata 生成两级 `VALUES` snippet/tab stops。语句起始输入 `in…` / `ins…` 时，LSP 还会按当前 schema 直接生成每张具体表的完整多行 INSERT 代码块，分别提供“必填可写列”和“全部可写列”，字段名与 value tab stop 一一对应。两条路径都排除 auto-increment/identity、generated 和 view；单次最多 32 张表、每表 64 列，避免大 catalog 放大补全体积。PostgreSQL/MySQL/SQLite 复用驱动精确 generated-column 探测，探测失败时安全抑制；保留字、大小写和非 ASCII 标识符按基础方言引用；覆盖 PostgreSQL/MySQL/SQLite/DuckDB/Hive/ClickHouse 及 compatibility aliases | 待统一验证：三类原生数据库真实 metadata、identity/generated/default 组合、Monaco 表级代码块筛选/Tab 导航及更广方言语法；按既定顺序留到全部逻辑迁移完成后执行。 |
| L07 | 逻辑已对齐：跨 console symbol/reference index | `lib/sql/semantic/references.ts` 和本地 semantic fixtures | 已同步项目 SQL 文档进入按内容缓存的有界 symbol graph；table/view/function/procedure DDL 提供 document/workspace symbol 和 metadata 缺失时的 definition fallback，物理 relation/routine usage 支持同 schema/项目的 references 与安全 rename。注释、字符串、无关同名列不进入图；CTE rename 保持单文档作用域；quoted/UTF-16/SQL Server `database..table` 范围和 `includeDeclaration` 有协议测试。单文档 512 KiB、256 文档、10,000 occurrence、2,000 result 为 LSP 硬上限，renderer 的 128 文件/128 KiB/5 MiB 同步上限更严格 | 延期用真实大项目验证缓存命中、超限降级、重复 migration definition 选择及 PostgreSQL/MySQL/Hive/ClickHouse 方言行为；同步集合之外不做隐式磁盘扫描。 |
| L08 | 本阶段已对齐并澄清：比较值类型模板 | `sqlCompletion.ts:buildComparisonValueItems`；DBX 当前根据列类型提供 NULL、字符串、数字和布尔模板，并不查询真实行样本 | bundled LSP 的 `dialects/common.rs:add_column_value_items` 在操作符、`IN (` 后从当前 metadata 列类型生成带 tab stop 的安全模板；覆盖 text/numeric/boolean/date/time/timestamp/UUID/JSON，并保留最多 64 个 ENUM/SET 声明域值。PostgreSQL、MySQL、SQLite、Hive、ClickHouse 在 WHERE/HAVING/JOIN ON/UPDATE SET 共用该逻辑；类型歧义时只返回始终安全的 NULL，不读取、缓存或传输真实行值 | 用真实 metadata 验证 vendor type spelling；若以后增加真实值采样，必须是独立显式 opt-in capability，限定列/行/字节并禁止无条件送入 LSP 或 Agent。 |
| L09 | 已对齐：常用命令 snippet | `lib/sql/sqlSnippetTemplates.ts`；`sqlCompletion.snippet.spec.ts` | `features/query-editor/model/sqlCommandSnippets.ts` | 按产品选择 LIMIT/TOP/ROWNUM/FETCH/ROWS、DDL 与 mutation 语法；接受历史按连接排序；补全行直接展示 trigger，支持 descriptive initials/fuzzy 查找。 |
| L10 | 本阶段增强，真实 provider 验证延期：补全触发、展示、插入与惰性解析 | `lib/sql/sqlCompletionTriggerPolicy.ts`、`sqlCompletion.ts:shouldChainSqlCompletionAfterAccept`、`components/editor/QueryEditor.vue:markCompletionAccepted`、`lib/editor/sqlCompletionPresentation.ts`、`sqlCompletionInsertion.ts` | 三种触发模式、语义门控、usage ranking 与 snippet insertion 保持原链路；端到端保留 Completion 协议。client 现声明并实现 `completionItem/resolve` 的 documentation/detail/additionalTextEdits 子集，记录 server `resolveProvider`，opaque `data` 原样往返；只给真实 server 候选附加 resolve identity，context adapter 的对象 spread 仍保留它，语法/cache fallback 不会误发。bundled LSP 同时声明 resolve，并仅在 client 显式支持 documentation resolve 时移除首包文档；8,192 项/4 MiB FIFO cache 与 256 KiB 单文档门限限制内存和协议体积，原始 data 可恢复，淘汰/未知 identity 仍保留可用候选。bridge resolve item 上限 256 KiB，owner/cancellation 门禁阻止迟到结果。documentation 的 Markdown/plaintext 类型不再丢失，Markdown 禁用 trusted command/HTML。server text edit 保持权威；接受 `schema.` 或 SQL Server `USE ` 后在当前 owner/scope 内重开下一层候选；`Variable` 候选不误追加空格 | 延期以真实 Monaco + 大 catalog 验证 resolve 重启/淘汰、incomplete 重触发、insert/replace 接受边界、代码块缩进、文档渲染、quote policy 和多层 schema/table/column 链；在超大文档验证有界触发扫描。 |
| L11 | 部分对齐：结构化编辑 intentions | `lib/editor/sqlIntentionActions.ts:34-820`、`queryEditorTextEdits.ts`、`sqlInListPaste.ts`、`sqlQuoteCaret.ts`、`lib/sql/semantic/completion.ts` | 已有格式化、危险语句 guard、Unicode quote/unquote identifier 和 clipboard→IN-list；星号 action 已可将单表、多表及 `alias.*` 按 metadata 展开。单字段 qualify/unqualify 与选区 batch qualify 已进入 bundled LSP：只使用当前位置 schema/CTE metadata，歧义时提供多候选或拒绝取消限定，批量编辑只改唯一可归属字段，保留 PostgreSQL 双引号/MySQL 反引号并跳过函数、别名、注释和字符串。普通 lightbulb 请求不再先格式化整份文档 | DBX 当前 identifier intentions 已对齐；仍需 JOIN/WHERE 重写 preview、generated/hidden 列策略以及更复杂的结构化多光标编辑。 |
| L12 | 主路径已对齐：编辑器模块边界 | DBX `components/editor/QueryEditor.vue:791-924` 将 execution request 编排建立在 `lib/sql/sqlExecutionTarget.ts` 上 | 命名事务、query/explain/parameter execution、文件 workflow、LSP virtual-document lifecycle 与稳定协议 provider coordinator 已独立。metadata-sensitive relation/field/FK JOIN fallback、Monaco viewport/selection、current-statement decoration 和 Console auto-suggest 均有独立 lifecycle；滚动 rAF 合并、offset 有界夹取、authoritative range cache、45ms Console 合并与 stale model/version gate 不再由组件持有。owner key 继续拒绝跨连接/schema/LSP 状态/设置边界的迟到结果；`QueryEditor.tsx` 约 3,253 行 | 已识别 lifecycle 拆分完毕；补真实 Monaco/provider 组合验证，组件测试继续避免加载完整 Monaco。 |
| L13 | 已对齐：进程恢复遥测 | DBX 本地 semantic model不依赖独立进程 | `useLspSemanticStatusStore` 按连接记录 LSP restart/恢复耗时、schema sync failure 与 stale response drop 的无内容计数；session registry 和同步器在对应路径写入，状态栏 schema 语义提示的 title 展示最新趋势，不记录 SQL/对象内容 | 保持计数有界、仅会话内；如需跨会话分析另建脱敏诊断导出。 |
| L14 | 逻辑已对齐：当前语句 frame 缓存与响应 | DBX `lib/sql/executableStatementRangeCache.ts`、`lib/sql/currentStatementFrame.ts`、`lib/editor/codemirrorCurrentStatementFrameLayer.ts`；`components/editor/QueryEditor.vue:1519-1533,4519-4558` | SQL 首次 miss 由 Rust driver-aware scanner 一次返回当前范围及最多 10,000 个有序 UTF-16 文档范围；同一 Monaco model version 内跨语句及语句间空白移动直接复用，不重复跨 Tauri 解析。精确 exclusive end、编辑、模型/连接切换立即重解析；超出上限时自动降级为仅缓存当前范围。选区和 Mongo command frame 同步显示，同范围不重复提交 Monaco decorations，过期异步结果不能覆盖新光标 | 延期以大文档和真实 WebView 记录 IPC/decorations 次数，并验证超过 10,000 条语句时的有界降级；前端不复制第二套 SQL parser。 |
| L15 | 逻辑已对齐，真实 metadata 验证延期：SQL Server 默认 schema | DBX `apps/desktop/src/components/editor/QueryEditor.vue` 的 `completionMetadataTarget`、`metadataSchemaForConnection`、`ensureColumnsForTable`；最新 `868f7961e` 在无显式 schema 且首次列 metadata 为空时从缓存 schema（含 `dbo`）恢复 | `connectionDatabaseNamespacePreference` 明确区分 SQL Server catalog 与 schema；Explorer 的缓存/远端 schema 选择和 `createLspSyncPlan` 共用 `selectPreferredNamespace`。用户显式选择优先，否则在已发现 schema 中选择大小写保真的 `dbo`，并避免把 `sys`/`INFORMATION_SCHEMA` 作为普通 fallback；query document 仍绑定原 catalog | 延期连接真实 SQL Server，验证默认登录 schema、无 `dbo` 权限、自定义默认 schema、多 catalog 同名表和 metadata refresh 后的列推荐；不得为寻找 schema 发送额外无界查询。 |
| L16 | 逻辑已对齐，真实 Monaco 交互验证延期：格式化布局 | DBX `apps/desktop/src/lib/sql/sqlFormatter.ts:applySqlFormatterLayout`、`sqlFormatterConfig.ts`、`components/editor/SqlFormatterSettingsPanel.vue`；最新 `868f7961e` 增加 logical operator `none` 与 FROM source 同行布局 | Settings 增加 `before/after/none` 和 `newLine/sameLine`，经 `LspConnectionSyncer`、配置摘要和 `workspace/didChangeConfiguration` 进入 bundled LSP；整篇与选区格式化共用 parser-mask 安全的线性后处理。字符串、注释、quoted identifier 中的关键词不改写，derived table 与注释开头 source 保持多行；随应用 binary/manifest 已重建 | 延期在真实 Monaco/WebView 验证 selection、undo、光标恢复、超大 SQL 响应和各 dialect formatter 输出；不得复制第二套前端 parser，也不得让布局后处理退化为逐行删除的平方复杂度。 |
| L17 | 逻辑已对齐，真实键盘交互验证延期：Insert Line Below | DBX `apps/desktop/src/components/editor/QueryEditor.vue:insertLineBelow`、`lib/editor/shortcutRegistry.ts`，最新 `868f7961e` 默认 `Shift+Enter` | `editor.insertLineBelow` 已进入共享 action/keymap/command palette；活动 QueryEditor 接收事件后调用 Monaco 原生 `editor.action.insertLineAfter`，由编辑器内核统一处理继承缩进、multi-cursor、selection、undo 和 read-only；`Ctrl/Cmd+Shift+Enter` 继续执行当前语句 | 延期在真实 Monaco + Vim insert/normal mode、IME 和 completion popup 打开时验证优先级；快捷键冲突仍由 Keymap 页显示，不硬编码第二套按键监听。 |
| L18 | 逻辑已对齐并加强，真实 provider 验证延期：过期补全取消 | DBX `apps/desktop/src/components/editor/QueryEditor.vue:3348-3384` 通过 CodeMirror `CompletionContext` abort 事件递增 epoch，在 debounce 和异步结果边界丢弃旧候选 | Monaco cancellation token 现贯通 completion 与 `completionItem/resolve`；renderer 为每次调用生成会话内 token，Tauri 映射到 JSON-RPC request id，Rust writer 删除 pending response 并发送标准 `$/cancelRequest`。取消先于请求注册或先于 writer 写出的竞态都有有界 tombstone，旧请求不会继续占用 provider 队列；重复/迟到取消保持幂等，token 长度与字符集受限 | 延期使用受控慢 provider 连续快速输入，确认旧 completion/resolve 收到 `$/cancelRequest`、新请求无饥饿、进程重启与会话切换不串 token；不需要连接数据库。 |

## 4. Explorer、metadata 与数据库管理

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| E01 | 部分对齐：对象类型宽度 | `lib/database/databaseObjectCapabilities.ts`；`ConnectionTree.vue` | tables/views/materialized views/indexes/constraints/routines；PostgreSQL 另走只读 `SchemaObjectInfo` descriptor 通道展示 sequence、非内部 trigger（标明所属 relation）、domain、enum type、composite/range/multirange type、extension 与 partition | 按产品补 event、synonym、package、权限与对象跳转；对象 presence 不能推导 DDL、编辑或迁移能力。 |
| E02 | 逻辑已对齐，规模验证延期：metadata cache 与失效 | `metadata/metadataLoadScope.ts`、`metadataResultCache.ts`、`metadataLoadCoordinator.ts`、`tableMetadataCache.ts` | 表 metadata/DDL/view source 与 database catalog refresh 已共用作用域代次；force refresh、invalidate/clear 会立即淘汰旧请求，持久化与删除按作用域串行，late response 不能在删除后重新落盘或通知 UI。v3 table key 与 v2 catalog key 固定包含 project、connection、driver package、连接默认 database、显式 catalog、schema/table；未显式传入时从当前保存连接补全，换包或原位改库不会命中旧资源。schema/LSP cache 原有 generation/owner gate 保持 | 补 10k catalog 并发/失效压测与真实 WebView 指标；真实数据库验证延期。 |
| E03 | 部分对齐：对象 DDL/source cache | `metadata/objectDdlCache.ts`；`editor/hoverTableSql.ts` | 表/视图 DDL 有限；PostgreSQL routine 现通过参数化 `pg_get_functiondef` 读取只读 source，单条和 overload 数均有上限，UI 仅提供复制；外置 driver 明确不走此路径。 | 为每个声明 objectSource 的 driver 提供可失效 source cache；不泛化生成 routine DDL。 |
| E04 | 未对齐：批量对象动作 | `ObjectSelectionTree.vue`、`sidebarExportRuntime.ts`、`useSidebarTreeToolRuntime.ts` | Explorer 主要是单对象动作 | 批量刷新/导出/删除必须按 descriptor/capability 生成，并提供逐对象结果。 |
| E05 | 本阶段增强，规模验证延期：大 catalog | `metadataTaskLimiter.ts`、cache coordinator、tree load handles | cache-first、显式 refresh 与 LSP 有界 batching 已有；table metadata 现额外按 project/connection/package/database/catalog 限制为每作用域 2 个活动任务和最多 512 个排队任务，交互式对象展开/补全优先于 LSP 后台 hydration。队列溢出 fail-fast；force/invalidate 和连接原位换包/改库会让尚未启动或迟到的旧任务在访问数据库/发布前失败，单节点失败移出 in-flight 后可重试 | 补 10k schema/table 的真实 WebView/IPC 压测、树虚拟化帧率和已在执行的 Tauri command 取消指标；真实数据库验证延期。 |
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
| G02 | 部分对齐：专用值查看器 | `JsonValueTable.vue`、binary/image/geometry/spatial modules | Value Editor 已区分 NULL/空串/未加载，提供 1,000,000 字符上限的 JSON tree、严格 binary hex 编辑与 byte 计数，并新增 JSON array / PostgreSQL array literal 的有界只读树预览：最多 64 层、100,000 项，叶子不做类型强转，切换树视图不重写原始数据库文本。 | 继续补 XML、map 专用键值视图、image 与 geometry；各自需要独立大小预算和只读/编辑边界。 |
| G03 | 未对齐：expression cell/default preview | DBX grid edit adapter、cell generation 与 bulk edit modules | 普通 typed cell mutation | 表达式必须显式切换；generated/default 在提交预览中区分“不发送”“NULL”“表达式”。 |
| G04 | 未对齐：全量数据 compare | DBX `dataGrid/dataCompare.ts` 与批量数据工具 | 仅 loaded-page compare | 后端 keyset 分页、稳定 key、断点、冲突/重复 key 报告和可恢复 artifact。 |
| I01 | 部分对齐：CSV/JSON/XLSX import | `crates/dbx-core/src/table_import.rs`；`TableImportDialog.vue`；`lib/table/tableImport.ts` | preview、mapping、原生事务流式导入已存在；native CSV/JSON/XLSX preview 现返回完整文件 SHA-256，确认写入时回传并核验，文件在预览后变化会被拒绝。UTF-8 原生 CSV 在确认后、事务前进行全文件只读预检，验证映射与每行可生成参数化 INSERT；有拒绝行时严格导入不启动，仅返回有界行号/错误码。每次有有效 project ID 的 native import 生成稳定 import ID，并持久化脱敏终态报告。 | 增加 reject-row 文件、显式错误行隔离与 resume token；浏览器 fallback 的非 UTF-8 CSV 暂不生成 native report。 |
| I02 | 部分对齐：连接导入 | `lib/imports/navicatImport.ts`、`dbeaverImport.ts`、`datagripImport.ts` | DataGrip、DBeaver 与 Navicat XML/NCX 已有；Navicat 仅读取非敏感 endpoint 属性，密码/令牌/本地路径永不导入，folder/group 会显示诊断。相同 driver/host/port/database/user 的候选项采用“保留已有本地连接、跳过导入项”的确定性 merge，不覆盖本地凭据或配置。 | 补更多 Navicat 版本/加密导出格式，以及 SSH/TLS/代理等不支持字段的逐项诊断。 |
| X01 | 主链路已对齐，安全恢复延期：流式 export | `crates/dbx-core/src/table_export.rs`（`SQL_INSERT_BATCH_SIZE`）、`database_export.rs`（`build_export_insert_statements`）；`useDataGridExport.ts`；`table_export.rs` | CSV/JSON/SQL 导出已有；Oxide 的本地导出使用稳定任务 ID，普通查询绑定 backend query cancellation，参数化筛选在查询 future 与批次边界协作式中断。数据库分页生产者与阻塞编码/写盘线程之间使用容量为 2 的有界页通道：磁盘、XLSX 或 Parquet 压缩变慢时查询端自然等待，内存不会无界增长，Tokio worker 不执行同步文件 I/O；进度只在写入器完成整页后发出。SQL INSERT 已迁移 DBX 的 100 行批处理，支持 25–1,000 行配置并增加 512 KiB 语句体积上限；原生 PostgreSQL/MySQL/SQLite 可显式生成方言正确的 conflict-skip 或基于完整主键的 conflict-update，分别使用 `ON CONFLICT ... DO UPDATE` / `ON DUPLICATE KEY UPDATE`，默认仍为严格 INSERT。无主键、主键被 generated 排除、外置/未知方言都由 Host 拒绝。分页兼容方言与字面量方言分离，当前静态覆盖 PostgreSQL array/bytea、MySQL binary/控制字符和 SQLite BLOB。新增 Arrow IPC file 与 Snappy Parquet 编码器、声明类型驱动的安全类型计划、源类型 field metadata 和有界降级提示；Parquet row group 同时受 50,000 行/64 MiB 限制。产物只有在生产端显式发送 `Finish`、footer/flush/`sync_all` 成功后才从唯一 `.partial` rename，通道中断、写入失败或取消均由 guard 清理。每次有有效 project ID 的终态导出仍保存脱敏审计记录。 | OFFSET 分页无法证明数据变化期间的 exactly-once 恢复，因此不签发伪 resume token；需在 driver 声明稳定 cursor/keyset + snapshot contract 后开放恢复。SQL 仍待 COPY、更多产品 identity/generated 策略与 typed-literal conformance。 |
| X02 | 本阶段已对齐：有界查询包装保留 execution hint | DBX `crates/dbx-core/src/query_result_sql.rs` 最新 `11c47d125` 的 `restore/split_leading_execution_hint`，覆盖 pagination/count/sort | 原生驱动通过结果读取上限截断，不重写用户 ad-hoc SQL；需要为 Headless Agent Host 增加 server-side limit 时，`core/statement.rs` 只识别开头 `/*+`、`/*@`、`/*&` execution/routing hint，并把它保留在外层有界 SELECT 前。普通注释仍留在原子查询内；拆分共用 UTF-8 安全 scanner，避免正则改写字符串或正文 | 延期用 MySQL compatible routing proxy/optimizer hint 与 Agent Host 受控 fixture 确认 hint 生效、普通注释不提升、max row 与 read-only transaction 不回退；表格分页由结构化 identifier/filter 生成，不接受任意 hint。 |
| T01 | 部分对齐：单表 transfer | `crates/dbx-core/src/transfer.rs:5734 transfer_table`；`DataTransferDialog.vue` | 单表 preview/确认/type map/事务/取消/append/overwrite | 保持同一 target transaction；失败和取消必须回滚；源端 query cancellation 有 fixture。 |
| T02 | 本轮已对齐：主键 upsert | `transfer.rs:2984 generate_upsert`、`:3515 keyset_pagination_sql` | `commands/table.rs:build_upsert_mutation`；Transfer Dialog | 仅 bundled PG/MySQL/SQLite；目标必须有完整映射的 PK；token 绑定 key；外置包默认拒绝。 |
| T03 | 部分对齐：多表/object transfer | `transfer.rs:TransferObjectSelection`、`transfer_schema_objects`；`ObjectSelectionTree.vue` | `preview_table_data_transfer_batch_plan` 一次接收选表、读取 FK、生成全局顺序和确认 token；`execute_table_data_transfer_batch` 在重新计算并比对该计划后，以一个目标事务执行全部表，并写入逐对象终态报告 | schema object transfer、Explorer 通用多选入口和真实跨库 fixture 仍待补齐。 |
| T04 | 部分对齐：FK 依赖排序 | `transfer.rs:5375 sort_tables_by_fk_dependency` | `table_data_transfer_batch_plan` 对同 schema 被选表构图，父表优先拓扑排序，循环 FK 返回 `cyclicTables` 并拒绝生成顺序 | deferred/disable policy 必须由目标 driver capability 决定；当前无该契约时不自动执行循环。 |
| T05 | 本阶段增强：sequence/identity/ownership | `transfer.rs:PostgresOwnedSequence`、`PostgresSequenceSnapshot`、ownership preview；`DataTransferDialog.vue` ownership flow | PostgreSQL 目标可显式启用 serial/identity generator 同事务同步；受影响列、选项和确认 token 均进入预览。单表与原子批量入口提交后均使用只读布尔比较确认每个 generator 状态不落后于对应表最大键，逐表报告只保存列名与 verified 状态，不保存 sequence 数值或行值；失败/权限不足转为 `needsReview`，不会回滚已提交的数据或伪造成功。未声明 identity/serial 的目标仅给出 warning。 | 仍缺 owned-sequence 当前值/owner preview、跨产品 ownership plan 和真实 fixture；旧 PostgreSQL/权限不足时验证必须保持 review-only 降级。 |
| T06 | 未对齐：schema objects transfer | `transfer.rs:ordered_transfer_object_kinds`、`transfer_postgres_schema_dependencies`、`transfer_postgres_schema_objects` | schema snapshot/diff 与 data transfer 是分离路径 | view/function/trigger/sequence 只在同族且有 source/DDL conformance 时开放。 |
| T07 | 部分对齐：持久化 transfer report | `useExportTracker.ts` 有后台任务、失败明细上限和终态；DBX 当前主要是会话级任务 | `TableDataTransferReport` 已按项目和目标连接保存 terminal report；单表与多表执行都写入逐对象终态。Transfer 对话框显示目标的最近历史，并且仅在当前源端点/库/schema/表完全一致时可用历史记录预填一次重试。重试会生成新 transfer id，且仍强制重新 preview/确认。overwrite 成功后会在提交后只读核对目标行数；并发写入或无法读取时只标为 `needsReview`，绝不伪装为失败或触发第二次写入。报告包含哈希 plan digest、端点标识、模式、行数、批次、终态和安全错误摘要，不保存 URL/凭据/SQL/参数/行值 | append 的稳定 baseline 验证，以及真实多表迁移报告 fixture 仍待完成；不保存行值或凭据。 |
| M01 | 部分对齐：schema snapshot/diff | `crates/dbx-core/src/schema.rs`、`schema_diff.rs`；`components/diff/*` | relation/index/constraint/routine signature snapshot/diff；新增 descriptor-only `schemaObjects` 快照及 create/drop/modify 差异，PostgreSQL sequence/trigger/domain/enum/composite/range/multirange/extension/partition 在可见时进入快照。所有 descriptor 对象均无 DDL、无 preflight、强制 manual-review。 | 补逐产品 event/synonym/package，以及具有受审核 source/DDL conformance 后才可能开放的可执行对象迁移。 |
| M02 | Host 产品主路径已对齐，逐产品实现/证据延期：migration apply | DBX `SchemaDiffDeployStep.vue`、`deployTxResult.ts` | PG transactional；MySQL journal + post verify。外置 sidecar 使用 descriptor-only semantic `plan/preflight/token-bound apply/verify`、签名/runtime/evidence 三门禁；Host-only 15 分钟单次 session 隐藏全部 sidecar token，执行前重抓 target，执行后同时要求 sidecar verify 与 Host recapture 通过。partial/count mismatch 强制失败；journal 不保存 token/DDL/原始 observed 文本 | 为每个外置产品实现协议并取得精确 package/entrypoint/platform/server-version evidence；没有证据的产品保持 review-only。 |
| M03 | 部分对齐：SQLite rebuild review planner | DBX SQLite schema/transfer 与 backup 实现可作行为参考 | SQLite schema diff 现生成临时表→同名列复制→rename→兼容索引重建→`foreign_key_check` 的受限审阅产物；所有变化均 manual-review 且自动 apply 继续禁用。 | 验证备份、外键依赖/失败恢复、类型转换与完整 DDL 保真后，才可评估受控执行。 |
| M04 | 部分对齐：跨产品 schema mapping | `transfer.rs:map_column_type`、`generate_create_table_ddl`、`convert_cross_family_object_ddl` | 单目标表创建现使用显式 `<source>-to-<target>/v1` profile：同产品保留原类型并标记 exact/review；跨产品仅为 PostgreSQL/MySQL/SQLite 的已识别标量族生成 DDL，每列返回 exact/safe/review/unsupported；unsupported 不生成 DDL、无确认 token 且后端拒绝执行，review 只能经显式预览和键入确认后执行，不再将未知/数组/空间/向量/自定义类型静默降为 TEXT | 仍需补充默认值、identity/sequence、FK/check/index/trigger、扩展/自定义类型依赖和逐产品 profile；真实产品版本验证已记录到 deferred queue。 |

## 6. 架构与测试差距

| ID | 状态 / 差距 | DBX 实现位置 | Oxide 当前落点 | 对齐验收 |
| --- | --- | --- | --- | --- |
| C01 | 部分对齐：统一 driver conformance runner 与 catalog 证据门禁已落地 | 各 `agents/drivers/*/src/test`、`crates/dbx-core/tests/live_*` | `scripts/run-driver-conformance.mjs`、`docs/database-driver-conformance-*.schema.json`、`DriverPackageConformanceEvidence` | bundled/external 对同一 fixture contract 运行；catalog 只能引用 CI 产生的版本证据。 |
| C02 | 未对齐：跨层契约 fixture | DBX backend/api types 与 app tests | TS/Rust/sidecar 类型各有测试 | 同一 JSON fixture 验证 TS decode、Rust serde、sidecar schema 和 backward compatibility。 |
| C03 | 未对齐：failure injection | DBX worker/process、SSE replay、transfer/export cancellation tests | driver handshake、下载摘要、LSP stale response已有部分覆盖 | 增加 crash/restart、下载中断、partial import、transfer rollback、stale metadata 和 reconnect 压测。 |
| C04 | 部分对齐：巨型模块拆分 | DBX 虽有纯模块，但 `transfer.rs`、主 Vue 组件同样较大 | `QueryEditor.tsx`、`SchemaSidebar.tsx`、`DataGrid.tsx`、`commands/table.rs` 仍大；单表与多表迁移已收敛到同一个 transaction executor，统一 overwrite、source cancellation、参数化写入、identity reseed 和批次进度，移除约 130 行会漂移的重复执行循环 | 继续按 feature/application/domain 拆出 export/transfer 模块；禁止把 vendor switch 堆到 UI，也不得为单表/批量入口复制第二套执行语义。 |

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
4. SQLite rebuild 的 backup/FK/rollback runtime contract；签名 sidecar semantic migration 协议已完成，随后补逐产品实现与真实 evidence。

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
