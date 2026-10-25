# MySQL 可恢复迁移实施笔记

状态：G04 的 MySQL 原生后端与现有桌面入口已接入。Windows MySQL 8.0.46 / 8.4.13 各十二项任务/边界通过，两版本分别有百万行强杀、源 TCP 路由离线恢复证据；8.0 转义库名默认角色的原生限制单独验证拒绝，不算该组合可用。界面有合成数据的呈现与交互证据。**打包桌面真连接操作和完整版本矩阵仍待验收**。使用方式见 [MySQL 整表迁移](MYSQL_RESUMABLE_TRANSFERS.md)；完整目标仍是 [差距清单](dbx-gap-analysis-2026-10-22.md) 中的 G01–G13、E01–E07。

## 发布事务与作业表

MySQL 的持久 CREATE/DROP TABLE 会隐式提交；不能在写入原目标后 DROP staging 再声称整次操作可以回滚。临时 CREATE 不会提交当前事务，但临时对象的创建本身也不随用户事务回滚。[官方隐式提交说明](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)。

实现使用一张每作业独立的 InnoDB journal：`kind, seq` 联合主键，分别保存审核 header、原始列字节和批次认证回执。CREATE 在原目标数据事务之外执行，并在同一条 DDL 的 COMMENT 中写入绑定作业、计划、原目标与快照的认证标记。创建后但 header 尚未登记时，也必须能识别自己的对象，不能根据名字就清理未知表。

最终事务只修改原目标、更新 published header，并 DELETE journal 中的暂存/批次行，保留单条最终回执。持久 DROP 仅用于确认归属后的取消清理，不放在发布事务中。目标提交后 Host 完成登记失败，须从密封原目标的已提交回执恢复，保持现有不重复写入契约。

InnoDB repeatable-read 下完整扫描的 FOR UPDATE 锁作为发布期的数据与插入范围保护，包含无主键和空表场景；不能用会隐式提交的 LOCK TABLES 代替。[官方锁范围说明](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html)。目标及 journal 都需持有对应锁和 metadata lock，再复核定义与内容。

Journal 的 DML 事务在归属初检后实际执行 `SELECT 1 ... LIMIT 0`，再复核归属、列/索引、触发器及定义，避免验证与写入之间被 DDL 改变。锁保持到该事务结束；仅 PREPARE 不提供这一保证。[MySQL 元数据锁语义](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)。独立引擎契约实测另一连接 ALTER 等待后返回 1205，持锁事务回滚后同一 ALTER 成功。此保证限于事务内 journal DML，不外推到取消时的持久 DROP。

## 类型、主键和会话

- 源在只读一致性快照中持续读取，先在服务器检查单行预算，再取有界的投影值。LATERAL 每行单行子查询避免全源物化和重复大表达式。
- `mysql/wire.rs` 用版本、列数和每列长度区分 NULL、空值及任意字节。整数/DECIMAL 保持原生十进制文本，DOUBLE 使用固定八字节位表示，二进制保持原字节，空间值携带 SRID 与 WKB。浮点必须经原生参数写入会话私有的 typed 表，不绕回 MySQL 字符串解析；极值、subnormal 和负零另核对实际位表示。编码、解码和摘要都不能依赖 JavaScript 数字。
- 文本通过 utf8mb4 传输，再由目标列字符集转换；目标 charset/collation 必须进入类型审阅与指纹，不能退回目标库默认值代替列定义。不能通过 JSON 数字中转大整数或 DECIMAL。
- 源 TIMESTAMP 的快照采用 UTC；目标实际写入使用显式 UTC offset，保留目标时区下的默认值和触发器。需要覆盖零日期、范围边界及 DST 重叠时刻，不能用可能有歧义的本地时间文本代替瞬时值。[官方 offset 输入语义](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-literals.html)。
- 原始 journal 不执行目标默认值、触发器或生成列。发布时使用会话私有的 typed 临时表，匹配目标列类型、精度与 collation，移除 auto_increment/default/生成逻辑，验证真实主键重复及类型约束。
- Upsert 按目标主键 UPDATE JOIN，再 INSERT 尚无主键匹配的行。MySQL ON DUPLICATE KEY 会响应任意唯一键，不能据此把其他主键的行当成匹配。非主键唯一冲突必须回滚之前的更新，不可改写错误的目标行。
- 发布期不能擅自关闭外键/触发器或降级 sql_mode 来吞掉坏值。需要区分已审阅的精度转换与意外截断，并检查实际诊断；实测 SHOW WARNINGS 需要 SQLx 文本协议，不能直接作为 prepared statement 执行。

