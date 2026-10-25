# PostgreSQL 可恢复整表迁移

桌面迁移对话框的 `Full table transfer` 支持保存的原生 PostgreSQL 连接之间迁移一个现有表。此路径使用私有源快照和持久任务，不继承原有小任务的行数上限、建表、恢复源 schema 或 identity 开关。SQLite 的不同快照范围见 [SQLite 使用说明](SQLITE_RESUMABLE_TRANSFERS.md)。

## 使用与支持范围

1. 在同一项目选择两个已保存的原生 PostgreSQL 连接、一个源表和一个现有目标表，选择 append、overwrite 或 upsert。
2. 进入 `Full table transfer`，准备快照。准备需要读取源表，并扫描目标现有内容以绑定审核；大表准备可能耗时。
3. 核对连接名、数据库、schema、表、模式、源行数、现有目标行数和列映射，输入当前审核短语再开始。暂停后也须重新输入短语。
4. 复制期间可以关闭对话框。应用完全退出后任务停止；重开相同 profile 和项目可恢复。准备完成后恢复不要求源服务器在线。

支持持久的普通表和分区表、用户 schema、append / overwrite / 主键 upsert。源不要求主键：快照建立后按本机不可变序号遍历。列先按精确名称匹配，再允许无歧义的大小写匹配；目标生成列明确跳过，普通源列缺失或映射歧义会拒绝准备，必填目标列必须有映射、默认值或 identity。Upsert 必须映射全部目标主键。

当前不支持 SSH、已选外置驱动包、跨产品、多表编排、源视图/外部表/临时表及系统 schema。显式选择外置包后不会静默改走内置驱动。活动行级安全策略会阻止完整表迁移，避免把权限过滤后的内容称为完整快照。具有可延迟唯一约束等不满足原生 `ON CONFLICT` 条件的目标，upsert 最终执行可能被 PostgreSQL 拒绝；失败保留任务和未发布数据，不代表该目标已通过兼容验收。

## 数据、权限与预算

源使用只读 repeatable-read 事务和原生类型输出函数，经连接上的 COPY text 流写入本机私有 SQLite 快照。它保留 PostgreSQL 的整数、numeric、二进制、数组维度、char 填充、日期时间及其他类型的文本表示，不经过 JavaScript 数字转换。JSON 和 JSONB 各自遵循目标类型的原生输入语义。最终转换使用审核中显示的目标类型和精度；不同类型或精度并不承诺值完全相同。

内部目录和指纹计算使用固定输出格式；最终写入恢复同一保存配置的原生连接所得到的 `search_path`、时区、日期/interval 格式等会话设置。因此，目标默认值和触发器可按正常连接上下文查询用户 schema、计算日期。源类型输出和目标内容核验也保留用户类型函数所需的 schema 查找路径；客户端编码和执行预算仍由迁移控制。

