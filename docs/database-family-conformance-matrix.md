# 数据库族 Conformance Matrix

本表以 dbx 的产品覆盖作为参考目录，不把“出现在连接菜单”视为支持。一个数据库类型
只有完成所属行的 contract 后，才允许由驱动包将它标为 `ready` 并进入连接创建列表。

## 通用交付门槛

### 版本证据的生成与绑定

`scripts/run-driver-conformance.mjs` 对一个精确 package entrypoint 运行
`connect/ping/version/parameterized query/error mapping/metadata` fixture，并生成不含
URL、凭据、SQL 或行值的哈希报告。签名 catalog 的 `conformance.evidence` 必须将该报告、
fixture、entrypoint、target 和 server version 一起绑定；声明的每个 operation/version 都必须
被至少一条 evidence 覆盖。详见 [driver-conformance-runner.md](driver-conformance-runner.md)。

### 当前可复现的本地证据

2026-08-02，DuckDB `oxide.duckdb@0.1.0` 的 Windows x64 release sidecar 已通过
`duckdb-core-v1` fixture：DuckDB `v1.5.5`、connect、参数化 query、错误归类、
schema/relation/column metadata 与 rollback transaction 均通过。该结果证明包与协议可运行，
但尚未成为 catalog `ready` 证据：发布流程仍需将精确 entrypoint 和该报告托管、以正式 URL
引用，并对 manifest 生成 Minisign 签名。ClickHouse 与 RQLite 已完成 release 构建和 payload
封装验证；由于当前工作区没有受控的真实服务端，二者尚没有可声明的 server-version evidence。
H2 的内存 JDBC fixture 已进入同一 runner；它在 managed Java 21 和经 digest 绑定的 H2 JAR
可用的 CI runner 上生成 package evidence，不能由本地 Maven 缓存缺失时的跳过测试替代。

| 层级 | 必须证明的行为 |
| --- | --- |
| Connect | URL/凭据不写入日志；connect、ping、server version 和失败归类可用；驱动包必须声明 network/file 连接方式，文件型包不能露出 host、SSH 或 TLS 控件。单端点且无 database/catalog URL 段的引擎可声明 `supportsConnectionDatabase: false`，连接表单只隐藏 database 字段，仍保留 host/port/认证字段。 |
| Query | 参数绑定、结果上限、取消、错误映射与只读策略按驱动能力声明执行；若要供 Agent 使用，sidecar 还必须在握手中声明并在运行时强制 `readOnly`，不能仅依赖 Host 的 SQL 解析。 |
| Create namespace | PostgreSQL/MySQL 使用 Host 的已验证方言 SQL。其它数据库只有在签名 manifest 声明 `supportsCreateDatabase` 且 runtime handshake 声明 `databaseCreation` 后，才能接收语义化创建请求；Host 不得为外部驱动拼接 `CREATE DATABASE`。owner、字符集和排序规则还必须分别声明 `supportsCreateDatabaseOwner`、`supportsCreateDatabaseCharset` 和 `supportsCreateDatabaseCollation`。 |
| Explorer | 数据库/namespace/relation/column/index/constraint 的实际支持与 manifest 一致；若声明外键，侧车还必须明确支持按被引用关系查询反向 FK，不能让 Host 扫描完整 catalog。 |
| Editor/LSP | 正确语言、identifier quote、对象名称和版本方言；无元数据时明确降级。签名的关系型驱动若暂未有内置厂商方言，可显式使用通用 `sql` document + 受审查的厂商 compatibility identity；LSP registry 将 identity 映射到明示 parser baseline，但 UI 不宣称厂商语法诊断。连接固定到某个 driver package 版本时，Editor 与 metadata sync 必须使用该版本的契约；UI 要独立展示 LSP process 与 schema metadata 的同步/缓存/降级状态。 |
| Grid | 只有声明 primary-key mutation、transaction 与参数绑定后，才能开放编辑；改列、改索引名、改约束必须分别声明对应的细粒度能力，不能由通用 DDL 推断。 |
| Table data transfer | 跨连接复制必须单独声明 `supportsTableDataTransfer`，并同时满足 relation browsing、事务与已审核的 PostgreSQL/MySQL/SQLite/DuckDB 方言；它有意独立于 Grid mutation，便于 DuckDB 等只开放受控批量复制的连接。runtime handshake 还必须提供事务。catalog 的 `conformance.dataTransfer` 只记录该**精确包版本**通过的 server 版本，不能由 `query`、`mutations` 或 JDBC 可连接状态推导。当前开放受限 append/overwrite；preview 必须输出结构化类型兼容性与转换、运行真实转换路径并生成绑定稳定 transfer id 的 exact confirmation token。执行使用有界分页和批次，但所有目标批次共享一个显式事务，任何读取/转换/写入或用户取消都回滚，全部成功后才提交；overwrite 只能使用可回滚 DELETE，并绑定/复检有硬上限的目标行数，不能使用可能隐式提交的 TRUNCATE。进度事件不得携带行值，取消必须声明 driver backend cancel 与有界协作式 fallback。 |
| Test | 包协议、离线安装、版本、metadata、query、cancel 和安全回归 fixture。 |

## dbx 参考族到 OxideStudio 路线

