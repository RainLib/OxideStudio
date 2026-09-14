# Database Explorer 与 DBX 对齐审计

> 审计基线：OxideStudio `feature/dbx-lsp`；DBX `sources/dbx@a2aad40190`。
> 本文区分“产品逻辑已实现”和“真实桌面/真实数据库已验证”，不以存在菜单文案代替可用能力。

## DBeaver 行为基线与本项目取舍

DBeaver 官方 Connections/Database Navigator 的稳定交互骨架是：project 内的连接文件夹、connection → catalog/database → schema → object directory → object/member 层级；工具栏只放新建连接、全部折叠、跟随编辑器、仅已连接和过滤层级等全局动作；右键菜单则根据“当前节点类型 + 数据库能力”动态生成。它还允许配置对象描述、统计、子项数量、字母排序、双击行为、状态恢复深度和大列表 fetch size。

OxideStudio 本轮采用这套职责边界，但搜索行为以 DBX 的增强实现为准：普通搜索可选择有界加载当前连接的折叠 metadata，Local 和 Regex 都严格只读本地快照；不会为了匹配结果静默连接或切换非活动数据库上下文。

## 参考实现位置

| DBX 能力                                                                        | 主要实现位置                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 单一树模型、过滤、定位、虚拟/普通渲染切换、Sticky database/schema、共享右键菜单 | `sources/dbx/apps/desktop/src/components/sidebar/ConnectionTree.vue`                               |
| 28px 树行、展开/选择、拖放、内联重命名与节点呈现                                | `sources/dbx/apps/desktop/src/components/sidebar/TreeItem.vue`                                     |
| 500 行阈值、50 行滞回、600px overscan、48 行预渲染、扁平索引                    | `sources/dbx/apps/desktop/src/composables/useFlatTree.ts`                                          |
| 节点能力到右键菜单的工厂与执行分流                                              | `sources/dbx/apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue`                       |
| 菜单目标冻结及描述符归一化                                                      | `sources/dbx/apps/desktop/src/lib/sidebar/sidebarActionTarget.ts`、`sidebarTreeMenuDescriptors.ts` |
| 数据源/对象的产品特定顺序                                                       | `sources/dbx/apps/desktop/src/lib/sidebar/sidebarNodeOrdering.ts`                                  |
| 折叠节点全局搜索与有界任务调度                                                  | `sources/dbx/apps/desktop/src/components/sidebar/ConnectionTree.vue`、`sidebarSearchTaskRunner.ts` |

## P0：结构、状态与基础操作

| 项目         | OxideStudio 实现                                                                                                                                                                                                              | 状态                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 层级身份     | connection/database/schema/directory/object/member 使用稳定节点 id；database 与 schema 不再混为同一层                                                                                                                         | 已实现                                                |
| 对象目录     | Tables、Views、Materialized Views、Procedures、Functions、Sequences、Triggers 等按统一目录定义排序；MongoDB/Elasticsearch 使用各自对象语义                                                                                    | 已实现；最终展示取决于驱动 capability 与真实 metadata |
| 展开/选择    | project-scoped 持久化展开、焦点、anchor 与多选；disclosure 与激活分离；方向键/Enter/Space 可操作                                                                                                                              | 已实现                                                |
| 状态反馈     | loading、empty、stale、error、retry 使用共享紧凑状态行，缓存内容不会因后台刷新失败消失                                                                                                                                        | 已实现                                                |
| 行样式       | 树行统一为 28px，并同步虚拟滚动计算；schema/table/view 使用不同语义色                                                                                                                                                         | 已实现                                                |
| 搜索入口     | 搜索常驻；Escape 清空；支持连接/对象/全部范围与仅显示已连接数据源                                                                                                                                                             | 已实现                                                |
| 可见对象过滤 | Connection、Schema、Table/View、Routine、Collection/Index/Key 及扩展对象支持“隐藏”“仅显示”“清除过滤”；高级配置支持大小写不敏感的 include/exclude `*`、`?` 通配符；规则按 project 持久化，exclude 优先，空结果保留一键清除入口 | 已实现                                                |
| 折叠节点搜索 | 当前连接的未展开 schema 通过 cache-first、最多 4 并发的独立快照加载参与搜索；PostgreSQL 远端 database/schema 使用不切换当前 database 的只读接口                                                                               | 已实现；不会为搜索自动连接未连接的数据源              |
| 右键操作门禁 | connection/database/schema/table/view/collection/search-index 等菜单按运行时 capability、连接状态、只读状态裁剪；mutation 仍进入既有审阅/确认流程                                                                             | 主路径已实现                                          |
| 操作目标冻结 | 从缓存展开的非活动连接执行双击、DDL、导入导出、重命名或删除时，动作携带节点自己的 connection/database/schema，不再回退到瞬时全局 active connection；执行前显式恢复目标连接上下文 | 已实现                                                |

## P1：组织、批量与专业工作流

