# SQLite 全量可恢复迁移

本文只说明本地 SQLite 适配器。共享入口现在也支持原生 PostgreSQL，使用方式和不同快照范围见 [PostgreSQL 可恢复整表迁移](POSTGRES_RESUMABLE_TRANSFERS.md)。

2026-10-22 在加入 PG 适配器后的当前共享运行时重新执行 SQLite 百万行强杀续传，1,000,000 行 / 1,000 批通过；3,000 行后强杀，源文件离线恢复，目标发布前为空、无重复、快照清理及两个 helper 退出均核验。当前数值证据为 `C:/Users/housh/AppData/Local/Temp/oxide-sqlite-transfer-acceptance-a4be5e670df14c5fb1cf048467e6dde9/evidence.json`，峰值 26,054,656 / 28,217,344 B，任务约 39.2 秒；下文原批次结果保留其历史口径。

这是现有表级 **Data transfer** 的独立全量流程：把一张已保存的本地 SQLite 表的全部快照行，迁入同一项目中已存在的本地 SQLite 目标表。当前实现是 G04 的首个原生适配器，不能据此视为全数据库产品、全平台迁移能力已经完成。

## 使用入口与审核

1. 在工作台打开现有 SQLite 表的 **Data transfer** 对话框，选择单张源表、一个已存在的原生本地 SQLite 目标表及 `append`、`overwrite` 或 `upsert` 模式。
2. 点击 **Full transfer & saved jobs**。这个入口也可以查看当前项目的旧任务；未选好合格目标时仍可浏览历史，但不能准备新任务。
3. 点击 **Prepare full snapshot**。Host 准备并校验整个源数据库的私有副本，然后统计所选表、生成列映射和目标审核信息。旧设置页的行数上限、结构恢复及 identity 选项不适用于此流程。
4. 审核源、目标、写入模式、快照行数与大小、目标现有行数，以及 **Review column mapping** 中的列名和类型。映射按列名匹配，不区分大小写；目标生成列跳过。无映射且没有默认值的必填目标列会阻止准备。
5. 阅读快照隐私、额外磁盘空间、目标类型和默认值、触发器与外键影响。输入本次审核展示的完整 `MIGRATE <12 位大写摘要>` 短语，再点击 **Start full transfer**。恢复暂停任务同样需审核并输入其准确短语。

**快照包含整个源库，包括未选择的表。** 只有所选表会导入，但未选表的数据也会暂存在本机应用数据目录。快照是准备阶段形成的稳定副本，不追踪之后的源编辑；准备成功后，原始源文件离线仍可从该副本续传。私有文件访问权限不等同于快照加密。

**Saved transfers** 按项目持久保存任务，以更新时间和任务 ID 排序；**Load older transfers** 可继续加载旧任务。原生列表每页最多返回 100 条，而不是只保留最近 100 条。`saved_history_paginates_beyond_one_hundred_jobs_with_project_isolation` 场景创建 103 个任务，检查首批 100 条、后续 3 条、无重复以及其他项目不可读；前端合并历史页，并单独刷新当前选中的旧记录。

## 状态与应用生命周期

| 状态 | 行为与可用操作 |
| --- | --- |
| `preparing` | 正在准备、检查私有快照。可取消；尚不能开始复制。准备中断后需取消旧任务并重新准备。 |
| `awaitingReview` | 快照审核已就绪。确认后开始，也可取消。 |
| `copying` | 批次写入目标库中的 staging。**Pause after batch** 在当前批次提交后暂停；也可请求取消。 |
| `paused` | 已提交的 staging 批次保留。审核后恢复，或取消并清理本作业对象。 |
| `publishing` | 全部批次已暂存，正在一个事务中发布。不可暂停或取消，需等待结果。 |
| `completed` | 发布成功；同一任务不会再次插入数据。私有快照清理失败会另给提示。 |
| `cancelled` | 未发布的任务已取消，原有目标行保留。快照清理失败可重试。 |
| `failed` | 准备失败。检查文件访问、列要求和磁盘空间，取消后重新准备。 |

关闭迁移对话框时，应用原生 Host 中的准备和复制任务继续执行。完全退出应用后不再运行；重新打开同一应用数据目录和项目的迁移对话框，读取保存状态并显式恢复。进程强杀时操作系统释放作业租约，下次读取可识别中断。这里没有 SQLite 计划备份使用的独立常驻 worker，也不依赖备份的后台开关。

界面中的进度是 **rows staged**，不代表原目标表已经写入这些行。发布前目标原表保持不变；staging 和 receipt 已经会占用目标数据库空间。最终发布包含整表 SQL、约束检查及触发器执行，可能耗时并占用写锁。磁盘需同时容纳整个源库快照、目标 staging 和事务日志，不能只按所选表行数估算。

## 写入与恢复语义

源快照通过 SQLite 原生在线备份生成。复制使用主键或可寻址的未遮蔽 `rowid` 做 keyset 遍历，不通过前端读取全表，也不使用不断增长的 `OFFSET`。SQLite 原生执行数据写入，避免把 64 位整数经 JavaScript 数字转换后失真。

