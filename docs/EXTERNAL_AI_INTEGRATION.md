# 外部 AI 接入 OxideStudio

OxideStudio 提供独立的 Rust 可执行程序 `oxide-agent`。外部 AI 直接调用它即可，不需要接入应用内的 Deep Agents，也不要求 OxideStudio 界面保持打开。

推荐优先使用 MCP；客户端不支持 MCP 时，再使用 CLI。当前两个公开入口共享同一套只读工具、项目/连接授权和结果限制。

> 安全边界：本页介绍的公开 `oxide-agent mcp stdio` 与 `oxide-agent tools call` 始终只读，不能通过 `_meta.approved`、`approved: true`、命令参数或环境变量自行获得写权限。应用内 Codex CLI / CodeBuddy CLI Provider 使用的是隐藏的 `oxide-agent mcp bridge`，它必须持有 OxideStudio Desktop 为单个 Turn 生成的短期 endpoint/token，写入仍由 Desktop 发起批准、签发一次性 lease 并在 Rust 中二次校验。该私有模式不是外部集成接口。

## 1. 准备可执行文件

本地开发版默认位于：

```text
/Users/houshuai/project/ai_project/OxideStudio/src-tauri/target/debug/oxide-agent
```

后续示例可以先定义：

```bash
BIN="/Users/houshuai/project/ai_project/OxideStudio/src-tauri/target/debug/oxide-agent"
PROJECT_ID="pencil-7ef0839d"
```

如果该文件尚未生成，在仓库根目录执行：

```bash
cargo build \
  --manifest-path src-tauri/Cargo.toml \
  --bin oxide-agent
```

正式发布包会按平台和架构提供独立的 `oxide-agent`。配置外部客户端时，应使用实际安装或解压后的绝对路径。

## 2. 查询项目和连接 ID

项目 ID 是必需的、不可扩大的进程级授权范围。macOS 开发环境可以这样查询：

```bash
sqlite3 -readonly \
  "$HOME/Library/Application Support/com.houshuai.oxide-studio/metadata.db" \
  "SELECT id, name FROM projects ORDER BY name;"
```

当前本地示例：

```text
pencil-7ef0839d  pencil
sqls             sqls
```

这些 ID 来自本机数据，并不是可移植的固定值。复制配置到其他机器前需要重新查询。

先创建空输入文件，再通过 CLI 获取项目中的连接 ID：

```bash
printf '{}' > /tmp/oxide-input.json

"$BIN" tools call connection.listSummaries \
  --project "$PROJECT_ID" \
  --input @/tmp/oxide-input.json
```

连接摘要会脱敏，不会返回数据库密码或完整连接 URL。

## 3. MCP 接入

支持 stdio 的 AI 客户端可加入：

```json
{
  "mcpServers": {
    "oxide-studio": {
      "command": "/Users/houshuai/project/ai_project/OxideStudio/src-tauri/target/debug/oxide-agent",
      "args": [
        "mcp",
        "stdio",
        "--project",
        "pencil-7ef0839d"
      ]
    }
  }
}
```

保存配置并重启 AI 客户端。客户端会通过 stdio 启动 `oxide-agent`，然后自动发现 OxideStudio 工具。

### 3.1 固定单个数据库连接

如果只允许 AI 访问一个连接，建议在进程启动参数中进一步锁定：

```json
{
  "mcpServers": {
    "oxide-studio": {
      "command": "/Users/houshuai/project/ai_project/OxideStudio/src-tauri/target/debug/oxide-agent",
      "args": [
        "mcp",
        "stdio",
        "--project",
        "pencil-7ef0839d",
        "--connection",
        "<connection-id>",
        "--database",
        "reporting",
        "--max-rows",
        "100",
        "--max-result-bytes",
        "262144",
        "--query-timeout-secs",
        "300"
      ]
    }
  }
}
```

这是 Rust 后端强制执行的不可扩大授权：

- `--project` 固定可访问的项目；
- `--connection` 固定可访问的连接；
- `--database` 固定可访问的数据库，可重复传入或使用逗号分隔；一旦设置，工具输入中的 `database` 不能越界；
- `--tool` 固定可发现和可调用的工具，可重复传入或使用逗号分隔；未授权工具在 `tools/list` 中不可见，直接调用也会被 runtime 拒绝；
- `--max-rows` 限制单次查询可返回的最大行数；
- `--max-result-bytes` 限制单次工具结果的序列化大小；
- `--query-timeout-secs` 为该 MCP 进程的所有数据库查询和 EXPLAIN 设置统一超时；省略时为 30 秒，设为 `0` 表示不设置自动截止时间；
- AI 即使在工具参数中传入其他项目或连接 ID，也会被拒绝；
- 数据库范围启用后，Rust 还会扫描只读 SQL 中的 `FROM`、`JOIN`、逗号连接、SQL Server `APPLY` 与三/四段式对象名；跨库引用或无法可靠判断的派生关系会 fail closed；
- 调用方不能通过 `approved`、`approvalLease` 或 `--approve` 自行提升权限。