| 项目                  | OxideStudio 实现                                                                                                           | 状态                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 数据源分组            | 支持根分组、子分组、新建/重命名/删除、连接批量移入/移出；分组按层级深度优先显示                                            | 已实现                         |
| 拖放排序              | 连接支持 manual 顺序；分组支持 before/inside/after 落点、循环阻断与视觉反馈；A–Z/Z–A 模式下显示排序结果                    | 已实现                         |
| 批量选择              | Ctrl/Cmd 与 Shift 范围选择覆盖连接、分组、database、schema 及主要对象；表批量任务保持数量和并发上限                        | 已实现                         |
| 打开与导航            | 单击/双击激活策略、Open Data/Open New Tab、Query Console、Object Browser、DDL、复制名称/限定名、Reveal active 与刷新快捷键 | 已实现                         |
| 上下文 SQL 历史       | Connection、Database、Schema、Table/View 右键按连接/库/schema 过滤最近 10 条执行历史；去重后打开到编辑器但不自动执行       | 已实现                         |
| 迁移与比较            | database/schema/table 层入口路由到既有 Data Transfer、Data Compare、Schema Snapshot/Diff/Migration 审阅流程                | 已实现；真实数据库矩阵验证延期 |
| MongoDB/Elasticsearch | collection/index 展示与产品专用菜单不再伪装成关系表；危险操作走产品专用预览与确认                                          | 已实现；真实版本验证延期       |

## 节点右键菜单矩阵

| 节点                                           | 已接入主操作                                                                                                                                                                           | 能力/安全门禁                                                         | 与 DBX/DBeaver 仍有差异                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 空白区/分组                                    | 新建数据源、新建子分组、重命名、删除、拖入/移出                                                                                                                                        | 分组移动阻止循环；删除释放连接归属                                    | DBeaver 的“在新视图打开文件夹”和连接 copy/paste 尚未作为独立工作流提供                                           |
| Connection                                     | Connect/Cancel/Disconnect、复制名称、Query Console、上下文 SQL 历史、Database Browser、刷新、移动分组、属性、复制、删除、隐藏/仅显示/通配符过滤、管理/导入导出等产品动作               | 根据连接状态、driver profile、管理能力和只读状态裁剪                  | DBX 的“断开并遗忘会话凭据”、Profile Workspace、按对象类型组合过滤等少数动作尚未统一进入 registry                 |
| Database/Schema                                | Object Browser、Query Console、上下文 SQL 历史、设为默认 schema、搜索数据、创建对象、刷新、Diagram、Schema Snapshot/Diff、迁移/比较、导入导出、重命名/删除                             | DDL/rename/drop 只在 capability 允许且非只读时出现；执行进入预览/确认 | database 的用户默认标记和对象注释编辑仍未形成跨驱动统一能力；Quick Documentation 当前位于关系对象层              |
| Table/View                                     | 打开数据/新标签、Query Console、上下文 SQL 历史、复制限定名、加入 Assistant、Quick Documentation、DDL/source、结构编辑、重命名、Generate SQL、Diagram、导入导出、迁移、比较、清空/删除 | view/table 分流；格式按驱动声明；批量和危险操作有上限及确认           | `MERGE` 模板、copy/duplicate structure 等少数高级生成动作尚未按驱动能力完整覆盖                                  |
| Column/Index/Constraint/Trigger/Routine 等成员 | 展开元数据、复制名称/限定名、查看 source/DDL、Routine 与顶层扩展对象可隐藏/仅显示、部分对象维护动作                                                                                    | 只渲染驱动返回且声明可用的成员类型                                    | 列/索引等表内成员尚未支持独立持久化过滤；少数产品特定的 compile/lineage/edit/drop 动作仍需按真实驱动能力逐项补齐 |
| Mongo collection / Elasticsearch index         | 文档/索引浏览、搜索、复制、元数据、迁移/比较、产品专用清理或危险动作                                                                                                                   | 不伪装 SQL DDL；危险动作使用专用预览和确认                            | 真实 MongoDB/Elasticsearch 版本与权限矩阵尚未执行                                                                |

## P2：规模、性能与可维护性