每批 staging 写入和认证 receipt 在目标库的同一事务中提交。恢复时核验 receipt 链、批次内容和所属审核计划，并按目标已提交事实恢复游标。因此，进程在批次提交后退出，或目标提交成功而本地 checkpoint 写入失败，都不会简单地重放该批次。只有全部批次通过核验后才进入最终发布事务。

| 模式 | 最终发布行为 |
| --- | --- |
| `append` | 插入所有源快照行。主键或其他约束冲突会回滚整个发布事务，不会留下部分新增行。 |
| `overwrite` | 在同一事务中删除目标全部现有行，再插入全部快照行；会执行目标的 DELETE/INSERT 触发器及相应外键行为。失败时整次发布回滚。 |
| `upsert` | 必须映射目标全部主键列。新主键插入，主键冲突时更新已映射的非主键列；源中不存在的既有目标行保留。没有非主键更新列时冲突不写入。其他约束与触发器仍可使发布失败。 |

目标类型亲和性、默认值、生成列、触发器和外键在目标原表最终发布时生效。它们可能改变结果或阻止提交；审核不是对任意用户触发器效果的预先模拟。`append`、`overwrite` 还会校验发布后的预期行数。发布失败会暂停任务并保留未发布的 staging，修复后仍需满足原审核约束。

发布事务同时写入 `published` 认证回执、移除 staging，并将 receipt 表缩减为一条最终记录。即使目标提交成功后 Host 尚未来得及登记完成就退出，下次也会从原目标文件的最终回执恢复 `completed`，不会再次导入。已经提交的事实仍绑定原文件；之后更改保存连接不会把完成记录重定向到另一个文件。

## 审核失效、清理与隐私

- 源/目标保存配置、目标操作系统文件身份、目标表结构，或目标已有完整行内容发生变化，都需要取消旧作业并准备新审核。校验不只比较路径或行数；保持行数不变的内容编辑也会使旧审核失效。源文件后续编辑不影响已准备快照，但编辑保存的源连接配置仍会使绑定失效。
- 作业账本和目标 receipt 使用认证摘要；快照、目标结构、已有行和 staging 内容也做摘要核验。签名或内容不匹配时阻止发布，不会把未知对象当成可恢复批次。账本或认证密钥损坏时禁用此功能，而不是静默重建并遗忘旧作业。
- 取消只清理本作业拥有的 staging、receipt、快照及受识别的临时文件，不删除原目标行，也不清理其他任务文件。原目标文件或暂存对象身份发生变化时停止自动清理，提示恢复原文件并重试。其他表若新增了指向本作业 staging/receipt 的外键引用，会阻止发布或清理，避免 DROP 触发旁表级联。
- 成功或取消后只删除本作业拥有的普通快照文件。删除失败显示 `snapshot_cleanup_pending`；释放占用后，重新打开或读取该任务会重试，不把已成功发布降级成失败。
- 暂存期间，目标库确实保存待导入行，快照确实含源库数据。审核/API 仅返回元数据、计数、类型、提示与稳定问题码，不返回行数据或原始 SQLite/trigger 错误文本；最终 receipt 不再保留逐批游标。

常见问题码包括：`process_interrupted`（应用退出，需恢复或取消）、`preparation_failed`（取消后重建）、`execution_interrupted_or_target_changed`（核对原配置和目标）、`cancellation_requires_review`（对象变化，停止自动清理）及 `snapshot_cleanup_pending`（终态已成立，等待快照清理）。界面提示用于恢复操作，不包含原始数据库报错。

## 实现位置与存储

| 位置 | 职责 |
| --- | --- |
| [`src-tauri/src/core/transfer_jobs/`](../src-tauri/src/core/transfer_jobs/) | `runtime.rs` 编排、`lifecycle.rs` 恢复与取消、`store.rs` 认证账本和分页、`files.rs` 文件身份及归属清理、`models.rs` 状态与预算。 |
| [`sqlite/catalog.rs`](../src-tauri/src/core/transfer_jobs/sqlite/catalog.rs)、[`copy.rs`](../src-tauri/src/core/transfer_jobs/sqlite/copy.rs)、[`receipt.rs`](../src-tauri/src/core/transfer_jobs/sqlite/receipt.rs) | 快照和映射、keyset 批次与事务发布、内容摘要和认证回执。 |
| [`src-tauri/src/commands/large_transfer.rs`](../src-tauri/src/commands/large_transfer.rs) | Tauri 命令边界和脱敏错误响应。 |
| [`ResumableTransferDialog.tsx`](../src/features/table-transfer/ui/ResumableTransferDialog.tsx)、[`ResumableTransferReview.tsx`](../src/features/table-transfer/ui/ResumableTransferReview.tsx) | 已有迁移入口下的新流程、项目任务列表、审核及状态操作。 |
| [`useResumableTransfer.ts`](../src/features/table-transfer/hooks/useResumableTransfer.ts)、[`largeTransferPolicy.ts`](../src/features/table-transfer/model/largeTransferPolicy.ts) | 轮询、历史分页、选择与确认，以及独立全量请求策略。 |
| [`large-transfer.service.ts`](../src/services/tauri/large-transfer.service.ts) | `prepare_large_transfer`、`list_large_transfers`、`get_large_transfer`、`preview_large_transfer`、`start_large_transfer`、`pause_large_transfer`、`cancel_large_transfer`。 |
| [`src-tauri/tests/large_transfer_jobs.rs`](../src-tauri/tests/large_transfer_jobs.rs) 及[子目录](../src-tauri/tests/large_transfer_jobs/) | 原生类型、keyset、分页、配置/内容变更、取消、checkpoint/发布恢复和显式百万行进程验收。 |

