# 外置数据库驱动族覆盖与验收清单

> 参考来源仅用于覆盖盘点：`/Users/houshuai/project/ai_project/dbx`。本文件不导入其
> 代码、JDBC 配置或执行规则。

## 目标口径

“支持 70+ 数据库”只在某产品存在已签名 sidecar package，且对应版本 fixture 通过
后成立。catalog 中显示、连接 URL 可以输入、或通用 SQL LSP 可用，均不构成已支持。

每一个包至少需要通过：连接/ping/version、带界限的 query、参数绑定、取消、真实
metadata、错误映射、断线恢复、驱动更新/回滚。声明写能力时，再增加 batch mutation、
事务或 partial-commit journal、类型映射、导入/导出和 schema post-verification。

`supportsTableRowMutation` 不是展示属性：它必须同时声明
`supportsTransactions`，并且启动时 Sidecar handshake 必须返回 `transactions: true`。
否则 package 会在连接凭据发送前被拒绝，Driver Manager 的验证结果也不会把它显示为
可编辑 Grid。这样“已安装的 JDBC/Sidecar 包”不会被误认为具备安全的数据写入能力。

`supportsTableDataTransfer` 是独立于 Grid 编辑的受控批量写入开关。它要求 table browse、
transactions，并要求包明确采用 Host 已审核的 `postgres`、`mysql`、`sqlite` 或 `duckdb`
分页/参数方言；启动时 runtime handshake 继续验证事务存在。只有同时满足这些条件的外置连接
才会出现在表→表复制的 target chooser，catalog 还必须在与当前 active `packageVersion`
完全匹配的 release 上提供 `conformance.dataTransfer`，才可向用户展示具体 server version
已经验证。generic JDBC、只读 warehouse 和仅支持 Grid 编辑的 sidecar 均不会因此获得
跨连接写入入口。

`tableExportFormats` 是独立的签名导出契约。可声明值仅限
`csv/json/jsonl/sql/tsv/xlsx/parquet/arrow`，且要求 relational table browse 与受审
PostgreSQL/MySQL/SQLite/DuckDB 分页方言。应用只返回“驱动声明 ∩ 当前构建编码器”的有效
集合。当前 Host 已实现 Arrow IPC 与 Snappy Parquet；只有内置 PostgreSQL/MySQL/SQLite
和具有已审 canonical value 编码的 DuckDB 包声明这两种格式。generic JDBC 与 RQLite 在
补齐值编码 conformance 前继续只声明 CSV/JSON/JSONL/SQL/TSV/XLSX，不能仅凭相似方言
获得分析格式入口。无法无损映射的列保留为 UTF-8/JSON，并携带源类型 metadata 与有界提示。

## 产品目录与实际执行目录分离

`src/features/database-drivers/model/referenceDriverCatalog.ts` 保存一个可测试的产品
目录：包含 dbx 的 68 个 `DatabaseType` 参考项，以及 5 个明确标注为 compatibility 的
常用 SQL 产品。这是发布规划和 Driver Manager 的覆盖盘点，不是可连接 driver registry。

状态只允许按下列方向提升：

```text
reference candidate
  → signed catalog release
  → installed package
  → ready + active package (+ managed Java when required)
  → backend capability catalog
  → connection selection / pinned package / editor-LSP context
```

因此一个“Package required”产品不能出现在新建连接、Agent provider 或 LSP 可选方言中。
只有 `list_database_capabilities` 返回的内置驱动或已激活签名包才是该构建的权威目录。
候选项用 `relational / document / keyValue / search / graph / wideColumn / timeSeries /
coordination / queue` 描述产品域；签名 package 的 capability contract 仍必须声明当前
Workbench 已实现的安全数据模型和具体操作边界。尚无专用工作区的 graph、time-series、
coordination 和 queue 包不得把自己伪装成可编辑关系表。

非关系型产品只有在签名 contract 明确声明 `lspLanguageId: "sql"` 时才会进入 SQL
语法/通用 completion 路径（例如 SQL-shaped time-series 引擎）；`cypher`、CQL 或厂商
语言会保持纯文本，直到其专用语言服务被交付。无论是否选择 SQL LSP，这些产品都不会
通过该开关进入关系型 Grid。

