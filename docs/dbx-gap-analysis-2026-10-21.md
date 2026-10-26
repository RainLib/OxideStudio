# OxideStudio 与 DBX 最新源码差距分析

日期：2026-10-21。

实施状态见 [DBX 对齐与修复进度](dbx-alignment-progress-2026-10-21.md)。本文保留分析时的基线，避免将实施后的状态与初始问题混在一起。

主要差距集中在驱动的产品级交付、公开 CLI/MCP 的工具覆盖、后台备份、大批量迁移、结构迁移保真、专用数据工作台和插件生态。Oxide 的模块拆分、数据库管理、值编辑和服务端数据比较已明显超出旧审计中的状态，应在现有实现上补齐闭环。

## 对比基线与口径

| 项目 | 基线 |
| --- | --- |
| OxideStudio | 当前 `feature/dbx-lsp`，`57ac240582a61b9c1ade7c1423b5d585fccfbab0`；原有本地修改保留 |
| DBX | [t8y2/dbx](https://github.com/t8y2/dbx)，`main@eeab128d738e59bbc4bd16646998275b921e16d2`，2026-10-21；下载完成后再次核对远端，提交一致 |
| 参考目录 | `sources/dbx`，工作树干净；此前停留在 `a2aad40190d83485149e923c7b77e826c9b52240`，2026-09-02。按最新主分支浅快照更新，旧本地 main 分支保留 |
| 范围 | 产品功能、源码能力边界、工程检查、针对性前端回归、前端打包 |

以下将“源码确认的功能差距”“已复现的问题”“共同优化方向”“待运行验收”分别标注。数据库名称出现在规划目录中，不代表已经安装可执行驱动，也不代表具备该产品的完整 DDL、编辑和事务能力。本次没有执行真实数据库写入、外部在线 AI 调用或打包桌面端的性能验收。

优先级：P1 为近期优先处理，P2 为下一阶段补齐，P3 为按产品定位选择的扩展方向。本次没有足够证据判定 P0 级业务运行故障。

## 已实现的能力与需要纠正的旧结论

| 领域 | 当前证据与判断 |
| --- | --- |
| 模块化 | `src` 下 1,515 个 TS/TSX 文件均未超过 1,000 行，最大文件约 862 行；`src-tauri/src` 下 541 个 Rust 文件均在 1,200 行门槛内。大小检查扫描 2,533 个文件通过，`scripts/module-size-baseline.json` 的 `legacy` 已为空。旧的“QueryEditor 4,000 行、SchemaSidebar 11,000 行、table.rs 28,000 行”不再适用于当前版本。 |
| 数据库管理 | 已有 sessions、metrics、locks、users、roles、privileges、MySQL events，以及 PostgreSQL/MySQL 表维护。应列出的缺口是产品覆盖和管理动作深度，不能再笼统写成“没有会话/用户/维护入口”。见 `src/features/database-admin/model/databaseAdminRefresh.ts:1`、`src-tauri/src/commands/database_admin.rs:13`。 |
| 数据比较 | 已有服务端完整比较、声明唯一键的 keyset 分页、受控同步计划、取消和退化状态。完整比较上限为每侧 100,000 行，之后进入采样或只读取行数。DBX 的默认完整比较阈值同样是 100,000 行；这个数值本身不能证明落后 DBX。 |
| 值编辑与 MongoDB | 已有 XML、array/map、geometry、image 等预览、单元格表达式模式和 Mongo 文档克隆界面。见 `src/features/value-editor/hooks/useValueEditorDraft.ts:1`、`src/features/value-editor/model/createValueEditorActions.ts:68`、`src/features/data-grid/ui/MongoDocumentCloneDialog.test.tsx`。 |
| 数据导入 | 已有 CSV/JSON/JSONL/XLSX、列映射、预览、严格预检、事务执行、取消和持久化导入报告。剩余差距主要是不同格式的大文件能力与可恢复任务，不是“没有导入映射/报告”。 |
| 驱动基础设施 | 已有签名包、版本 pin、安装/激活/回滚、托管 Java、运行健康界面和通用 JDBC Agent。需要交付的是逐产品经过验证的运行能力。 |
| 连接迁移 | 已识别 DataGrip、DBeaver、Navicat 来源；见 `src/features/connection-import/model/connectionImport.ts:3`。无需重复建设同类导入入口。 |
| SQL 与助手 | 已有独立 SQL LSP、语句作用域处理、Agent Host、受控审批、恢复投影和 Git 审阅入口。这些能力应保留并继续做真实运行验收，不宜直接换成 DBX 的组件内实现。 |
| 独立 Rust CLI/MCP | `src-tauri/src/cli/` 已有公开 stdio/HTTP MCP、项目/连接授权、5 个只读工具、直接数据库连接与发布打包。`scripts/oxide-ai.ts` 是另一个较旧的 TypeScript 入口，不能以其中的空 adapter 判定独立 CLI/MCP 缺失。见 `docs/EXTERNAL_AI_INTEGRATION.md:3`、`oxide_agent/runtime.rs:400`。 |

## 需要补齐的产品差距

| 编号 / 优先级 | 差距与当前边界 | DBX 对照及建议完成标准 |
| --- | --- | --- |
| G01 / P1 | **企业数据库的完整交付。** Oxide 有 13 个内置 driver profile、协议兼容配置、ClickHouse/DuckDB/rqlite Rust sidecar、Kingbase/IoTDB 发布通道和通用 JDBC。但 JDBC Agent 明确不提供交互事务、Grid 行写入和表迁移能力，Oracle/SQL Server 等配置项不能视作全功能支持。 | DBX 具备更多产品专用适配。优先把目标用户需要的 SQL Server、Oracle 等做成可安装、可取消、类型保真、元数据正确的产品包；编辑能力必须另有事务与回滚 conformance。证据：`src-tauri/jdbc-agent/README.md:15`、`.github/workflows/publish-drivers.yml:14`、`src/features/database-drivers/model/builtinProfiles.ts:19`。 |
| G02 / P2 | **公开 CLI/MCP 的工具与驱动覆盖。** 独立 Rust 实现和原生发行链已存在；目前公开 catalog 为 5 个只读工具，元数据来自应用缓存，查询方言限定 PostgreSQL/MySQL/SQLite。另有 `npm run ai` 的旧入口，默认空 adapter 容易造成使用预期不一致。 | DBX 独立 MCP 还覆盖 Redis/Mongo 等直接执行。建议统一主入口与文档、补明确授权下的实时元数据刷新，并逐驱动增加非 SQL 只读工具与外部客户端 conformance。公开 MCP 只读是现有边界选择，不作为漏洞，也不建议默认开放写入。见 Oxide `oxide_agent/catalog.rs:4`、`runtime.rs:144,537`、`scripts/oxide-ai.ts:21`；DBX `packages/mcp-server/README.md:16`。 |
| G03 / P1 | **备份任务依赖可见窗口与当前项目。** SQLite 调度 hook 每 30 秒轮询；窗口 hidden 时不启动到期任务，并只处理 active project 的计划。已有 Host 任务、保留策略和执行记录，但没有应用退出后继续调度的独立 worker。 | DBX 已有 MySQL/PostgreSQL 共用 Rust worker，以及可选的 Windows Task Scheduler、macOS LaunchAgent、Linux user service。完成标准：隐藏/关闭窗口、切换项目、重启时计划行为明确，执行状态可重接且不会重复运行。见 Oxide `useSqliteBackupScheduler.ts:26,34,63`；DBX `docs/background-database-backups.md:3`。 |
| G04 / P1 | **跨库迁移仍是有界小任务。** `MAX_TRANSFER_ROWS = 10_000`，归一化参数会强制截断到该上限；已有多表计划、类型审查和报告，尚不足以承担大表迁移。 | DBX 的 transfer 请求支持整表、逐表过滤和持续分批读取。建议引入 Host 持久化 job、稳定游标、批次恢复与可验证的结果统计。以百万行任务、中断续作、取消、目标切换及内存预算作为验收；保留现有预览/确认语义。见 Oxide `limits.rs:55`、`transfer_runtime.rs:31`；DBX `transfer.rs:317`。 |
| G05 / P2 | **全库导出和恢复覆盖有限。** 当前 `export_database_sql` 仅接受 bundled PostgreSQL，且以 schema 为范围；外置包必须具备尚未通用化的产品备份契约。SQLite 已有专用一致性备份/恢复，应保留。 | DBX 提供更广的 database export、MySQL/PostgreSQL 计划备份及产品专用 dump 路径。建议统一备份计划、能力描述、压缩与恢复验证；逐产品明确对象/权限/所有者是否包含。见 Oxide `export_database.rs:92`、`sqlite_backup.rs`；DBX `crates/dbx-core/src/data/database_export.rs`。 |
| G06 / P2 | **管理工作台的深度与外置驱动接入。** 当前管理语义主要面向 PostgreSQL/MySQL/MariaDB，外置包被明确拒绝；roles/privileges 目前侧重只读可见性，尚缺经审查的 grant/revoke 差异流程与更多厂商管理能力。 | DBX 有 Oracle、Dameng、Xugu、SQL Server 等专用管理面板。建议扩展语义化 admin capability 和变更计划；先补目标产品的用户/角色/权限与活动诊断，再扩任务调度、参数等。见 Oxide `database_admin/identity.rs:14`、`models.rs:27`；DBX `apps/desktop/src/components/admin/`。 |
| G07 / P2 | **大表采样策略较窄。** Oxide 的采样枚举目前只有 `ExtremeValues`，按唯一键首尾采样；中间区间的差异可能不被检查。界面已经正确说明这种局限。 | DBX 默认 `Hybrid`，组合随机与首尾样本。建议增加有数据库预算约束的分层/随机策略和逐键复核；不能把样本一致标为整表一致。双方默认完整比较 100,000 行、采样区间上限 10,000,000 行相同，单纯提高限制不构成优化。见 Oxide `compare_types.rs:158`、`compare_execute.rs:94`；DBX `data_compare.rs:375,1700`。 |
| G08 / P2 | **导入格式的大文件能力不均衡。** CSV/JSONL 已有 512 MiB 流式路径；JSON/XLSX 限 32 MiB，规范化记录受 100,000 行边界限制。已有终态报告，但没有将导入进度持久化为可恢复游标的执行协议。 | 建议优先补 XLSX 逐行读取、JSON 后续执行链的有界缓冲和可恢复映射/任务；“跳过坏行”需显式选择并给出完整统计，继续保留默认事务语义。DBX `data/table_import.rs` 可参考其格式与映射工作流，不据源码存在就认定其所有大文件场景已经验证。证据：Oxide `limits.rs:9,11,13,41`、`import_types.rs:234`。 |
| G09 / P2 | **消息与专用数据工作台宽度。** 当前 MQ 主要是 RocketMQ；Kafka/RabbitMQ/Pulsar/MQTT 尚未形成相应完整工作台。向量/图/宽列系统多处于参考 catalog，不能以通用 JDBC 或 SQL 编辑器替代原生对象语义。 | DBX 已有相应 MQ、MQTT、graph/vector/document 等工作区。按用户需求选择 Kafka/RabbitMQ、Qdrant/Neo4j 等优先族，分别交付连接、浏览、查询、取消与适用写入动作。证据：Oxide `src/features/mq/hooks/useRocketMqSession.ts`、`referenceDriverCatalog.ts:76,122,141`；DBX `components/mq/`、`mqtt/`、`graph/`、`vector/`。 |
| G10 / P2 | **通用插件生态。** 当前可扩展驱动协议已具备安全边界，但未发现 DBX 同类的通用 UI contribution、工具面板插件 SDK、市场安装与开发预览链。 | DBX 已有签名插件、独立 sidecar、连接提供者、结果视图/菜单/MCP contribution，以及 SDK/scaffolding。建议先定义少量稳定扩展点，再做插件开发与版本兼容工具；将驱动扩展与任意 UI/工具扩展分开设计。见 DBX `crates/dbx-plugin-runtime/src/plugins/manifest.rs`、`plugins/sdk/cli/README.md`。 |
| G11 / P2 | **数据文件的即时查询入口。** 已有导入、项目文件和图片预览，但没有发现拖入 CSV/JSON/Parquet 后自动建立临时 DuckDB 查询会话的统一入口。导入到目标表与直接查询文件是不同工作流。 | DBX `useFileDrop.ts:15,59` 生成数据文件预览 SQL 并建立 DuckDB 连接。建议复用已有 DuckDB sidecar，增加临时只读文件数据源、路径/资源释放和大文件预览限制，先支持三种常用格式。 |
| G12 / P2 | **参考目录已发生漂移。** 最新 DBX generated catalog 有 88 个类型，Oxide 参考 candidate 有 86 项；集合不同，不能用两个数字直接计算支持率。DBX 独有条目是 `solr/couchdb/gbase8s/gbase8c/transwarp/nebula/plugin/salesforce`。 | 先对齐规划目录、数据模型和状态说明；`plugin` 是扩展入口，GBase 子产品也需单独语义验证，不能直接变成“已支持”。Oxide 另有 `rocketmq/cockroachdb/yugabytedb/timescaledb/tidb/greenplum` 条目。建议以固定上游 SHA 与结构化目录差异维护基线。 |
| G13 / P1 | **MySQL 结构迁移缺列级字符集/排序规则。** `ColumnInfo` 未建模 column charset/collation；MySQL `get_columns` 也未读取这两项，snapshot 直接使用 `ColumnInfo`，列定义和结构比较因此无法表达或显式保留该差异。数据库级 defaultCharset/defaultCollation 已存在，但不覆盖列级覆盖值。 | DBX 本次上游已修复 ADD COLUMN 丢失 charset/collation。建议补齐 Rust/TS/外置协议与 snapshot 版本兼容、列捕获、diff 和 DDL；验收“相同 VARCHAR 类型而 collation 不同”的差异识别，以及目标默认字符集不同情况下的新增列保真。源码确认缺字段，尚未执行真实 MySQL 迁移复现。见 Oxide `core/protocol.rs:360`、`drivers/mysql/driver.rs:475`、`core/schema_diff/types.rs:41`、`ddl.rs:235,663`。 |

上述 13 项中，G01–G07、G09–G13 有明确的源码能力边界或上游对应；G08 同时包含当前限制和后续工程优化建议，不推断 DBX 在未实测的规模下必然更快。

## 下载期间新增的上游修复

初始核对的 DBX `23b63d43` 到最终 `eeab128d` 又新增 10 个提交，涉及 38 个文件。主要变化的落点如下，不把“上游修过”直接判定为 Oxide 也存在同一缺陷。

| DBX 变化 | Oxide 的处理建议 |
| --- | --- |
| `9e7ea728`：MySQL ADD COLUMN 保留 charset/collation | 已核对到 G13 的协议/元数据缺口，作为迁移保真优先项。 |
| `6e550518`：SQL Server 表结构编辑开放外键 | 纳入 G01 的产品级 DDL 验收；通用 JDBC profile 当前不提供同等编辑能力。 |
| `5f1a5bf2`：PostgreSQL procedure diff 忽略定义中的 schema 限定 | 加入跨 schema routine diff 回归，验证 Oxide 的签名与 source normalization；本次未判定存在同一 bug。 |
| `a80d12da`：Oracle 复用 DDL 时采用目标默认 tablespace | 纳入 Oracle 专用 sidecar 的目标环境契约，不能仅复用通用 JDBC 配置。 |
| `c50cd723`：映射预览划除跳过列；`4ebf4053`：切换后不隐藏特殊 Tab；`70c0e563`：保留 MQTT 发布 Topic | 分别作为导入审阅、工作区生命周期、未来 MQTT 工作台的交互回归场景；不据提交标题宣称 Oxide 已复现。 |
| `eeab128d`：恢复历史 SQL 时避免覆盖活动编辑器 | Oxide 的 `createEditorHistoryActions.ts:23` 已通过 `createTab` 打开历史查询并恢复其连接/database/schema；此路径不列为新增缺口，保留回归即可。 |

[该批上游提交与文件差异](https://github.com/t8y2/dbx/compare/23b63d43b8889bc4b6238b021f9ff20dcd22a204...eeab128d738e59bbc4bd16646998275b921e16d2)。

## 当前工程自身需要优化的事项

| 编号 / 优先级 / 状态 | 证据与影响 | 建议与验收 |
| --- | --- | --- |
| E01 / P1 / 已复现 | **Windows 完整构建失败。** `verify-document-metadata-cache-boundaries.mjs:12,19,23` 原样读取文件并比较含 LF 的多行字符串；本地 `core.autocrlf=true`，文件是 CRLF。原始匹配为 false，仅在内存统一换行后匹配为 true。 | 在共享读取层统一换行；逐步将格式敏感的文字匹配替换为结构化导出/依赖检查。LF 与 CRLF checkout 都应通过相同边界检查。本次按分析范围保留源码，未修复。 |
| E02 / P1 / 源码确认 | **持续集成没有覆盖普通 PR 和根前端回归。** `.github/workflows/ci.yml:4` 仅手动/tag 触发；frontend job 跑 release、agent contract、agent host，未调用根 `npm test`。已有多平台发布矩阵，但发布构建不能替代每次改动的回归。 | 添加 PR/主分支触发、根 Vitest、构建与必要的跨平台检查；对现有 92 项已通过用例之外的主套件建立固定门禁。 |
| E03 / P1 / 待运行验收 | **产品版本与真实运行证据。** 有 conformance fixtures 和 `test-live-databases.sh`，后者默认只跑 PG16、MySQL8.0、Redis7、Mongo7、ES8.15.3；CI 未调用 live-db/conformance 脚本。不能从单元测试推断全部版本/厂商已覆盖。 | 建立受支持版本矩阵和独立可选 CI job；记录实际 driver/服务端版本、平台及结果，重点覆盖取消、事务、类型、导入回滚、sidecar 重启和真实 LSP 文档同步。 |
| E04 / P2 / 源码确认 | **国际化覆盖未闭合。** 已有中英文框架，英文消息约 275 个 key；数据库管理面板仍含 `Sessions/Privileges/Auto` 等硬编码，部分值编辑标签也未使用翻译。 | 优先覆盖连接、管理、导入/迁移和错误恢复路径；沿用现有 i18n，不新建第二套翻译系统。按关键工作流做中英文界面验收。 |
| E05 / P2 / 配置优化 | **参考仓库未进入 Vite watcher 忽略项。** `vite.config.ts:43` 只显式忽略 `src-tauri` 和旧参考目录；更新后的 DBX 快照包含 7,205 个文件。Vitest 已通过 include 范围排除参考工程。 | 将 `sources/**` 加入开发 watcher 的忽略配置；测量拉取/切换参考仓库时的 CPU 和 HMR 行为。这里只确认配置缺口，未量化实际开销。 |
| E06 / P2 / 待运行验收 | **桌面性能需要可复现预算。** 已有懒加载、Worker、虚拟表格和产物检查。本次 startup JS 281.60 kB（gzip 87.83 kB），workspace chunk 516.51 kB；Vim 可选 chunk 2,753.72 kB，已通过动态 import 按需加载。 | 为打包版建立首个可编辑时刻、Tab 切换、大 schema、大结果、长会话恢复、IPC 负载的基线。先测量再优化，不用可选 Vim 包的大小推断首屏慢。 |
| E07 / P2 / 文档确认 | **历史审计状态已漂移。** 旧文档仍把超大组件、仅当前页比较、缺 XML/表达式编辑等列为现存问题，部分引用还使用 `source/dbx`。 | 为审计固定 Oxide/DBX SHA、状态、证据和验收命令；后续以本文为本次基线，关闭已实现条目，避免重复立项。 |

## 可选择的战略扩展

| 优先级 | 方向 | 判断 |
| --- | --- | --- |
| P3 | Web/Docker 数据库工作台 | DBX 有完整 Web backend 与 Docker 入口；Oxide 的 enterprise admin/gateway 已有基础，但不等于完整浏览器数据库客户端。若产品继续优先桌面，可后置；若要面向远程团队，再规划 core/desktop/web 的共享服务边界。 |
| P3 | Git 工作台深化 | Oxide 已有独立 Git 功能与审阅路径。stash、blame、冲突处理、merge/rebase、PR 流程属于自身增强方向，不列为“DBX 已有而 Oxide 缺少”的差距。 |

## 本次验证结果

| 检查 | 结果与可解释范围 |
| --- | --- |
| `npm run build` | **失败**。TypeScript、文件大小门禁及前几项边界检查通过，随后因 E01 的 CRLF 格式匹配中断；完整构建仍需修复后重跑。 |
| 8 个专项 Vitest 文件 | **92/92 通过**，涵盖比较生命周期/请求隔离、Mongo clone、参考驱动目录、维护/events、语句 scope 与助手侧栏。 |
| 单独 Vite production build | **通过**，Vite 用时 37.02 秒，本机 Node 24.11.1；该结果仅验证打包步骤。 |
| `node scripts/verify-frontend-bundle.mjs` | **通过**，1 个 startup module，无静态 import cycle。 |
| 文件大小扫描 | **通过**，2,533 个文件，未保留 legacy 大文件豁免。 |
| 已有原生 CLI 的工具发现 | 本机已有 `oxide-agent 0.1.16`，`tools list` 返回 5 个只读工具。源码包版本为 0.1.18；此项用于确认独立入口已存在，不代表当前 Rust 源码已重编译或数据库查询已完成联调。 |

专项回归命令：

```powershell
npm test -- tests/frontend/data-compare-lifecycle.test.tsx tests/frontend/data-compare-operation-scope.test.tsx src/features/data-grid/ui/MongoDocumentCloneDialog.test.tsx src/features/database-drivers/model/referenceDriverCatalog.test.ts src/features/database-admin/ui/DatabaseMaintenanceDialog.test.tsx src/features/database-admin/ui/DatabaseEventAdminPanel.test.tsx tests/frontend/sql-statement-scope-conformance.test.ts tests/frontend/assistant-agent-sidebar.test.tsx
```

## 建议推进顺序

1. **先让修改可验证并补齐迁移保真**：E01 Windows 构建兼容 → E02 PR 与前端测试门禁 → G13 MySQL 列语义 → E03 目标产品/版本 conformance。完成标准是相同源码在受支持平台能构建，关键回归在提交时自动运行，迁移契约能保留已声明的列语义。
2. **补齐常用工作闭环**：G03 后台备份 → G04 大表迁移，并按实际用户需求并行规划 G01 产品驱动。每项都以独立可演示的端到端流程验收。
3. **再扩宽度和效率**：G02 现有 Rust CLI/MCP 的工具覆盖、G05–G12 的管理、数据工具、专用工作台、插件和目录同步；同时完成 E04/E06 的国际化与性能基线。Web/Docker 与 Git 深化按定位选择。

## DBX 固定版本证据入口

- [数据库类型 generated catalog](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/apps/desktop/src/types/generated/databaseTypes.ts)
- [独立 MCP 的架构与连接要求](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/packages/mcp-server/README.md)
- [后台数据库备份](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/docs/background-database-backups.md)
- [服务端数据比较与采样](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/crates/dbx-core/src/data/data_compare.rs)
- [跨库迁移](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/crates/dbx-core/src/data/transfer.rs)
- [文件拖入与 DuckDB 查询入口](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/apps/desktop/src/composables/useFileDrop.ts)
- [插件 manifest 与 SDK](https://github.com/t8y2/dbx/blob/eeab128d738e59bbc4bd16646998275b921e16d2/crates/dbx-plugin-runtime/src/plugins/manifest.rs)

DBX 的部分实现本身仍非常集中，例如该版本 `data/transfer.rs` 约 24,351 行。应借鉴经过核对的工作流和能力契约，保留 Oxide 已形成的模块边界。
