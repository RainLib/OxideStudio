# Windows 原生 PostgreSQL / MySQL 验收

`scripts/test-native-sql-databases.mjs` 使用指定的原生服务器二进制，在新临时目录运行生产驱动、结构迁移和可恢复数据迁移测试。它为 Docker 不可用时提供真实引擎入口；现有 Linux 容器矩阵继续由 `scripts/test-live-databases.sh` 执行。

## 运行

准备 Node 22+、Rust 1.91.1、Desktop 构建依赖及已经下载的服务器目录。PostgreSQL 目录需同时包含 `postgres.exe`、`initdb.exe`、`pg_ctl.exe`、`psql.exe`；MySQL 目录需包含 `mysqld.exe`、`mysql.exe`、`mysqladmin.exe`。保留发行包的 `bin`、`lib`、`share` 相对布局。

```powershell
$env:OXIDE_POSTGRES_BIN = 'C:/path/to/pgsql/bin'
$env:OXIDE_MYSQL_BIN = 'C:/path/to/mysql-8.4.13-winx64/bin'
node scripts/test-native-sql-databases.mjs
# 仅运行两项 PG/MySQL 中段差异与采样键预算验收
node scripts/test-native-sql-databases.mjs --compare-only
# 仅运行 8 项 PostgreSQL 可恢复迁移场景
node scripts/test-native-sql-databases.mjs --transfers-only
# 单独运行真实百万行、强杀、源离线续传及进程内存验收
node scripts/test-native-sql-databases.mjs --postgres-million
# 仅运行十二项 MySQL 持久任务/边界场景（无 Desktop features）
node scripts/test-native-sql-databases.mjs --mysql-transfers
# MySQL 百万行、强杀、源 TCP 路由离线和内存验收
node scripts/test-native-sql-databases.mjs --mysql-million
# 独立 MySQL 底层引擎契约
node scripts/test-native-sql-databases.mjs --mysql-contract
```

脚本目前只接受 Windows。使用已有 Cargo 离线 cache；默认及 PG 模式编译 Desktop feature 的 `live_database`、`large_transfer_jobs` 和库测试，结构迁移用例依赖桌面表定义重写模块。`--compare-only` 仅编译 Desktop 库测试，表比较命令目前属于 Desktop 模块。过滤参数互斥，默认预期运行 29 项场景，不隐式运行百万行或 MySQL 前置契约。MySQL 的三种过滤模式仅编译无 Desktop 的迁移测试，并设置不可用 PROTOC；证据记录实际 features。它不变更公开 CLI/MCP 的只读工具契约。构建设置 debug=0、`CARGO_INCREMENTAL=0`、默认 4 个 job，默认 Desktop 构建的 `TAURI_CONFIG` 只为该子进程移除 externalBin 要求。

## 隔离与执行