`sql` 是编辑文档语言而不是 bundled LSP 的独立 parser 名。通用 SQL 包（例如尚未有
专用 parser 的 JDBC 产品）保持 `.sql` 虚拟 URI，并在同步时显式映射到签名 capability
声明的受审查 server baseline（默认 PostgreSQL；已验证的 MySQL-compatible 包可选
MySQL）。schema mapping 因而仍绑定到同一编辑器文档，且状态栏会显示 “SQL generic”，
不宣称厂商特有语法诊断。

这解决了“70+”的统计口径：73 个产品目标可被审计，但已支持数量只从 unique、ready、
active 的签名 package（或内置 recovery driver）得出，协议兼容别名与同产品多个版本均不
重复计数。

Driver Manager 的候选行会在用户检查过签名 HTTPS catalog 后显示匹配 release 的版本，并
直接复用同一条 digest-bound 安装链路；它不会自行访问网络、选择版本或绕过 catalog
签名。没有 `archiveSha256` 的 release 仍只显示为 review/import，保持离线审阅路径。

catalog 下载使用 `<sha256>.tar.gz` 与同目录 `.<sha256>.tar.gz.partial` 作为唯一缓存身份。
网络中断会保留 partial，重试发送严格的 HTTP Range；206 必须从已保存字节精确继续，服务端
忽略 Range 返回 200 时会截断后重新全量下载，416 只有在 partial 已通过 catalog SHA-256
时才允许发布。任何路径最终都必须完成摘要复验，随后原子改名为完整缓存，不能直接从
partial 解压或执行。Registry 级异步锁避免并发安装覆盖同一缓存。

Settings 的 **Clean cache** 只清理 catalog 归档，不删除已安装 package/runtime。清理与下载、
安装/激活串行，并自动保留 active、previous rollback、所有保存连接固定的 packageVersion
和当前 live sidecar 使用的版本。扫描只接受安全 driver/version 目录和 64-hex 摘要命名的
普通归档/partial 文件；未知文件、目录与符号链接会保留并报告，而不是递归删除。

运行时观察同样按最小披露原则处理。Driver Manager 只汇总 package identity、连接数、
可观察 PID、PID 不可观察数以及已退出 sidecar 数；不会显示连接名、URL、账号、请求内容
或 sidecar stderr。后两种状态必须提示用户重新连接，而不能尝试从设置页面向
connection-owned process 发送任意控制信号。

候选行还会将 **Active package** 与 **Verified: server versions** 分开：后者仅在当前
ready + active package 的 `packageVersion` 与已检查的签名 catalog release 完全相同，且该
release 的 `conformance` 有版本记录时显示。离线导入包、catalog 中的另一版本，或没有
conformance 记录的 active package 一律显示为“Active · no version evidence”。因此安装
成功不会被误写成某个数据库服务器版本已完成验证。

## 已可执行基础

外置包现在同时支持两种受签名保护的运行时契约：默认的 native executable，以及
`runtime.kind: "java"`。后者只允许 Java 21、显式 main class 和逐个 SHA-256 绑定的
classpath；Host 只从 Driver Registry 内已激活的受管理 Java runtime 启动它，绝不从 `PATH`
寻找或执行任意 JVM。JRE 与 vendor JDBC package 分别签名、导入、激活；每次 JDBC 启动前
都会复验 active runtime 的签名和 Java binary SHA-256。`package-managed-java-runtime.mjs`
会将 JRE 打成可审阅、无符号的导入目录（解引用符号链接），随后必须为 `runtime.json` 生成
Minisign 签名才能在 Driver Manager 导入。这样 JDBC 生态可作为 70+ 目标的扩展层，同时仍
保留原生 Rust/Go 侧车作为优先路径；没有已验证 JRE 时，连接会给出恢复说明而不会降级使用
系统 Java。

为避免 70+ 候选产品在制包时被随意标成 PostgreSQL/MySQL 方言，
`create-jdbc-driver-capabilities.mjs` 支持 `--reference-driver <catalog-id>`。
它仅选择保守的连接、namespace、标识符引用和 LSP 基线：兼容 PostgreSQL/MySQL 协议的
产品默认仍使用通用 `sql` LSP，不会伪装成已验证的厂商诊断；只有明确选择并验证
`postgres` 或 `mysql` profile 的发布包才能采用对应专用 LSP。该快捷映射不改变任何
写入、DDL、迁移或 Agent 权限，所有此类能力仍须由签名 manifest、runtime handshake 与
版本 conformance fixture 独立证明。

