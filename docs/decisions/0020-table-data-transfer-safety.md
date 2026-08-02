# ADR-0020：跨连接表数据迁移的受控执行边界

## 状态

已接受（2026-07-31）。

## 背景

dbx 的 Data Transfer 工作流证明“读取一个表再写入另一个表”是独立于 CSV 导入和
schema migration 的产品能力。它同时跨越两个连接、两套权限和可能不同的事务模型。
把它实现为前端先读完数据、再逐行拼 SQL，或把它交给 AI Shell，都会绕开现有的参数
绑定、表对象检查和可审计的 mutation 边界。

## 决策

以现有 `commands/table.rs` 的数据编辑边界实现 `preview_table_data_transfer` 与
`execute_table_data_transfer`，当前提供 **append** 与受控 **overwrite**：

1. 预览和执行都重新读取 source/target 的列元数据；不可重放的 `transferId`、source/target/table/列映射（包括源/目标
   类型）/行数上限/批次大小会参与 SHA-256 确认 token。执行时 token 不匹配即拒绝；计划变化后旧预览不能执行，
   同一活动 ID 不能并发执行。
2. 按列名大小写不敏感映射；无映射列直接拒绝，source-only 列作为 warning；未映射且
   无默认值、非 nullable、非 auto-increment 的 target 列直接拒绝。
3. source 使用受限分页读取；每次执行最多 10,000 行，每个 batch 最多 500 行。target
   仍走参数化 `INSERT` 与 driver batch API，绝不生成可注入的值字面量。
   preview 会显示两端字段类型和 `exact/safe/review/unsupported` 兼容级别；JSON/标量到文本等
   已审核转换使用与执行相同的转换路径，未审核组合直接阻止。值始终通过目标参数绑定。
4. source 和 target 不是全局分布式事务，但一次 target 迁移使用一个显式事务：所有有界 batch
   成功后才提交，读取、转换、写入或用户取消任一失败都回滚整个 target 事务。驱动不能提供该
   contract 时不得声明 `supportsTableDataTransfer`。
   overwrite 不使用可能隐式提交的 `TRUNCATE`，而是在同一事务中执行参数化边界内的
   `DELETE FROM`。preview 读取并绑定目标行数，当前硬限制 100,000 行；执行时实际删除行数
   与预览不一致即回滚并要求重新预览。
5. 当前只为 PostgreSQL、MySQL、SQLite、DuckDB 的已验证 Table Data dialect 开放。
   外置 package 只有在签名 manifest 显式声明 `supportsTableDataTransfer`，同时具备
   `supportsTableBrowsing`、`supportsTransactions`，并选择已审核的 `postgres`、`mysql`、
   `sqlite` 或 `duckdb` 方言时才会进入 chooser；它有意不由 Grid mutation 推导，runtime handshake 仍必须
   提供 transactions。只有随后在 catalog 的 `conformance.dataTransfer` 为该精确包版本
   记录了 source paging、parameter binding、type mapping、transaction / partial-commit
   和 source/target fixture 的 server version，Driver Manager 才能将它显示为已验证。
   “query 已验证”、普通 Grid 编辑或 generic JDBC 可连接均不构成迁移授权。
   若包复用了 `postgres`、`mysql` 等内置 driver id，Host 仍优先读取该 live package 的
   显式能力；内置方言白名单不能将包的 `false` 扩大为迁移许可。
6. endpoint 携带的 driver 只是展示/方言选择输入。桌面连接建立时会保存规范化的实际
   driver identity；预览和执行均先将两端 endpoint 与该 identity 对比，不一致即拒绝。
   这样陈旧 tab、前端篡改或错误复用连接 ID 不会改变 Host 选择的 SQL 方言。
7. 执行通过 `table-data-transfer://progress` 发送只包含 transfer id、行数、批次数和状态的
   有界事件。取消命令先请求 source driver 的 backend cancellation，再发送协作式取消信号；
   不支持立即取消的驱动会在当前有界 batch 返回后检测信号并回滚。活动 ID 到执行完成前不会
   从 registry 移除，因此不能用同一 ID 并发或重放迁移。
8. 目标表不存在时采用独立的两阶段 DDL 流程，而不把建表伪装进数据复制事务：Host
   先从 source column metadata 生成目标方言的保守类型、`CREATE TABLE`、warning 与
   `CREATE <digest>` 确认短语；用户确认后仅创建空表，刷新 metadata 后再进入普通
   transfer preview。该入口只对内置 PostgreSQL、MySQL/MariaDB 与 SQLite Host DDL
   builder 开放；外置 package（包括 DuckDB sidecar）必须先实现独立的 semantic DDL
   conformance contract。生成计划保留列名、主键和 nullability，但不臆造 identity、
   sequence、default、FK、check、trigger 或 index。

## 后果

- 用户得到从当前 Table Data 视图进入的 target 选择、预览、映射与 exact-token 确认流程。
- 目标建表只创建经过独立确认的空表；它不会承诺与随后的数据复制跨方言原子，也不会
  自动复制 identity/sequence/FK 等语义。merge/upsert、无限复制、后台续传或自动
  scheduler 仍需要额外处理 key 冲突、依赖顺序、锁、幂等恢复和审计 journal。
- schema migration 仍使用独立的 snapshot/preflight/apply/post-verify 流程；Data Transfer
  不推断或创建目标表结构。