如果项目只有一个连接，可以不传工具级 `connectionId`。如果项目有多个连接且启动时未使用 `--connection` 固定范围，调用工具时必须显式传入 `connectionId`。

也可以使用 `OXIDE_DATABASE`、`OXIDE_MCP_TOOL`（均为逗号分隔）和 `OXIDE_MCP_QUERY_TIMEOUT_SECS` 环境变量设置数据库、工具范围与全局超时。命令参数优先于环境变量；这些值不会进入工具 Schema，模型不能在单次调用中扩大范围或期限。

### 3.2 MCP 协议要求

当前 MCP 服务严格要求协议版本 `2025-11-25`。如果客户端在初始化阶段提示协议不兼容，需要升级对应 AI 客户端。

stdio 的 stdout 专用于 MCP 协议帧，诊断信息只写入 stderr。Streamable HTTP 使用相同协议版本和同一个只读 runtime，不会扩大授权。

### 3.3 Streamable HTTP

推荐从 OxideStudio 的 **Settings → Tools → MCP Server** 配置。Desktop 会生成私有 bearer token 文件、托管独立的 `oxide-agent` 子进程、检查 readiness，并在异常退出后受控重启。界面可以限定项目、连接、数据库、工具、查询行数、结果字节数和全局超时；修改配置后必须显式重启服务。

也可以独立运行：

```bash
"$BIN" mcp http \
  --project "$PROJECT_ID" \
  --connection "<connection-id>" \
  --database reporting \
  --tool connection.listSummaries \
  --tool metadata.listObjects \
  --tool query.runReadOnly \
  --bind 127.0.0.1:43521 \
  --path /mcp \
  --token-file /private/path/oxide-mcp-token
```

客户端连接 `http://127.0.0.1:43521/mcp`，并发送：

```text
Authorization: Bearer <token-file 中的值>
MCP-Protocol-Version: 2025-11-25
```

安全边界：

- token 不接受命令行明文参数，避免进入系统进程列表；文件必须是普通、非符号链接文件，Unix 下还必须拒绝 group/other 权限；
- 默认只监听 loopback，并只允许 `localhost`、`127.0.0.1` 和 `::1` Host；loopback 浏览器 Origin 可用，其他 Origin 必须显式列入 allowlist；
- 非 loopback 监听同时要求 `--allow-remote`、`--allowed-host` 和 `--allowed-origin`，缺少任一项都会拒绝启动；HTTP 本身不提供 TLS，远程部署必须放在受信网络或 TLS 反向代理之后；
- `/healthz` 与 `/readyz` 只返回服务身份和 readiness，不返回 token、项目、连接或数据库信息；`/mcp` 始终先经过 Origin 和 bearer token 校验；
- HTTP 和 stdio 都只暴露五个公开只读工具。应用内 Codex/CodeBuddy 使用的短期私有 bridge 是另一条协议边界，HTTP token 不能用于审批或数据库写入。

## 4. CLI 使用

CLI 适合不支持 MCP 的 AI、脚本和本地自动化。

### 4.1 查看工具

查看全部工具：

```bash
"$BIN" tools list
```

查看单个工具的说明和 JSON Schema：

```bash
"$BIN" tools inspect query.runReadOnly
```

### 4.2 执行只读 SQL

将输入写入文件：

```bash
printf '%s\n' '{
  "connectionId": "<connection-id>",
  "database": "<database-name>",
  "schema": "<schema-name>",
  "sql": "SELECT * FROM users LIMIT 10",
  "maxRows": 10
}' > /tmp/oxide-query.json
```

执行查询：

```bash
"$BIN" tools call query.runReadOnly \
  --project "$PROJECT_ID" \
  --connection "<connection-id>" \
  --input @/tmp/oxide-query.json
```

`database`、`schema` 和工具输入中的 `connectionId` 都是可选的范围参数；是否需要填写取决于连接类型和项目中的连接数量。使用 `--connection` 固定连接后，可以省略输入中的 `connectionId`，但如果同时提供，两者必须一致。使用一个 `--database` 时可以省略工具输入中的 `database`，Host 会选择唯一授权数据库；多个数据库被授权时必须显式选择其中一个。

