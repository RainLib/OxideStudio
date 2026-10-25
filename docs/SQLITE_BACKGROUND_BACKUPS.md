# SQLite 后台备份

SQLite 计划由原生 worker 执行，不依赖页面定时器、窗口可见性、工作台当前项目或已连接的前端会话。设置页按当前项目展示计划；Host 会处理所有项目的已启用计划。

## 生命周期

| 场景 | 行为 |
| --- | --- |
| 窗口隐藏、切换项目 | 到期计划继续执行。 |
| 退出应用，后台开关关闭（默认） | worker 请求取消当前备份并退出。尚未开始的队列保存在磁盘，重新打开应用后处理。 |
| 退出应用，后台开关开启 | 独立 worker 继续调度。电脑需处于唤醒状态，用户需保持登录。 |
| 再次打开应用 | 连接现有 worker；不会把另一个进程正在执行的备份标记为中断。 |
| worker 被强制终止 | 下次获得独占租约的 worker 优先恢复文件账本中的终态；缺少成功回执的 Running 记录标记为 Interrupted。该次调度不会自动重复；未开始的 Queued 记录可继续处理。 |
| 文件成功回执已写入，近期历史尚未更新时崩溃 | 从独立账本恢复 Success，不重新读取源数据库，也不重复复制。 |
| 在文件发布后、成功回执写入前崩溃 | 文件保留为“待核查”，不会当成已验证备份自动清理。可以在文件列表中查看，使用前需验证。 |
| 关闭后台开关 | 删除当前 profile 的用户启动配置；计划、历史和备份文件保留。应用仍打开时继续执行计划，退出时按默认行为取消和停止。 |
| 源文件缺失或备份盘离线 | 可暂停参数未修改的已有计划；修改参数或重新启用仍需完整验证。 |

设置中的 **Continue backups after closing OxideStudio** 是用户主动开启的选项。Windows 使用当前用户的 Task Scheduler 登录触发任务、InteractiveToken 和 LeastPrivilege；Linux 使用 `systemctl --user` service；macOS 写入当前用户的 LaunchAgent。它们均不安装管理员或 SYSTEM 服务。应用重新打开时刷新已启用的启动入口，使其指向当前可执行文件。

本轮在 Windows 验证了独立进程退出、原生跨版本接力，以及 Task Scheduler 的 XML 只校验接口。尚未执行真实注销/登录启动测试；Linux/macOS 的系统启动与打包应用验收仍需完成。开发测试没有在本机安装启动任务。

## worker 接力

`worker-control.json` 在既有 `store.lock` 中读写，记录目标代次、协议、Cargo 包版本和编译时构建 ID。构建 ID 来自原生源码、锁文件、构建参数与 Rust 工具链；移动同一份构建无需重启健康 worker。较低版本、同版本已退役的构建和旧窗口不能夺回队列。启动入口只运行当前程序自身，不执行控制文件中的路径，不按记录 PID 结束进程。

候选进程持有启动租约，等待旧进程完成当前备份的复制、完整性检查、压缩和清理。旧进程交出 `worker.lock` 后，候选才修复遗留状态和处理队列。claim 在同一状态租约中再次检查代次，因此旧进程不会在接力请求之后开始下一项。各实例另持 UUID 文件锁；过期 JSON、遗留空文件或复用的 PID 都不足以认定归属。候选异常退出时队列仍保存，应用监督循环、重新打开或下次登录可重新启动；不承诺应用关闭后任意崩溃都立即重启。

`WORKER_PROTOCOL` 约束计划和文件账本的写入兼容性，不兼容格式改变时必须提升协议。旧 leader 仍可完成当前工作；协议不同的前台写入和账本迁移会等待接力。无实例回执的旧 worker 不会被自动终止，新版拒绝修改其计划和账本，并提示从原版本关闭后重开。旧进程自然退出后可以接续，这是协议推出前版本的保护路径。

原生入口 `--activate` 只允许选定当前运行的程序，用于登录入口和显式接力；仍只接受已有 profile，不接受任意 SQL 或备份目标。设置页显示接力和旧版本处理提示，刷新不会改变偏好。后台开关的既有退出/取消规则继续适用。

自动更新已接入下述原生安装门禁。worker 接力和安装门禁分别验收；Windows 当前用户 NSIS 的真实签名包原位替换和安装器启动后失败恢复已通过，MSI/UAC、人工取消、真实登录及其他平台仍需验收。

## 更新安装与恢复

更新检查仍使用 Tauri updater；下载改由原生命令从检查得到的 `Update` resource 获取并验证签名。校验后的字节、目标版本和独立 nonce 一起保存在发起 WebView 的资源表中；安装只接受该 resource 和原生准备令牌，不接受前端自报版本或安装路径。默认 capability 仅开放 updater 的 check，旧的直接 download/install/download-and-install 入口不再获权。公开 CLI/MCP 仍是既有 6 项只读工具。

