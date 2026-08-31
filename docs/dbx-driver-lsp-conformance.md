# DBX 参考：驱动与 LSP 收敛矩阵

> 参考工程：`/Users/houshuai/project/ai_project/dbx`。该工程只用于分析，不会被
> 作为 OxideStudio 的运行时依赖、驱动来源或权限边界。

## 结论

DBX 将三个概念分开：产品类型、方言描述、连接运行时。当前基线在原目录上新增了
ArgoDB；产品类型、方言描述与连接运行时仍是三个独立概念。`plugins/dialects` 的声明式
SQL 方言数量也明显小于产品目录。两者不应被理解成“所有目录项都具有相同的 SQL
编辑器、关系型 Grid 和可写能力”。DBX 的桌面端语义补全同样
先按方言族选择标识符、限定名和别名可见性，再基于已连接的 metadata 提供对象建议。

Oxide 应继续采用更严格的口径：新建 Data Source 的搜索目录可以展示全部参考产品，
以便用户发现和选择目标；但一个产品只有在**已签名、已激活的运行时包**通过
`connect + version + metadata + query + cancellation + error mapping` 后，测试、保存与连接
操作才会解锁。Catalog 的产品行、JDBC 方言模板、或 SQL generic LSP 都不是“已支持”的证据。

## 当前映射

| DBX 路线 | Oxide 运行时路线 | 编辑器/LSP | 可发布门槛 |
| --- | --- | --- | --- |
| PostgreSQL、MySQL/MariaDB、SQLite | 内置 recovery driver | 各自专用 SQL LSP | 现有原生版本矩阵持续扩展 |
| MongoDB、Redis、Elasticsearch | 内置 provider | collection/key/DSL provider | 不进入关系型 SQL Grid |
| DuckDB、rqlite、ClickHouse | 已有侧车源码，需签名包激活 | DuckDB/SQLite、SQLite、ClickHouse | 真实版本 fixture、签名 release、连接级 conformance |
| DBX 关系型 JDBC 产品 | Java 21 JDBC Agent + vendor JAR 签名包 | 已验证 parser 则专用；其余为 `SQL generic` 文档 + 厂商 compatibility ID + 明示 parser baseline | 每产品 URL、metadata、类型、取消、版本 fixture |
| DBX SQL-shaped 非关系产品（QuestDB、Manticore） | 专用 HTTP 侧车 | 仅显式 `sql` 时 generic SQL metadata completion | 不进入可编辑 relation Grid |
| Graph、wide-column、time-series、coordination、queue | 专用 sidecar/workspace | 自己的语言 provider；未实现前无 LSP | 原生对象模型与安全操作 contract |

## 产品族与保守 LSP 基线

| 产品族 | 首选包形态 | 默认 LSP 身份 | 说明 |
| --- | --- | --- | --- |
| PostgreSQL 协议兼容（Redshift、Kingbase、HighGo、OpenGauss、GaussDB、UXDB、Vastbase、Cockroach、Yugabyte、Greenplum、Timescale） | signed JDBC/sidecar | `sql` | 不因协议相似冒充 PostgreSQL 专用诊断；完成方言 fixture 后才可声明 `postgres`。 |
| MySQL 协议兼容（Doris、StarRocks、GoldenDB、TiDB） | signed JDBC/sidecar | `sql` | 保留反引号与 database namespace 默认值，仍走 generic 语义。 |
| DuckDB/rqlite | signed native/HTTP sidecar | `duckdb` / `sqlite` | 已有兼容 parser 路线；必须有包才可创建连接。 |
| ClickHouse | signed HTTP sidecar | `clickhouse` | 已有专用 LSP 身份；Host 语句范围扫描使用 backtick-safe 边界，但不伪造 MySQL 语法验证。 |
| Hive、ArgoDB | signed JDBC package | `hive` / `sql` + `argo` identity | bundled LSP 已有 Hive completion scope 测试；Argo 保留独立产品身份并委托 Hive parser baseline。 |
| SQL Server、Oracle、DB2、H2、Informix、Firebird、Dameng、IRIS 等 | signed JDBC package | `sql` | 先完成 metadata/query，随后再增加真正厂商 parser。 |
| Warehouse（Trino、Presto、Spark、Snowflake、BigQuery、Databricks） | signed JDBC/HTTP package | `sql` | 默认只读；异步 job、成本、分页、认证需要独立 conformance。 |

