# OxideStudio 对照 dbx 的能力差距与演进方案

> 基线日期：2026-07-30
> 主工程：`/Users/houshuai/project/ai_project/OxideStudio`
> 只读参考工程：`/Users/houshuai/project/ai_project/dbx`

## 1. 范围与原则

dbx 仅用于观察交互、能力覆盖和测试组合，不是 OxideStudio 的主工程，也不是
待修改目标。本轮不修改 dbx，不复制其源码，也不假设其代码可以直接复用。

对照目标不是把 OxideStudio 改造成 dbx：

- 保留 OxideStudio 的 Tauri/Rust 安全边界、能力模型、SQL LSP、Agent Host 和
  Git 审核闭环。
- 参考 dbx 在驱动生命周期、数据库覆盖、管理工具、表格工具和语句边界恢复上的
  产品经验。
- 不引入 dbx 同样存在的超大组件、集中式 driver switch、巨型 locale 文件和
  UI 直接编排后端副作用等维护成本。
- 以 DataGrip 级的连续工作流为目标：输入、补全、执行、查看、编辑、管理和审计
  应共享同一上下文，而不是成为彼此独立的功能入口。

## 2. 结论摘要

### 2.1 总体判断

| 领域 | OxideStudio 当前成熟度 | dbx 可参考点 | 结论 |
| --- | --- | --- | --- |
| SQL 编辑器 | 中高 | 更成熟的语句边界恢复、编辑辅助与测试矩阵 | 优先修复多语句上下文并拆分 `QueryEditor` |
| 数据驱动 | 中高 | 驱动商店、离线包、JRE/JAR、更新/回滚流程 | Oxide 已有签名离线包、隔离运行时、连接 pin 和回滚；带 archive SHA-256 的签名 HTTPS catalog 条目可由用户显式下载、摘要核验并复验安装，已提供摘要命名的本地归档复用缓存；仍缺断点续传与更多驱动族 |
| LSP/补全 | 中高 | 软语句边界、组合场景覆盖 | 基线发现第二条无分号 SQL 会串上下文；本轮已修复高置信度场景 |
| Agent | 高 | 数据库语境和写 SQL 确认 | Oxide 的安全、恢复、工具协议和文件审核领先 |
| 版本管理 | 中高 | dbx 没有同等完整的独立 Git 工作台 | Oxide 领先，后续补 stash/blame/merge/rebase |
| Database Explorer | 中 | 更广对象类型、驱动覆盖和管理路由 | Oxide 核心对象可用，但管理对象和跨库动作不足 |
| 数据库管理 | 中 | Dashboard、Process、User/Role、Job | 已迁移 PostgreSQL/MySQL 会话与用户管理；Job/监控指标仍待补齐 |
| 数据表格 | 中高 | 丰富值编辑器、过滤构建器、导入导出细节 | Oxide 数据正确性边界更好，工具宽度仍不足 |
| 架构可维护性 | 中 | dbx 的细粒度纯逻辑模块值得参考 | 两边都有巨型文件；Oxide 应先建立 feature 边界 |

若只计算日常 SQL 浏览、编辑、执行和小规模数据修改，OxideStudio 已具备较完整
主路径；若按 DataGrip 全功能工作台衡量，主要差距集中在驱动生态、数据库管理、
对象覆盖、复杂数据工具和长期可维护性。

### 2.2 优先级

- **P0：无。** 当前主路径可使用，没有发现阻断所有数据库工作的单点。
- **P1：**
  1. 多条 SQL 未使用分号时的上下文泄漏已修复：LSP completion、子句建议、当前语句
     高亮与执行均使用相同的高置信度软边界规则。后续仍需抽取跨进程共享 scope contract。
  2. 外置驱动包的签名导入、原子激活/回滚、长驻连接 sidecar、并发 RPC 和连接级 pin
     已完成；带摘要的签名远程 catalog 已能受控下载、复验安装并复用已校验归档，仍缺断点续传、崩溃遥测与正式 conformance 包。
  3. `QueryEditor.tsx`、`SchemaSidebar.tsx`、`DataGrid.tsx`、`useTabStore.ts`、
     `commands/table.rs`、`agent/host.rs` 过大，修改会扩大回归范围。
  4. 缺少 Process/Session、User/Role/Privilege、Job、运行参数等数据库管理入口。
- **P2：**
  1. LSP 已有受限的项目 SQL 虚拟文档同步；主编辑器与补全共用按 URI 串行的确认后提交规则，
     `didOpen`/`didChange` 失败不会再错误提交本地 shadow revision，下一次补全会重试同一版本。
     Trino/PrestoSQL 保留全量对象名补全，但仅按需
     读取当前/引用表的列元数据。仍缺真实值采样、跨控制台 symbol/reference index、migration/view
     symbol 来源和进程级恢复遥测。
  2. Grid 已有加载页的只读转置视图；仍缺文档树/文本视图、表达式单元格、完整服务器数据比较和更细导入映射。
  3. Git 缺 stash、blame、merge、rebase、冲突工作台和托管平台 PR。
  4. Explorer 的对象类型、批量动作和各数据库版本能力覆盖不完整。
- **P3：**
  1. 新增数据库产品时维持品牌图标覆盖测试；继续补对象图标、快捷键提示和细节交互。
  2. 继续统一紧凑工具窗口的 hover、焦点和空状态表现。

## 3. 逐领域详细分析

## 3.1 SQL 编辑器

### OxideStudio 已有能力

- Monaco 模型、多个 Tab、拆分编辑器、当前语句边框、选区/当前语句/全文执行。
- SQL、MongoDB、Redis、Elasticsearch Console 使用不同文档语义，不把非 SQL
  查询伪装成 SQL。
- SQL 参数、查询历史、保存查询、格式化、诊断、导航、hover、补全和 Vim 模式。
- 当前语句执行在 Rust 中使用 driver-aware scanner，能正确处理 UTF-16 光标偏移。
- 执行结果与编辑模型分离，支持查询取消、事务和结果面板。