COPY 通过现有连接传输，不要求服务器文件目录或服务端 COPY 文件权限，行为依据 [PostgreSQL COPY 文档](https://www.postgresql.org/docs/17/sql-copy.html)。源快照只包含所选映射列及其行，**不是整个 PostgreSQL 数据库**。它在本机以私有权限保存明文业务值，暂停期间仍占磁盘。

| 项目 | 当前约束 |
| --- | --- |
| 批次 | 每批最多 1,000 行，并受约 4 MiB 内容预算约束。 |
| 单行 | COPY 编码行上限 1 MiB；源侧先用保守预算拦截，超大行拒绝，不截断。 |
| 列与元数据 | 最多 512 列；schema 认证描述上限 512 KiB，并限制展开的关系/类型数量。 |
| 大对象 | 普通 bytea 在行预算内；large-object OID 不会自动复制其外部大对象生命周期。 |
| 连接与锁 | 连接建立和锁等待有限时；最终发布需要目标表排他锁，可能因其他事务而暂停。 |
| 权限 | 源表读取；目标 schema 创建暂存/回执表、目标数据写入，以及已映射 owned sequence 的所有者权限。 |

快照、目标 staging、数据库事务日志会同时占空间。源输出是流式的，本机快照按有限行数/字节批量写入；百万行结果不能用来推断任意宽行、LOB 或打包桌面版的资源预算。

## 发布、恢复与取消

每个批次将 staging 数据和认证回执放在目标的同一事务内提交。本机 checkpoint 丢失时按目标已提交事实恢复，不重新插入已提交批次。恢复核对回执链、批次行数和内容摘要，拒绝缺失、篡改、未知对象和不连续进度。

最终发布前再次核验源快照、原目标库/表身份、schema 与已有完整行内容。目标检查包含分区/继承后代，保持行数不变的编辑也会使审核失效。发布在一个事务中锁定目标、staging 和 receipt，并执行：

| 模式 | 行为 |
| --- | --- |
| append | 插入全部快照行；冲突导致发布回滚。最终行数必须是原目标行数加快照行数。 |
| overwrite | DELETE 全部原目标行再 INSERT 快照；最终行数必须等于快照行数。触发器静默跳过行也会触发整次回滚。 |
| upsert | 原生 ON CONFLICT 按全部目标主键插入或更新映射非主键列；目标中不在源内的行保留。仅主键映射时冲突不写入。 |

原表的类型、默认值、生成列、约束、触发器和外键在最终发布时生效。它们可能改变数据、影响关联表或拒绝提交；审核不会预演任意用户触发器。事务保护数据库内本次数据与 DDL，普通 `nextval` 等操作仍遵循 PostgreSQL 自身的非事务语义。

已映射的 owned sequence 以事务性 `ALTER SEQUENCE RESTART` 推进至已发布范围之外；先获取对应锁，并检查上下界，避免使用不可回滚的 setval 作为迁移提交步骤。实际验收包含另一连接已缓存 identity 值的情况；[官方 RESTART 事务语义](https://www.postgresql.org/docs/17/sql-altersequence.html)和本机运行证据分别记录。

最终 published 回执、批次回执缩减和 staging 删除与目标写入同一事务提交。Host 完成登记失败后，重开可从原目标最终回执恢复完成状态，重试不会再次导入。原目标配置用绑定作业/项目的 AES-GCM 密文保存在认证账本中，已保存连接后来被编辑也不会把完成核查或取消重定向到新目标。

取消只删除经认证且归本作业的暂存对象和本机快照，不删除原目标行，不使用 DROP CASCADE。身份或认证变化会停止自动清理；恢复原对象后再重试。成功或取消后快照删除失败显示 `snapshot_cleanup_pending`，不会撤销已经提交的完成状态。凭据、行数据及原始数据库错误不返回前端；公开 CLI/MCP 继续为 7 项只读工具。

## 实现与复现

生产适配器位于 [`src-tauri/src/core/transfer_jobs/postgres/`](../src-tauri/src/core/transfer_jobs/postgres/)，复用共享任务、审核、租约、分页和恢复逻辑。v2 PostgreSQL 账本不改变旧 v1 SQLite 记录的认证序列化；兼容回归直接加载旧格式认证记录。

真实数据库测试见 [`large_transfer_jobs/postgres.rs`](../src-tauri/tests/large_transfer_jobs/postgres.rs) 及其 [`process.rs`](../src-tauri/tests/large_transfer_jobs/postgres/process.rs)。[原生验收入口](NATIVE_SQL_ACCEPTANCE.md)提供默认数据库/迁移场景与显式百万行强杀模式；测试只使用自行启动的临时数据库。合成界面复核只证明界面呈现和交互，后端、类型、提交恢复和内存结论以真实引擎测试为准。

MySQL 的进展与边界见 [MySQL 整表迁移](MYSQL_RESUMABLE_TRANSFERS.md)。G04 继续保留更多产品/版本的完整验收、多表、跨产品、SSH/外置包、LOB 和其他平台，详见 [完整差距清单](dbx-gap-analysis-2026-10-22.md)。

Windows 原生版本证据现包含 PostgreSQL **16.15 与 17.11**。16.15 的八项迁移场景在完整入口 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-g7LrDQ/evidence.json` 实际通过；该入口同时运行 MySQL 8.0.46，共 27 项。PG16 独立百万行证据为 `oxide-native-sql-acceptance-1tcC5x/{evidence,postgres-million}.json`：kill 2,000 后源路由离线续传，1,000,000 行 / 1,000 批、全键/值、发布前目标不变、最终单回执、快照清理及 helper 退出通过。两进程峰值 **25,481,216 / 27,308,032 B**，本次约 **120.7 秒**，两台隔离服务器均退出 0。独立入口按各自二进制摘要记录；17.11 的历史百万行证据和其他平台边界不变。