## 已接入的后端与待验收边界

v3 作业使用独立 AES-GCM 域密封原目标，v1/v2 缺省字段继续省略。Host prepare/start/pause/cancel/recovery 已分派到 MySQL：源表流式快照写入私有 SQLite；原始行和 HMAC 批次回执在同一 InnoDB 事务提交；目标 UUID、定义、触发器和完整内容进入审阅与校验。浮点指纹另外读取原始位，避免文本输出精度掩盖相邻值。服务器 GET_LOCK 与本地租约共同约束同一作业的执行者。

当前预算为最多 512 列、单行 1 MiB、每批最多 1,000 行及 4 MiB，并按实际 max_allowed_packet 和 prepared 参数数进一步缩小。目标写入恢复原生 sql_mode 和时区，另外启用 NO_AUTO_VALUE_ON_ZERO 保留显式零身份值；任何转换诊断都会拒绝发布。原目标、最终回执及暂存数据删除同事务提交，不在其中执行持久 DDL。原生 auto_increment 空洞、触发器对非事务表或外部系统的副作用遵循 MySQL 自身语义。

代码拒绝低于 MySQL 8.0.22、MariaDB/TiDB、系统库、非 InnoDB、SSH 和已选外置包，且要求目标及 journal 的 TRIGGER 可见权限。partial_revokes 已启用时目前拒绝执行。已实测一个仅授予测试库权限的默认角色及撤销 TRIGGER 后的拒绝路径；不能把这一组合等同于全部权限配置已证明。[MySQL 角色权限展开语义](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html)与实际账户测试分别提供规范和运行依据。

仍需完成：

1. 打包桌面真连接的端到端操作，更多 OS 和安装形态；现有入口、审阅、确认及恢复交互已接线并做浏览器合成数据复核。
2. 更多行形状/宽行、资源配置与重复受控性能测量；已有百万行证明不外推到任意 LOB 或桌面全应用。
3. 更多权限/角色、partial revokes 专用策略、类型/触发器/default 组合、零日期与命名时区/DST。空间值、跨字符集、身份值、无主键重复行和分区现有特定作业已通过，不能外推到所有组合。
4. 多表、跨产品、SSH/外置包、大 LOB，以及其他版本和平台。

## 探针和代码位置

- [真实引擎探针](../src-tauri/tests/large_transfer_jobs/mysql.rs) 创建唯一的测试数据库，仅在显式隔离环境运行。
- [生产分派](../src-tauri/src/core/transfer_jobs/mysql.rs) 和 [有界行编码](../src-tauri/src/core/transfer_jobs/mysql/wire.rs) 已编译进核心迁移服务；未增加公开只读工具之外的 CLI/MCP 写入工具。
- [真实作业验收](../src-tauri/tests/large_transfer_jobs/mysql/jobs.rs) 调用现有 Host API，不使用探针模拟作业。`--mysql-transfers` 单独以无 Desktop features 运行十二项任务/边界场景；类型/表形状见 [types.rs](../src-tauri/tests/large_transfer_jobs/mysql/types.rs)，两个最小权限角色及原生拒绝对照见 [permissions.rs](../src-tauri/tests/large_transfer_jobs/mysql/permissions.rs)。[进程验收](../src-tauri/tests/large_transfer_jobs/mysql/process.rs) 通过 `--mysql-million` 运行。`--mysql-contract` 继续保留独立的底层契约 scope。

与已有入口相同，需要指定 `OXIDE_POSTGRES_BIN`、`OXIDE_MYSQL_BIN`；脚本自建回环服务器和随机凭据，结束后关闭自己持有的实例。运行方式与二进制来源见 [原生 SQL 验收](NATIVE_SQL_ACCEPTANCE.md)。

## 当前证据（2026-10-22）

