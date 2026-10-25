# 大表比较：分层采样与结果边界

整表比较仍在每侧最多 100,000 行时读取全部行。超过该阈值、且两侧均不超过 10,000,000 行时，默认采用 `stratified`；再大的表仅读取行数并显示跳过风险。没有提高原有完整比较或采样区间上限。

## 选键与逐键复核

分层策略按声明唯一且非空的键排序，把每侧关系划为最多 16 个区间，在首部、中段和尾部读取不重叠的键窗口。窗口按行位置确定，不假设整数主键连续，也不按键值的数值大小插值；复合、文本和稀疏键同样使用数据库自身排序。

每侧默认最多抽取 10,000 个键。两侧样本去重形成共同键集合，再分别使用参数化条件读取两侧对应行，最后比较完整选定值和样本列摘要。共同集合最多为 20,000 个键；一侧的键会在另一侧复核，避免只比较两份独立样本。

显式请求 `samplingStrategy: "extremeValues"` 继续使用首尾策略。它现在也按驱动的 1,000 行边界拆分查询；原来一次请求 5,000 个键可能被驱动截为 1,000 个的问题已修复。完整比较仍使用原有 keyset 路径。

## 预算

| 范围 | 当前约束 |
| --- | --- |
| 键查询 | 每侧最多 16 次，每次最多 1,000 行；返回截断标志或短读时拒绝结果。 |
| 偏移 | 从首尾中较近的一端读取；每侧全部 `OFFSET + LIMIT` 的位置预算最多 40,000,000。该数值不等同于优化器实际扫描、排序或磁盘 I/O 上限。 |
| 等待 | 单个选键查询最多等待 10 秒，每侧选键阶段最多 60 秒；超时会按注册的 query ID 请求驱动取消，取消调用另限 2 秒。服务器中止能力取决于实际驱动。 |
| 本机键 | 每侧键的规范化 JSON 累积最多 16 MiB。 |
| 样本值 | 每侧已累积样本值的 JSON 最多 64 MiB，超限拒绝结果。该值不包含当前驱动页、解析和容器开销，不作为进程峰值内存承诺。 |
| 结果明细 | 每种差异最多返回 1,000 行；计数和摘要覆盖已检查样本。 |

选键等待预算不包含之前的 COUNT 或后续逐键值读取。偏移查询可能比首尾读取昂贵；大表、不同索引/排序规则和外置适配器仍需独立性能与取消验收。准备和比较不修改目标数据。

## 覆盖率和一致性

覆盖率取两侧实际读取行数占各自行数比例的较低值；空表视为全部已覆盖。共同键集合可能包含另一侧不存在的键，不能用“并集键数 ÷ 较大表行数”放大行覆盖率。

采样结果固定为 `countsExact: false`，不提供统计置信分数，也不支持生成同步写入计划。样本摘要一致只能说明被检查的键和值一致。确定性分层不是随机抽样，仍可能遗漏未采样区域的差异。

各查询不是同一个跨连接事务快照。窗口短读、重复或截断会导致拒绝，但这不能检测所有并发变化；表在变化时应重新比较，不把该结果当作某一时点的整表一致性证明。

## 原生关系型元数据与值保真修复

真实回归同时发现并修复了三处基础问题：

- rowid 别名 `INTEGER PRIMARY KEY` 虽然 PRAGMA 的 `notnull` 为 0，实际仍不能存储 NULL；驱动现在结合独立主键索引判断。内联 `INTEGER PRIMARY KEY DESC`、普通 `INT PRIMARY KEY` 和复合键保留各自的真实语义，附加 schema 也实际验证。
- SQLite、PostgreSQL、MySQL 的复合主键/唯一索引不会再把其中一个成员标为独立唯一键；完整单列唯一索引才提供该标志。PostgreSQL 同时识别不附带约束的唯一索引，排除部分/表达式索引，并区分唯一键与 INCLUDE 附加列；MySQL 按实际 STATISTICS 索引组核对，不仅依赖 COLUMN_KEY。
- SQLite 结果按每个值的实际存储类型解码，避免首行 NULL 或其他列类型导致后续整数、文本或二进制误读为 NULL。

rowid 与主键空值语义依据 [SQLite 官方 CREATE TABLE 说明](https://www.sqlite.org/lang_createtable.html#rowid)，同时用真实引擎插入和元数据结果核对。

PostgreSQL 键列与附加列的区分见 [pg_index 官方定义](https://www.postgresql.org/docs/16/catalog-pg-index.html)；MySQL 的 PRI/UNI 提示并不直接证明单列独立唯一，见 [COLUMNS 官方定义](https://dev.mysql.com/doc/refman/8.0/en/information-schema-columns-table.html)。两者均有真实索引和比较键验证，未仅根据提示字段推断。

## 实现与复验

- [选键计划和执行](../src-tauri/src/commands/table/compare_sampling.rs)、[比较分派](../src-tauri/src/commands/table/compare_execute.rs)、[逐键读取及覆盖率](../src-tauri/src/commands/table/compare_rows.rs)。
- [六项本地采样回归](../src-tauri/src/commands/table/tests/compare_sampling.rs)：100,001 行、仅第 50,001 行不同，首尾样本漏掉而分层样本发现；两种策略真实读到 10,000 个键；稀疏复合 Unicode/大整数键；窗口完整性、取消及预算分布。
- [原生 PG/MySQL 用例](../src-tauri/src/commands/table/tests/compare_sampling_live.rs) 在独立实例执行同样的中段差异与 10,000 键验证。使用 `node scripts/test-native-sql-databases.mjs --compare-only`；也已纳入默认原生入口和 Linux 手动矩阵。

真实版本、运行目录和计数见 [SQL 验收](NATIVE_SQL_ACCEPTANCE.md)，剩余产品/平台及其他对齐项见 [完整差距清单](dbx-gap-analysis-2026-10-22.md)。