通用 JDBC Agent 已具备受限的语义化 namespace-create 协议；制包时只有显式传入
`--supports-create-namespace` 才会在 contract 中声明它。该开关不会允许 owner、charset
或 collation，也不会让 Host 生成 `CREATE` SQL；JDBC Agent 会按签名的 `schema`/`database`
namespace kind 重新验证并使用 JDBC metadata 的引用规则构造语句。

JDBC 打包器同样接受 `--server-version-range '>= 2.3.232 < 2.4.0'`，并将其写入签名
manifest。连接后 Host 从服务器 banner 提取版本并重新校验范围；不匹配的服务不会以
“已支持”状态留在工作区。

通用 JDBC Agent 的打包器只接受 `dataModel: relational`，并拒绝 collection/key-value
浏览声明。它不能把 JDBC metadata 伪装为 graph、document、time-series、coordination 或
queue 工作区；这些 DBX 参考产品仍必须交付专用 sidecar、原生请求编辑器和对应的安全
conformance 后才能进入可连接目录。

| 驱动/族 | 当前路径 | 已验证边界 | 仍需补齐 |
| --- | --- | --- | --- |
| PostgreSQL | bundled | query、metadata、表编辑、事务、schema migration | 外置 recovery package、版本 fixture |
| MySQL / MariaDB | bundled | query、metadata、表编辑、非事务 migration journal | 外置 package、版本 fixture |
| SQLite | bundled file | metadata、Grid mutation、CSV/JSON import/export | rebuild-table migration planner |
| DuckDB | signed sidecar | query、参数、事务、attached catalog、reverse FK、Grid import/export | server-style namespace creation 不适用 |
| RQLite | signed sidecar source | HTTP ping/status、parameterized query、SQLite `main` metadata、server-enforced Agent read-only endpoint | real-cluster version fixture、signed release/activation、bounded Grid mutation contract |
| ClickHouse | signed sidecar source | HTTP health/version、Basic Auth、database selection、JSON query、database/table/column/data-skipping-index metadata、ClickHouse LSP identity、Agent HTTP-GET read-only enforcement | real 23.x/24.x/25.x fixture、signed release/activation、server-version type/error matrix; no grid mutation/transaction/cancel claim |
| Generic JDBC Agent | portable Java 21 source + signed package assembler | JDBC `DriverManager`、query、`Statement.cancel()` 查询取消、JDBC metadata（表/列/索引/主外键/反向外键/例程）、JSON-native scalar result types、vendor JAR classpath hash binding、manifest-bound protocol identity、managed JRE signed import/activation；可按签名能力执行受限 `CREATE SCHEMA` / `CREATE DATABASE`，执行端限制 55 秒、2,000 行、单元格与约 3 MiB 响应预算；H2 2.3 fixture 已覆盖能力文件生成、实际 JAR 打包/哈希 manifest、连接、参数、typed result、schema creation，以及 relation/column/index/foreign-key/reverse-FK metadata | Trino fixture, then vendor packages and version matrices; owner/charset/collation 和 Agent read-only/transactions 仍必须由专用 sidecar 实现 |
| MongoDB | bundled | collection metadata、query、Mongo completion | server-version aggregation matrix |
| Redis | bundled | key metadata、command/query workspace | command-version/admin matrix |
| Elasticsearch / Easysearch | bundled HTTP | 6/7/8 route handling、mapping completion | 外置 package、完整 endpoint fixture |

## 第一批：SQL 协议兼容族

这些产品优先通过一个或多个 sidecar package 接入；不能仅声明 PostgreSQL/MySQL
方言后跳过 metadata、pagination、parameter 与版本测试。

