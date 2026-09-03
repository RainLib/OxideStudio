# OxideStudio 与 DataGrip 能力差距

> 评估日期：2026-07-29。DataGrip 基线采用 JetBrains DataGrip 2026.2 官方文档与发布说明；OxideStudio 基线采用当前仓库代码与测试，而不是 README 宣称能力。AI Agent 的完整逻辑要求见 [AI_AGENT_PRODUCT_SPEC.md](AI_AGENT_PRODUCT_SPEC.md)。

## 1. 评估方法

状态定义：

- **已具备**：日常主路径可用，并有相应实现或测试。
- **部分具备**：已有入口，但覆盖范围、可靠性或专业细节不足。
- **缺失**：没有可用主路径，或只有不在当前工作台挂载的遗留组件。

DataGrip 的官方能力基线主要来自：

- [Features overview](https://www.jetbrains.com/datagrip/features/)
- [Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html)
- [Introspection](https://www.jetbrains.com/help/datagrip/introspection.html)
- [Query consoles](https://www.jetbrains.com/help/datagrip/query-consoles.html)
- [Run queries and query history](https://www.jetbrains.com/help/datagrip/run-a-query.html)
- [Code completion](https://www.jetbrains.com/help/datagrip/auto-completing-code.html)
- [Data editor and viewer](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html)
- [Filter data](https://www.jetbrains.com/help/datagrip/tables-filter.html)
- [MongoDB support](https://www.jetbrains.com/datagrip/features/mongodb/)
- [Elasticsearch Console completion](https://www.elastic.co/docs/explore-analyze/query-filter/tools/console)
- [Search in DataGrip](https://www.jetbrains.com/help/datagrip/search-in-ide.html)
- [Import](https://www.jetbrains.com/help/datagrip/import-data.html) / [Export](https://www.jetbrains.com/help/datagrip/export-data.html)
- [Schema comparison and migration](https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html)
- [Diagrams](https://www.jetbrains.com/help/datagrip/creating-diagrams.html)
- [Refactoring](https://www.jetbrains.com/help/datagrip/refactoring-source-code.html)
- [Databases in VCS](https://www.jetbrains.com/help/datagrip/databases-in-the-version-control-system.html)
- [AI for databases](https://www.jetbrains.com/help/ai-assistant/use-ai-with-databases.html)
- [DataGrip 2026.2 release notes](https://www.jetbrains.com/help/datagrip/release-notes-datagrip.html)

这不是逐像素复制计划。DataGrip 依托 IntelliJ Platform，OxideStudio 应优先补齐数据库工作流，不复制与数据库价值无关的通用 IDE 复杂度。

## 2. 结论摘要

OxideStudio 已经具备“连接 → 浏览元数据 → 编写/执行查询 → 查看/编辑表数据”的骨架，并在多数据模型、Tauri 安全边界、项目文件和 AI 工具一致性上形成了自己的方向。与 DataGrip 的主要差距不在单个按钮，而在五条专业闭环尚未形成：

1. **发现闭环**：Search Everywhere、对象导航、find usages、数据库全文搜索仍不完整。
2. **变更闭环**：schema diff/migration review、机器可判定 preflight 与 PostgreSQL 指纹绑定的原子 apply/post-verify/journal 已形成首条安全闭环；项目 Git 已覆盖 clone/init/status/diff/stage/unstage/hunk/commit/history/branch/remote/fetch/pull/push/patch，Agent 文件变化也可直接在主编辑器审阅，Data Compare 已具备服务端全量/降级比较、批量同名表检查、缺表迁移串联和小差异安全同步；仍缺 MySQL 安全 apply、changelist/blame 与 DDL data source mapping。
3. **数据工作闭环**：Value Editor 已有类型感知主路径，但外键导航、聚合视图、多视图模式和导入映射不足。
4. **诊断闭环**：Explain Plan 与 PostgreSQL/MySQL 原生错误诊断已有主路径，但自动 Fix → Validate、会话/锁/运行监控仍不足。
5. **智能协作闭环**：Chat/Plan/Agent 已统一进入独立 TypeScript Deep Agents host，并具备 Rust 模型/工具/审批边界、加密 LangGraph checkpoint/pending writes、应用重启后的对话恢复与手动 checkpoint resume、文本附件、项目文件 revision-safe 写入、Changes 审阅、trusted metadata/plan citation、optimizer-estimate 热点信号和 vendor error 到 review-only patch 的修复路径；仍缺运行时统计驱动的自动优化、通用后台任务恢复和全部 provider tool bridge。LSP 已补齐 catalog 隔离、同名列排序、CTE/派生表输出、当前 console 临时表生命周期、routine overload、MongoDB collection-aware 自动补全、ES 引号内 mapping 字段与 6/7/8 版本路径、Table WHERE 补全、FK JOIN、静态 domain 值、偏好/usage 排序和大 catalog 性能基线；未打开文件的全项目 usage index 与需显式治理的 live value-frequency sampling 仍属于后续缺口。

按日常数据库开发主路径估算，当前完成度约为 **58%–68%**；按 DataGrip 2026.2 全功能面估算约为 **38%–48%**。这是工程规划区间，不是营销评分。

## 3. 能力矩阵

### 3.1 数据源与 Database Explorer

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 多数据源、连接属性、SSH/SSL | 部分具备 | 已有项目隔离数据源、测试连接、SSH tunnel、SSL 参数；缺少更完整的 driver 属性、密码存储策略 UI 和连接诊断 | P0 |
| 连接 session 策略 | 缺失 | DataGrip 2026.2 提供 dedicated、single shared、shared + introspection 双 session；OxideStudio 目前由 pool/transaction session 隐式管理，用户不能为 console、data editor 与 introspection 选择隔离策略 | P1 |
| 数据库对象树与 introspection scope | 部分具备 | 支持 database/schema/table/view/collection/key/routine，带 cache/remote 状态；Redis 显示 `db N` namespace，非默认 namespace 采用可取消的异步 hydrate；对象类型、授权、trigger、sequence 等覆盖不足 | P0/P1 |
| Explorer 快速过滤与 reveal | 部分具备 | 有 filter、展开/折叠、reveal active；缺少缩写匹配、多选和跨数据源统一索引 | P0 |
| 对象创建、重命名、删除、DDL | 部分具备 | 表、列、索引、约束、view、database 已覆盖主要路径；不同 driver 的对象动作不齐 | P0/P1 |
| 广泛数据库驱动 | 部分具备 | 运行时为 PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis、Elasticsearch；ES 自动探测并适配 6/7/8 typed/typeless API；SQL Server 等通过签名外部 driver package 规划接入 | P0/P1 |
| DDL data source / offline schema | 部分具备 | 可从一份受限项目 SQL 文件或确定性有界的 eligible SQL 文件集解析 portable `CREATE TABLE` / `CREATE INDEX`、列和部分约束，创建带来源的 review-only baseline 并进入 schema diff/diagram；尚缺完整方言 parser、DDL 文件与真实对象 mapping、迁移 run configuration，且项目 DDL baseline 不能自动 apply | P1 |

### 3.2 SQL 编辑与 Query Console

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 绑定数据源的多个 query console | 部分具备 | 支持多 Tab、连接/schema 上下文、split editor；无选区时会按 driver lexer 只执行光标所在 statement，选区与 Run All 保持显式；console 生命周期、执行范围模式和 session 模式仍不够完整 | P0 |
| schema-aware completion | 已具备/持续细化 | query/table tab 按 `(connection, database, schema)` 隔离 metadata/schema id/cache；无 FROM 时使用 `table.column`，单表时使用短字段，多表时使用 alias；PostgreSQL/MySQL/Hive/ClickHouse 有共同矩阵、FK JOIN 片段、静态 `ENUM`/`SET` domain 值、可配置大小写/alias 及本地 usage 排序。MongoDB 按当前 collection 隔离字段并自动弹出 key/collection 候选；ES 支持引号内 mapping 字段且 REST 路径按 6/7/8 变化。2,500 表冷目录有跨方言回归预算；仍缺未打开文件的持久 usage index 与需显式授权的 live value-frequency sampling | P1 |
| inspections、quick-fix、错误高亮 | 已具备/部分 | parser 与 pull/push diagnostics、全文/范围格式化、无 WHERE mutation、无条件 JOIN、歧义列、`SELECT *`、明显 dialect 风险及逐项 `noinspection` 已接入；提供安全 guard 与 `*` 展开 quick-fix。仍未达到 DataGrip 的全部数据库规则与设置 UI | P1 |
| refactor / find usages / navigation | 已具备/部分 | Definition 可从 SQL 跳到真实 Explorer 对象，References/安全 Rename 覆盖同 schema 的全部已打开文档，document/workspace symbols 已提供；尚缺未打开项目文件的持久 usage index 和完整依赖图 | P1 |
| 参数化查询 | 部分具备 | 已有参数面板与后端参数化执行；自定义参数 pattern、历史和值配置不足 | P0 |
| query history | 已具备 | 项目级 SQLite 日志记录成功/失败/取消、connection/database/schema、duration、row count；支持搜索、筛选、单条删除、打开和安全重跑 | — |
| local history / scratch recovery | 缺失 | 项目文件有 revision conflict，但没有编辑器级自动历史与恢复 | P1 |
| run configuration / ordered scripts | 缺失 | 不能保存多文件、多 target schema 的执行配置 | P1 |

### 3.3 Data Editor 与结果集

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 服务端分页、排序、过滤 | 已具备/部分 | Table Tab 支持分页、filter、sort 和布局；WHERE 输入以当前表构造虚拟 SQL 文档，立即给出本地列候选并异步合并 LSP，支持 Ctrl/Cmd+Space、方向键、Enter/Tab。多列排序历史与 query preview 细节仍不足 | P0 |
| 行增删改、提交/回滚 | 已具备/部分 | 参数化 mutation、批量提交、草稿保护已存在；冲突展示和 generated key 反馈不足 | P0 |
| 单元格 SQL expression | 缺失 | 目前 cell/Value Editor 只提交 literal、NULL 或 DEFAULT，不能像 DataGrip 2026.2 那样明确切换 expression mode 后提交 `NOW()`、计算式等未转义 SQL 表达式 | P1 |
| Value Editor | 已具备/部分 | `Shift+Enter`/cell menu 打开独立大视图；text/JSON/date/binary/boolean/number 有类型校验，明确区分默认未加载、NULL、空串和值，修改复用 table draft/mutation gate；超大 LOB 的独立按需拉取仍待增强 | P1 |
| Table / Tree / Text / Transpose | 部分具备 | Mongo collection、Redis key、ES index 已进入只读有界 Data Grid，不再打开 SQL editor；表数据与 SQL 查询结果的加载页都有只读 transpose（表格未提交编辑时锁定），JSON Value Editor 有 1 MiB 有界只读 tree；仍缺文档 tree/text 切换、原生服务端分页/过滤/编辑与 XML/array/map 专用视图 | P1 |
| 外键导航 | 已具备/部分 | PostgreSQL/MySQL 可从 FK cell 跳到 referenced row，也可从主键/唯一键 cell 查看 referencing rows；复合键原子映射、NULL 不误跳、保留 connection/database/schema scope。尚缺键盘快捷键、关系路径历史和图内联动 | P1 |
| Aggregate View | 已具备/部分 | Table/Query grid 的 range/row/column 多选支持 cells/distinct/NULL/default 与类型感知 sum/avg/min/max；decimal/bigint 用定点精确累计，50k cell 有界采样且明确标记。尚缺自定义函数和 server-wide aggregate | P1 |
| Data compare | 逻辑已具备，真实产品验证延期 | 任意两个已加载 Table/Query 结果可从 tab 菜单打开只读 artifact；支持共同 PK/`id` 推荐、用户复合 key、不同列序、changed/left-only/right-only/equal/duplicate 分类、absolute/relative 数值 tolerance、搜索和显式 refresh。表端点另有 Host 全量 keyset / 确定性极值抽样 / 超限风险降级，带稳定 operation ID、阶段进度、双端 backend cancel、批次/本地 checksum 协作取消和有界明细。Explorer 可从单表、Schema、数据库默认 Schema 或批量选择启动同名表检查，最多两个 compare 并发；目标缺表携带已选 target 进入既有受审阅迁移向导。共享 value column 可显式忽略，key 始终保留。精确且未截断的小差异集支持逐行选择，并生成审阅 SQL与 Host 冻结的短期单次参数化计划；执行前复核 metadata digest，UPDATE/DELETE 绑定旧目标快照，单事务逐句验证 affected rows，漂移或异常整体回滚，commit 结果未知时禁止自动重试。sample/skip/truncated 结果 fail closed。重复 key/重复列不静默配对，truncated/current-page 边界可见；剩余为真实产品并发、权限与大宽表验证 | P1 |
| 当前结果内查找 | 部分具备 | 有 grid search/filter；普通 PostgreSQL/MySQL 查询在驱动读取阶段硬限制为首 1,000 行并明确标记 truncated，避免先全量入内存；仍缺可配置 fetch page、列范围、正则和匹配导航 | P0 |

### 3.4 Import / Export

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 数据导入 | 已具备/部分 | CSV 已有编码/delimiter/header/空值策略预览、逐列映射和类型预检；表对象菜单支持 CSV、JSON/JSONL/NDJSON 参数化原子导入；数据源、PostgreSQL database、schema/database 和 table 右键均可运行 `.sql` 脚本，并明确显示脚本实际作用于所在 database/schema 而非强行限定单表；32 MiB/10 万行以上仍需 Rust native streaming | P1 |
| 多格式导出 | 部分具备 | CSV、JSON 与可重放的 SQL `INSERT` 已有；缺少 Markdown、XML、Excel、自定义 extractor | P1 |
| schema/object DDL 导出 | 部分具备 | 支持对象 DDL 查看/复制；缺少选择集、依赖顺序和批量导出 | P1 |
| pg_dump / mysqldump | 缺失 | 没有原生工具发现、参数配置、进度和恢复流程 | P1/P2 |

#### Explorer 常规操作审计

| 对象层级 | 已支持 | 仍缺少或需增强 | 优先级 |
| --- | --- | --- | --- |
| Data Source | 新建对象、刷新、缓存失效、属性、移除、SQL script import；支持嵌套连接分组、批量移入/移出、Manual/A–Z/Z–A 与 before/inside/after 拖放 | 会话/锁监控、更多产品的 native backup/restore、跨环境数据传输真实矩阵验证 | P1/P2 |
| Database / Schema | 展开与过滤、刷新、重命名/删除（按 driver capability）、快照/diff、SQL script import | 批量 DDL + data export、native dump/restore、schema clone、对象搜索/find usages、权限/owner 管理 | P1 |
| Table / View | 打开数据/DDL、复制名称/路径/DDL、重命名、列编辑、truncate/drop、CSV/JSON import、CSV/JSON/SQL inserts export、SQL script import、loaded-page data compare | duplicate/copy table、server-wide data compare/sync、依赖/usage、索引/约束专用编辑器、统计信息/ANALYZE/VACUUM、批量多表导入导出 | P1 |
| Query Result | CSV/JSON 等已有导出路径和有界结果 | Excel/Markdown/XML、自定义 extractor、导出列映射、后台流式超大结果 | P1 |

SQL script import 是库/schema 级执行能力：即使入口来自 table 右键，也不会伪造“仅影响当前表”的安全保证。表级结构化数据导入继续使用 CSV/JSON 映射与参数化事务；需要真正的单表 SQL 导入时，应在后续增加 SQL AST 目标校验，而不是用字符串匹配限制脚本。

### 3.5 Schema 工程与可视化

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| Schema diff | 已具备/部分 | 已有按 project/connection/database/schema 隔离的版本化快照、稳定 fingerprint、差异 rail、phase/order/dependsOn、风险/可逆/blocked 状态与精确对象联动；尚缺 rename detection、完整 view/routine source 和 schema mapping | P1 |
| Migration preview / apply | 已具备/部分 | PostgreSQL/MySQL 已生成 dependency-ordered preview；NOT NULL/UNIQUE/FK/drop preflight 带机器断言。PostgreSQL Apply 会校验 typed schema/分级批准、重新抓取 live fingerprint 并重算计划，随后原子 batch、持久 journal、post-verify，并只为全量可逆计划生成 guarded rollback artifact。MySQL 必须额外确认 DDL auto-commit 风险，逐条执行并在每条成功后持久 journal，失败会明确报告可能已提交数；尚缺完整跨对象 dependency/source、rename/schema mapping、独立 server dry-run 与 interrupted-journal reconciliation | P1 |
| Database diagram | 已具备/部分 | Schema Snapshot 可打开独立 ER artifact：保留复合 PK/FK 映射、确定性 parent→child 布局、关系/字段搜索、keys-only、zoom/Fit、关系检查器和 Explorer reveal；快照刷新复用同一 target tab。尚缺手动布局持久化、SVG/图片导出、跨 schema 目标节点与对象 dependency overlay | P1 |
| Explain Plan | 已具备/部分 | PostgreSQL/MySQL 支持 estimate/analyze、规范化节点树、raw plan、cost/rows/time 和取消；Patch Preview 还可比较当前完整 SQL 与完整虚拟修改后 SQL，并经二次确认运行一次提议 SQL 的 Analyze。尚缺图形 plan、节点到表/索引的双向联动、计划历史与多次采样对比 | P1 |
| Object dependency / usages | 缺失 | 无依赖图和影响面分析 | P1 |

### 3.6 项目、文件与 VCS

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 项目关联本地目录 | 已具备 | 自动目录名、别名、删除、路径约束和项目内数据源隔离已具备 | — |
| SQL/文本文件编辑 | 已具备/部分 | Monaco、保存、revision conflict 已有；缺少自动保存策略与 local history | P1 |
| 图片等文件预览 | 已具备/部分 | 常见图片只读预览已具备；PDF、CSV table view、hex/binary viewer 尚缺 | P2 |
| VCS 集成 | 已具备/部分 | New Project 支持本地目录、Git URL clone 和经官方 `gh` CLI 认证后的 GitHub 搜索/clone。独立 Version Control 面板提供 init、branch/upstream/ahead/behind、status、All/Staged/Working diff、主 Monaco DiffEditor、逐 hunk stage/unstage、文件 stage/unstage、commit、100 条 log、branch create/checkout、remote、fetch/fast-forward-only pull/push、patch generate/check/apply/reverse；所有路径/URL有界校验、无 shell 拼接、无交互 prompt。Agent Changes 继续保留 Turn 归因和 revision-safe Keep/Undo。尚缺 changelist/stash、blame/ownership、merge/rebase 冲突工作台、托管平台 PR UI 和数据库对象到 DDL 文件 mapping | P1/P2 |
| DDL 文件与真实数据源 mapping | 部分具备 | 项目 SQL 可生成有界、来源可见的离线审阅 baseline；仍不能将完整 DDL 文件映射为可信真实对象或作为可执行迁移来源 | P1 |

### 3.7 搜索、工作台与可配置性

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| Search Everywhere | 部分具备 | 第一阶段已覆盖 action、tab、connection、当前 schema/table 与已加载 project files；采用 deferred + 有界结果，全局持久索引仍缺 | P0 |
| 数据库全文搜索 | 缺失 | 只能查当前结果集，不能跨 schema/table 搜索数据 | P1 |
| 可配置 keymap | 已具备/部分 | 支持快捷键设置和 Vim mappings；冲突发现与 action 覆盖不足 | P1 |
| 主题与外观 | 部分具备 | light/dark、字号、grid 参数已存在；完整 token 编辑和可导入主题缺失 | P2 |
| 多语言 UI | 缺失 | 当前 UI 文案以英文为主，没有 i18n 资源层 | P2 |
| 插件生态 | 部分具备 | 有内部 provider registry；没有第三方签名、发现、安装和隔离机制 | P2 |

### 3.8 诊断、运行与安全

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 查询取消、事务 | 已具备/部分 | PostgreSQL/MySQL 有 tracked cancellation 和命名事务；session 可视化、锁与 idle transaction 提示不足 | P0 |
| 后台任务与进度 | 部分具备 | Assistant task 已移出 Sidebar 生命周期；对话、最后 100 个 Turn 与最多 8 个 resumable request 按项目加密保存，应用重启后活动 Turn 变为 paused 并可从 checkpoint 手动恢复。TaskStatusCenter 仍有 project-scoped history；普通查询/导入/元数据任务尚无同等级恢复、通用执行日志与跨任务搜索 | P1 |
| 结构化错误 | 已具备 | connection/query/schema/table/project-file 已统一稳定 code、category、safe context、retryable；Query Command 额外从 `sqlx` 白名单提取 PostgreSQL SQLSTATE/severity/字符位置/schema/table/column/constraint/type 和 MySQL SQLSTATE/vendor code，并明确排除 SQL、连接串、detail 与内部 query | 持续覆盖新 driver |
| destructive safety | 已具备/部分 | SQL 分类、确认、参数化 mutation、AI policy 和 read-only backend gate 已有；权限模型与审计导出不足 | P0/P1 |
| AI 辅助 | 部分具备/有差异化基础 | Deep Agents sidecar、Rust 安全边界、统一三模式、加密 checkpoint、Codex 式 Turn UI、可跳到精确 schema/object/plan 的 trusted Sources，以及不覆盖用户输入的 SQL 错误修复/Patch Preview/Validate/Apply 是优势；用户已打开的 analyzed plan 可作为有界可信运行时证据。后续差距集中在长期 workload statistics、自动优化和解释质量评测 | P1 |

### 3.9 AI Agent 与 IDE 交互

| DataGrip / 专业 Agent 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| Schema/object/selection/UI attachment | 已具备 | tool result 已生成带 provenance 的对象、文件、结果、tab、selection、diagnostic、Explain Plan、Schema Diff 与 patch attachment；`task.reveal` 可从内存或 retained history 打开精确安全摘要 | 持续覆盖新增 artifact |
| Text-to-SQL 与 dialect grounding | 部分具备 | 有模型 planner、inline completion、dialect context、revision-bound Patch Preview/Apply、显式 PostgreSQL/MySQL 离线语法检查，以及完整虚拟修改后 SQL 的前后 `EXPLAIN estimate` 对比；不会再把局部 replacement 误当成完整查询。Apply 后 LSP 会重新诊断。metadata describe/list 的 schema/object 证据已支持 trusted citation | P1 补长期统计信息 grounding |
| Explain/Fix SQL error | 已具备 | LSP diagnostic 已可点击 Jump 到精确 range；数据库执行错误会把 PostgreSQL 字符位置换算为 Monaco UTF-16 文档坐标，结果面板展示 SQLSTATE、MySQL error number、表/列/约束，AI active-tab context 获得同一份结构化诊断；错误卡可创建不覆盖现有草稿的 AI fix prompt，Assistant 的 fenced `sql` 回答只能由用户点击 Preview in editor 转成优先覆盖失败语句、其次选区、最后全文的 revision-bound patch。Patch Preview 提供离线方言语法检查；完整虚拟修改后文档为单条只读查询时还可显式比较前后 estimate plan，或经内联二次确认对提议 SQL 执行一次 Analyze。关闭或 stale 会取消请求。Apply 后由 LSP 重新诊断；源 SQL 不会被自动应用或执行 | — |
| Query optimization / plan explanation | 部分具备 | `query.explain` 生成真实规范化 estimate；Patch Preview 对完整 SQL 给出 planner cost/estimated rows/节点变化和最多三条确定性 estimate signal，Actual review 给出一次实测 time/rows/loops、最慢节点与估算偏差。active tab 中用户已打开的 analyzed plan 以排除 SQL/raw/condition 的有界摘要生成 trusted plan citation；estimate 不会被描述为实测。尚缺长期 workload statistics、自动优化和 AI 解释黄金评测 | P1 |
| Agent 数据源管理与 live DB 反馈 | 缺失/部分 | DataGrip 2026.2 Agent 可创建/编辑/测试连接，AI 查询进入 query history，DDL 后自动 introspect，并把真实数据库错误回传模型；当前 Rust host 只安装连接列表/能力、metadata、只读查询/Explain 与项目文件工具，尚未开放连接 mutation、数据库写工具、AI query history 标记和 DDL 后自动刷新 | P0/P1 |
| IDE 页面跳转和联动 | 已具备 | typed `UiActionRegistry` 已覆盖 project/file/tab/panel/connection/object/editor/result/plan/schema diff/patch/task/settings，含 stable target 与 stale-context | 持续覆盖新增 artifact |
| 多轮 durable agent | 已具备/需加固 | Node 22 `deepagents@1.10.8` 独立 host 负责三模式 loop；Rust 保存七天 AES-GCM thread/artifact/graph checkpoint/writes 与对话快照，提供 cancel、持久 interrupt、跨 sidecar/app restart 的手动 resume、批准和只读 subagent。数据库 idempotency、自动重连策略与长期恢复评测仍缺 | P0/P1 硬化 |
| 工具安全与多数据模型 | 已具备/首批 bridge | Rust 只发布并执行统一枚举中的 installed tools，严格校验 manifest 权限；`project.listFiles/readFile/writeFile` 复用项目根、路径穿越、256 KiB 和 SHA-256 revision 边界，reviewable write 串行即时落盘并受 revision-bound Undo 保护，不经过预批准。Mongo/Redis/ES 的 provider-specific bridge 仍需逐项完成 | P0/P1 |
| AI 数据治理 | 已具备/部分 | provider secret 与 Agent Store 主密钥分别位于应用用户级 credential file（不进项目/localStorage/sidecar，也不访问系统 Keychain）；项目级 thread/checkpoint/artifact 以 AES-GCM 保存七天；长上下文可摘要/offload；Context Preview 已覆盖 token、预算、截断/省略和 tool manifest。仍缺 attachment 敏感级别、字段 masking 和企业 policy | 基础治理已完成；细粒度治理 P1 |
| Agent 对话可读性 | 已具备 | 每个 Turn 是问题→运行中平铺时间线→终态折叠过程→最终回答；当前步骤高亮，文件步骤带语义图标和增删行统计，读取打开文件、编辑打开主 Diff；支持自增高输入框、Enter 发送/Shift+Enter 换行、Markdown、复制、编辑/重用/重试 prompt、附件、停止生成和滚动回最新；tool/subagent 不单列消息 | 持续补 thread search/branch |
| 外部 Agent 接口 | 已具备/严格只读 | Rust 原生 `oxide-agent` 提供五个项目级只读 stdio/Streamable HTTP/CLI 工具；严格 MCP 2025-11-25、connection/database/tool grant、结果上限，调用者自报批准无效 | 持续四平台发布 smoke；公开 HTTP token 永不授予写入 |

完整状态机、工具契约、页面动作、批准绑定、Deep Agents 分层方案和 LSP 排序规则见 [AI Agent 产品与技术规格](AI_AGENT_PRODUCT_SPEC.md)。

## 4. 优先路线图

### P0：形成可靠日常闭环

| ID | 工作项 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| DG-P0-01 | Search Everywhere 第一阶段 | 搜索 action、tab、数据源、当前 schema/table 和已加载 project files；选择数据源会真正激活连接；键盘可完成全部操作 | 已完成 |
| DG-P0-02 | Query History 2.0 | 记录 connection/schema/database、duration、success/error、row count；支持筛选、单条删除、复制到 editor 和 rerun | 已完成 |
| DG-P0-03 | Value Editor | text/JSON/date/binary 类型有只读/可编辑大视图；明确 NULL、空串和未加载状态；提交沿用 mutation gate | 已完成 |
| DG-P0-04 | Explain Plan MVP | PostgreSQL/MySQL 支持文本/JSON plan；只读执行；显示 cost/rows/time，失败可定位到 driver 能力 | 已完成 |
| DG-P0-05 | Driver 与文档一致性 | 增加 SQLite driver，或从发布文档移除未实现支持；能力列表由 runtime registry 生成 | 已完成：SQLite/SQL Server 明确为规划项；后端 capability list 驱动连接 UI、Explorer 与 AI，失败仅降级不阻塞启动 |
| DG-P0-06 | 结构化错误协议 | connection/query/schema/table/file command 返回稳定 code、message、context、retryable；UI 不再解析字符串前缀 | 已完成 |
| DG-P0-07 | CSV Import Mapping | 导入前预览、编码/delimiter/header、列映射、类型错误摘要和事务性提交 | 已完成：支持 BOM/UTF-8/UTF-16/GB18030、delimiter 自动识别、表头/位置映射、类型预检和 PostgreSQL/MySQL 原子 batch；32 MiB/10 万行以上明确转入 native streaming P1 |
| DG-P0-08 | LSP catalog scope 与候选排序 | `(connection, database, schema)` 严格隔离；显式 qualifier/当前 statement/DML target/active table 排序；同名列以 alias/table 区分；同 source 去重；覆盖跨 PostgreSQL database 回归 | 已完成并扩展：关系型矩阵锁定无 FROM 为 `table.column`、单表短字段、多表 alias；MongoDB 锁定 collection 字段隔离、operator/pipeline；ES 锁定引号内 mapping 字段与 6/7/8 REST 差异；Table WHERE 使用同一 schema-bound LSP session |
| DG-P0-09 | AI attachment 与页面动作 | 对象、错误、结果、执行计划引用可点击并准确跳转；stable target、stale context 和同名对象有测试；导航不与数据库 mutation 混为一个动作 | 已完成：对象/文件/结果/LSP error/plan/schema diff/patch 均有精确跳转或 artifact surface 与 stale target 测试；patch 仅由用户 Apply |
| DG-P0-10 | AI 发送上下文预览 | 发送前显示 provider、database identity、token/截断、tool manifest 和 post-tool 范围；关闭项必须从真实请求删除 | 已完成：显示完整 prompt/编辑器/选择/历史/tool manifest 的发送前 token 估算、模型预算占比、逐来源 excluded/bounded 省略量和 55% 长 prompt 预压缩提示；`model.usage`/`context.compacted` 项目级加密累计并跨重启恢复；大 observation 支持模型侧及聊天 UI 的有界 search/range read、匹配定位和由 Rust 原生保存对话框控制的 JSON 导出 |
| DG-P0-11 | AI 对话过程与长文导航 | 一个 Turn 固定为问题→运行时间线→终态折叠过程→最终答案；宽面板 minimap 每个完整问答一个灰色 marker，中间 tool/subagent 不单列 | 已完成：活动过程直接平铺、当前步骤高亮，终态过程为紧凑 disclosure；minimap 仅在真实溢出时显示，支持 hover、键盘和 reduced motion |
| DG-P0-12 | AI context snapshot/version | tool/approval 绑定 project/connection/config/context/thread/turn 与 input digest；变化后旧批准失效，持久层不保存 secret/无界结果 | 已完成/需压力测试：Rust 每次执行重验并消费一次性 lease；AES-GCM graph checkpoint 与对话快照按项目保存七天，支持 sidecar/app restart 后的显式 resume；仍需 100+ Turn 与崩溃注入验证 |
| DG-P0-13 | Deep Agents 生产 runtime | Chat/Plan/Agent 统一使用独立签名 sidecar；无 provider/sidecar 失败不阻塞主界面；生产不静默 fallback | 已完成：Node 22 + `deepagents@1.10.8`、版本化 Content-Length JSON-RPC、Rust supervisor；四平台实际安装包 smoke 仍是发布门禁 |
| DG-P0-14 | 外部 MCP/CLI 安全边界 | Rust 原生 stdio/Streamable HTTP/CLI 严格只读；调用者不能自报 approval，缺少目标二进制时打包 fail closed | 已完成：Cargo、target-specific externalBin、Desktop supervisor 与 HTTP token/Host/Origin 防护已接线；project/connection/database/tool grant、只读事务、超时和结果上限由 Rust 强制执行 |
| DG-P0-15 | 查询范围与结果内存边界 | 无选区时执行光标 statement；普通关系型查询不得先全量读取，达到硬上限必须明确标记 | 已完成：Monaco UTF-16 offset 在 Rust 转 UTF-8 byte offset，并复用 driver lexer；PostgreSQL/MySQL 读取至 1,001 条 sentinel 后仅返回前 1,000 条，结果协议携带 truncated/rowLimit |
| DG-P0-16 | ChatGPT 式对话与应用恢复 | 输入、Markdown、复制/重试/编辑、附件和滚动行为形成一致主路径；应用重启不丢对话且不持久化 API key | 已完成首版：对话快照通过 AgentStore AES-GCM 保存，恢复中的任务 fail-closed 为 paused；文本附件经 Rust 原生选择、UTF-8/扩展名/64 KiB 单文件与 128 KiB 总量限制 |
| DG-P0-17 | Agent 文件修改与 Git review | Agent 只能在项目根内以 revision 原子写文件；写入即时生效并可 Keep/Undo，数据库与外部 mutation 仍需批准；用户可查看 branch/status、按 Turn 归因与逐文件 unified diff | 已完成第五阶段：Rust host 直接写入并发出不可由 sidecar 伪造、包含有界 before/after 内容的 `file.changed` 审阅事件；连续写同一文件合并为净 Diff，整文件与逐 hunk Keep/Undo 使用 applied revision 防止覆盖后续编辑。Changes 支持 all/Agent/Turn 归因与精确行跳转；项目 Version Control 另行提供真实 Git stage/unstage/hunk/commit/history/branch/remote/sync/patch，主编辑器复用 Monaco DiffEditor |
| DG-P0-18 | Vendor query error diagnostics | PostgreSQL/MySQL 原生错误保留安全的 vendor code/object/position；执行 statement/selection 时能映射到编辑器位置；结果面板和 AI 使用同一结构化对象且不泄露 SQL/凭据 | 已完成诊断与 review-only fix：Rust 从 `sqlx::DatabaseError` 白名单提取字段；PostgreSQL original position 映射到 Monaco marker，internal query 永不透出；MySQL 保留 SQLSTATE/error number；错误卡可打开 AI fix draft，fenced SQL 只能经用户点击生成 revision-bound Patch Preview，不自动改写/执行 |

### P1：形成 schema 工程能力

1. Schema snapshot + diff + dependency/preflight + PostgreSQL 安全 apply/journal/post-verify/conditional rollback 已完成；MySQL 已具备显式 partial-commit 确认与逐条 journal 执行，继续补对象 source、rename detection、跨对象 dependency graph、schema mapping、独立 server dry-run 与 interrupted-journal reconciliation。
2. ER diagram MVP 已完成：复用稳定 snapshot 与 PK/FK/constraint metadata；继续补手动布局、导出、跨 schema 节点和 dependency overlay。
3. Loaded Data Compare、服务端全量/降级 compare、value column 忽略、逐行选择、多表同名检查、目标缺表迁移串联、小差异冻结计划与参数化原子同步逻辑已完成；真实产品验证延期。
4. 外键导航继续补键盘路径、关系历史和 diagram 联动；新增 object dependency navigation。
5. 完整方言 DDL data source、真实数据源 mapping 和 migration run configurations（当前项目 DDL baseline 仅用于 review）。
6. 编辑器 inspections、quick-fix、find usages 和 local history。
7. 批量 DDL/data export 与 native dump/restore。
8. Native streaming CSV import：Rust 侧增量 decode/parse、分批 prepared insert、单事务与可取消进度；替代 P0 的 32 MiB/10 万行安全上限。

### P2：平台化与长尾能力

1. 第三方 provider/plugin 的发现、版本、签名和隔离。
2. VCS 继续补 changelist/stash、blame、merge/rebase 冲突工作台、PR surface 和数据库对象文件化工作流。
3. 多语言、主题导入和更完整的 accessibility 偏好。
4. PDF、CSV table view、hex/binary 等通用文件预览。
5. 会话、锁、运行日志和数据库运维面板。

## 5. 实施顺序原则

- 先完成一条用户任务闭环，再扩对象类型或 driver；不要同时铺十个半成品入口。
- UI capability 与 Rust capability 必须有契约测试，unsupported 必须可解释而不是静默降级。
- destructive 操作必须有 preview、明确 target、确认和后端约束。
- 大数据路径必须有 page/stream/limit，禁止把“先全部读入内存”作为 MVP。
- 新工作项必须在本文件登记 ID、验收标准和状态；完成后补测试证据。

## 6. 下一步

**DG-P0-01 Search Everywhere 第一阶段** 与 **DG-P0-02 Query History 2.0** 已完成。技术边界见 [ADR-0001](decisions/0001-search-everywhere-index.md) 和 [ADR-0002](decisions/0002-query-history-persistence.md)。

近期顺序调整为：

1. **DG-P0-08 LSP catalog scope 与候选排序** 已完成；证据覆盖跨 PostgreSQL database 配置、database-scoped metadata、同名列、alias 插入、模糊匹配、CTE/DML 作用域、全量 LSP tests 与 Clippy。
2. **DG-P0-09 AI attachment 与页面动作** 已完成：通用 registry、stable target、stale context、对象/文件/结果/LSP error/plan/schema diff/patch attachment 均有回归测试；patch proposal 不修改 editor，打开预览与用户 Apply 分离并两次校验 revision/range。
3. **DG-P0-06 结构化错误协议** 已完成：envelope 与直接 Tauri rejection 统一为 `ApiError`，project revision conflict 不再依赖字符串前缀，错误 context 使用白名单且不包含 SQL、URL、密码或文件内容。
4. **DG-P0-03 Value Editor** 已完成：类型感知大视图、四态值语义、JSON/binary/date 校验和既有 mutation gate 已有组件与模型测试。
5. **DG-P0-04 Explain Plan MVP** 已完成：后端生成 driver-specific SQL 并强制单条只读源查询，PostgreSQL/MySQL 结果规范化为稳定 plan tree，UI 支持 tree/raw、estimate/analyze、取消和节点指标；AI 只允许无审批 estimate，并通过 `plan.revealNode` 回到精确节点。安全边界见 [ADR-0003](decisions/0003-explain-plan-safety.md)。
6. **DG-P0-05 Driver 与文档一致性** 已完成并持续校准：SQLite 已是内置原生数据源驱动（本地文件、`:memory:`、表/视图/列/索引/外键/trigger 元数据和补全），`main` schema 的表 create/drop/rebuild、view create/drop/replace 及独立 trigger create/drop/replace 可通过精确 `sqlite_schema` table/view/index/trigger DDL、恢复备份、写锁、事务与 FK check 受控执行；缺少 catalog/dependency/backfill 证据及 attached schema 继续 review-only，Explain Plan 与 Agent 只读包装仍由 capability 明确关闭。SQL Server 仍需经已签名的外部 driver package 接入。后端完整 capability list 成为连接 UI、Explorer 新建菜单和 AI `provider.list` 的权威目录，能力发现失败会保留内置目录且不阻塞应用壳。
7. **DG-P0-07 CSV Import Mapping** 已完成：文件选择与写库解耦，用户先配置编码、delimiter、header、空值策略和逐列映射；提交前按目标列类型汇总错误，确认后复用后端原子 batch，任一数据库错误会回滚全部行。内存路径限制为 32 MiB/10 万行，超限文件不会尝试全量载入；后续以 native streaming importer 扩展。
8. **DG-P1-01 Schema snapshot/diff MVP** 已完成：快照使用稳定 catalog identity 与 fingerprint，抓取采用六路有界并发且不保存部分结果；差异在独立 artifact 展示 safe/review/destructive rail，PostgreSQL 使用 ROLLBACK guard，MySQL 标注 auto-commit，AI attachment 可回到精确 change。安全边界见 [ADR-0005](decisions/0005-schema-snapshot-diff.md)。
9. **DG-P1-01 Migration DAG / preflight** 已完成支持对象的第二阶段：外键拆为独立依赖 change，changed index/constraint 拆为 drop/recreate，拓扑排序输出 phase/order/dependsOn；无法完整重建时阻断当前 change 及其依赖，另生成只读 preflight surface。边界见 [ADR-0006](decisions/0006-migration-dependency-preflight.md)。
10. **DG-P0-11 AI 对话过程与长文导航** 已完成：活动过程 stage 在当前 Turn 内按时间顺序直接展示，终态后才收进默认折叠的 `Worked` disclosure；最终回答与 raw tool structure 分离，文件步骤可打开源文件或主 Diff 并显示增删行；minimap 以完整问答为灰色 anchor，中间工具不进入检索记录。
11. **DG-P0-12 / DG-P0-13 Agent 安全 runtime** 已完成主结构：Deep Agents sidecar、Rust 模型/工具/policy、项目级 AES-GCM graph checkpoint/writes/对话快照、持久 interrupt、跨 sidecar/app restart 的显式 resume、只读 subagent、澄清/批准和故障隔离已接入。接下来必须完成 mutation receipt/idempotency、100+ Turn、崩溃注入、冷启动/内存与四平台 production bundle smoke，不能把 durable checkpoint 写成 exactly-once。
12. **DG-P0-10 Context Preview** 已补齐发送前可见 payload token 估算、模型预算占比、逐来源省略原因/数量、长 prompt 预压缩预警、项目级加密且跨重启恢复的 provider usage/compaction 摘要，以及受 Rust project/大小边界保护的 artifact range/search、聊天内匹配定位和显式 JSON 导出；导出路径只能由 Rust 原生保存对话框产生。provider secret 已从 localStorage 移至用户级 credential file，并由设置测试与 Agent 共用同一读取链路。
13. **DG-P0-14 Rust `oxide-agent`** 已完成只读 stdio/Streamable HTTP/CLI、Cargo、Desktop 管理入口与发布接线；继续把四平台真实安装包 smoke 作为发布门禁。OIDC、UI tools 和外部 mutation 仍不开放。
14. **DG-P0-15 查询安全边界** 已完成：光标 statement 解析与 driver streaming hard cap 均在 Rust/driver 边界执行，前端只消费结构化 selection 和 truncated 标记。
15. **DG-P0-16 ChatGPT 式交互与恢复** 已完成首版：可增长 composer、Markdown/代码复制、prompt 编辑/重试、文本附件、scroll follow，以及不含 provider secret 的加密 conversation snapshot 已接入。
16. **DG-P0-17 Agent project write + Changes** 已完成第四阶段：Agent 写文件沿用 project root/revision 约束并直接原子落盘，`project.writeFile` 是唯一无需预批准的 reviewable workspace write；数据库、destructive 与 external mutation 的一次性 approval lease 不变。Rust 成功写入后向 WebView 发出包含有界 before/after 内容、写入前后 revision、最多 2,048 个保守新侧行号及 Turn/Call ID 的可信事件，内容不返回给 sidecar/model。输入框上方汇总 changed files 与增删行，主编辑器显示 Git 式 Diff；整文件和逐 hunk Keep/Undo 都以 applied revision 回滚，文件被其他操作改过时 fail closed，新建文件只在 revision 相同的情况下删除。用户仍可按全部 Agent 或具体 Turn 过滤 Git 变化，并在逐文件 All/Staged/Working diff 间切换；后续保留完整 blame/ownership 与需单独授权的 Git mutation。
17. **DG-P0-18 Vendor query error diagnostics** 已完成 review-only 主路径：Query Command 不再把 `sqlx` 原生错误压平成字符串；结果卡、Monaco marker 与 AI context 共享经过白名单和坐标换算的诊断对象。Ask AI to fix 只预填不含 SQL 的安全请求且不覆盖现有草稿；模型 fenced SQL 需由用户点击才生成优先覆盖失败语句、其次选区、最后全文的 revision-bound Patch Preview。Preview 内的 Validate 会对虚拟修改后文档做 PostgreSQL/MySQL 方言解析并返回有界坐标诊断，不连接数据库、不应用、不执行；Apply 后沿用 LSP 重新诊断。
18. **DG-P1-02 Patch plan review** 已完成增强：已连接的 PostgreSQL/MySQL 上，服务先把局部 patch 应用到完整虚拟文档，再对当前/提议完整 SQL 请求前后 `EXPLAIN estimate`；后端沿用 single-statement/read-only gate，保留 database/schema scope，并支持关闭或 stale 后取消。Actual 是独立内联二次确认动作，确认后才在后端只读事务中执行一次提议 SQL，显示 actual time/rows/loops、最慢节点与 material row-estimate mismatch，并明确缓存/负载会影响结果。
19. **DG-P1-03 Trusted AI sources** 已完成第二阶段：metadata list/describe 与 query.explain observation 生成稳定 citation id，聚合列表拥有 database/schema 级证据，对象明细拥有 object 级证据；模型只能使用 observation 中的 id，Host 会删除未知 id，并只把被最终回答引用的最多八条证据交给 Sources UI。点击可跳到精确 schema、对象或计划节点。后续补长期解释质量评测。
20. **DG-P1-01 migration execute** 已完成：前端内联确认要求 exact `connection / database / schema`、manual-review 与 destructive 分级批准；Rust 不接收前端 SQL，而是验证 snapshot fingerprint/plan id、刷新 live target、重算计划并执行机器 preflight。PostgreSQL DDL 复用 database-scoped transaction batch，任一错误回滚且 committed statements 为 0；MySQL 需要额外 auto-commit 确认，逐条执行并在每条成功后持久 journal，失败会报告可能已提交数；两者提交后都重新抓取并 diff。reverse plan 仅在全量可逆且无 blocked change 时发布为 guarded artifact。边界见 [ADR-0013](decisions/0013-schema-migration-execution.md)。
21. **DG-P1-02 ER diagram MVP** 已完成：schema context menu 可抓取 fresh snapshot，历史 snapshot 也可直接打开；artifact 保留复合 FK、确定性有界布局、搜索、keys-only、zoom/Fit、选中关系检查和 Explorer reveal。同一 target 再打开会刷新 snapshot，不制造重复 tab。边界见 [ADR-0014](decisions/0014-schema-diagram-artifact.md)。
22. **DG-P1-03 Loaded Data Compare** 已完成：两个 Table/Query loaded result 经共同/复合 key 对齐，支持数值 tolerance、状态汇总和不可变 artifact refresh；duplicate key、重复列与 truncated source 均不会被静默解释成可靠全量差异。边界见 [ADR-0015](decisions/0015-loaded-data-compare.md)。
23. 数据库主线下一步仍是完整 source/dependency capture、rename/schema mapping、独立 server dry-run、MySQL interrupted-journal reconciliation，以及长期 workload statistics/自动优化；不能把小差异同步、PostgreSQL 单次 post-verify、MySQL 顺序执行或单次 Analyze 描述为跨驱动 exactly-once replication/migration 或稳定性能提升。