Windows MySQL 8.4.13 的最终无 Desktop 探针实际通过 1 项，构建 features 为空，使用不可用 PROTOC；证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-e9eu8l/evidence.json`。两台隔离服务器均退出 0。探针包括主键更新后次要唯一键冲突的整次回滚、临时 DDL 不提交目标修改，以及浮点极值/subnormal 经固定八字节帧和原生参数绑定的实际位比较。

两项行编码测试加现有 15 项 SQLite 迁移回归共 17 通过；12 个显式环境/进程 fixture 在普通回归中 ignored，MySQL 探针另通过上述入口实际执行。新增内容按默认/无 Desktop 的 `--test large_transfer_jobs` 严格 Clippy 通过；格式、Node/Bash 语法、2593 文件模块检查和 431 包无 Desktop 依赖图通过。开发入口恢复为 `oxide-agent 0.1.18`，没有改变现有捆绑二进制。

以上是前置批次的历史证据。接入生产后，无 Desktop 的六项真实作业在 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-lMtq8S/evidence.json` 通过，两个服务器均退出 0。场景覆盖 1,201 行/11 个映射列的原生值（另跳过生成列）、浮点实际位、微秒、源表移走、暂停与重开恢复、取消、主键 upsert、次要唯一冲突整次回滚、空表 overwrite、目标/日志篡改、超大行和未映射列拒绝。最终回归另外核验服务端提交领先本地账本及保存目标被编辑后的原目标完成恢复；最终证据在 [SQL 验收](NATIVE_SQL_ACCEPTANCE.md) 登记。

真实比对发现并修正 TIMESTAMP 的 UTC 转换路径丢失微秒：UTC 日历秒与原生 MICROSECOND 分别组装，再以显式 offset 写入，未通过放宽精度断言绕过差异。

后续七项实际作业与百万行使用同一无 Desktop 测试二进制，证据分别为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-i8sUGN/evidence.json` 与 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-2ODeXR/evidence.json`。新增库级默认角色与目标触发器上下文，且撤销 TRIGGER 后拒绝准备；持久角色管理测试命令使用文本协议，不误用 MySQL 尚不支持的 prepared 语句。

百万行在 2,000 行后强杀实际 helper，源 TCP 路由关闭后新进程完成 1,000,000 行 / 1,000 批。逐行整数、UTF-8、二进制及全部主键、零重复、发布前目标为空、最终单回执和快照清理均通过。首进程/续传峰值 **24,731,648 / 27,054,080 B**，本次作业约 **168.5 秒**；helper 和隔离服务器均退出。更完整的使用边界、二进制摘要及证据解释见 [MySQL 整表迁移](MYSQL_RESUMABLE_TRANSFERS.md)。

界面复核另发现并修正暂停回执晚于终态轮询时的待处理提示残留；取消则继续保持待处理直到清理完成或要求复核。开始时立即消费确认短语，包括响应丢失的情形，恢复前须重新输入。相关前端回归不等同于打包桌面的真连接验收。

### 类型/表形状与元数据锁复验

本批新增四项实际 Host 作业：空间 SRID/WKB、latin1/UTF-8 与 ENUM/SET、显式零身份值及原生默认值；无主键重复行；分区目标 upsert 保留未匹配主键；触发器拒绝 overwrite 后整次回滚、取消并重新准备成功。源/目标保存的 URL 显式配置 `timezone=-07:00`，验证微秒瞬时值和触发器/default 上下文。[SQLx 0.8.6 默认每个新 MySQL 会话使用 UTC](https://docs.rs/sqlx-mysql/0.8.6/sqlx_mysql/struct.MySqlConnectOptions.html#method.timezone)，不能用只修改 GLOBAL 时区的夹具假设连接继承；固定 offset 也不等于命名时区/DST 已验收。

最终十一项无 Desktop 作业在 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-zrbS67/evidence.json` 通过；含实际 MDL 等待/释放断言的独立契约在 `oxide-native-sql-acceptance-DZhC5x/evidence.json` 通过。当前百万行完整复验为 `oxide-native-sql-acceptance-6yqbIF/{evidence,mysql-million}.json`，与十一项作业使用同一测试 exe，SHA-256 **`6077f6d9540f1021f2b396ca8cfb4b912e69c95fa287e547d311c41906ed4d94`**。全部路径均位于同一本机 Temp 目录；两台服务器正常退出 0。当前数值和边界见使用说明，前文批次记录继续作为历史证据保留。

后续 8.0.46 的真实版本复验发现：默认角色下的转义库名授权在原生认证及原生 USE 都返回 1044，Host 同样拒绝准备且不暂存/发布。保留这个独立对照用例；另用不含通配符的唯一库名验证完整的最小权限角色迁移和撤销 TRIGGER 后拒绝，未改宽 GRANT 或关闭角色。8.4.13 两种库名的角色迁移均通过。8.0 的十二项/百万行同 exe；8.4 的十二项/契约本批另复验通过，详细目录和摘要见 [SQL 验收版本增量](NATIVE_SQL_ACCEPTANCE.md)。原有角色 case 的成功不能继续外推到全部版本和权限组合。
