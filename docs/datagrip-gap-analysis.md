# OxideStudio 与 DataGrip 能力差距

> 评估日期：2026-07-15。DataGrip 基线采用 JetBrains DataGrip 2026.1 官方文档；OxideStudio 基线采用当前仓库代码与测试，而不是 README 宣称能力。AI Agent 的完整逻辑要求见 [AI_AGENT_PRODUCT_SPEC.md](AI_AGENT_PRODUCT_SPEC.md)。

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
- [Search in DataGrip](https://www.jetbrains.com/help/datagrip/search-in-ide.html)
- [Import](https://www.jetbrains.com/help/datagrip/import-data.html) / [Export](https://www.jetbrains.com/help/datagrip/export-data.html)
- [Schema comparison and migration](https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html)
- [Diagrams](https://www.jetbrains.com/help/datagrip/creating-diagrams.html)
- [Refactoring](https://www.jetbrains.com/help/datagrip/refactoring-source-code.html)
- [Databases in VCS](https://www.jetbrains.com/help/datagrip/databases-in-the-version-control-system.html)
- [AI for databases](https://www.jetbrains.com/help/ai-assistant/use-ai-with-databases.html)

这不是逐像素复制计划。DataGrip 依托 IntelliJ Platform，OxideStudio 应优先补齐数据库工作流，不复制与数据库价值无关的通用 IDE 复杂度。

## 2. 结论摘要

OxideStudio 已经具备“连接 → 浏览元数据 → 编写/执行查询 → 查看/编辑表数据”的骨架，并在多数据模型、Tauri 安全边界、项目文件和 AI 工具一致性上形成了自己的方向。与 DataGrip 的主要差距不在单个按钮，而在五条专业闭环尚未形成：

1. **发现闭环**：Search Everywhere、对象导航、find usages、数据库全文搜索仍不完整。
2. **变更闭环**：schema diff/migration review 与 preflight 已形成第一条闭环；自动 apply/verify、data compare、VCS/DDL data source 仍缺失。
3. **数据工作闭环**：Value Editor 已有类型感知主路径，但外键导航、聚合视图、多视图模式和导入映射不足。
4. **诊断闭环**：Explain Plan 与结构化错误已有主路径，但 vendor error、会话/锁/运行监控仍不足。
5. **智能协作闭环**：AI 已有工具、审批、对象/结果/错误/plan/patch attachment、稳定页面跳转和 revision-bound Patch Preview/Apply，但持久任务、vendor error 结构化诊断和 plan-grounded 自动优化仍待完成；LSP 的 catalog 隔离与同名列 P0 排序已经关闭，高级派生表/临时对象语义仍不足。

按日常数据库开发主路径估算，当前完成度约为 **55%–65%**；按 DataGrip 全功能面估算约为 **35%–45%**。这是工程规划区间，不是营销评分。

## 3. 能力矩阵

### 3.1 数据源与 Database Explorer

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 多数据源、连接属性、SSH/SSL | 部分具备 | 已有项目隔离数据源、测试连接、SSH tunnel、SSL 参数；缺少更完整的 driver 属性、密码存储策略 UI 和连接诊断 | P0 |
| 数据库对象树与 introspection scope | 部分具备 | 支持 database/schema/table/view/collection/key/routine，带 cache/remote 状态；对象类型、授权、trigger、sequence 等覆盖不足 | P0/P1 |
| Explorer 快速过滤与 reveal | 部分具备 | 有 filter、展开/折叠、reveal active；缺少缩写匹配、多选和跨数据源统一索引 | P0 |
| 对象创建、重命名、删除、DDL | 部分具备 | 表、列、索引、约束、view、database 已覆盖主要路径；不同 driver 的对象动作不齐 | P0/P1 |
| 广泛数据库驱动 | 部分具备 | 运行时为 PostgreSQL、MySQL/MariaDB、MongoDB、Redis、Elasticsearch；SQLite、SQL Server 等尚无 driver | P0/P1 |
| DDL data source / offline schema | 缺失 | 项目 SQL 文件可编辑，但不能作为可解析、可映射的离线 schema 数据源 | P1 |

### 3.2 SQL 编辑与 Query Console

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 绑定数据源的多个 query console | 部分具备 | 支持多 Tab、连接/schema 上下文、split editor；console 生命周期和 session 模式不够显式 | P0 |
| schema-aware completion | 已具备/部分 | query tab 已按 `(connection, database, schema)` 映射独立 metadata/schema id/cache；FROM 前同名列按 table 限定，JOIN 按 alias 限定并插入，当前 statement/DML/active object 有稳定优先级；临时对象、派生表字段和更深 routine 语义仍不足 | P1 |
| inspections、quick-fix、错误高亮 | 部分具备 | 有 diagnostics 和 formatting；数据库语义 quick-fix、意图操作和 inspection 配置缺失 | P1 |
| refactor / find usages / navigation | 缺失 | 缺少对象 rename refactor、usage graph、代码与对象双向导航 | P1 |
| 参数化查询 | 部分具备 | 已有参数面板与后端参数化执行；自定义参数 pattern、历史和值配置不足 | P0 |
| query history | 已具备 | 项目级 SQLite 日志记录成功/失败/取消、connection/database/schema、duration、row count；支持搜索、筛选、单条删除、打开和安全重跑 | — |
| local history / scratch recovery | 缺失 | 项目文件有 revision conflict，但没有编辑器级自动历史与恢复 | P1 |
| run configuration / ordered scripts | 缺失 | 不能保存多文件、多 target schema 的执行配置 | P1 |

### 3.3 Data Editor 与结果集

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 服务端分页、排序、过滤 | 已具备/部分 | Table Tab 支持分页、filter、sort 和布局；多列排序历史与 query preview 细节不足 | P0 |
| 行增删改、提交/回滚 | 已具备/部分 | 参数化 mutation、批量提交、草稿保护已存在；冲突展示和 generated key 反馈不足 | P0 |
| Value Editor | 已具备/部分 | `Shift+Enter`/cell menu 打开独立大视图；text/JSON/date/binary/boolean/number 有类型校验，明确区分默认未加载、NULL、空串和值，修改复用 table draft/mutation gate；超大 LOB 的独立按需拉取仍待增强 | P1 |
| Table / Tree / Text / Transpose | 缺失 | 当前以表格为主；文档数据库也缺少稳定的 tree/text 切换 | P1 |
| 外键导航 | 已具备/部分 | PostgreSQL/MySQL 可从 FK cell 跳到 referenced row，也可从主键/唯一键 cell 查看 referencing rows；复合键原子映射、NULL 不误跳、保留 connection/database/schema scope。尚缺键盘快捷键、关系路径历史和图内联动 | P1 |
| Aggregate View | 已具备/部分 | Table/Query grid 的 range/row/column 多选支持 cells/distinct/NULL/default 与类型感知 sum/avg/min/max；decimal/bigint 用定点精确累计，50k cell 有界采样且明确标记。尚缺自定义函数和 server-wide aggregate | P1 |
| Data compare | 缺失 | 不能比较表或两个结果集并设置 tolerance | P1 |
| 当前结果内查找 | 部分具备 | 有 grid search/filter；缺少列范围、正则和匹配导航 | P0 |

### 3.4 Import / Export

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| CSV 导入 | 部分具备 | 有入口与基础实现；缺少 delimiter/encoding/quote/header 预览和列映射 | P0 |
| 多格式导出 | 部分具备 | CSV、JSON 已有；缺少 SQL insert、Markdown、XML、Excel、自定义 extractor | P1 |
| schema/object DDL 导出 | 部分具备 | 支持对象 DDL 查看/复制；缺少选择集、依赖顺序和批量导出 | P1 |
| pg_dump / mysqldump | 缺失 | 没有原生工具发现、参数配置、进度和恢复流程 | P1/P2 |

### 3.5 Schema 工程与可视化

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| Schema diff | 已具备/部分 | 已有按 project/connection/database/schema 隔离的版本化快照、稳定 fingerprint、差异 rail、phase/order/dependsOn、风险/可逆/blocked 状态与精确对象联动；尚缺 rename detection、完整 view/routine source 和 schema mapping | P1 |
| Migration preview / apply | 已具备/部分 | PostgreSQL/MySQL 已生成 review-only artifact；已按 relation/column/index/constraint DAG 排序并生成 NOT NULL/UNIQUE/FK/drop 等只读 preflight，无法完整重建会阻断 drop。尚缺跨对象完整 dependency graph、server dry-run、apply journal、post-verify 与 rollback 包 | P1 |
| Database diagram | 缺失 | 已有 constraints 数据，尚未形成 ER graph、布局和导出 | P1 |
| Explain Plan | 已具备/部分 | PostgreSQL/MySQL 支持 estimate/analyze、规范化节点树、raw plan、cost/rows/time 和取消；尚缺图形 plan、节点到表/索引的双向联动与多次计划对比 | P1 |
| Object dependency / usages | 缺失 | 无依赖图和影响面分析 | P1 |

### 3.6 项目、文件与 VCS

| DataGrip 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| 项目关联本地目录 | 已具备 | 自动目录名、别名、删除、路径约束和项目内数据源隔离已具备 | — |
| SQL/文本文件编辑 | 已具备/部分 | Monaco、保存、revision conflict 已有；缺少自动保存策略与 local history | P1 |
| 图片等文件预览 | 已具备/部分 | 常见图片只读预览已具备；PDF、CSV table view、hex/binary viewer 尚缺 | P2 |
| VCS 集成 | 缺失 | 没有 diff、status、commit、branch 和数据库对象到文件的 VCS 工作流 | P1/P2 |
| DDL 文件与真实数据源 mapping | 缺失 | 项目上下文可参与 AI/LSP，但不能做 schema mapping 与 migration | P1 |

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
| 后台任务与进度 | 部分具备 | 有 TaskStatusCenter；缺少可回看日志、任务详情和 retry | P1 |
| 结构化错误 | 已具备/部分 | connection/query/schema/table/project-file 已统一稳定 code、category、safe context、retryable；vendor SQLSTATE/position/object 仍待驱动层补齐 | P0 |
| destructive safety | 已具备/部分 | SQL 分类、确认、参数化 mutation、AI policy 和 read-only backend gate 已有；权限模型与审计导出不足 | P0/P1 |
| AI 辅助 | 部分具备/有差异化基础 | 共享工具 registry、MCP/CLI、审批、审计和不覆盖用户输入的 Patch Preview/Apply 是优势；但 schema citation、完整 SQL 错误修复、查询优化和 plan explanation 尚未形成对应用户闭环 | P0/P1 |

### 3.9 AI Agent 与 IDE 交互

| DataGrip / 专业 Agent 基线 | OxideStudio 状态 | 当前证据与差距 | 优先级 |
| --- | --- | --- | --- |
| Schema/object/selection/UI attachment | 已具备/部分 | tool result 已生成带 provenance 的对象、文件、结果、tab、selection、diagnostic、Explain Plan、Schema Diff 与 patch attachment；task artifact 尚未完成 | P1 |
| Text-to-SQL 与 dialect grounding | 部分具备 | 有模型 planner、inline completion、dialect context 和 revision-bound Patch Preview/Apply；缺 metadata citation 与执行前 parse/LSP/EXPLAIN 验证闭环 | P0 |
| Explain/Fix SQL error | 部分具备 | LSP diagnostic 已可点击 Jump 到精确 range，通用 patch 可安全预览/应用；vendor error 尚未统一为 SQLSTATE/position/object，自动 Fix → Validate 仍缺失 | P0 |
| Query optimization / plan explanation | 部分具备 | `query.explain` 只生成 estimate plan，模型可读取真实规范化计划；尚缺热点规则、索引/schema citation、优化前后 plan 对比与验证闭环 | P1 |
| IDE 页面跳转和联动 | 已具备/部分 | typed `UiActionRegistry` 已覆盖 project/file/tab/panel/connection/object/editor/result/plan/patch/settings，含 stable target 与 stale-context；task surface 待补 | P1 |
| 多轮 durable agent | 部分具备 | Sidebar 有有界多轮工具循环，LangGraph 当前主要为 `plan -> policy`；缺 checkpoint/resume、runtime-owned loop、持久 thread 和 subagent | P1 |
| 工具安全与多数据模型 | 已具备/优势 | registry、capability、approval、MCP/CLI 以及 Mongo/Redis/ES 结构化 mutation 已形成独立方向 | — |
| AI 数据治理 | 部分具备 | credential 隔离、上下文截断和有界结果已有；缺发送内容预览、项目级 retention 和 attachment 敏感级别 | P0/P1 |

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
| DG-P0-08 | LSP catalog scope 与候选排序 | `(connection, database, schema)` 严格隔离；显式 qualifier/当前 statement/DML target/active table 排序；同名列以 alias/table 区分；同 source 去重；覆盖跨 PostgreSQL database 回归 | 已完成 |
| DG-P0-09 | AI attachment 与页面动作 | 对象、错误、结果、执行计划引用可点击并准确跳转；stable target、stale context 和同名对象有测试；导航不与数据库 mutation 混为一个动作 | 已完成：对象/文件/结果/LSP error/plan/schema diff/patch 均有精确跳转或 artifact surface 与 stale target 测试；patch 仅由用户 Apply |

### P1：形成 schema 工程能力

1. Schema snapshot + diff + migration SQL preview 前两阶段已完成；继续补对象 source、rename detection、跨对象 dependency graph、schema mapping、server dry-run/apply journal、post-verify 与 rollback 包。
2. ER diagram MVP，复用已有 PK/FK/constraint metadata。
3. Data compare 与 tolerance。
4. 外键 cell navigation 与 object dependency navigation。
5. DDL data source、真实数据源 mapping 和 run configurations。
6. 编辑器 inspections、quick-fix、find usages 和 local history。
7. 批量 DDL/data export 与 native dump/restore。
8. Native streaming CSV import：Rust 侧增量 decode/parse、分批 prepared insert、单事务与可取消进度；替代 P0 的 32 MiB/10 万行安全上限。

### P2：平台化与长尾能力

1. 第三方 provider/plugin 的发现、版本、签名和隔离。
2. VCS 深度集成和数据库对象文件化工作流。
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
6. **DG-P0-05 Driver 与文档一致性** 已完成：README 不声明 SQLite/SQL Server 已支持，`sqlx/sqlite` 明确仅用于 MetaStore；后端完整 capability list 成为连接 UI、Explorer 新建菜单和 AI `provider.list` 的权威目录，能力发现失败会保留内置目录且不阻塞应用壳。
7. **DG-P0-07 CSV Import Mapping** 已完成：文件选择与写库解耦，用户先配置编码、delimiter、header、空值策略和逐列映射；提交前按目标列类型汇总错误，确认后复用后端原子 batch，任一数据库错误会回滚全部行。内存路径限制为 32 MiB/10 万行，超限文件不会尝试全量载入；后续以 native streaming importer 扩展。
8. **DG-P1-01 Schema snapshot/diff MVP** 已完成：快照使用稳定 catalog identity 与 fingerprint，抓取采用六路有界并发且不保存部分结果；差异在独立 artifact 展示 safe/review/destructive rail，PostgreSQL 使用 ROLLBACK guard，MySQL 标注 auto-commit，AI attachment 可回到精确 change。安全边界见 [ADR-0005](decisions/0005-schema-snapshot-diff.md)。
9. **DG-P1-01 Migration DAG / preflight** 已完成支持对象的第二阶段：外键拆为独立依赖 change，changed index/constraint 拆为 drop/recreate，拓扑排序输出 phase/order/dependsOn；无法完整重建时阻断当前 change 及其依赖，另生成只读 preflight surface。边界见 [ADR-0006](decisions/0006-migration-dependency-preflight.md)。
10. 下一步为完整 source/dependency capture、server dry-run/apply journal/post-verify，以及 AI plan explanation/优化前后验证；不能把当前 review-only artifact 描述为自动 migration 已完成。