`tools call` 强制使用 `--input @file`，不能把 JSON 直接放进命令参数。这可以避免 SQL 和其他输入内容暴露在系统进程列表中。输入文件最大为 512 KiB。

### 4.3 使用环境变量

以下参数也可以通过环境变量提供：

```bash
export OXIDE_PROJECT_ID="pencil-7ef0839d"
export OXIDE_CONNECTION_ID="<connection-id>"
export OXIDE_DATABASE="reporting,analytics"
export OXIDE_MCP_TOOL="connection.listSummaries,query.runReadOnly"
export OXIDE_DATA_DIR="$HOME/Library/Application Support/com.houshuai.oxide-studio"

"$BIN" tools call connection.listSummaries \
  --input @/tmp/oxide-input.json
```

`OXIDE_DATA_DIR` 只在使用非默认应用数据目录时需要设置。

## 5. 当前开放的工具

| 工具 | 能力 | 主要限制 |
| --- | --- | --- |
| `connection.listSummaries` | 列出项目内脱敏后的连接摘要 | 不返回密码和完整连接 URL |
| `metadata.listObjects` | 按连接、父对象、类型或名称前缀查询缓存对象 | 依赖 OxideStudio 已写入的 metadata 缓存，单次最多 200 项 |
| `query.runReadOnly` | 执行后端校验的只读 SQL | 当前仅 PostgreSQL、MySQL/MariaDB；只接受单条只读查询 |
| `query.explainEstimate` | 执行估算型 EXPLAIN | 不支持 `ANALYZE`，不会实际执行写入 |
| `lsp.sqlContext` | 无需打开编辑器即可分析 SQL 光标上下文和候选项 | 缓存候选仍受项目和连接范围限制 |

所有工具当前均为只读。SQL 查询会在只读事务中运行，应用行数、结果大小和 30 秒 deadline，并在完成后关闭临时数据库连接。

## 6. 运行方式和当前限制

- OxideStudio 界面不必保持打开；`oxide-agent` 会自行读取本地 `metadata.db`，并在 SQL 工具调用时按需连接已保存的数据源。
- `metadata.db` 以只读方式打开，`oxide-agent` 不会修改项目、连接或缓存。
- metadata 缓存需要先由 OxideStudio 刷新。应用关闭后仍可读取已有缓存，但不会自动发现远端新增对象。
- MongoDB、Redis 和 Elasticsearch 当前只能通过 `metadata.listObjects` 读取缓存对象，尚未开放原生查询工具。
- 不提供新增、修改、删除、DDL 或其他 mutation 工具。
- 如果项目有多个连接，工具必须传 `connectionId`，或者在启动 MCP/CLI 时使用 `--connection` 固定连接。
- Streamable HTTP 支持 bearer token、Host/Origin 校验和 Desktop supervisor；当前不提供 OIDC，因此远程部署不能把 bearer token 当成多用户身份系统。
- 当前不开放 UI、Editor 或页面跳转工具。

## 7. 常见问题

### 初始化时报协议版本不兼容

升级 MCP 客户端，确保其使用 `2025-11-25`。服务端不会降级到旧协议。

### 提示 `multiple connections are available`

项目中存在多个连接。给工具传入 `connectionId`，或使用 `--connection <connection-id>` 重启 `oxide-agent`。

### 提示找不到 metadata 数据库

先启动一次 OxideStudio，确认本地数据目录已经生成。使用了自定义目录时，为 MCP 参数增加：

```text
--data-dir <oxide-application-data-directory>
```

也可以设置 `OXIDE_DATA_DIR`。

### 查询被拒绝

确认目标是 PostgreSQL 或 MySQL/MariaDB，并且 SQL 是单条 `SELECT`、`TABLE`、`VALUES` 或只读 CTE。`INSERT`、`UPDATE`、`DELETE`、DDL、多语句和 `EXPLAIN ANALYZE` 都会被后端拒绝。

## 8. 实现位置

- [CLI 命令定义](../src-tauri/src/bin/oxide_agent/cli.rs)
- [工具清单和输入 Schema](../src-tauri/src/bin/oxide_agent/catalog.rs)
- [MCP 协议边界](../src-tauri/src/bin/oxide_agent/mcp.rs)
- [Streamable HTTP 传输](../src-tauri/src/bin/oxide_agent/http.rs)
- [HTTP Token 与 Origin 校验](../src-tauri/src/bin/oxide_agent/http_auth.rs)
- [Desktop 服务托管](../src-tauri/src/commands/mcp_http.rs)
- [工具执行和数据库安全边界](../src-tauri/src/bin/oxide_agent/runtime.rs)
- [项目/连接授权策略](../src-tauri/src/bin/oxide_agent/policy.rs)