### 与 dbx/DataGrip 的差距

1. **补全和执行过去使用不同的语句边界事实源。**
   现在 Rust 的当前语句选择，以及 LSP completion、`WHERE`/`ORDER BY`/谓词和值
   上下文，都会在顶层空行后的语句关键字恢复新作用域。这解决了：

   ```sql
   SELECT *
   FROM first_table

   SELECT
   ```

   第二个 `SELECT` 被当作第一条语句延续而造成的表别名、字段和子句上下文泄漏。
   Run All 仍保留显式分号作为脚本执行边界，避免为了编辑体验错误拆分数据库脚本。

2. `QueryEditor.tsx` 超过 4,000 行，同时负责 Monaco 生命周期、LSP、Elastic
   provider、执行、参数、搜索、当前语句装饰、拖放、状态和 UI，难以局部测试。
3. 补全 provider 的集成测试偏少，更多测试集中在纯 helper；缺两条真实文档、
   不同光标位置、取消、过期响应和 text edit 映射的组合测试。
4. LSP 已提供格式化、`SELECT *` 展开、危险 mutation 的 `WHERE 1 = 0` 安全 guard，
   以及 metadata 驱动的字段 qualify/unqualify 和选区 batch qualify code actions；
   编辑器另提供多选区原子 quote/unquote identifier 与 clipboard→`IN (...)` intention。
   普通 lightbulb 请求不会再计算整文档格式化。仍缺 JOIN/WHERE 重写 preview、
   generated/hidden 列策略、更复杂的结构化多光标编辑、可配置 dialect inspection profile
   和项目级 scratch/console 组织。

本轮已在 LSP server 增加高置信度软边界：空行后的顶层语句关键字会获得独立
completion scope，同时保护 CTE、INSERT SELECT、EXPLAIN、CREATE body、
ClickHouse `ALTER ... UPDATE`、集合运算、注释/字符串和嵌套括号。真实 bundled
binary 测试确认第二个 `SELECT` 不再继承上一条语句的单表字段范围。

### 参考方式

参考 dbx 的顶层“软语句边界”思路：只在语法噪声之外、顶层行首识别新的
`SELECT/WITH/INSERT/UPDATE/...`，并保护 CTE、INSERT SELECT、EXPLAIN、
CREATE BODY 和方言过程块。不能简单用正则按每个 `SELECT` 切分。

当前实现已经让这些入口遵守相同高置信度规则，并以回归测试保护 CTE、INSERT
SELECT、EXPLAIN、嵌套查询、集合运算、注释和字符串。后续应抽取跨 Rust Host 与
bundled LSP 共用的 statement-scope contract，以消除实现副本。

## 3.2 数据驱动与版本管理

### OxideStudio 已有能力

- 运行时驱动：PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis、Elasticsearch。
- 后端 `DatabaseDriver`、capability catalog 和 connection manager 已形成稳定边界。
- Elasticsearch 会探测 6/7/8 主版本并适配 typed/typeless API。
- `list_database_driver_installations` 能显示编译进应用的 client library 与版本。
- ADR-0017 已决定采用签名 sidecar package，而不是不稳定的 Rust 动态库 ABI。
- 外置包 manifest v1、安装目录扫描、活动版本指针、目标平台、协议主版本、入口
  SHA-256 和 detached Minisign 校验已实现；`manifest.json.minisig` 必须由编译进
  official build 的可信公钥验证。无公钥、无签名、不兼容或摘要错误的包只进入状态
  清单，不会执行。
- 独立 `oxide-driver-protocol` crate 已定义握手、连接、查询、取消、元数据、事务和
  关闭消息；registry 只解析 active + ready 包，握手必须与 manifest 的包、版本、
  driver 和协议完全匹配，且必须声明 query capability。
- 签名 manifest 还可声明完整 `DatabaseCapabilities`：数据模型、LSP 语言、Explorer
  对象、事务、取消和 Grid 边界均不再由前端猜测；runtime handshake 不能兑现它声明的
  metadata、事务、Grid 写入或取消能力时，会在发送连接凭据前拒绝启动。Grid 行修改
  额外要求 manifest 和 runtime 同时提供事务，避免仅因包已安装而开放无法原子执行的编辑。
  Settings 安装、激活或回滚完成后的 catalog refresh 也会让已打开的连接表单重新读取
  可 pin 的 ready package；用户无需关闭并重新打开数据源配置。
- 外置关系型包即使尚无厂商专用 parser，也可声明任意方言名称并安全降级为内置通用
  `sql` completion；该路径仍同步 catalog/schema/table 元数据，因此提供对象补全，
  但不会误报为 Oracle、DB2 等厂商语法诊断。编辑器状态栏会显示 `SQL generic`，避免
  将降级状态误解为专用方言服务。
- 外置包 capability 的读取与连接版本 pin 绑定：active catalog 只代表默认激活版本，
  被 pin 的连接会读取自身版本而不覆盖全局 catalog。这样同一产品并行测试旧/新驱动时，
  LSP、Grid、DDL 和创建 namespace 的可用性不会串到另一条连接。Connection Form、
  Query Editor 与 LSP schema sync 都读取这份 connection-local contract；驱动切换会主动
  失效未 pin 的 active capability cache。Grid WHERE/Sort 输入与 Agent 的
  `lsp.getCompletions` 同样携带该 contract；Monaco 的全局 provider 只服务当前虚拟
  文档，避免后台标签页被当前连接或当前 package version 的 LSP 会话误处理。
- 已增加 `get_connection_database_capability_context`，从同一个 live driver 实例一次读取
  canonical driver、外置包精确版本、签名 capability、协商后的 server version 和迁移模式。
  LSP 配置不再分别查询活动包目录与服务端版本，从而避免重连/包切换期间拼出不存在的组合；
  Query Editor 同样优先读取 live contract，未连接或旧后端才保守回退到版本固定的目录能力。