- 创建新的 `oxide-native-sql-acceptance-*` 临时目录、随机密码和系统分配的回环端口。服务器只绑定 `127.0.0.1`，不注册系统服务、不读取应用 profile。
- PostgreSQL 使用 `initdb` 创建 UTF-8 集群并启用 SCRAM；probe 子进程清除继承的 `PG*` 选项，显式选择自己的用户/主机/数据库，避免连接到其他配置的服务。
- MySQL `--no-defaults --initialize-insecure --skip-networking` 仅初始化文件；首次启动的 init-file 在开放连接前设置密码并建立隔离测试用户。客户端清除继承的 MySQL 环境选项，并将 `MYSQL_TEST_LOGIN_FILE` 指向本次目录中不存在的私有路径。`--no-defaults` 本身仍会读取登录文件，而新参数 `--no-login-paths` 不受 8.0 客户端支持；采用 [8.0 官方支持的路径覆盖](https://dev.mysql.com/doc/refman/8.0/en/option-files.html)兼容两版。密码通过环境传入，不进入命令参数。
- 以成功的认证查询确认服务端版本。Cargo 返回实际测试可执行文件后，脚本直接持有测试进程，保存二进制 SHA-256；测试超时或取消时终止实际测试进程。
- PostgreSQL 两项、MySQL 三项、PG 迁移八项、MySQL 任务/边界十二项、PG/MySQL 采样比较两项、库 smoke 两项分别运行。各模式严格要求预期通过数、0 failed、0 ignored，且不能出现 `skipping live`。因此可选环境缺失不会被计作验收成功。MySQL 8.0 转义库名默认角色的 native 1044 与 Host 拒绝单独断言、打印；该项通过表示正确拒绝，不表示此授权组合已受支持。
- MySQL 使用 [Windows `--no-monitor`](https://dev.mysql.com/doc/refman/8.0/en/server-options.html#option_mysqld_no-monitor)，让脚本持有的 PID 就是实际服务器，避免强制回收监控父进程后留下子进程。此夹具不测试 RESTART。
- 完成后分别用 `pg_ctl ... stop`、`mysqladmin ... shutdown` 关闭自己启动的实例，并等待进程退出。只有两个主进程均退出 0 才保留成功状态；启动密码/init-file 也会清理。退出竞速的超时计时器在完成后清除，不会多等一个已不需要的窗口。

数据目录和日志保留供核验。可以分享顶层 `evidence.json` 与经过审查的数值结果；整个目录包含服务器认证数据，不作为 CI artifact 上传。

## 默认十五项真实场景

| 场景 | 验证内容 |
| --- | --- |
| PostgreSQL lifecycle | 生产 ConnectionManager 的连接、列/索引/约束/视图/函数目录、参数绑定、读写和事务提交/回滚；精确 numeric、64 位整数、UUID、日期时间和二进制等已有断言。 |
| MySQL lifecycle | 生产驱动的目录、参数精度、无符号 64 位边界、DECIMAL(65,30)、二进制、DELIMITER routine、读写与事务回滚。 |
| MySQL 字符迁移 | 实际列捕获 → snapshot/diff → 执行 DDL → 重新比较；源列覆盖目标库默认字符集，单独修改 collation，以及旧快照没有字符字段时保留目标已有属性。 |
| PostgreSQL cancellation | 先从 `pg_stat_activity` 观察正在执行的 fixture 查询，再通过生产取消接口中止；要求有限时间内返回错误、取消句柄移除且连接池还能查询。 |
| MySQL cancellation | 先从 `PROCESSLIST` 观察真实表上的等待查询，再调用 KILL QUERY 路径；确认中断错误、句柄移除和后续查询。 |
| PostgreSQL smoke | 显式执行原来 ignored 的 `test_get_schemas`，真实连接、读取并断开。 |
| MySQL smoke | 显式执行原来 ignored 的 `test_get_schemas`，真实连接、读取并断开。 |
| PG 迁移：原生值与源离线 | 12,001 行、18 列，精确 numeric/大整数/二进制/数组下界/JSON/复合类型等；源离线后完成，identity 缓存失效，清理快照并保留最终回执。 |
| PG 迁移：checkpoint 与取消 | 强制 Host checkpoint 写入失败，确认目标批次已提交；取消保留原表，重开依据目标事实续传，不重复写入。 |
| PG 迁移：内容认证 | 目标行数不变的编辑和 staging 内容篡改均阻止发布；只能清理归本任务的认证对象。 |
| PG 迁移：原子失败与发布恢复 | 触发器抛错或静默跳行都使 overwrite 回滚；最终目标提交后 Host 登记失败，编辑保存连接仍从密封的原目标恢复完成，不重复导入。 |
| PG 迁移：分区 upsert | 两个分区，更新匹配键、插入新键，并保留不在源快照内的目标行。 |
| PG 迁移：有界拒绝 | 2 MiB 单行在准备期拒绝，普通源列没有映射时拒绝，不截断或静默丢列。 |
| PG 迁移：空表与无主键重复行 | 空快照 overwrite 正确清空旧目标；移除源/目标主键后，源离线仍复制全部重复行，不按值去重。 |
| PG 迁移：原生会话上下文 | 对照普通连接，触发器正确查询用户 schema，并保留 search_path、日期/interval 格式、时区等上下文及日期默认值；固定传输格式与实际原生写入语义分别验证。 |

显式百万行模式额外验证：真实 PostgreSQL 源表 1,000,000 行、每批 1,000 行；提交至少 2,000 行后强杀实际迁移进程，核实原目标仍为空，关闭源连接路由，再由新进程完成。它逐行汇总核对整数、UTF-8、二进制值和全部主键，要求 1,000 个批次、零重复、单条最终回执、快照清理及两个 helper 退出。Windows 使用实际进程 PeakWorkingSet；Linux 使用 `/proc/<pid>/status` 的 VmHWM，每个 helper 必须低于 192 MiB，不用零值代替缺失的 OS 计数。数值证据单独保存在 `postgres-million.json`。

Linux 容器入口接入八项 PG、十二项 MySQL 任务/边界、独立 MySQL 契约和两项原生采样比较。`OXIDE_LIVE_POSTGRES_MILLION=1`、`OXIDE_LIVE_MYSQL_MILLION=1` 分别启用两种进程验收；`OXIDE_POSTGRES_TRANSFER_EVIDENCE`、`OXIDE_MYSQL_TRANSFER_EVIDENCE` 可指定数值 JSON。手动 PG16/MySQL8.0、PG17/MySQL8.4 矩阵已设置两个开关，并只上传顶层日志和数值 JSON。配置接入不代表远端矩阵已经执行。

MySQL 的单独 `SLEEP()` 被中止时允许返回 1 而没有 SQL 错误，因此取消测试使用包含真实表的查询来验证中断错误；这是夹具选择，不是把该服务器行为归为驱动缺陷。[MySQL 官方 SLEEP 语义](https://dev.mysql.com/doc/refman/8.4/en/miscellaneous-functions.html#function_sleep)。

## 本轮二进制来源

| 产品 | 官方来源与本轮记录 |
| --- | --- |
| PostgreSQL 17.11 | [PostgreSQL Windows 下载入口](https://www.postgresql.org/download/windows/) 指向的 [EDB 二进制包](https://www.enterprisedb.com/download-postgresql-binaries)，实际下载为 `postgresql-17.11-5-windows-x64-binaries.zip`，381,531,864 B。SHA-256：`80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`。 |
| MySQL 8.4.13 | [MySQL 8.4 官方下载](https://dev.mysql.com/downloads/mysql/8.4.html?os=3)，实际包 `mysql-8.4.13-winx64.zip`，281,154,912 B。官方公布 MD5 `7b94489d5524dea9b27097068bea25a8` 与本地一致；本轮 SHA-256：`e9cd98b1d23f122987b1afca26ad942efec5891481103d48ae3cde237fa3ea54`。 |
| PostgreSQL 16.15 | 同一 EDB 官方下载页的 Windows x86-64 入口取得 `postgresql-16.15-5-windows-x64-binaries.zip`，373,254,386 B。SHA-256：`43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281`。 |
| MySQL 8.0.46 | [MySQL 8.0 官方下载](https://dev.mysql.com/downloads/mysql/8.0.html?os=3)，实际包 `mysql-8.0.46-winx64.zip`，248,009,349 B。官方公布 MD5 `003f527d5df61b663ff191038cd676bd` 与本地一致；SHA-256：`28e9eda019d88eff4478d811ea2110b83f02a3966be157fe91cc55def3ab0d4d`。 |

上述 SHA-256 是本轮下载与解压验收的固定记录。PG 包通过官方 HTTPS 来源取得，本轮没有独立的发行签名验证；不将下载记录称为签名包安装验收。具体初始化方式见 [PostgreSQL initdb](https://www.postgresql.org/docs/17/app-initdb.html)、[MySQL Windows 数据目录初始化](https://dev.mysql.com/doc/refman/8.4/en/windows-initialize-data-directory.html)。

## 本机结果

上一批入口于 2026-10-22 退出 0，PostgreSQL 17.11 两项、MySQL 8.4.13 三项、显式库 smoke 两项共 **7/7 通过**，均无忽略。证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-a1fZl5/evidence.json`。两个服务器均正常退出 0；该批专项严格 Clippy、格式、模块大小和依赖边界检查通过。

加入 PG 可恢复迁移并修正原生会话设置后，默认入口 **15/15 通过、0 failed、0 ignored**；版本仍为 PostgreSQL 17.11 / MySQL 8.4.13。当前证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-hTYwOM/evidence.json`，包含实际测试二进制摘要和两个服务器退出结果。八项 PG 迁移场景均实际执行，未以 ignored 编译代替运行。

同一 transfer 测试二进制的显式百万行入口另 **1/1 通过**，证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-iDsKPR/evidence.json` 与 `postgres-million.json`。1,000,000 行 / 1,000 批，在 2,000 行后强杀，源连接路由离线后恢复；全量主键与值核对、快照清理、单条最终回执及受控进程退出均通过。首进程峰值 **24,866,816 B**、续传峰值 **26,849,280 B**，任务约 **91.1 秒**；两个服务器也均退出 0。这不是桌面应用整体性能或其他行形状的内存承诺。

此入口只提供所选 Windows 服务器版本和实际行形状的证据。其他版本、平台、SSH、外置驱动、宽行/大 LOB 和打包版性能仍需各自验收。使用方式和 PostgreSQL 的具体边界见 [整表迁移说明](POSTGRES_RESUMABLE_TRANSFERS.md)。

## MySQL 前置契约

`--mysql-contract` 的 scope 为 `mysql-engine-contract`。它实际检查 MySQL 持久 DDL 的隐式提交、单表 journal 与原数据同事务提交/回滚、临时 DDL 不提交原事务、主键更新后的其他唯一键冲突回滚，以及含空表/无主键的 InnoDB 插入范围锁。类型路径使用实际行编码，覆盖 unsigned 64 位、DECIMAL(65,30)、浮点实际位表示与极值/subnormal、二进制/NUL、跨字符集文本、JSON、微秒时间/负 TIME、时区 offset 和 SRID/WKB。2 MiB 值由 LATERAL 行预算在服务器拦截。

Windows MySQL 8.4.13 的前置契约 **1 项通过**，无 Desktop features，两个隔离服务器均退出 0；证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-e9eu8l/evidence.json`。探针不经过 Host 持久任务、审核和恢复 API，也不是百万行验收，不能单独计作 MySQL 适配器交付。后续真实作业证据见下文，边界与待办见 [MySQL 笔记](MYSQL_RESUMABLE_TRANSFER_DESIGN.md)；Linux 手动容器入口已接入，尚未在远端运行。

## MySQL 持久任务

`--mysql-transfers` 的 scope 为 `mysql-transfers`，通过实际 Host prepare/start/pause/cancel/recovery API 运行。首批六项记录为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-lMtq8S/evidence.json`。后续增加库级默认角色与触发器上下文，七项在 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-i8sUGN/evidence.json` 通过，实际 features 为空，两个隔离服务器均退出 0。撤销 TRIGGER 可见权限后准备被拒绝。角色授权依据有效默认角色展开，无全局管理权限；这不是所有权限组合的验收。

普通类型用例的源表不可用通过准备后移走所选表实现；源 TCP 路由离线另由下述进程用例证明。界面复核使用合成数据，不代替打包桌面真连接验收。

上一批默认 Desktop 构建入口 **21/21 通过、0 failed、0 ignored**，证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-BMG84x/evidence.json`。其中 MySQL 作业六项还核验了本地 checkpoint 落后服务端回执、实际浮点位，以及目标已提交后恢复旧本地记录、再编辑保存目标时仍从密封原目标确认完成。PG 八项、既有 PG/MySQL 五项和两个 smoke 均实际重跑；两台隔离服务器均退出 0。该轮没有重跑 SQLite/PG 的百万行，前批百万行证据仍按原测试二进制和日期独立保留。

加入角色/触发器与进程用例后的默认入口 **22/22 通过、0 failed、0 ignored**，证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-gaifBD/evidence.json`。实际重新执行 PG 两项、MySQL 三项、MySQL 作业七项、PG 作业八项和两个 smoke，服务器均退出 0。

## MySQL 百万行进程验收

`--mysql-million` 的 scope 为 `mysql-million`，无 Desktop features，单独运行真实测试 exe 及其两个 helper。用例通过私有 TCP 路由连接源表；2,000 行后强杀初始 helper，确认原目标仍为空，关闭监听器及已建立的路由连接，再启动新 helper。源码表仍存在，但源连接端口不可用，续传必须使用此前的私有快照。

本轮 **1/1 通过**：`C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-2ODeXR/evidence.json`、`mysql-million.json`。其测试二进制与七项 MySQL 作业的 `i8sUGN` 证据一致，SHA-256 为 `34eca0ef836c79be7908d427d6f54be77d60cea56b6f4f5550c4de3b662b65db`。1,000,000 行 / 1,000 批，全部主键、整数、UTF-8、二进制值核对，零重复、单条最终回执、快照清理及 helper/服务器退出均通过。首进程/续传峰值 **24,731,648 / 27,054,080 B**，本次作业约 **168.5 秒**；这不是任意行形状或桌面总体的性能承诺。

原生入口保留实际编译 features、exe SHA-256、服务端版本和退出码；脚本超时仍拥有真实测试进程。Linux 手动矩阵接入 MySQL 百万行及数值证据，但本轮没有执行远端 Actions。MySQL 的完整使用方式、权限与未覆盖项见 [整表迁移说明](MYSQL_RESUMABLE_TRANSFERS.md)。

## 前批增量复验：十一项 MySQL 与元数据锁

以下是该批实际重跑结果，前文 7/15/21/22 项记录保留各自历史范围。

| 入口 | 结果 | 本机 Temp 下证据目录 |
| --- | --- | --- |
| 默认 Desktop | **26/26、0 failed、0 ignored**：PG 2、MySQL 3、MySQL 作业 11、PG 作业 8、smoke 2 | `oxide-native-sql-acceptance-o2LGOm/evidence.json` |
| `--mysql-transfers` | **11/11、0 failed、0 ignored**，无 Desktop；增加空间/字符集/身份/default、无主键重复行、分区和触发器失败回滚 | `oxide-native-sql-acceptance-zrbS67/evidence.json` |
| `--mysql-contract` | **1/1**，无 Desktop；包含事务内 journal 零行读取保持 MDL、另一连接 ALTER 返回 1205、回滚后 ALTER 成功 | `oxide-native-sql-acceptance-DZhC5x/evidence.json` |
| `--mysql-million` | **1/1**，无 Desktop；1,000,000 行 / 1,000 批、kill 2,000、源 TCP 离线恢复、全值核对及清理 | `oxide-native-sql-acceptance-6yqbIF/{evidence,mysql-million}.json` |

根目录为 `C:/Users/housh/AppData/Local/Temp/`。三个 MySQL 独立入口的测试 exe SHA-256 均为 **`6077f6d9540f1021f2b396ca8cfb4b912e69c95fa287e547d311c41906ed4d94`**；默认 Desktop exe 单独记录在其证据中。当前百万行两进程峰值 **24,866,816 / 27,385,856 B**，本次任务约 **140.9 秒**，不是受控跨批次性能比较。以上入口的隔离服务器均退出 0，百万行两个 helper 均退出。

脚本现在记录退出 signal、是否 forcedStop 及关闭命令错误，等待正常退出最多 45 秒后才强制回收；强制回收仍使整次验收失败。此前 `oxide-native-sql-acceptance-LLxBFN` 的业务测试通过，但 MySQL 在正常 shutdown 约 5.7 秒内未满足原 5 秒回收窗口，外层验收失败。该失败证据保持原样，当前绿色结果来自修正回收窗口后的完整重跑，不依据日志将失败改写为成功。

## 版本增量复验：PostgreSQL 16 / MySQL 8.0

Windows 原生实际服务端为 **PostgreSQL 16.15 / MySQL 8.0.46**，并非从 CI 的镜像配置推断。当前默认入口 **27/27、0 failed、0 ignored**，证据为 `C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-g7LrDQ/evidence.json`：PG 2、MySQL 3、MySQL 任务/边界 12、PG 迁移 8、smoke 2。MySQL 三项包含 G13 的实际字符集/排序规则迁移。前面的 17.11/8.4.13 历史入口仍保留原计数和摘要。

| 独立入口 | 结果与 Temp 下证据目录 |
| --- | --- |
| MySQL 8.0 任务/边界 | **12/12**，无 Desktop：`oxide-native-sql-acceptance-4hRQiE/evidence.json`。普通库名的库级默认角色完成迁移并验证撤销 TRIGGER 后拒绝。转义下划线库名另测 native 1044 和 Host 拒绝，目标保持不变。 |
| MySQL 8.0 百万行 | **1/1**，无 Desktop：`oxide-native-sql-acceptance-6peke3/{evidence,mysql-million}.json`。1,000,000 行 / 1,000 批、kill 2,000、源 TCP 离线、全值/全键、零重复、单回执及快照清理通过。峰值 **24,723,456 / 27,058,176 B**，本次约 **194.6 秒**。 |
| MySQL 8.0 引擎契约 | **1/1**，无 Desktop：`oxide-native-sql-acceptance-uFwCbw/evidence.json`，含实际 metadata lock 等待与释放。 |
| MySQL 8.4 增量复验 | **12/12** 任务/边界及 **1/1** 引擎契约，无 Desktop：`oxide-native-sql-acceptance-3jwKv5/evidence.json`、`oxide-native-sql-acceptance-wDmXON/evidence.json`；两种库名的最小权限默认角色均实际迁移，两个服务器均退出 0。 |
| PG16 百万行 | **1/1**：`oxide-native-sql-acceptance-1tcC5x/{evidence,postgres-million}.json`。1,000,000 行 / 1,000 批、kill 2,000、源路由离线续传及全部键/值检查通过；测试还断言最终单回执和快照删除。峰值 **25,481,216 / 27,308,032 B**，本次约 **120.7 秒**。 |

MySQL 8.0 十二项与百万行是同一无 Desktop exe，SHA-256 **`c4fe0c950224ef6ca4ad4e99507b6a956c302cc031a1c5ff8331ea15f7ec579d`**。其他入口按各自 `artifacts` 记录摘要，不把分别编译的产物宣称为同一 exe。以上服务器全部退出 0、forcedStop=false，百万行 helper 均退出。性能数字属于本次行形状和 helper，不作跨批次性能改善或桌面整体结论。

8.4 本批十二项和契约使用同一 exe，SHA-256 **`e216b9d1c6069479245f0e1495f25302e103ab287afc3d3aa40c8e91d739ff3f`**；本批没有重跑 8.4 百万行。PG16 的 27 项与百万行分别编译，各自记录摘要：`a28b5fcbdb2c1169379632deefc9619d73bb4eface417dd86d16e3f564544ada`、`f0195b1ad723ed7fd2dd17a2cc7a32d04207e2d709b1189b832143f679f37246`，不声称同 exe。

MySQL 8.0.46 的转义库名默认角色限制已用原生认证和文本协议 USE 重现，与 [#110582 的描述](https://bugs.mysql.com/bug.php?id=110582)相似；该报告状态为 Can't repeat，不作为厂商已确认所有版本的依据。应用没有修改服务器权限或扩大 GRANT 来绕过。该项绿色表示已证明拒绝路径，**不表示此组合可迁移**。

首次启动 `oxide-native-sql-acceptance-iBU3wo` 因旧脚本使用 8.0 不支持的 `--no-login-paths` 失败；监控父进程被回收后留下的唯一测试子进程，经数据目录/二进制/父 PID 核验后清理。脚本改用私有登录文件路径、清除继承 MySQL 环境变量、共享明确的连接参数，并用 `--no-monitor` 持有实际服务器 PID。成功退出时清除已无用的竞速计时器。

另以独立实例实际强杀正在启动的自身 MySQL 进程验证故障清理：`oxide-native-sql-acceptance-wjwk1n/{evidence,fault-cleanup-evidence}.json`。原验收正确返回 **1**、没有启动业务测试，MySQL 非零退出、PG 正常退出，最终该目录所属服务器为 **0**。这是故障处理通过的独立证明，不计入正常数据库用例或将其 `success:false` 改成成功。失败的 `OE3HvL`、`F4awTp`、`tHEOIU` 也保留原记录；最后一个是新增 USE 探针误用 prepared 协议，现已改用文本协议后完整重跑。

## G07 分层比较增量

新增两项真实库测试 `sampled_compare_live_`，纳入默认入口和 `--compare-only` 独立 scope。每个产品实际创建 100,001 行，仅修改第 50,001 行；通过生产选键、共同键集合、参数化逐键读取、差异和摘要路径，验证首尾样本漏掉该改动而分层样本发现。两种策略还分别实取 10,000 个键，证明不会被驱动 1,000 行结果上限静默缩减。仍明确断言样本计数非整表精确、没有统计置信分数。

首轮 Windows PG16.15/MySQL8.0.46 默认入口 **29/29、0 failed、0 ignored**，证据：`C:/Users/housh/AppData/Local/Temp/oxide-native-sql-acceptance-zpqaz6/evidence.json`。其中新增比较两项，原 PG/MySQL 生命周期、取消、字符迁移、20 项可恢复迁移和两个 smoke 均实际重跑；百万行本批未重跑，前批记录继续按原摘要保留。

首轮 Windows PG17.11/MySQL8.4.13 的 `--compare-only` **2/2、0 failed、0 ignored**：`oxide-native-sql-acceptance-TToark/evidence.json`。两个入口的库测试 exe SHA-256 相同：**`d7e516bac7082eaebcda7275481d5c4d8eb30e43f83add8a06507b6d37a2b6d5`**。四个服务端均由隔离夹具启动并正常退出 0，forcedStop=false；没有运行远端 Actions。

随后核对调用点发现 PostgreSQL/MySQL 也把复合主键成员当作独立唯一列，已按实际完整索引修复并增加真实断言：复合主键的部分成员不构成唯一键，完整主键可用；不附带约束的单列唯一索引可用；表达式索引中的普通成员不独立唯一；PG 部分索引排除、INCLUDE 附加列不成为唯一键。

最终重跑 PG16.15/MySQL8.0.46 **29/29**，证据 `oxide-native-sql-acceptance-SW7Tfm/evidence.json`；PG17.11/MySQL8.4.13 采样专项 **2/2**，证据 `oxide-native-sql-acceptance-cDhbrF/evidence.json`。同一库测试 exe SHA-256 **`a86effc7defa4f5ccd2fc05f72a5296f712ecc3022e5847778c69dcfbefceedb`**，均为 0 failed、0 ignored，服务器全部正常退出 0、forcedStop=false。

采样预算、覆盖率定义、SQLite 元数据/逐值解码修复及并发边界见 [大表比较说明](DATA_COMPARE_SAMPLING.md)。这些证据覆盖所列 Windows 原生版本；外置适配器、更多排序/键类型和实际大表性能仍需各自验收。
