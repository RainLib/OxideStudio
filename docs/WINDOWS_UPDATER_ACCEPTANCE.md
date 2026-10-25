# Windows 升级实包验收

该入口验证生产更新服务、原生安装门禁与 SQLite 队列在真实 Windows NSIS 替换中的行为。它编译并安装两份隔离的 OxideStudio 桌面应用，前端使用最小自动化入口；更新服务和原生命令使用当前仓库实现。

## 本地运行

需要 Windows、Node 22.13 以上或 Node 24、Rust 1.91.1、MSVC、protoc、已安装的 WebView2，以及当前仓库 npm/Rust 依赖。脚本使用 Cargo offline 构建，因此首次准备需先取得锁文件中的依赖。首次构建还需要 Tauri 所需的 NSIS 工具。

```powershell
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
node scripts/test-desktop-updater.mjs
```

每轮生成独立 UUID：产品名为 `OxideUpdateFixture-<UUID>`，程序名为 `oxide-updater-<UUID>.exe`，bundle identifier 为 `com.houshuai.oxide-updater-fixture-<UUID>`。源码副本、安装目录、loopback 服务和临时签名密钥均放在 `%TEMP%/oxide-updater-acceptance-*`。数据库位于该目录，应用 profile 使用独立 identifier。脚本不修改原仓库版本文件；默认 Cargo target 为原 target 下的 `updater-acceptance` 子目录。

成功后等待测试应用退出，调用真实卸载器并确认主程序已移除。源码副本、独立 profile、密钥和数据库保留供失败调查；不要把整个临时目录上传。失败时先阅读输出目录中的各阶段日志，确认测试安装器和应用状态再处理该轮独立数据。

`--prepare-only` 只构建并签名，不能计为升级通过；`--debug --prepare-only` 只用于诊断。安装验收必须使用 GUI subsystem 的 Release 构建。`--resume <输出的临时目录>` 可接续仍保留安装程序的 committed 或已升级场景，要求原 loopback 端口可用；已卸载的成功轮次不能继续运行。

默认目录避免覆盖原构建产物。需要复用原 target 时，可显式设置 `OXIDE_UPDATER_TARGET_DIR` 指向它；脚本最后重建原仓库 debug 与 Release 二进制。Release 恢复沿用 Tauri 的 `STATIC_VCRUNTIME=true`，防止 NSIS 构建留下的 CRT shim 与恢复参数冲突。该选项会改变本地构建产物，应等待收尾完成后再使用它们。

## 验收内容

| 场景 | 实际检查 |
| --- | --- |
| 签名不匹配 | 正常 B 包配另一个实际包的有效签名，真实原生验签返回 `The signature verification failed`；门禁仍为 idle。 |
| 备份尚未完成 | 源 SQLite 的排他事务保持 Running/Queued；磁盘上出现 preparing 门禁时，A 的完整可执行文件摘要仍相同。释放事务后才允许安装。 |
| 外部安装器失败 | 已签名故障 NSIS 在 preinstall 写出自身进程见证、等待后退出，未复制 B。观察实际安装器退出后重开 A，确认 committed 和待执行队列仍在，显式恢复后两个备份成功。 |
| 正常原位替换 | 再排两个任务，实际正常 NSIS 将同一路径从 A 替换为 B 并自动启动 B。核对实际编译版本、完整程序摘要、idle 门禁及四个 Success。 |
| 备份内容 | 对四个文件独立以只读 SQLite 连接执行 `PRAGMA integrity_check`，并读取源表中的 `id=42`。canonical 路径必须留在该轮备份目录内。 |
| 收尾 | 测试 B 退出后执行真实卸载，确认主程序已移除。 |

完整程序摘要只考虑 Tauri 已知的固定宽度 bundle marker：`__TAURI_BUNDLE_TYPE_VAR_UNK` 在 NSIS 打包时变成 `__TAURI_BUNDLE_TYPE_VAR_NSS`。规则要求编译文件中恰有一个 marker，然后比较整个文件 SHA-256，不忽略其他区域。对应 Node 回归还检查源文件未被修改、Windows namespace 路径和 junction 越界拒绝，以及生产进程名拒绝。进程观察使用只读 `tasklist.exe`，不结束进程、不修改 PowerShell 执行策略。

## 已取得的本机证据

2026-10-22 的完整功能轮次：`9cf97d77-0305-4c8a-b5c0-ae082d1dd2fb`，本机证据目录为 `C:/Users/housh/AppData/Local/Temp/oxide-updater-acceptance-j0fOCi`。

| 检查项 | 结果 |
| --- | --- |
| 实际版本 | 0.1.18 → 0.1.19 |
| A 完整安装文件 SHA-256 | `979b694ef4545d1e016a243c810ae1461213851c6d4af6701309f8733c130a4c` |
| B 完整安装文件 SHA-256 | `0c46a38c948e72992d8192960dd18af4839110383fd889202cd8ba0c222edd89` |
| 原生验签错误 | `The signature verification failed` |
| 外部失败恢复 / 正常升级 | 均通过 |
| 实际备份文件 | 4 个，内容与完整性均通过 |
| 测试应用卸载复核 | 主程序、独立 HKCU 卸载键和该轮进程均不存在 |

`evidence.json` 保存以上机器可读结果，`events.ndjson` 保存实际 WebView 事件；阶段日志分别保存。该轮在功能验收及卸载之后，首次共享缓存 Release 恢复遇到 CRT 参数不一致。修正命令后单独完成恢复，原仓库 debug/release `oxide-agent --version` 均为 `0.1.18`；不能把首次整体进程退出码写成成功。新脚本包含相同修正。脚本语法、CI YAML、完整前端 build 和发布契约检查通过；发布契约为 74 项中 70 项通过、4 项因本机 JDK/H2 条件跳过。

## 手动 CI 与剩余范围

CI 的 `workflow_dispatch` 提供 `desktop_updater` 开关，默认关闭。Windows job 安装依赖、取得 locked crates 后运行同一脚本，仅上传顶层 `run.log`、`evidence.json`、`events.ndjson`，不会上传临时签名密钥、源码、profile 或数据库。该远端 job 尚未执行，本机结果不能替代远端成功记录。

本轮使用临时 minisign updater 签名和当前用户静默 NSIS，没有验证生产 Authenticode、MSI、UAC 拒绝、用户手动点击取消、真实注销/登录启动、实际 systemd/LaunchAgent 或 Linux/macOS 更新。故障 NSIS 在复制前退出，不覆盖复制中断或断电。应用后台偏好保持关闭，未注册启动任务。最小自动化前端不能代替完整工作台 UI 验收。Release 验收构建关闭优化以缩短编译时间，结果不能用于启动性能或资源预算结论。G03 和 E03 继续保持进行中。