- 常用 SQL 推荐不再只是静态关键词：语句边界会给出 bounded SELECT、INSERT、带 WHERE 的
  UPDATE/DELETE、CTE、建表、加列和索引 snippet，并按实际产品选择 `TOP`、`ROWNUM`、
  `FETCH FIRST`、`ROWS`、`LIMIT` 与 ClickHouse mutation 语法。未知 JDBC 不猜分页方言，
  非 SQL provider 不接收这些模板；接受记录继续只保存在本机并参与 connection scope 排序。
- LSP 进程健康与 schema-aware completion 状态已拆分：status bar 会明确显示 metadata
  正在同步、缓存命中、完整就绪或部分降级。这样 LSP 二进制已启动但 metadata 尚未可用时，
  不会错误显示为完全可用。
- 数据库创建已从“Host 为未知 driver 拼 SQL”改为语义化 sidecar RPC
  `name/owner/charset/collation`。外置包必须同时在签名 manifest 与 runtime handshake
  声明创建能力；二者任一缺失均在建立连接时拒绝。owner、字符集、排序规则是三个独立
  的 opt-in 能力，旧 manifest 默认关闭。
- sidecar 探测进程已使用清空后的环境变量、4 MiB 帧上限、握手超时、响应 ID 校验、
  stderr 持续排空和退出清理；Settings 可对 active 外置包执行不携带连接凭据的启动
  验证。目录身份伪装和入口符号链接逃逸会被 registry 拒绝。

### 实际缺口

ADR-0017 的 registry/manifest、签名离线导入、原子激活与回滚、连接级 pin 和
sidecar 连接路径已经接入。当前 PostgreSQL/MySQL 的 SQLx、MongoDB、Redis 和 HTTP
adapter 仍是 bundled recovery channel，升级它们仍需发布整个应用。当前仍缺：

- 断点续传与可观测的缓存回收（当前缓存按 driver/version/archive SHA-256 隔离，
  每次复用前重新摘要校验，损坏条目会丢弃并重新下载）；
- 长期健康/崩溃预算、可诊断但脱敏的运行日志；
- Maven 依赖解析与经审计的受控下载/断点缓存（现有 Java 21 runtime 与本地签名 JAR
  package 已可用，但不自动下载或解析任意 Maven 坐标）。
- 可配置的 driver store 迁移已提供：Settings 选择一个父目录后，Oxide 只会复制到一个
  全新的绝对目标目录，拒绝链接、特殊文件和超限目录树，重新扫描 staged layout 后原子
  发布，并写入 restart-required pointer。运行中的 registry 与旧 Store 均保持不变，
  活跃外置 sidecar 连接时拒绝迁移。旧目录回收仍应作为一次单独、可恢复的维护操作，
  不随迁移自动发生。

### dbx 数据库覆盖映射与 Oxide 执行批次

dbx 当前 `DatabaseType` 覆盖 68 个类型（其中 `jdbc`、`mq` 是扩展入口）。Oxide 不应把所有名称一次性加入菜单并
假装支持，而应按“协议族 + conformance suite”交付：

| 批次 | 数据库族 | dbx 中的代表类型 | Oxide 状态/路线 |
| --- | --- | --- | --- |
| A | 当前原生 | PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis、Elasticsearch | 已贯通连接、Explorer、查询与对应 LSP；SQLite 已覆盖表/视图/索引的基础原生 DDL，Agent 使用 SQLite 引擎级只读句柄执行查询；Explain 与迁移 rebuild planner 仍为显式缺口；继续补版本矩阵 |
| B | 嵌入式 SQL | DuckDB、Rqlite、Turso、Cloudflare D1、H2、Access | DuckDB sidecar 已具备协议级 connection/query/parameter/transaction、attached catalog/schema/table/column/index/constraint metadata、catalog-scoped editor/table-query context、能力驱动的 Explorer cache/selector 与只读 schema snapshot/diff、DuckDB 标识的 SQLite-compatible LSP 路由和可复现 package payload；H2 已有通用 JDBC Agent 的真实协议 fixture（连接、参数、typed grid result、schema 创建和 Explorer metadata），但尚未作为签名/激活的产品包发布；Turso、D1、Access 仍需各自连接与版本契约，不能仅以 SQLite 文件路径替代。 |
| C | 主流企业 SQL | SQL Server、Oracle、ClickHouse | 外置 driver pilot；补 catalog/schema 差异、分页、参数和取消 |
| D | PostgreSQL 协议族 | Redshift、Kingbase、HighGo、OpenGauss、GaussDB、Vastbase、KWDB、UXDB | 复用 PG transport，manifest 声明 dialect/版本差异，禁止只改显示名 |
| E | MySQL 协议族 | Doris、StarRocks、OceanBase、GoldenDB、GBase | 复用 MySQL transport，按 capability 覆盖 catalog、DDL、分页和编辑限制 |
| F | Warehouse/Query | Databricks、Snowflake、Trino、PrestoSQL、Hive、Spark、BigQuery、Kylin | 先只读 query/metadata/LSP，再单独开放 mutation |
| G | 其它关系型 | DB2、Informix、Firebird、Vertica、Exasol、Dameng、Xugu、IRIS 等 | JDBC sidecar 或独立 native package；必须逐产品跑元数据与类型 fixture |
| H | 专用数据系统 | HBase、Cassandra、Neo4j、Qdrant、Milvus、Weaviate、ChromaDB、InfluxDB、TDengine、IoTDB | 使用非 SQL workspace/provider，不套用关系型表编辑器 |
| I | 协调与消息 | Etcd、ZooKeeper、Nacos、Kafka/Pulsar/RocketMQ | 独立 admin provider，不声明为 SQL driver |

每个类型只有在 `connect + ping + server version + metadata + query + cancellation +
error mapping` 合同通过后才进入可创建连接目录；支持编辑时还必须额外通过
parameter、transaction、primary-key mutation 和 rollback 测试。