安装准备在跨进程 startup/store 租约中登记持久化门禁，保留所有队列、计划和后台偏好。控制文件保持 v1，通过临时提升目标协议并增加代次，让未包含门禁实现的已有合作式 worker 仍可读取控制记录、完成当前备份并拒绝下一次 claim，避免把队列误记为失败。门禁期间，前台计划写入、账本迁移和文件删除等待；已有 leader 的当前复制、完整性检查、压缩和保留清理可以完成。无实例回执的更早 worker 仍需从原版本关闭，不按 PID 终止它。

准备流程等待真实进程退出，再持有 worker 启动和 leader 租约。Windows 使用经路径/启动时间核对的进程句柄观察退出，另检查同安装路径的其他应用实例；只释放 `worker.lock` 不足以放行。更新对话框提示等待、关闭其他实例，并允许取消准备。令牌绑定窗口和下载 nonce，其他窗口不能取消或提交该准备。前端任务在准备前和提交安装前均检查；等待期间新建任务会取消准备并要求完成任务后重试。

准备租约为 60 秒，由原生监督循环回收失联 renderer 的准备状态，最多再等待一个监督周期；准备尚未改动系统启动入口。应用进程在准备时退出后，下次打开可恢复。提交安装后先持久化 committed 状态，再暂停系统启动入口，偏好本身保持原值；Linux 在已观察 worker 退出后停止对应用户 unit，再禁用入口，避免旧 unit 失败重试。此平台路径仍需实际 systemd 验收。

原生任务拥有安装调用和失败处理，即使 renderer 重载也不把回滚交给页面。安装尚未成功时会恢复启动入口、清除门禁并释放队列；恢复失败则保持暂停并显示原因。安装成功但重启失败时继续暂停，界面提供 **Restart now**，不会再次执行安装或恢复旧程序调度。实际新版本启动且安装 owner 已退出后才自动解除 committed 门禁；重新打开旧构建时，在更新对话框确认 **I have closed the update installer** 后才可 **Resume backups**，请求绑定当前门禁 ID。新开应用只有更新元数据时仍须下载包，不能直接进入安装状态。

