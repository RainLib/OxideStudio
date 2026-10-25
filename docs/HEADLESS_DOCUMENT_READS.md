# 公开 CLI/MCP 文档只读查询

`document.findReadOnly` 对保存的原生 MongoDB 连接执行有界 find，复用项目、连接、数据库与工具授权，以及桌面保存的加密凭据。它是第七项公开只读工具。HTTP MCP、stdio MCP、原生 CLI 和 Node launcher 使用同一实现。

## 使用

把下列输入保存为 JSON 文件。数据库可以来自输入、保存的连接或唯一的 `--database` 授权；有多个候选时需显式选择。

```json
{
  "database": "app",
  "collection": "orders",
  "filter": { "status": "paid", "total": { "$gte": 100 } },
  "sort": [
    { "field": "createdAt", "direction": -1 },
    { "field": "customer.name", "direction": 1 }
  ],
  "projection": { "_id": 1, "total": 1, "createdAt": 1 },
  "offset": 0,
  "limit": 50
}
```

```text
oxide-agent tools call document.findReadOnly --input @request.json --project project-id --connection connection-id --database app
```

MCP 使用同名工具及相同输入；只开放该工具可在启动时加 `--tool document.findReadOnly`。`connectionId` 可在未固定连接时指定，不能覆盖启动参数授予的连接。

结果中的 `documents` 是 MongoDB canonical Extended JSON，保留 ObjectId、64 位整数、Decimal128、日期、二进制等类型。例如超出 JavaScript 精确整数范围的数值返回 `{"$numberLong":"9007199254740993"}`，过滤条件也可使用合法 Extended JSON。

`returnedCount` 是本页数量；`hasMore` 表示额外文档或字节限额导致的后续内容，`nextOffset` 是下一页输入。`byteLimited` 区分字节限额与普通行数分页。排序使用有序数组，最多八项，默认按 `_id`；未提供 `_id` 时追加它作为同值排序的后续字段。投影仅允许 0/1 或布尔值，不能混用普通字段的包含和排除，`_id` 例外。

每页独立读取，源发生变化时 offset 分页可能重复或遗漏文档，不提供跨请求快照或全表一致性结论。

`--query-timeout-secs` 控制 Host 总体 deadline。显式设置 0 可关闭该总体 deadline；文档 find 此时仍采用默认 30 秒服务端 maxTimeMS。连接/游标清理另有独立预算。

## 边界

| 项目 | 约束 |
| --- | --- |
| 授权 | 项目、连接、数据库和工具白名单均在执行前校验；输入不接受新的权限或审批租约。 |
| 过滤 | 允许普通字段、比较、逻辑、数组匹配、存在/类型及正则谓词；只接受 find，禁止 `$where`、`$expr`、`$function`、`$accumulator`、pipeline 和任意 command。 |
| 数据字段 | `filter` 和 `projection` 中的 `approved` 等字段名是业务数据，不授予权限；顶层审批字段和 MCP `_meta` 仍按原有策略拒绝。 |
| 输入 | 总查询配置最多 32 KiB、过滤深度 16、节点 2048、数组 100 项；offset 最多 1,000,000。 |
| 行数 | limit 1–1000，默认 50，同时受启动时 `--max-rows` 约束；多读一个哨兵确定后续页面。 |
| 字节 | 按 canonical JSON 字节预算收集完整文档，为外层响应预留空间。首个文档过大时要求缩小 projection，不返回无法前进的空页；后续文档超过预算时从该文档之前继续。 |
| 时间与资源 | 默认 30 秒总体 deadline 包括连接、find 与读取；服务器同时使用 maxTimeMS，禁止排序落盘。SDK 游标在结束/错误/取消时释放，Agent 关闭连接会等待清理，清理另有 5 秒上限。 |
| 驱动选择 | 当前原生 MongoDB 支持该语义；pin/active 指向外置包时明确拒绝，不能回退到内置驱动。外置文档协议与其他厂商仍待对齐。 |

服务器分批读取与时间参数采用 [MongoDB find 契约](https://www.mongodb.com/docs/manual/reference/command/find/)。响应字节上限约束返回的完整文档和序列化结果，不表示 MongoDB SDK 的总内存只占该数值；读取单个原生 BSON 文档及服务器批次仍有自身开销。

## 真实服务端验收

```text
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
node scripts/test-headless-mongodb.mjs
```

runner 在独立临时目录下载并核对官方 MongoDB 7.0.45 的固定 SHA-256，自动选择 Windows x64 或 Ubuntu 22.04 x64 的原生包。其他平台可以设置 `OXIDE_MONGOD` 指向已有的原生可执行文件。它不连接已有数据库、不安装服务、不修改系统 PATH，也不执行生产配置迁移。

Rust fixture 检查所连接服务端的 PID 确属自己，随后创建临时数据与账户，再以认证模式重启该进程。生产 MetaStore 保存加密连接，公开 CLI/MCP 使用服务端 read 角色的账户，验证过滤、多字段排序、行/字节分页、类型保真、投影、输入与授权拒绝、实际游标关闭和 deadline。执行前后比较四个完整源集合的 BSON 摘要、凭据密文/nonce 与密钥；文件和数据库均属该 fixture。

原生测试默认标为 ignored，须显式提供可执行文件并运行；普通 CI 编译它，手动 `mongo_documents` job 在 Windows/Linux 运行完整入口。远端 CI 配置不代表这些平台已执行成功。验收只分享顶层日志及 `evidence.json`，整个临时 profile 含独立的测试密钥和账户数据。

2026-10-22，Windows x86_64 已实际运行官方 MongoDB **7.0.45**，完整脚本退出 0。证据为 `C:/Users/housh/AppData/Local/Temp/oxide-mongodb-acceptance-oOGuXA/evidence.json`，包括真实 CLI/stdio MCP、只读账户、完整 BSON 类型、行/字节预算、授权、deadline、源集合与加密凭据保持不变，以及清理后开放游标数为 0。首次运行暴露的客户端关闭超时已通过 Agent 临时连接的 polling 监测策略修复，并重跑完整场景；其他版本/平台与外置文档包仍待验收。