| 驱动族 | dbx 代表类型 | Oxide 当前 | 下一可交付物 |
| --- | --- | --- | --- |
| 原生关系型 | PostgreSQL、MySQL/MariaDB | 原生完整路径 | 扩版本 fixture 与 sidecar 迁移验证。 |
| 嵌入式 | SQLite、DuckDB、Turso、D1、Rqlite、H2、Access | SQLite 原生：文件/内存连接、查询、Explorer 元数据、LSP、分页/筛选/行编辑、表/视图/索引基础 DDL、Agent 引擎级只读查询与只读快照差异。DuckDB：独立 sidecar 源码已完成连接、原生参数绑定、查询、事务、attached catalog/schema/table/column/index/constraint 元数据、catalog 选择器/表格预览与 DuckDB 标识的 SQLite-compatible LSP 基线；已支持签名包能力驱动的 schema snapshot 与只读 diff，仍须由发布系统签名、安装和激活。RQLite：独立 HTTP sidecar 已实现 `readyz`/status、JSON 参数绑定、查询结果/错误映射、SQLite `main` schema 的表/列/索引/约束/反向外键 metadata；Agent 的只读请求强制使用 RQLite `/db/query` 服务端只读连接。 | DuckDB 取消、行编辑及专用 DuckDB 语法实现；RQLite 真实集群 fixture、发布签名与安装/激活；随后 Turso/D1。 |
| 企业 SQL / OLAP | SQL Server、Oracle、DB2、Firebird、Dameng、Kingbase、HighGo、Vastbase、ClickHouse | ClickHouse：独立 HTTP sidecar 源码已实现 `/` health、version、Basic Auth、database URL 选择、JSON query、数据库/表/列/data-skipping index metadata，以及安全的 `?`/`$n` 到 typed HTTP parameter 映射；Agent read-only request 固定为 HTTP GET。不声明行编辑、事务、取消或通用 DDL。其他产品由签名 sidecar 接入。 | ClickHouse 真实 23.x/24.x/25.x fixture、签名发布/安装激活、类型和错误流 fixture；随后 SQL Server。 |
| PostgreSQL 协议族 | Redshift、OpenGauss、GaussDB、Kingbase 等 | 复用 PG LSP/quote 的候选 | 每个包声明 server range 与 capability 覆盖，不允许仅改名称。 |
| MySQL 协议族 | Doris、StarRocks、OceanBase、GBase、GoldenDB | 复用 MySQL LSP/quote 的候选 | 先只读 metadata/query；事务和 Grid 编辑分别验收。 |
| Warehouse | Snowflake、Trino、Presto、Hive、Spark、Databricks、BigQuery | sidecar contract 可表达只读 | 以只读 query + catalog + 分页为第一阶段。 |
| 文档/搜索 | MongoDB、Elasticsearch、Neo4j、Cassandra、InfluxDB、Milvus、Qdrant | Mongo/ES 原生；其他待包 | 声明 document/search，而非强制 SQL 表格模型。 |
| KV/协调/消息 | Redis、Etcd、ZooKeeper、Nacos、Kafka/Pulsar | Redis 原生；其他待 admin provider | 独立 workspace/provider，不进入关系型表编辑器。 |

## 外置包约束

- `manifest.json.capabilities` 是签名内容，描述数据模型、LSP 语言、Explorer 对象和
  mutation 边界；它必须使用同一个 `driverId`。
- 未声明的历史包以保守关系型 fallback 兼容，但新包必须声明完整 contract。
- runtime handshake 继续证明 `query/metadata/cancellation/transactions` 实际存在；Agent 还要求 `readOnlyEnforcement`，
  以证明侧车会独立拒绝带 `readOnly` 上下文的写入；
  manifest 与 handshake 不一致时禁止启用高风险能力。
- `referencingForeignKeys` 是 runtime handshake 的独立开关。旧包缺省为 `false`，即使其
  manifest 声明了外键，关系图和引用导航也安全降级为空，直到包实际实现有界的反向查询。
- 产品层只显示 `ready + active` 包，未受信任、协议不兼容或 schema 不匹配的包仅在
  Driver 管理中显示故障与恢复入口。
- `supportsColumnAlteration`、`supportsIndexRename`、`supportsConstraintAlteration` 默认均为
  `false`。这使 SQLite、DuckDB 等“可查看/可建部分对象、但没有完整 ALTER 语义”的驱动
  不会在 Data Editor 中暴露不可执行的操作。
- Host 生成的 `SHOW CREATE`、view-definition 和 table-DDL SQL 只会发送给内置方言驱动。
  外置包即使复用了 `postgres` 或 `mysql` ID，也必须先交付单独的语义化定义/DDL 协议，
  不能由 ID 继承这些命令；Explorer metadata 仍可按它自己签名的能力契约使用。
- JDBC-only driver packages 使用 `runtime.kind: "java"`：Java 21、main class 和每个
  vendor JAR 都必须由 manifest 的 SHA-256 绑定。Host 只使用 Driver Registry 中受管理的
  JRE，绝不使用 `PATH` 中的 Java；通用 JDBC Agent 不声明 Agent read-only enforcement，
  所以没有厂商专用安全实现和 fixture 的 JDBC 包不会进入 Agent 数据库工具。