Windows updater 2.10.1 原实现未检查 `ShellExecuteW` 失败结果，可能在安装器未启动时直接退出。仓库保留该已锁定版本并回补上游已有检查，失败会返回原生任务以执行恢复。来源、许可证和移除条件见 [补丁说明](../src-tauri/crates/tauri-plugin-updater/OXIDE_PATCH.md)。已核对缓存 crate 的 SHA-256 与原锁文件一致；除该 Rust 文件及补丁说明外，vendored 文件与发布包一致。外部安装器已经启动后的取消或失败无法由该返回值判断，因此 committed 门禁继续等待实际新版本或用户关闭安装器后的显式恢复。Tauri 的平台行为见 [updater 文档](https://v2.tauri.app/plugin/updater/)。

当前证据覆盖实际 SQLite、真实旧/新 worker、原生安装回调与启动管理 adapter 的失败恢复，以及真实两个 Cargo 包版本之间的门禁接续。另在 Windows 实际安装当前用户 NSIS A，以生产更新服务下载和验签：错误签名被拒绝；故障 NSIS 启动后在复制前退出，重开 A 显式恢复队列；正常 NSIS 完成 A→B，B 按实际编译版本解除门禁，4 个备份文件逐一通过内容与完整性检查。测试安装器由临时 minisign 密钥签名，未使用生产签名密钥。没有验证 Authenticode、MSI/UAC、人工取消、实际登录任务或其他平台，完整范围见 [Windows 升级实包验收](WINDOWS_UPDATER_ACCEPTANCE.md)。

## 队列与文件

- 计划和运行记录保存在 `app_data_dir/database-backups/sqlite-schedules.json`。每次读写都在 `store.lock` 的跨进程独占锁内重新读取磁盘，随后原子替换文件。
- 文件回执单独保存在同目录的 `sqlite-artifacts.db`，使用 SQLite WAL 与 FULL 同步。成功回执先提交到账本，再更新近期历史；历史截断前也会迁入尚未登记的旧回执。
- `worker.lock` 保证同一 profile 只有一个执行者；`desktop.lock` 的共享租约表示应用进程仍存活。锁由操作系统在句柄关闭或进程终止时释放，不依赖 PID 推测或删除陈旧标记文件。
- 调度时点与 Queued 记录在同一次持久化中提交。每个计划最多有一个 Queued/Running 任务；全局顺序执行，避免连接和磁盘 I/O 同时拥入。
- 取消请求和进度跨进程持久化。worker 最迟在下一次 500ms 控制轮询中观察请求；SQLite 忙等待或单次 native 调用结束前，取消可能尚未完成。
- worker 从 `app_config_dir/metadata.db` 的同一次查询读取属于同一项目的连接配置与加密字段，复用桌面的凭据认证解密函数。不会创建凭据密钥、迁移连接配置或写回元数据库。
- 只支持保存的内置本地 SQLite 文件。内存数据库、外置驱动固定版本、托管连接和 SSH 连接均拒绝。源文件以 SQLite 原生只读模式打开，缺失文件不会变成新建的空数据库。
- 使用在线备份 API，按页复制已提交的数据，经完整性检查后发布；可选 gzip。文件名使用完整 run UUID，压缩和保留策略沿用 Host 的文件类型、目录和文件系统身份检查。
- 公共只读 CLI/MCP 不新增备份或恢复工具，原有只读 SQLite driver 仍拒绝这些文件写入动作。

计划与近期历史仍限制为 100 个计划、500 条运行记录和 4MiB JSON。文件账本不随近期历史截断。设置页的 **Retained backup files** 可按当前项目或所有项目分页浏览，并搜索名称或路径。一次最多返回 100 条，序列化响应预算为 2MiB，单条回执上限为 256KiB；游标绑定项目、计划及搜索范围。界面默认每页 50 条，每 10 秒刷新可见窗口中的文件列表，此轮询只读取状态。

保留策略从文件账本分批查找过期的成功备份，单批最多 100 条，批次之间释放状态锁。一个被修改的文件不会阻止其他过期文件的清理；离线目录只探测一次后保留其全部回执。清理失败以警告记录，不会把已成功复制的备份降级为失败。删除计划会保留其文件回执。

新回执记录文件所在的文件系统、文件 ID、大小和修改/创建时间；自动清理前重新核对。旧版 JSON 中仍存在的成功回执可迁入账本，缺少文件 ID 时按其原大小和运行时间核对。旧版本已经截断、没有回执的文件无法自动恢复归属，需另行检查，不能按目录通配符删除。

手动删除会先读取当前文件，再展示路径、大小及“文件已变化或未验证”的提示。确认令牌绑定运行 ID、路径和当前文件身份，5 分钟有效且只能使用一次；确认后文件再次变化会拒绝删除。删除结果先记录到账本，再移除近期历史；旧历史不会重新登记已删回执。近期历史不再引用的删除标记会清理。中断后已发布但没有成功回执的文件也会单独保存，超出近期历史窗口后仍可核查或通过当前文件确认删除。

## 计划时区

每天/每周计划可选择 IANA 时区，例如 `Asia/Shanghai`、`America/New_York` 或 `UTC`。新计划默认填入当前 WebView 识别的命名时区；保存后固定该名称，电脑更换系统时区不会改变计划的墙上时间。列表中的下一次执行时间按保存的时区显示，并带时区标记。小时计划仍按经过的小时数计算，跨夏令时不改变间隔；时区选择在改为每天/每周时生效。

旧计划缺少 `timeZone` 时保留原有的系统本地时间行为，设置页明确显示 **System time zone · follows changes**，不会在加载或暂停时自动赋值。旧客户端省略该字段时，Host 保留已有命名时区；显式提交 `timeZone: "system"` 才切换回跟随系统。参数未修改的暂停请求仍可在源文件或备份盘离线时保存。

夏令时向前跳过的时间不执行该次计划；每周计划继续寻找下一周相同星期几的时间。向后重复的时间只采用第一次出现，第一次之后计算下一次时不会再选择同一天的第二次。也覆盖半小时变化和整个民用日期被跳过的时区。无法解析的保存时区或无效日历字段会暂停该计划并显示 `schedulingError`，其他项目仍能继续备份；已经完成的文件及其成功回执仍会保存。

休眠/关机期间不会执行备份，恢复后对到期计划补一次执行，不逐次重放错过的时点。命名时区固定名称，不冻结未来规则；Unix 优先使用系统时区数据库，Windows 使用 Jiff 随应用附带的数据库，更新依赖时需同步检查时区数据库。Jiff 依赖仅加入 desktop feature，不扩大公开 CLI/MCP 的功能。时区解析与歧义策略依据 [Jiff TimeZone](https://docs.rs/jiff/0.2.38/jiff/tz/struct.TimeZone.html) 和 [AmbiguousTimestamp](https://docs.rs/jiff/0.2.38/jiff/tz/struct.AmbiguousTimestamp.html)。

## 验证

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib sqlite_backup_schedule
cargo test --manifest-path src-tauri/Cargo.toml --test backup_worker
cargo test --manifest-path src-tauri/Cargo.toml --test backup_worker -- --ignored --exact update_preparation_waits_for_process_exit_and_failed_installer_resumes_queue
node scripts/test-backup-worker-upgrade.mjs
node scripts/test-desktop-updater.mjs
```

原生进程测试使用当前 Cargo 构建的桌面程序，以 `--backup-worker --data-dir <现有绝对目录> --config-dir <现有绝对目录>` 在 WebView 初始化前进入 worker。`--once` 处理当前队列和到期计划后退出，适合隔离验收。

默认进程套件为 3 项，另有 6 个 ignore：`desktop_lifetime_fixture` 由生命周期测试显式启动；跨构建和旧协议测试需要实际旧二进制；安装失败场景单独运行以隔离应用进程扫描；两个安装门禁 fixture 由双版本脚本按顺序运行。忽略项不会自动计为产品验证通过。

`test-backup-worker-upgrade.mjs` 在临时源码副本实际编译当前包版本和下一 patch 版本，验证 worker 接力及安装 owner 退出后新版本对 committed 门禁的恢复。原仓库版本文件保持不变；脚本复用 Cargo 缓存，结束时重建原仓库全部二进制以恢复版本匹配。副本和安装 profile 保留供检查，不复制 `.env`、secrets、target 或 node_modules。脚本已接入 CI，远端 Actions 尚未执行。本机验证了 0.1.18 → 0.1.19 的接力与安装门禁恢复；同版本不同源码构建接力有前一批证据。

`test-desktop-updater.mjs` 仅在 Windows 执行，额外需要 MSVC、WebView2、protoc 和本地 npm/Rust 依赖。它使用独立产品、可执行文件和 profile 名称，实际安装/更新/卸载当前用户测试应用；默认编译目录为 `target/updater-acceptance`。隐藏 WebView 调用生产 IPC，不使用回调模拟。证据保留在输出的临时目录，手动 CI 的 `desktop_updater` 选项仅上传运行日志及验收 JSON，不上传密钥、源码副本或数据库。

安装失败进程场景也可设置 `OXIDE_BACKUP_PREVIOUS_WORKER`，验证尚未实现安装门禁、但支持 worker 接力的实际旧程序。本机该组合已通过：当前复制自然完成，下一项仍为 Queued，原生安装回调失败后由当前程序继续执行，不丢失或重复任务。8 项安装门禁原生回归包含准备过期、窗口/下载绑定、旧版本拒绝、启动暂停失败、安装错误/异常、启动恢复失败保持暂停，以及成功后重启前不放行；备份原生场景合计 59 项。

手动使用旧二进制时，设置 `OXIDE_BACKUP_PREVIOUS_WORKER` 或 `OXIDE_BACKUP_LEGACY_WORKER` 的绝对路径，分别用 `--ignored --exact cooperative_worker_upgrade_finishes_current_copy_before_successor_claims_queue`、`--ignored --exact legacy_worker_is_left_running_and_new_writes_wait_for_its_shutdown` 运行对应进程测试。跨构建场景以真实 SQLite 排他事务暂缓旧任务，核对 Running/Queued 后释放，实际读取两个备份文件，拒绝旧构建重新激活并验证重开不重复。旧协议场景使用协议推出前保留的实际程序，确认新版写入被拒绝、旧进程继续存活、自然退出后可接续。

同时移除 Windows 私有文件替换中先删除目标再重命名的间隙；现在使用标准库直接替换，避免中断落在路径缺失窗口。并发读取回归检查 64 次 64KiB 替换不出现缺失或部分内容。该检查不等同于断电验收；标准库行为见 [rename](https://doc.rust-lang.org/std/fs/fn.rename.html)。

覆盖真实 SQLite 内容与完整性、两个项目、竞争 worker、加密配置恢复、默认退出与开启后台后的独立存活、队列重新接续、异常退出标记、持久化取消、缺失源文件、压缩与保留。文件账本回归覆盖历史截断、成功回执重接、删除回执、离线目录、文件替换、确认令牌、未验证文件、旧版 schema 升级、901 条元数据回执分页 fixture 和响应字节预算。分页 fixture 不代表执行了 901 次数据库备份。日历回归覆盖纽约夏令时、Lord Howe 半小时变化、Kathmandu 偏移、Apia 跳过日期、每周跳过后寻找下一周、旧客户端保存和离线暂停。外部进程测试使用不同 `TZ` 环境的实际 worker 写出真实 SQLite 文件，独立检查保存时区对应的下一次墙上时间，并在源文件移除后从新进程恢复结果。Windows XML 测试使用 `TASK_VALIDATE_ONLY`，不会注册任务。

实现依据：[Rust 文件锁及释放规则](https://doc.rust-lang.org/stable/std/fs/struct.File.html#method.lock)、[SQLite 同步与持久性](https://www.sqlite.org/pragma.html#pragma_synchronous)、[Windows Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema)、[只校验任务的 TASK_VALIDATE_ONLY](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_creation)、[systemd 用户 service 的命令规则](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)、[macOS 用户 LaunchAgent](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)。