桌面应用在 `app_data_dir/large-transfers/` 保存 `jobs.sqlite`、`authentication.secret`、作业租约及 `<job-id>.snapshot.sqlite`。账本与认证密钥必须作为同一组保留。目标库内使用作业 UUID 派生的 `_oxide_transfer_stage_*` 和 `_oxide_transfer_receipt_*` 表；暂停期间两者保留，成功后只保留最终 receipt。不要手动修改这些文件或对象来跳过审核。

迁移入口属于桌面 Tauri 命令。公开 CLI/MCP 继续提供原有 7 项只读工具，没有新增公开迁移写入能力。

## 验证与复现

在仓库根目录使用 PowerShell，关闭 Desktop 默认 feature 可运行原生库及此功能集成测试。以下命令不启动桌面窗口，也不要求准备真实业务数据库；测试创建隔离的临时 SQLite 文件。

```powershell
$env:CARGO_BUILD_JOBS = '4'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml --lib
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml --test large_transfer_jobs
```

百万行验收为显式 ignored 测试，需单独执行。它启动并只管理自己的测试子进程，强杀第一次复制进程，检查发布前目标仍为空，移走源文件，再启动接续进程，检查最终行数、类型、无重复、快照清理、单条最终 receipt 和进程内存峰值。可选环境变量将 JSON 证据写到已有目录下的指定文件。

```powershell
# 可选；不设置时仍输出 JSON 证据
$env:OXIDE_LARGE_TRANSFER_EVIDENCE = Join-Path $env:TEMP 'oxide-large-transfer-evidence.json'
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml --test large_transfer_jobs process::million_row_transfer_survives_process_kill -- --exact --ignored --nocapture
```

2026-10-22 的 Windows 最终代码验收证据位于 `C:/Users/housh/AppData/Local/Temp/oxide-large-transfer-acceptance-7a4e7b9003bc4ca0bc8cb2ec7b544915/evidence.json`：1,000,000 行、1,000 批，在 2,000 行后强杀；源离线续传成功，发布前目标 0 行，最终重复 ID 为 0，成功后仅保留一条最终 receipt。两个受测迁移子进程峰值分别为 22,106,112 B、24,211,456 B，包含首次快照准备，整体约 51.6 秒，快照 109,744,128 B。这些是该数据集和本机进程的测量值，不是整个 Desktop 的内存数值或一般性能承诺。

15 项迁移专属原生回归覆盖上述恢复、分页、取消、类型和篡改边界，包括 8 MiB 异常行/回执预检；回执读取受 512 KiB 限制，恢复核验在同一读事务中完成。Desktop 库、CLI 和外部调用回归亦已通过。CI 已在 Windows/Linux 无 Desktop 矩阵配置原生测试和显式百万行任务，仅上传数值证据 JSON；本轮未执行远端 Actions，也未在 Linux/macOS 上执行验收，Windows 结果不能替代这些平台。

## 当前边界

- 仅支持同项目已保存的原生本地 SQLite、`main` 中已存在的普通持久表；不支持内存库、自定义 VFS、只读目标、SSH 或外置 driver package，不静默回退内置驱动。单次只处理一对表，不创建目标表，不允许源和目标为同一个物理表。
- UI 默认每批 500 行，原生请求范围为 1–1,000 行；同时限制单批估算数据 4 MiB、单行预算 1 MiB、键预算 16 KiB、最多 16 个键列、每表最多 512 列。超预算大 LOB 会被拒绝，不承诺流式大对象传输。源键不能含 NULL，不支持非有限浮点键，仅支持内建 `BINARY`、`NOCASE`、`RTRIM` 排序规则；无可寻址稳定键的表不支持。
- 字节预检使用 SQLite [`octet_length`](https://www.sqlite.org/lang_corefunc.html#octet_length)；对 TEXT/BLOB 列可按元信息估算大小，超预算时先拒绝读取值。估算依据数据库文本编码，不是整个应用进程的内存额度。
- 单表全量原生 SQLite 是当前可审查的局部实现。G04 的全目标仍进行中；PostgreSQL/MySQL、多表编排、跨产品迁移、SSH/外置 package 适配、超预算大 LOB，以及完整产品和平台覆盖仍待实施与验收。
