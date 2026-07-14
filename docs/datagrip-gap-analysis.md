# OxideStudio 与 DataGrip 能力差距

> 评估日期：2026-07-13。DataGrip 基线采用 JetBrains DataGrip 2026.1 官方文档；OxideStudio 基线采用当前仓库代码与测试，而不是 README 宣称能力。

## 1. 评估方法

状态定义：

- **已具备**：日常主路径可用，并有相应实现或测试。
- **部分具备**：已有入口，但覆盖范围、可靠性或专业细节不足。
- **缺失**：没有可用主路径，或只有不在当前工作台挂载的遗留组件。

DataGrip 的官方能力基线主要来自：

- [Features overview](https://www.jetbrains.com/datagrip/features/)
- [Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html)
- [Query consoles](https://www.jetbrains.com/help/datagrip/query-consoles.html)
- [Run queries and query history](https://www.jetbrains.com/help/datagrip/run-a-query.html)
- [Data editor and viewer](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html)
- [Search in DataGrip](https://www.jetbrains.com/help/datagrip/search-in-ide.html)
- [Import](https://www.jetbrains.com/help/datagrip/import-data.html) / [Export](https://www.jetbrains.com/help/datagrip/export-data.html)
- [Diagrams](https://www.jetbrains.com/help/datagrip/diagrams.html)
- [Databases in VCS](https://www.jetbrains.com/help/datagrip/databases-in-the-version-control-system.html)

这不是逐像素复制计划。DataGrip 依托 IntelliJ Platform，OxideStudio 应优先补齐数据库工作流，不复制与数据库价值无关的通用 IDE 复杂度。

## 2. 结论摘要

OxideStudio 已经具备“连接 → 浏览元数据 → 编写/执行查询 → 查看/编辑表数据”的骨架，并在多数据模型、Tauri 安全边界、项目文件和 AI 工具一致性上形成了自己的方向。与 DataGrip 的主要差距不在单个按钮，而在四条专业闭环尚未形成：

1. **发现闭环**：Search Everywhere、对象导航、find usages、数据库全文搜索仍不完整。
2. **变更闭环**：schema diff、migration preview、data compare、VCS/DDL data source 缺失。
3. **数据工作闭环**：Value Editor、外键导航、聚合视图、多视图模式和导入映射不足。
4. **诊断闭环**：Explain Plan、结构化错误、会话/锁/运行监控和可筛选查询历史不足。

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
| schema-aware completion | 部分具备 | Monaco + bundled SQL LSP + 项目上下文；跨 database 解析、临时对象和 routine 语义不足 | P0/P1 |
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
| Value Editor | 缺失 | 大文本、JSON、二进制、日期等没有独立值编辑器 | P0 |
| Table / Tree / Text / Transpose | 缺失 | 当前以表格为主；文档数据库也缺少稳定的 tree/text 切换 | P1 |
| 外键导航 | 缺失 | 已 introspect foreign key，但不能从 cell 跳转关联行 | P0/P1 |
| Aggregate View | 缺失 | 多 cell 选择没有 sum/avg/min/max/count 汇总 | P1 |
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
| Schema diff | 缺失 | 无结构快照比较、差异树和迁移 SQL | P1 |
| Migration preview / apply | 缺失 | UI 生成单对象 DDL，但没有多对象 dependency plan、dry run 和 apply journal | P1 |
| Database diagram | 缺失 | 已有 constraints 数据，尚未形成 ER graph、布局和导出 | P1 |
| Explain Plan | 缺失 | 没有文本或图形计划、节点成本和热点展示 | P0 |
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
| 结构化错误 | 部分具备 | 部分前端错误有类型，很多 Rust command 仍返回字符串 | P0 |
| destructive safety | 已具备/部分 | SQL 分类、确认、参数化 mutation、AI policy 和 read-only backend gate 已有；权限模型与审计导出不足 | P0/P1 |
| AI 辅助 | 差异化优势 | 共享工具 registry、MCP/CLI、审批与审计是相对 DataGrip 的产品差异点，应继续坚持安全一致性 | — |

## 4. 优先路线图

### P0：形成可靠日常闭环

| ID | 工作项 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| DG-P0-01 | Search Everywhere 第一阶段 | 搜索 action、tab、数据源、当前 schema/table 和已加载 project files；选择数据源会真正激活连接；键盘可完成全部操作 | 已完成 |
| DG-P0-02 | Query History 2.0 | 记录 connection/schema/database、duration、success/error、row count；支持筛选、单条删除、复制到 editor 和 rerun | 已完成 |
| DG-P0-03 | Value Editor | text/JSON/date/binary 类型有只读/可编辑大视图；明确 NULL、空串和未加载状态；提交沿用 mutation gate | 待开始 |
| DG-P0-04 | Explain Plan MVP | PostgreSQL/MySQL 支持文本/JSON plan；只读执行；显示 cost/rows/time，失败可定位到 driver 能力 | 待开始 |
| DG-P0-05 | Driver 与文档一致性 | 增加 SQLite driver，或从发布文档移除未实现支持；能力列表由 runtime registry 生成 | 待开始 |
| DG-P0-06 | 结构化错误协议 | connection/query/schema/table/file command 返回稳定 code、message、context、retryable；UI 不再解析字符串前缀 | 待开始 |
| DG-P0-07 | CSV Import Mapping | 导入前预览、编码/delimiter/header、列映射、类型错误摘要和事务性提交 | 待开始 |

### P1：形成 schema 工程能力

1. Schema snapshot + diff + migration SQL preview。
2. ER diagram MVP，复用已有 PK/FK/constraint metadata。
3. Data compare 与 tolerance。
4. 外键 cell navigation 与 object dependency navigation。
5. DDL data source、真实数据源 mapping 和 run configurations。
6. 编辑器 inspections、quick-fix、find usages 和 local history。
7. 批量 DDL/data export 与 native dump/restore。

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

**DG-P0-01 Search Everywhere 第一阶段** 与 **DG-P0-02 Query History 2.0** 已完成。技术边界见 [ADR-0001](decisions/0001-search-everywhere-index.md) 和 [ADR-0002](decisions/0002-query-history-persistence.md)。下一项优先进入 **DG-P0-03 Value Editor**，补齐大文本、JSON、日期和二进制值的专业查看/编辑闭环。
