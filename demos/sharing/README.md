# 分享演示工作区

对应合并版 PPT 的第 4、8、9、10、11 页，以及 30 分钟分享文档第 19 页。现场动作共 4 分钟，已经包含在分享时长中。

## 准备和恢复

在仓库根目录运行 `python3 scripts/prepare-sharing-demo.py`。默认生成 `output/sharing-demo/workspace/oxide-sharing.sqlite`，同时复制 SQL、CSV 和 Plan 提示词。只需要 Python 3 标准库；生成文件不提交。

在客户端新建本地项目，选择该 workspace，命名为“OxideStudio 分享演示”；添加 SQLite 数据源，File 选择生成的数据库，测试连接后保存。该库含 7 张表、1 个视图、外键和索引，全部内容为合成数据。

完整恢复：先断开演示 SQLite 连接，再运行 `python3 scripts/prepare-sharing-demo.py --reset`。脚本只替换带有精确 fixture 标记的演示库，拒绝覆盖陌生数据库；有 WAL/SHM/journal 文件时拒绝恢复，有 lsof 的系统还会检查其他进程的打开句柄。日常网格演示后执行 `sql/03-reset-grid.sql` 即可，无需替换数据库。

## 现场顺序

| PPT | 时间 | 操作 | 可见验收结果 |
| --- | --- | --- | --- |
| 4 | 60 秒 | 选择演示项目，连接 SQLite，展开 main / Tables | share_demo、products、orders、order_items 等表可见；当前连接名称明确 |
| 8 | 60 秒 | 打开 `sql/01-query.sql`，选择演示连接，运行；打开 Query History | 两行：Bob 92、Alice 86；历史中可找到该查询 |
| 9 | 60 秒 | 打开 share_demo 的 Data，把 Bob 的 score 从 92 改为 95；保存，再刷新 | 草稿计数归零；刷新后仍为 95。再执行 `03-reset-grid.sql` 恢复为 92 |
| 10 | 30 秒 | 新控制台输入 `SELECT s. FROM share_demo s;`，将光标放在 `s.` 后，按 Ctrl+Space | 出现 id、name、score、team、note 等候选；随后撤销测试文本 |
| 11 | 30 秒 | AI 助手中打开提前完成的 Plan，展示读取表结构的工具记录 | 真实完成的计划和工具记录可见；明确没有执行数据库修改 |

AI 预演：切换 Plan 模式，使用 `PLAN-PROMPT.txt`，选择已登录、可用的运行时和模型。必须等到真实完成后才纳入现场演示。外部 CLI 生成的报告、离线文字和 mock 不等于应用内 Plan 验收。若模型依赖超过 10 秒，现场切回架构图，不等待生成。

该 Plan 预演使用上述本地 SQLite 项目。组织项目当前可通过托管 Gateway 查询和验证权限，但 AI 数据库工具对组织项目会返回 `active agent project no longer exists`；在组织项目支持该工具并完成真实验收前，不要把本地 Plan 描述为组织数据库 AI 访问。

## 会后可选演示

- 执行 `02-join.sql`：订单金额应为 102 / 129900、105 / 75700、101 / 49700（单位：分）。可用于 Explain、结果导出。
- 结构快照：保存 A，逐条执行 `04-schema.sql` 的 ADD COLUMN，保存 B 并比较，最后执行 DROP COLUMN 恢复。
- 导入：把 `data/import-notes.csv` 映射至 demo_notes；使用预览检查列。导入后删除合成行 11、12，或断开后完整恢复。
- Project Files：打开已保存 SQL，编辑注释并保存，重新打开检查。Git 可在该生成目录自行初始化，数据库文件应加入该目录的 `.gitignore`。

## 当前组织验收

个人 SQLite 演示与远程 hs_test 托管组织使用不同连接链路。组织验收顺序是：设备证书 → Mac 设备登记 → Gateway mTLS → 项目/资源权限 → 查询 → 允许表编辑 → 禁止表拒绝 → 审计。

当前服务器的设备签发和连接凭据属于部署配置，不能放在本目录或 PPT 中。设备登记需要证书 DER 的 SHA-256，不能用 CSR 的哈希代替，也不能复用 Windows 设备私钥。

在这台 Mac 上运行 `npm run demo:check-device` 检查三份配置文件、CA 链、客户端用途、有效期和公私钥匹配；准备不全时退出码为 2。通过只代表本机身份文件有效，仍需检查组织登记和真实 Gateway 查询。

`postgres-organization-seed.sql` 用于管理员在已有隔离验证库增加分享样例。它限定数据库和 Schema，拒绝覆盖同名对象，不修改已有业务表或权限。执行后仍需要为具体数据源/用户登记资源和逐表 grant；只读 SQL 通道不能替代受控写入通道。

组织演示至少验证以下内容，缺一项都应在验收记录中标为未完成：

| 场景 | 预期 |
| --- | --- |
| Mac 设备 | 独立 device ID、clientAuth 证书、私钥匹配、CA 验证通过，登记状态 active |
| 资源与查询 | 展开 validation，查询 sharing_share_demo，返回 Bob 92、Alice 86 |
| 普通表写入 | 没有 data.write 时入口关闭，服务端也拒绝 |
| 允许表写入 | 在 hs_test permissions 数据源中修改 adapter_notes 的合成备注，保存、刷新后恢复原值；实际 data.write 授予此表 |
| 结构变更 | 在 hs_test permissions 数据源的 schema_sandbox 中新增/删除临时列；实际 schema.ddl 授予此表 |
| 禁止资源 | hs_test permissions 数据源对 restricted_records 显式拒绝；只读 TLS validation 数据源使用独立授权，不能把该拒绝描述为组织内所有数据源的全局规则 |
| 审计 | 查询/允许写入/拒绝请求均可按该设备和数据源检索 |