按产品族拆分的 70+ 发布目标、工作区类型和 conformance 门槛见
[`driver-family-rollout.md`](driver-family-rollout.md)。
逐功能差距与 DBX 源码位置的一一对应关系见
[`dbx-detailed-gap-matrix.md`](dbx-detailed-gap-matrix.md)。

### dbx 可参考点

dbx 已覆盖驱动安装进度、在线/离线包、托管 JRE、JAR/Maven、存储目录、更新、
重装、卸载和占用保护。这些是工作流参考，不代表 Oxide 应直接采用 Java。

### 推荐实施顺序

1. 先完成通用 package manifest、registry cache、installer、atomic activation。
2. 建立 versioned RPC conformance suite。
3. 以 Elasticsearch 为首个外置驱动；它已有明确 HTTP 和版本适配边界。
4. 再迁移 MongoDB、Redis，最后迁移事务语义更复杂的 PostgreSQL/MySQL。
5. 保留 bundled recovery channel，直到外置驱动通过相同集成测试。

### 创建、迁移与数据转移的边界

dbx 的 JDBC/driver-profile 主要解决“可连接”的广度；它不能证明某个产品的 DDL、
事务与数据迁移语义相同。Oxide 因此将三类动作分开：

| 动作 | 当前执行边界 | 外置驱动接入条件 |
| --- | --- | --- |
| 创建 database/schema | PostgreSQL/MySQL 使用 Host 已验证方言；其它为语义化 sidecar 请求 | `supportsCreateDatabase` + runtime `databaseCreation`，可独立声明 owner/charset/collation |
| schema diff / migration | PostgreSQL 原子事务；MySQL 显式确认的逐语句 journal；SQLite、文档/搜索后端、无 Host DDL planner 的外置包以及跨驱动映射只生成关系、字段、索引、约束的 metadata diff | 不能复用 Host SQL；必须新增“方言生成 + 预检 + apply + post-verify” sidecar conformance 合同后才开放自动执行 |
| 数据导入/导出/复制 | 走参数绑定、行数/大小预算和连接侧权限，不借 Agent Shell；SQLite/DuckDB 与 Grid 复用有界 ANSI/PG 数据路径，CSV/JSON 导入不再被 PostgreSQL/MySQL 的枚举限制误拒绝。关系型的“表→表”复制通路现为 `preview → exact confirmation → append/overwrite/upsert`：后端重新读取两端元数据、按列名（大小写不敏感）映射、拒绝未赋值的必填目标列，并把 source/target、模式、列映射、源/目标类型、limit/batch、upsert key 和 PostgreSQL reseed 选项绑定进动态确认短语。upsert 仅对 bundled PostgreSQL/MySQL/SQLite 开放，要求目标声明完整主键且全部 key columns 有 source mapping；外置包在 signed semantic conflict-write contract 完成前保持拒绝。PostgreSQL 目标可显式启用同事务 serial/identity generator 同步，预览会列出受影响列；没有可同步列时只给出 warning。多表复制先读取选表间 FK，完成拓扑排序和逐表映射预检，再在单一目标事务中执行，循环 FK 在没有明确 target capability 时拒绝。预览会明确展示两端字段类型；跨类型族只形成需人工审查的 warning，不伪造数据转换。目标连接声明 catalog 能力时，复制对话框先选择 `database → schema → table`，选中的 database 也进入确认令牌和后端请求，避免跨库复制错误落到连接默认库。一次执行最大 10,000 行、每批最多 500 行；所有写入模式使用同一目标事务，失败或取消会回滚目标变更，并产生隐私受限的逐对象终态报告。除内置 PostgreSQL、MySQL/MariaDB、SQLite、DuckDB 外，chooser 只显示签名声明 `supportsTableDataTransfer`、运行时事务可用且采用已审核 PostgreSQL/MySQL/SQLite/DuckDB 方言的外置连接；它独立于 Grid 编辑，以支持 DuckDB 等受控批量写入。generic JDBC、只读数仓和仅能 Grid 编辑的包不再被误显示为“可迁移”。 | 仍需经版本 conformance 验证的 source/target fixture；外置驱动 upsert、循环 FK policy、schema object transfer、ownership preview 和外置 semantic DDL contract 必须各自完成后才开放。只有 query/metadata 的包不得显示写入入口。 |

CSV 对话框提供编码、分隔符、列映射和类型预览；提交时所有 INSERT 又会以刚读取的
目标列元数据复核未知列、必填列与非空约束。这一后端复核同样覆盖 JSON 导入、Grid 与
Agent 的参数化插入，避免缓存过期或绕开 CSV 对话框时将错误推迟到已开始的批处理。桌面端
从原生文件选择器取得 CSV 后，先以只读、32 MiB 有界前缀复用相同的映射界面，确认时将
`sourceIndex → targetColumn`、首行、单字节分隔符与空字段语义连同原路径交给原生 UTF-8
流式事务；事务开始前会重新验证计划，拒绝重复源/目标、未知目标和“全部忽略”的映射。
UTF-16/GB18030 等编码会明确保留在有界、已解码的预览提交路径，不能被伪称为原生流式。
预览超过上限
的文件会明确要求改用受限的标准 streaming import，不能伪造“完整已审核”的映射。

这比“在菜单里列出所有产品”更慢，但不会把未知方言的 `CREATE/ALTER` 当作可恢复
迁移。dbx 的 dialect YAML 可作为产品和 version 组合的测试目录，不作为未经签名的
执行逻辑来源。跨连接 Table Data Transfer 的首版边界见
[ADR-0020](decisions/0020-table-data-transfer-safety.md)。

## 3.3 LSP、自动推荐与上下文推断

### OxideStudio 已有能力

- 每连接/语言 LSP 会话、初始化队列、引用计数、空闲回收、健康恢复和取消。
- metadata 以不含凭据的对象 URI 同步；schema cache、batch 和 session registry
  均有前端测试。
- SQL 支持 schema/table/column、alias、CTE、derived/temp relation、function、
  FK join、enum/static domain、usage rank。