| 族 | 产品目标 | 首次能力 | 版本/差异验收 |
| --- | --- | --- | --- |
| PostgreSQL compatible | Redshift、Kingbase、HighGo、UXDB、Vastbase、OpenGauss、GaussDB、KWDB、Cloudberry、YugabyteDB、CockroachDB | read-only query + metadata + generic/PG LSP | identifier、catalog/schema、分页、DDL transaction policy |
| MySQL compatible | MariaDB、Doris、StarRocks、OceanBase、GoldenDB、GBase、TiDB、Sundb | read-only query + metadata + MySQL LSP | parameter marker、limit、catalog、auto-commit DDL |
| Column/OLAP | ClickHouse、Databend、QuestDB、Vertica、Exasol、Teradata、Kylin | ClickHouse 已有独立 HTTP sidecar 源码；其余 query + metadata + generic SQL LSP | ClickHouse fixture/release signing；其余 type mapping、HTTP/native protocol、cancel、read-only mutation policy |
| Enterprise relational | SQL Server、Oracle、DB2、Informix、Dameng、YashanDB、Xugu、IRIS、SAP HANA、Firebird、Access、H2、Oscar | query + metadata + generic SQL LSP | URL templates、identifier quote、driver runtime/JDBC isolation、type/LOB fixtures |
| Warehouse/Federation | Databricks、Snowflake、Trino、PrestoSQL、Hive、Spark、BigQuery | read-only query + metadata | auth model、catalog hierarchy、async jobs、cost/limit guard |

## 第二批：非关系型与专用工作区

这些系统不得被放入关系型 Grid/DDL 路径。每一个包需声明 data model，并提供对应的
Explorer、编辑文档语言和操作安全策略。

| 族 | 产品目标 | 工作区 | 首次验收 |
| --- | --- | --- | --- |
| Search / vector | ManticoreSearch、Qdrant、ChromaDB、Milvus、Weaviate | JSON/request editor | collection/index metadata、pagination、query shape completion |
| Wide-column / time-series | HBase、Cassandra、TDengine、IoTDB、InfluxDB | native query/request editor | namespace/measurement model、retention/type fixture |
| Graph / coordination | Neo4j、Etcd、ZooKeeper、Nacos | graph/key-value/admin workspace | mutation safety、watch/timeout、object navigation |
| Messaging | Kafka、Pulsar、RocketMQ、MQ | topic/consumer admin workspace | broker auth、read-only inspect、dangerous action policy |

目标覆盖以 dbx 当前 `DatabaseType` 的 68 个连接类型为参考基线；其中 `jdbc` 与 `mq`
属于扩展入口而非独立产品，不能拿来虚增产品数。再按 MariaDB、TiDB、CockroachDB、
YugabyteDB 等常用兼容产品补足，形成 70+ 的可发布包目标。最终的“独立产品”数量以签名
catalog 中唯一 `driverId` 为准；同一产品的协议兼容模式不得重复计数。未被 package
conformance 标记为 ready 的产品必须显示为“available package required”，不得出现在
可连接驱动下拉框中。

## 包级验收记录格式

每个 release 应附带以下信息，并由 Settings 的签名 catalog 仅作发现展示：

```json
{
  "driverId": "example-db",
  "packageVersion": "1.0.0",
  "serverVersionRange": ">= 4 < 6",
  "connectionUrlTemplate": "jdbc:vendor://{host}:{port}/{database}",
  "capabilities": {
    "dataModel": "relational",
    "lspLanguageId": "sql"
  },
  "conformance": {
    "connect": ["4.0", "5.0"],
    "metadata": ["4.0", "5.0"],
    "query": ["4.0", "5.0"],
    "cancellation": ["5.0"],
    "mutations": [],
    "dataTransfer": []
  }
}
```

`conformance` 不是 Host 的执行授权；真正授权仍来自 package manifest 与启动 handshake。
不过 catalog 导入时已经校验它与 capability contract 一致：取消、Grid 修改、迁移和数据
传输不能为未声明的能力伪造测试覆盖。它仍需在发布流程中关联到可复现 fixture，才能构成
某个 server version 的“已验证支持”证据。

对于 JDBC 或其他拥有非通用 URL 语法的包，`connectionUrlTemplate` 是签名 manifest 的
一部分。它只可使用 `{host}`、`{port}`、`{database}`、`{user}`、`{password}` 五种占位符，
用来在连接表单预填 `jdbc:oracle:thin:@...`、`jdbc:trino://...` 等厂商格式。用户仍可编辑
最终 URL；Host 不重新解释或改写已选 package 的 JDBC 前缀，Sidecar 也仍须通过其自身的
manifest-bound handshake 才会收到连接信息。