## 已落地的收敛点

- `referenceDriverDeliveryPlan` 为全部 74 个参考/兼容产品给出明确的 runtime 与
  LSP/workspace 路线，并显示未来签名 capability 可使用的受审查 parser baseline。
  DBX 的 35 个声明式方言现均有专用或 compatibility 路线：例如 Doris 的 document 仍为
  `sql`，server identity 为 `doris`，registry 明确委托给 MySQL baseline；Oracle 则保留
  `oracle` identity 并委托给 PostgreSQL baseline。它们不会被描述成厂商专用诊断，且后续
  可直接用真正 parser 替换别名。该计划不改变产品的可连接状态。
- JDBC capability generator、前端 LSP session 和 Rust 签名 contract 使用同一批受审查
  compatibility identity；未知 vendor id 仍安全失败并回落到 generic PostgreSQL 路线。
- Mongo 编辑器当前语句与执行 target 已改为 JSON command range，Rust/LSP 同时支持
  单对象、顶层数组和空白分隔命令流；aggregation stage 继续按 server version 过滤。
- Settings 的 Driver Manager 同时显示产品域、建议运行时、激活后智能路线和签名 release
  证据，避免把“候选产品”误当作可用驱动。
- ClickHouse 的外置连接已可使用有界 statement-at-cursor 扫描，多个 SQL 片段不会因其
  专用 LSP 身份而失去当前语句解析。
- JDBC capabilities generator 对 49 个 DBX/兼容关系型 JDBC 候选提供保守 profile；它默认
  禁止 Grid 写入、DDL、迁移和表间复制。
- 从签名 Catalog 安装的 package 会在解压后把 manifest 与 Catalog 条目逐项绑定：driver/version
  之外还必须匹配 protocol、显示名、目标平台、server-version range、连接模板与（若 Catalog
  声明）capabilities。任何 metadata/query/cancel/write/migration/transfer conformance 都必须
  同时存在 connect conformance，避免把“未连通的功能测试”展示成可发布版本证据。
- 外置 capability 的 `identifierQuote` 仅可声明空、`"`、`` ` `` 或 `[`；该值同时进入
  SQL 补全和表格 SQL 生成，Host 会在签名包导入阶段拒绝其他字符串。SQL Server 的 `[` 会
  使用 `]` 作为闭合/转义字符，不会退化为 PostgreSQL 双引号。
- SQL Server 的 cursor statement scanner 与托管网关解析均已按 T-SQL `[...]` identifier
  处理；方括号内的分号不会被误判为下一条语句。通用 Host 不会给 SQL Server 伪造
  `BEGIN READ ONLY` 或 `EXPLAIN` 包装：只有 package 明确提供 driver-enforced read endpoint
  后才允许 Agent 只读执行，Explain 仍需该包交付厂商实现。

## 仍需以 release 逐项完成的事实

当前并不是“所有数据库已经支持”。除了内置六种数据库外，其他产品仍需各自的签名
package 与真实版本 conformance。尤其下列事情不能由 generic LSP 取代：

1. vendor JAR/HTTP client 的可复现打包、签名、回滚；
2. 真实 server version 的 metadata、类型、分页、参数与取消 fixture；
3. 非关系型系统的 Explorer、编辑器、危险操作和权限模型；
4. 只读 package 到可写 Grid/DDL 的单独事务、回滚和 post-verification 合同；
5. 供应商专用诊断、formatter、quick fix 和高级语义补全。

因此发布页的“支持数”必须从 ready + active package 和其精确 package version 的
conformance 记录计算，不能从参考目录长度计算。

## 验收顺序

1. 为 DuckDB、rqlite、ClickHouse 生成并签署多平台 package，跑真实版本 fixture。
2. 将 H2 fixture 扩展为可发布的 JDBC reference package，再落地 Trino/SQL Server/Oracle
   的各自 fixture，不共用“JDBC 通过”结论。
3. 每个协议兼容族至少选一个代表产品交付后，再按版本矩阵扩展同族产品。
4. 搜索、图、时序、协调与消息系统在自己的 workspace/provider 交付前保持不可选。
5. 每个新包添加前端 LSP route、Rust statement scanner、Driver handshake 及真实服务
   integration tests；任何不一致都使包不可激活。