| 项目               | OxideStudio 实现                                                                                                                                                                          | 状态                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 大目录             | 500 行启用虚拟化，50 行滞回，600px overscan，48 行预渲染；连接根和大对象目录避免无界 DOM                                                                                                  | 已实现                                                                                              |
| 搜索调度           | `useDeferredValue` + 180ms 合并；折叠 metadata 最多 4 并发；连接/schema 上下文改变后结果不得覆盖当前视图                                                                                  | 已实现                                                                                              |
| 数据源排序         | Manual/A–Z/Z–A 按 project 持久化；分组路径优先、组内再排序                                                                                                                                | 已实现                                                                                              |
| 共享模型           | 节点身份、目录定义、选择、菜单描述符、分组顺序和虚拟窗口均已抽为可单测模块                                                                                                                | 已实现                                                                                              |
| 全树虚拟化预算     | 一个 viewport host 汇总所有固定行目录；总量达到 500 后所有目录共同 window，视口外目录挂载 0 行；打开 metadata 的可变高度对象保持在文档流中，其前后固定行分别虚拟化                        | 行为已对齐；内部采用分段窗口而非 DBX 单数组 flatten，避免打开一个 table metadata 后退化为整目录挂载 |
| 单一右键菜单宿主   | Explorer 滚动树只挂载一个 Radix root；connection/database/schema/relation/collection/routine/descriptor 及 table members 在右键瞬间把节点身份和菜单投影到共享宿主；嵌套对象树复用最近宿主 | 已实现；节点菜单内容仍由各产品渲染器生成，但不再为每行创建 portal/root                              |
| 本地/全局搜索      | 默认全局搜索可有界加载当前连接的折叠 metadata；Local 开关只过滤已经加载的树对象、不发送远端请求，并按 project 持久化                                                                      | 已实现                                                                                              |
| Regex 搜索         | 正则只编译一次并作为本地只读投影；非法表达式显示错误状态；不会把表达式传给驱动或触发折叠 metadata 远端加载                                                                                | 已实现；只匹配当前已载入快照，不自动建立跨连接本地索引                                              |
| 横向滚动与注释展示 | 默认保持单行截断；设置中可显式启用自然宽度与原生横向滚动，连接备注可单独开关                                                                                                              | 功能已实现；未复制 DBX 的 Canvas 对齐测量与自绘双向滚动条                                           |
| 多连接同时远程搜索 | Oxide metadata store 仍以单 active connection 为事务上下文，不会为一次搜索静默切换连接                                                                                                    | 架构差异；未连接/非活动连接仅使用已有快照，避免上下文串线                                           |

## 后续修改顺序

1. 先在真实 Tauri 中记录 1k/10k 节点的首次展开、过滤、滚动和右键打开耗时，确认分层虚拟化是否达到目标。
2. 在 10k catalog 基准确认分层 window 的总 DOM 或 commit 仍超预算时，再把动态 table metadata 也投影为固定行并切换整棵树 flatten/recycle。
3. 如需像素级复刻 DBX 的注释列，再增加按帧 Canvas 文本测量与对齐宽度；当前先使用浏览器自然宽度，避免每次 metadata 更新布局扫描。
4. 若需要跨连接 Regex 索引，为 snapshot 增加独立版本号和显式刷新，仍不得因搜索自动连接数据源。
5. 如需完全复制 DBeaver 的按对象类型组合过滤，再把当前 include/exclude 通配符规则扩展为类型分组；不能以 UI 中存在规则代替驱动实际返回该对象类型。
6. 为提供安全的“断开并遗忘凭据”，需先建立只清理会话 secret、不改动持久连接配置的后端契约，不能用前端菜单伪造该能力。
7. 逐驱动补齐真实 metadata/菜单验收；目录候选或 JDBC compatibility 不能作为右键 mutation 可用的证据。

## 待验证清单

### 2026-09-05 显示与交互修正

- 按 DBX 的每级 16px 缩进统一连接、database、schema 子树及嵌套连接分组；非活动连接保留 database 父节点，缓存目录使用自身驱动能力。切换活动连接不再清空所有展开状态。
- 移除连接区域的 320px `content-visibility` 占位、连接外框的额外行高以及表元数据上方默认不可见的工具栏空行；缓存标记和刷新按钮并入 Columns 行。
- 普通模式 28px、紧凑模式 22px 的 DOM 行高与虚拟窗口共享配置，包括表字段目录。前方子树发生布局变化时重新计算目录偏移，避免滚动窗口继续使用旧位置。
- schema/namespace 加载失败显示错误与重试，不再误报空结果；数据库发现失败提供重试。表元数据刷新等待及失败时保留已显示的完整快照，错误文字采用深浅主题可读的语义色。
- 验证：31 个相关测试文件、112 项测试通过；浏览器使用真实 Sidebar 组件和可控元数据样例验证 620 张表、28px/22px 行高、字段展开、滚动到底及失败状态。紧凑模式中段可见行连续，无额外行间空白。
- 验证边界：本次浏览器数据为样例，未进行真实数据库或原生 WebView 的完整矩阵验收。以下跨平台及真实数据库清单继续保留。

- Windows/macOS/Linux 的键盘、焦点、右键定位、拖放、200% zoom 与 reduced-motion。
- 1k/10k schema/table 的 WebView DOM 数、滚动空白、过滤延迟、内存与首次右键耗时。
- PostgreSQL/MySQL/SQLite/MongoDB/Elasticsearch 的真实权限不足、断线重连、缓存过期与危险操作确认。
- database/schema/table 三层迁移入口的目标冻结、预览失效、取消和执行后刷新。
- 70+ 产品目录逐项只验证其声明能力；没有已签名运行时的产品必须保持不可执行。
