# 公开 CLI/MCP 签名驱动验收

该入口验证当前 Rust CLI 通过生产包管理器加载实际签名 sidecar，包括版本 pin、激活选择、只读握手、真实 IPC、数据库范围、摘要/签名拒绝、超时与文件保护。公开 registry 当前为 7 项只读工具；本脚本验证外置 SQL 与元数据路径，原生文档工具另见 [文档只读查询](HEADLESS_DOCUMENT_READS.md)。

## 运行

使用已验证的 Node 24、Rust 1.91.1、平台原生 C/C++ 工具链及当前 npm/Rust 依赖。无需启动桌面 UI 或数据库 Docker；RQLite 使用只读 SQLite 支撑的 loopback HTTP 协议 fixture，DuckDB 使用实际编译的引擎。

```text
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
cargo fetch --locked --manifest-path src-tauri/crates/oxide-driver-rqlite/Cargo.toml
cargo fetch --locked --manifest-path src-tauri/crates/oxide-driver-duckdb/Cargo.toml
node scripts/test-headless-driver-packages.mjs
```

脚本在 `%TEMP%/oxide-headless-drivers-*` 或系统临时目录创建源码副本、profile、独立驱动仓库、数据库和密钥。副本不包含 target、node_modules、`.env` 或 secrets 目录。使用临时密钥构建验收 CLI，不使用生产密钥，不添加运行时信任参数，不关闭签名检查，也不发布任何包。

默认 Cargo 目录为原 target 下的 `headless-driver-acceptance`。需要复用原 target 时，显式设置 `OXIDE_HEADLESS_DRIVER_TARGET_DIR`；脚本复制验收 CLI 后先重建原仓库 CLI，再开始功能测试，避免保留带测试公钥的日常程序。版本文件和既有捆绑二进制保持不变。

临时数据和密钥保留供调查。只分享顶层运行日志和 `evidence.json`，不要上传整个临时目录。Tauri signer 输出的 updater 公钥/签名带有 base64 包装；fixture 会解出标准 minisign 文本后分别交给驱动编译配置和 `manifest.json.minisig`。生产驱动信任格式保持不变。

## 验证范围

| 场景 | 实际检查 |
| --- | --- |
| 签名运行包 | 真正编译 RQLite 0.1.0、0.1.1、受控非只读 0.1.2 版本；使用现有 package 脚本生成 manifest，再实际签名。 |
| 版本选择 | 全局激活 0.1.1 时，pin 到 0.1.0 的查询使用 0.1.0；取消 pin 后使用 0.1.1。结果报告实际包版本。 |
| 外部 MCP | 真实 stdio 客户端完成 initialize 和工具调用，确认使用激活的实际包。 |
| 数据范围 | DELETE 与 `outside.items` 在联网前被拒绝，后端请求计数不变。SQLite/RQLite 的二段名称按 database.table 判断；PostgreSQL/DuckDB 的 schema 与 catalog 分开判断。 |
| 信任与能力 | 修改 manifest、不符的可执行文件摘要、非只读握手、缺少文件只读连接能力均拒绝；失败不切换客户端。 |
| 激活损坏 | SQLite 激活指向缺失版本或含无效 JSON 时，不使用能正常打开该源文件的内置 SQLite。 |
| 超时 | 正常签名 RQLite 包的查询遇到后端延迟时明确超时。 |
| 实际 DuckDB | 真实协议创建临时 analytics schema 和数据，签名包通过公开 CLI 在对应 schema 查询并读取列元数据；源文件完整 SHA-256 不变，缺失源不会创建。 |

另有原生引擎回归绕过 SQL 过滤器直接尝试 INSERT，确认 DuckDB 引擎自身拒绝写入；context 回归验证查询出错后恢复原 schema。该引擎选项依据 [DuckDB Config API](https://docs.rs/duckdb/1.10505.0/duckdb/struct.Config.html)。

当前目录解析复用 Desktop 的自定义设置。安装的 Linux profile 区分 XDG config/data 目录；便携 profile 使用本目录。配置损坏时联网明确失败，连接摘要和缓存不会因此获得新的执行权限。确切版本直接检查其安装目录，避免无关版本开销和伪装邻居遮蔽；启动前的边界、目标、协议、签名、摘要及依赖校验继续执行。

## 本机证据与限制

2026-10-22，Windows x86_64 MSVC 的完整脚本退出码为 0。证据目录：`C:/Users/housh/AppData/Local/Temp/oxide-headless-drivers-dHtHiv`。验收 CLI 为 0.1.18，pin/active 分别为 0.1.0/0.1.1；`evidence.json` 记录上述信任、范围、超时和文件检查通过，RQLite HTTP 请求共 15 次。错误请求的计数在对应阶段独立核对；最终计数包含主动超时的查询请求。

完整链路暴露并修复了三个实际缺口：发布使用 Rust target triple 而加载器原先只认简写；SQLite/RQLite 的二段关系名被当成 PostgreSQL schema；确切版本查询遍历校验了无关包。大体积 debug DuckDB 的验收使用产品默认 30 秒预算，不把该构建当作生产性能基线。脚本开发期间还修正了 fixture 的 key 包装和原生 IPC 字段名，没有修改生产信任格式来迁就 fixture。

CI 新增四个 Rust 驱动组件的编译/测试/Clippy，以及手动启用的 `signed_driver_packages` Windows/Linux job；仅上传顶层运行日志与验收 JSON。远端 job 尚未运行。此处的 RQLite 服务是 HTTP 协议 fixture，不能替代真实 RQLite 版本 conformance；DuckDB 则实际运行锁定依赖中的引擎。通用 JDBC、其他厂商、更多连接参数、非 SQL 只读工具和各平台发布签名仍需继续验收。G02/E03 保持进行中。