- MongoDB 支持 collection-aware 补全；连接成功后会以非阻塞 `buildInfo`
  探测的服务端版本写入 LSP schema，因此聚合阶段和操作符可按 4.2/4.4/5.0/5.1/5.3
  的最低版本过滤。权限不足而无法读取版本时不会中断连接，LSP 退回保守兼容候选。
- Elasticsearch 支持 method/path/operation/DSL key/mapping field，并区分 6/7/8。
- Table WHERE 输入已接入字段、谓词、操作符和组合条件补全。
- WHERE 续写会将双引号、反引号、方括号以及 `catalog.schema.column` 的最后一段识别为字段；
  因此已选字段后优先给出 `= / IN / BETWEEN / IS NULL`，而不会把带引号字段误判为字符串值。
  未闭合的 `"field`、`` `field`` 与 `[field` 前缀也会作为一个替换范围，接收建议时不会留下
  重复引号；连接声明的标识符引号会用于插入文本，避免 SQL Server 等外置包被默认双引号污染。

### 关键缺口

1. **事实源重复**：前端 SQL context、Rust statement scanner、bundled LSP parser
   和 Grid WHERE parser 仍各自维护部分语法状态；当前语句、completion 与子句建议
   已完成规则对齐，但代码尚未提取到同一跨进程库。
2. **版本矩阵仍不完整**：
   - PostgreSQL/MySQL 版本差异主要依赖通用 dialect；
   - ES 已有 6/7/8，但需要 endpoint、mapping、removed feature 的完整 fixture；
   - MongoDB aggregation stage/operator 已按 server version（4.2/4.4/5.0/5.1/5.3）
     过滤，但仍需要真实 server fixture 证明各版本的 metadata 与 command 行为。
3. **值域补全不足**：enum/static domain 可用，但真实数据值不应默认全表扫描；
   需要带预算、采样、脱敏和缓存的显式 value provider。
4. **项目语义仍有限**：已保存的 `.sql/.psql/.pgsql/.mysql` 文件现在会以有界、无绝对
   路径的 `oxide://project` 虚拟文档同步到当前连接的本地 LSP，并映射到活动 schema；
   跳转到该 URI 会打开项目文件。同步排除隐藏目录、依赖目录与密钥命名文件，限制 128
   个文件、每文件 128 KiB、总计 5 MiB。未保存编辑内容仍由当前 Monaco 文档优先，避免
   用磁盘版本覆盖用户草稿。下一步仍是迁移、view definition 与命名查询的真正 symbol/
   reference index，而非无限制扫描项目目录。
5. **退化可见性不足**：metadata stale、LSP restart、catalog 未完成时，UI 应说明
   当前是 keyword-only、cache-only 还是 full semantic completion。

LSP 刚启动、重连或单次请求失败时，编辑器不会完全失去建议：`FROM/JOIN` 等关系位置仍
从 Explorer 缓存返回对象；已经解析出唯一 relation 或明确 `alias.` 的字段位置，会有界地
读取该单表的已缓存列。三段对象名会把 catalog、schema、table 一并绑定到缓存和 metadata
请求，SQL Server 方括号/带点标识符也不会被错误拆分。显式列列表的 CTE 直接提供本地字段；
没有可靠列定义的 CTE 不会退化查询同名物理表。多表而未限定字段时刻意不猜测，避免把 JOIN
中另一张表的字段作为错误建议。此 fallback 不会扫描整库，也不会代替版本方言、诊断或完整
LSP 语义。连接声明 `supportsDatabaseCatalogs` 时，Explorer、缓存 fallback 和 LSP schema
ID 都使用同一个已选 catalog；外置 SQL Server/DB2 等不会再因为 PostgreSQL 专用判断而把
默认 catalog 丢掉。三段对象引用会将其显式 catalog 作为额外同步目标，方括号、反引号和
双引号内的 `.` 保持为标识符内容而不是路径分隔符。文件型 driver 的连接文件路径不会被误写
成 catalog。即使 LSP 对新 revision 暂时返回空集，当前语句也仍会提供受限的 SQL 语法
兜底：语句开头、`SELECT`、`WHERE/ON/HAVING` 和 `ORDER BY` 分别保留关键词、条件运算符
和排序方向；单一可确认 relation 的缓存字段会与条件运算符合并而非互相遮蔽。该层不猜测
metadata，字符串、注释、反引号/方括号标识符及 PostgreSQL dollar-quote body 内的分号
都不会重置语句上下文。
即使 LSP 已返回部分字段，过滤后的 live proposals 也会与这些条件运算符合并，避免部分
响应重新造成 `WHERE field` 后只有字段、没有谓词的交互断点。
语法兜底同时识别双引号、反引号、方括号和 catalog/schema 限定的字段引用，因此
`WHERE "order"`、`WHERE [status code]` 与 `ORDER BY public."created at"` 都会继续给出
谓词或排序方向，而不是退化成字段名列表。

### 必须覆盖的组合测试

- 第一条语句有/无分号、空行、注释和未闭合括号，第二条从 `SELECT` 开始。
- `WITH ... SELECT`、`INSERT ... SELECT`、`EXPLAIN SELECT` 不被错误切开。
- 有 FROM 时仅优先当前 relation 字段；无 FROM 时使用当前 database/schema 的
  限定候选，不跨连接泄漏。
- alias、同名表、跨 schema、临时表、CTE 和子查询遮蔽。
- `WHERE field` 后推荐 operator；`field =` 后推荐类型兼容值；完成谓词后推荐
  `AND/OR/GROUP BY/ORDER BY/LIMIT`。
- MongoDB find/aggregate/update 上下文和字符串内字段路径。
- Elasticsearch 6 typed path 与 7/8 typeless path、字符串内字段、Query DSL 层级。
- Grid WHERE 与 Sort 行使用相同字段类型和 quote policy。

## 3.4 Agent 管理

### OxideStudio 优势

- Deep Agents sidecar 与 Tauri/Rust 权限边界明确。
- 工具 schema、provider、CLI、MCP 和 GUI 共用能力定义。
- `shell.execute` 已实现 preflight、policy digest、执行前复检、动态确认短语、
  单次 approval lease、声明式项目规则和 post audit。
- Agent 文件修改有 revision、Turn/Call 归因、Git diff、Keep/Undo 和 hunk review。
- checkpoint 加密、项目隔离、暂停/恢复、流式 timeline 和工具过程展示较完整。
- Agent 的外置数据库驱动现在与普通连接共享已签名的 capability contract；仅当 runtime
  握手声明 `readOnlyEnforcement` 时才会交付连接凭据，随后每条 Agent 查询都带
  `readOnly` 上下文，由 sidecar 独立拒绝写入。SQLite 保持引擎级只读打开方式。

这些能力整体上比 dbx 当前集中式 AI Assistant 更适合作为主架构，不能为了参考
dbx 而退回 UI 直接执行或仅依赖提示词安全。

### 仍需完善

- 将 5,700+ 行 `agent/host.rs` 拆成 supervisor、turn runtime、approval、
  tool dispatch、event bridge、recovery 和 audit。
- tool result/event schema 做版本化兼容测试，避免 sidecar 与桌面应用独立升级时漂移。
- 增加长任务幂等、应用崩溃后恢复、重复事件、半写入和 reconnect 压力测试。
- 明确数据库数据出境策略：schema、样例值、结果行和附件分别配置预算与脱敏。
- Agent 产生 SQL 后应能绑定 database/schema/dialect，并在执行前走同一风险分析和
  parameter preview，不建立第二套执行通道。

## 3.5 版本管理

### OxideStudio 已有能力

- Commit 与 Version Control 是独立工具窗口，可移动左右侧。
- status、staged/unstaged/untracked/conflict、line stats、文件 diff 和 hunk 操作。
- stage/unstage/commit、log、branch、remote、fetch/pull/push、patch apply/reverse。
- Git 命令使用 Rust 固定参数数组、canonical root、输出上限和超时，不经过 AI shell。
- Agent 当前 Turn 的 Keep/Undo 保持在输入框上方，仓库变更则进入 Commit Panel。

### 差距

- stash/shelve、blame/annotate、merge/rebase/cherry-pick/revert。
- 冲突三方编辑器、ours/theirs/base 和逐块解决。
- worktree/submodule/LFS 的明确状态与恢复提示。
- GitHub/GitLab/托管平台的 PR、review、checks 和认证状态。
- 大仓库后台 refresh、文件监视、分页 log 和取消。

dbx 不是这一领域的主要参考源；Oxide 应继续沿用自身的有界 Git 命令和 Diff
Editor，而不是引入一个新的 Git UI 框架。

## 3.6 Database Explorer

### OxideStudio 已有能力

- 项目/连接隔离、cache-first metadata、显式刷新、搜索、连接状态和可见数据库。
- database/schema/table/view/materialized view/index/constraint/routine 等核心对象。
- PostgreSQL database 层和 remote database contents，Redis namespace，
  Mongo collection，Elasticsearch index。
- 新建/删除/重命名、DDL、diagram、diff 等动作按 capability 暴露。

### 差距

- `SchemaSidebar.tsx` 超过 4,400 行，同时承担树构建、加载、动作路由、弹窗和状态。
- 对象类型覆盖与各 driver 不一致：sequence、type/domain、extension、trigger、
  event、partition、foreign server、tablespace 等仍不完整。
- 批量选择、批量刷新/导出/删除、拖放复制和跨连接数据传输不足。
- 大 catalog 虚拟化、增量搜索、过期节点和失败节点的恢复策略仍需压测。
- 对象动作应由 provider/command descriptor 生成，避免继续在树组件中追加
  `if (driver === ...)`。

## 3.7 数据库管理命令

这是 Oxide 与成熟数据库 IDE 的最大功能宽度差距之一。

### 已有

- 数据库/schema、表、列、索引、约束、view 的常用 DDL。
- schema snapshot/diff、migration preflight；PostgreSQL 采用整批事务执行，MySQL 采用单独确认的逐条 DDL 执行、持久化进度日志和执行后校验，避免把可能 auto-commit 的 DDL 伪装成可回滚事务。
- connection test、transaction、query cancellation、Explain。

### 缺少或未形成统一工作台

- Process/Session/Lock 监控与 kill/cancel。
- User/Role/Privilege 管理和权限 diff。
- Server variables/config、连接池和运行指标。
- Vacuum/Analyze/Optimize、表维护和统计信息。
- Backup/Restore、dump/transfer 工作流。
- PostgreSQL extension、MySQL event、routine/job scheduler。
- 慢查询、执行历史、活动查询和 dashboard。

推荐新增独立 `Database Administration` tool window，并以 capability + descriptor
注册视图。所有 destructive action 必须有 server identity、scope、预览和确认，
不能把管理命令写成通用字符串模板直接从前端执行。

## 3.8 表格与数据操作

### OxideStudio 已有能力

- Glide Data Grid 虚拟化、类型单元格、复制、CSV/JSON、列隐藏和本地搜索。
- 任意查询会使用 ResultSet 列类型；源表元数据只作为表头的高精度来源，表达式和
  CAST 后的值以实际 ResultSet 类型决定对齐和图标。
- 支持表头右键冻结到当前列、解除冻结，并随当前 Tab 保留布局状态。
- 单元格悬浮展示完整值和结果类型；本地结果筛选与整表服务器筛选使用独立入口，
  支持等于/不等于/包含/NULL 等常见条件，避免把“当前页”误认为“全表”。
- 待提交的单元格与新增行使用低干扰状态底色，不改变 NULL、布尔、时间等类型表现。
- 服务器分页、结构化 filter/sort、WHERE 行、Sort 行和 metadata 校验。
- 插入/更新/删除通过参数化语句和批量事务提交。
- Value Editor、FK navigation、selection aggregate、loaded-page compare。
- 表数据页与 SQL 查询结果都可切换为只读转置视图：字段成为行、加载记录成为列；表格有未提交编辑时禁止切换，避免展示模式改变写入语义。
- JSON Value Editor 可在文本与只读树之间切换；树仅解析有效且不超过 1 MiB 的草稿，提交始终使用原始 JSON 文本。
- CSV/JSON/XLSX/SQL 导入导出有路径、格式、行数和批次边界。表数据视图的 CSV 导入已提供
  编码、分隔符、首行 header、空值和列映射预览；Explorer 的 `Import CSV…` 会先打开
  对应表的数据页并复用同一对话框，不再绕过 mapping。JSON/JSONL 与 XLSX 首工作表也会先读取受限的
  结构化样本、核对目标列后才显示导入确认；正式写入继续走原生文件路径与事务。SQL 脚本导入会按当前
  方言分句返回最多 20 条、每条最多 1,200 字符的只读预览，并把确认的 SHA-256 digest 绑定到执行前
  重新读取的文件；文件内容变动或跳过预览时 Host 会拒绝执行。

### 差距

- `DataGrid.tsx`、`TableDataView.tsx` 和 `commands/table.rs` 责任过多。
- XML、非 JSON 的 array/map 以及嵌套表格仍缺专用视图；JSON Value Editor 已有有界树检查，关系型/查询结果已有加载页的只读转置，二者都不替代原生文档查看器。
- 缺 expression cell mode、generated/default preview 和 per-cell SQL。
- compare 只保证已加载页，缺服务器全量、key-based 和可恢复 diff。
- CSV 映射预览已统一到 Explorer 与表数据页；桌面端的选择、预览、映射与执行现在会保持
  同一个原生文件路径和映射计划，WebView 开发模式保留受限的本地内存回退。原生 CSV 导入
  现可在一个显式事务中按 500 行流式参数化写入（源文件上限 512 MiB），任一
  记录或数据库错误都会回滚所有已处理批次。显式 PostgreSQL secondary database 使用独立的
  单连接事务池，MySQL 事务绑定所选 database；外置驱动必须同时在已签名 runtime contract 中
  声明 transaction 与 database-scoped query，Host 绝不回退到默认库事务。JSON Lines/NDJSON
  同样可流式导入；原生 CSV 现在接受与预览同形的映射计划并在事务前重验。桌面端完整映射
  预览目前上限为 32 MiB；更大的 CSV 仍是标准 UTF-8、comma、header 的 streaming path。
  JSON object/array 仍未实现增量解析与类型转换。所有入口
  仍缺错误行隔离、断点恢复、映射快照和可恢复失败报告。
- 批量编辑、fill、normalize、find/replace、extractor profile 不足。
- 表格过滤和 SQL editor 的 completion/type system 尚未完全共享。
- 冻结、列宽、顺序与隐藏状态已进入版本化本地 layout repository：对象表按
  connection/database/schema/table 隔离，查询结果按 SQL revision 隔离；重开后会自动
  剔除已不存在的列，Reset column layout 会清除对应对象/查询的已保存布局。布局仅保存
  展示偏好，不保存过滤、选择或行数据。仍缺跨设备同步、共享布局和服务器侧配置。

## 4. 架构与目录问题

### 4.1 当前系统性问题

当前前端按技术类型为主组织：`components/workspace`、`lib`、`store`、`services`。
随着功能增长，一个 feature 的 UI、状态、领域逻辑和 IPC adapter 分散在多个目录。
这导致：

- 删除或迁移功能时难以确认完整影响范围；
- workspace 组件互相导入并直接调用多个 store；
- 纯逻辑被留在组件内部，测试必须加载 Monaco/Radix/Tauri；
- `useTabStore` 成为查询、结果、事务和数据编辑的综合状态容器；
- Git 只有两个大 Panel 文件，Driver Management 又被嵌入 Settings。

Rust 同样存在 `commands/table.rs`、`agent/host.rs`、`core/store.rs` 等横跨校验、
用例、SQL builder、I/O 和序列化的文件。

### 4.2 目标前端结构

采用渐进式 feature slice，不进行一次性搬家：

```text
src/
  app/                         # App、route、全局 provider、workbench composition
  features/
    query-editor/
      ui/
      model/                   # statement scope、completion adapter、execution target
      api/                     # 仅本 feature 使用的 service facade
      index.ts
    database-explorer/
      ui/
      model/
      object-actions/
      index.ts
    data-grid/
      ui/
      model/
      editing/
      import-export/
      index.ts
    driver-management/
      ui/
      model/
      api/
      index.ts
    version-control/
      commit/
      repository/
      diff/
      model/
      index.ts
    assistant/
      conversation/
      approvals/
      changes/
      model/
      index.ts
    database-admin/
      sessions/
      users/
      maintenance/
      index.ts
  entities/
    connection/
    database-object/
    query-document/
    project/
  shared/
    ui/
    lib/
    types/
  platform/
    tauri/                     # 通用 invoke/error/event transport
    monaco/
```

边界规则：

- `app -> features -> entities -> shared/platform`，反向禁止。
- feature 之间通过公开 `index.ts` 或应用层 coordinator 协作，不深层导入。
- Tauri command 名和序列化类型集中在 `platform/tauri`，UI 不直接 `invoke`。
- provider/capability 决定功能是否存在；组件不根据 driver 名称猜能力。
- store 按 feature 拆分，跨 store 流程由 use case/coordinator 承担。

### 4.3 目标 Rust 结构

先在单 crate 内建立层次，再把稳定协议拆成 workspace crate：

```text
src-tauri/src/
  interfaces/tauri/           # command 输入校验、Response 映射
  application/
    query/
    table/
    schema/
    agent/
    git/
    drivers/
  domain/
    database/
    query/
    schema/
    driver_package/
    command_policy/
  infrastructure/
    drivers/
    lsp/
    git/
    project_files/
    agent_sidecar/
    metadata_store/
```

稳定后新增：

```text
src-tauri/crates/
  oxide-driver-protocol/
  oxide-driver-runtime/
  oxide-driver-registry/
  oxide-sql-scope/
```

`oxide-driver-protocol` 不依赖 Tauri；bundled driver 和 external sidecar 必须通过
同一 conformance suite。`oxide-sql-scope` 为执行、LSP、inline completion 和
当前语句装饰提供统一契约。

## 5. 分阶段实施路线

### Phase 1：语义正确性与分包起点

- 在 SQL LSP 引入受测试保护的顶层软语句边界。
- 增加无分号双语句、CTE、INSERT SELECT、EXPLAIN、注释和未闭合输入测试。
- 从 `QueryEditor` 提取 model sync、completion adapter 和 statement decoration。
- 建立 `features/query-editor` 首个 feature 边界。

验收：第二条 SQL 的补全不继承上一条语句；现有 dialect tests 全部通过。

### Phase 2：驱动运行时

- registry/manifest/schema、平台/协议/digest/Minisign 信任校验。**基础已完成。**
- installer、staging、atomic current、rollback 和 offline import。
- supervisor、protocol handshake、health check、crash budget。
- Elasticsearch pilot 和 connection pin。

验收：不升级 Oxide 应用即可在两个兼容版本之间切换 ES driver，失败可原子回滚。

### Phase 3：Explorer 与 Admin

- 把 tree model、load coordinator、action descriptor 从 `SchemaSidebar` 提取。
- 新增 Sessions、Users/Roles、Maintenance 三类 admin capability。
- PostgreSQL/MySQL 先行，其它 driver 显式显示 unsupported，而不是空白或失败。

### Phase 4：Grid 深化

- 提取 grid presentation、editing session、server query、import/export。
- XML/array/map 等嵌套值视图；JSON tree 与加载页的只读 transpose 已完成。
- streaming import、mapping preview、reject rows 和 full compare。

### Phase 5：Git 与 Agent 收口

- Git 冲突工作台、stash、blame、merge/rebase。
- Agent Host 拆分，增加协议兼容、幂等恢复和隐私预算测试。
- Agent SQL 和人工 SQL 统一经过 dialect、risk、parameter 和 execution use case。

## 6. 测试策略

### 6.1 当前正向基础

OxideStudio 已有 157 个前端测试文件、794 个前端 test case，以及 300+ Rust
测试标记；LSP、Agent、Git、Table 和 shell policy 都有专项测试。这一基础应保留。

### 6.2 必须新增的测试层

1. **Contract tests**：前端 TypeScript 类型、Tauri payload、Rust serde 和 sidecar
   schema 使用同一 fixture。
2. **Driver conformance**：connect/ping/metadata/query/cancel/transaction/error
   对 bundled 和 external driver 运行同一套测试。
3. **Version matrix**：
   - PostgreSQL/MySQL 选择受支持的最低、主流和最新版本；
   - Elasticsearch 6/7/8；
   - MongoDB 最低与最新 aggregation/operator capability；
   - Redis RESP/version 差异。
4. **LSP context matrix**：dialect × server version × schema state × statement shape ×
   cursor context × metadata freshness。
5. **Long-running tests**：大 schema、大结果、大 Git 仓库、Agent resume、LSP restart。
6. **Failure injection**：driver crash、下载中断、digest mismatch、connection switch、
   stale completion、partial import 和 Git operation timeout。

## 7. 技术 UI 审计附录

该附录遵循本仓库 `impeccable` 技术审计维度，只评价可验证的实现质量，不把桌面
数据库 IDE 强行按移动网站标准设计。

| 维度 | 分数 | 主要观察 |
| --- | ---: | --- |
| Accessibility | 2/4 | 已有键盘、Vim、ARIA 和 focus 工作，但密集图标按钮及复杂 Grid/Tree 仍需系统验证 |
| Performance | 2/4 | Monaco/Glide/worker/缓存基础良好；超大组件与综合 store 扩大重渲染和订阅范围 |
| Responsive Design | 2/4 | 桌面分栏可缩放和移动，但窄窗口仍易产生工具拥挤、截断与横向溢出 |
| Theming | 3/4 | token、暗色和设置体系较完整，仍有第三方组件与局部 hard-coded style 待收口 |
| Anti-Patterns | 4/4 | 整体是明确的紧凑 IDE 语言，没有营销卡片、玻璃拟态或无意义渐变文字 |
| **总分** | **13/20** | **可接受；主要问题是复杂度与性能风险，不是视觉方向错误** |

### 系统性建议

1. **P1 `$impeccable optimize`**：拆分 workspace 巨型组件，缩小 store selector 和
   Monaco provider 生命周期。
2. **P2 `$impeccable harden`**：补齐 Tree、Grid、Dialog、动态审批和 IME 的
   键盘/ARIA/错误恢复矩阵。
3. **P2 `$impeccable adapt`**：为窄窗口定义工具栏折叠、Tab overflow 和双侧面板
   最小宽度策略。
4. **P3 `$impeccable polish`**：在功能边界稳定后统一第三方控件、tooltip 和
   focus ring。

## 8. 不应照搬的 dbx 内容

- 不复制 4,000–10,000 行 Vue/Rust 大文件。
- 不把数据库差异继续堆入单个 Connection Dialog、Query Editor 或 Data Grid。
- 不因 JDBC 覆盖广就默认让 Java/JAR 获得应用进程权限。
- 不将 driver agent 与 AI agent 混为同一概念。
- 不用前端确认框代替 Rust 可信边界。
- 不为了“数据库数量”在 catalog 中声明尚未通过 conformance test 的支持。

OxideStudio 的拔高方向是：**以可升级驱动扩展宽度，以统一 SQL scope 提升流畅度，
以 capability 和 feature boundary 控制复杂度，以 Agent/Git 安全闭环形成差异化。**
