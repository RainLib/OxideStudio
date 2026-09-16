# 全量模块化推进清单

目标：完成项目自有客户端、服务契约、状态、CLI/Agent 运行时、Rust 后端、SQL LSP 与企业模块的职责拆分。参考目录 `source/dbx` 保持只读；第三方依赖、生成物和二进制不通过拆文件来治理。

## 完成条件

- [x] 所有下列历史大文件均完成职责拆分，并移除对应大小豁免。
- [x] 每个功能都有明确的类型、状态/运行时、服务与 UI 边界；不能只把大块代码搬进另一个大文件。
- [x] 状态和请求有唯一所有者；跨模块操作通过明确接口组合，没有重复 store 或失效的取消/版本检查。
- [x] 公共协议、行为和 UI 交互经过与改动范围相称的回归验证；不能以几个用例代表整个项目。
- [x] 最终构建、大小门禁、依赖检查和各工作区测试通过，或对环境边界给出明确证据。

完成与否必须检查这些条件；清单不是以“本轮已完成部分”重新定义目标。

## 本次已完成

- Tauri 的 244 个公共契约分为 22 个领域模块；`types.ts` 保留显式兼容导出。AST 比较确认契约定义未变。
- 元数据 store 分为 9 个状态分片，以及身份、缓存、请求运行时、后端 namespace 激活等模块。
- 连接 store 分为连接配置、项目作用域、远程 SQLite 准备、保存/加载、会话与后台恢复模块。
- 两个 store 在 `src/store/workspaceDataStores.ts` 组合，通过延迟读取的窄接口交互；移除实现层对对方 store 入口的导入。
- 元数据与连接请求队列、版本计数分别归各自实例所有；34 个动作经依赖引用替换后的 AST 比较确认逻辑一致。
- 新增 `verify:workspace-store-boundaries`，检测组合入口可达模块的运行时循环及实现层反向导入，已接入构建。
- 大小门禁扩大到 agent-host、企业模块和测试目录；新增覆盖范围中现存超限文件冻结于当前大小，继续列为未完成。没有为本轮新增模块增加豁免。

### 设置、连接表单和顶栏

- 设置配置分为公共类型、默认值、启动外观缓存、工作台布局归一化和值读取规则；`lib/appSettings.ts` 保留兼容导出。
- 设置面板按外观、工作台、快捷键、编辑器、片段、数据编辑、数据库资源管理、AI 分开；AI 控制 hook 负责密钥状态、保存、测试及关闭前持久化。
- 驱动管理 UI 与安装、运行状态轮询、重连、Java runtime、缓存和迁移控制逻辑分开；面板卸载时释放轮询。
- 连接表单分为常规、SSH/SSL、高级和驱动可用性 UI；连接草稿、签名驱动安装、SSH/远程 SQLite 动作各自归属独立模块。沿用唯一连接 store 和原有 URL/worker 授权失效规则。
- 项目切换由一个 hook 持有选择、新建、GitHub 来源和删除流程状态；项目菜单、来源选择和两类弹窗独立。AppBar 负责顶栏组合，设置菜单项可复用。
- 四个入口分别由 4,711 / 2,656 / 1,365 / 1,314 行降为 323 / 723 / 32 / 356 行，已移除大小豁免。新模块均低于 1,000 行。
- 77 个迁移回调的函数体经 AST 归一化比较保持一致；新组件测试覆盖驱动重连与轮询清理、目录项目创建、删除失败保留弹窗、按需检查 GitHub。

### 数据表格与值编辑器

- DataGrid 从 3,469 行降为 718 行：列格式、持久化布局恢复、列展示、列搜索、行筛选/排序、选择聚合、单元格绘制、编辑、粘贴、值详情导航、复制导出、菜单动作和画布主题各有独立模块。
- `useGridContextMenu` 组合菜单行为和条目，只向入口暴露所需事件；菜单与悬停状态由该 hook 持有。列搜索、值详情目标、布局恢复标记与工具栏 observer 也分别由对应 hook 持有。
- 查询工具栏、列搜索弹层与错误展示独立为组件；Glide DataEditor 的主组合仍在原入口，公共 ref 和选区摘要类型保留兼容导出。
- ValueEditorDialog 从 1,185 行降为 618 行：公共目标类型、草稿与预览状态、提交动作、JSON 树有界遍历和虚拟列表分别归属独立模块。数据表格直接使用值编辑器的模型类型。
- 89 个回调/计算缓存定义、11 个纯辅助函数与 12 处 effect/ref 注册经 AST 归一化比较保持一致。两个入口已移除大小豁免。
- 回归 23 文件/131 项通过。新增 4 项表格组合测试，在 Glide 画布边界验证查询排序后的源行选择、筛选/重排列后的编辑坐标、生成列只读和标签切换后的选区清理；这类测试不代替真实画布和桌面性能验收。

### LSP 客户端同步

- `LspConnectionSyncer` 从 1,322 行降为 145 行，只组合 store 快照、偏好、能力与连接客户端。Tab SQL 防抖、能力解析及同步生命周期各有独立 hook。
- `features/lsp-sync/runtime/` 分离 schema 身份/对象地址、表元数据缓存与补全、catalog 发现、分批配置发布和项目文档会话；原有按需加载、批处理限制与元数据版本检查保留。
- 项目文档会话由一个实例持有记录和 RPC 队列。关闭先使旧任务失效，后完成的打开会主动关闭；更新、会话替换和关闭串行执行，单次传输失败不会阻断后续同步。
- 已先复现“关闭发生在 didOpen 完成前，旧文档被重新写入记录”的竞态，再修复。发布语义完成状态也重新检查当前代次，避免旧文档同步完成后发布过期状态。
- 12 个未改变职责的快照/身份/元数据定义经 AST 比较一致。17 文件/84 项回归通过，包括 5 项会话测试和 1 项新增组件异步关闭测试；完整构建、1,415 文件大小门禁及现有依赖检查通过。
- 已移除此入口的大小豁免。此次覆盖客户端同步和生命周期，SQL parser 与后端 LSP 大文件仍在后续清单中。

### 查询语言分析与补全

- `sqlAnalysis` 从 1,074 行降为 22 行；词法规则、占位符、噪声屏蔽、语句切分、关系/CTE 提取、schema 上下文和元数据影响分别进入 `features/query-languages/sql/`。
- `mongodbCompletion` 从 1,256 行降为 20 行；JSON 扫描与上下文、shell 参数与上下文、候选目录、条目构造、自动触发策略和 Monaco 注册拆开。shell 参数直接使用 JSON 分析，不再回调含 shell 分派的总入口，避免运行时循环。
- `elasticsearchConsole` 从 2,654 行降为 50 行；请求范围/导航、注释、变量与执行、诊断、格式化、补全上下文、HTTP/DSL 目录、版本策略、schema 候选、行内提示及 Monaco 注册分别归属模块。分析 Worker 直接使用请求解析与诊断模块。
- 新增 36 个生产模块，最大 563 行；61 个原有公共导出完整保留。195 个原样迁移定义经 AST 比较一致；MongoDB 拆出的 JSON 分支语句未变，shell 参数只替换为直接调用该分支。
- 20 文件/171 项回归通过，覆盖 SQL 参数、语句范围、元数据影响、MongoDB shell/JSON、Elasticsearch Console、自动/行内补全及查询执行。
- 新增构建门禁 `verify:query-language-boundaries`：检查 36 个模块的运行时循环、实现反向导入旧入口、UI/store/service 依赖及反向调用 Monaco 注册。用临时导入验证门禁能拒绝循环、静态/动态兼容入口、UI 和注册层依赖；随后清理临时文件并复验通过。
- 移除这三个入口的大小豁免。此次保留既有语言能力，不以文件拆分证明 SQL LSP 与 DBX 功能完全对齐或真实桌面性能已改善。

### 数据库驱动目录与查询安全

- `databaseDialect` 从 1,776 行降为 71 行。新增 28 个驱动领域模块：13 份内置描述独立存放，组合目录只聚合描述；能力复制、协议别名、保守回退、连接默认值、命名空间、数据类型、标识符、关系对象和 LSP 路由分别管理。
- `createDatabaseDriverCatalog` 独占运行时能力、注册 profile、外部安装来源和后端权威 driver 集合；`runtimeCatalog` 创建应用唯一实例并导出既有 API。工厂可用于隔离测试，不增加应用运行时实例或重复 store。旧驱动来源模型直接依赖目录模块。
- `querySafety` 从 1,149 行降为 7 行；9 个模块分别管理总分类、SQL 函数/扫描/语句规则、JSON 搜索、MongoDB 命令/shell、Redis 与 Elasticsearch。安全扫描保留原语义，没有按名称强行合并成编辑器补全扫描器。
- 127 个原定义、13 份内置配置和 60 个公共导出经 AST 对比保持一致。新增 3 项目录测试覆盖实例隔离、登记输入的数组复制、兼容入口与领域入口共享同一应用实例。
- 23 文件/192 项回归通过，覆盖方言能力、查询安全、目录与安装来源、连接表单/store、namespace、LSP 同步和查询执行。
- 现有查询语言边界门禁扩大到驱动和安全模型，共 77 个模块；已发现并消除旧驱动来源模型反向引用兼容入口。两个大小豁免已移除，完整目标仍未完成。

### AI 助手会话与客户端侧栏

- `useAssistantAgentSession` 从 2,683 行降为 380 行；`features/assistant-session/` 的 20 个模块分离事件归并、进度与审批状态、文件审阅状态、恢复数据、快照写入队列、增量事件、Host 事件 broker 和跨会话缓存。
- 会话恢复/订阅、快照持久化、回合命令、文件审阅各有 hook。协调入口继续持有跨流程共享状态与 ref；文件写入去重集合由审阅 hook 独占，跨会话缓存通过读/保留/删除/清空 API 访问。事件与快照限额、取消清理、审批上下文、文件版本检查和重放规则保持不变。
- `AssistantSidebar` 从 2,368 行降为 869 行；`features/assistant-panel/` 的 11 个模块分离 provider 身份与展示状态、会话身份/版本、选中会话持久化、工具 manifest 与 prompt 组合、CLI 安装/授权生命周期、提交动作、文件审阅联动及展示组件。
- 73 个辅助函数、51 个回调、21 处 effect 与迁移前 AST 一致（缓存访问归一为等价访问器）。展示 JSX 按 React 空白处理规则归一后相同；16 个公共导出完整保留。接口复用 session、CLI setup store、i18n 和快照队列的契约，避免复制私有类型或展开翻译 key 联合。
- 回归覆盖 13 文件/115 项，通过扩大回归与侧栏整文件复测完成验证。扩大运行时，侧栏的 2 项模型交互用例触发原有 5 秒超时；构建结束后单独复测该文件，56 项全部在原超时配置下通过。其余 12 文件/59 项在扩大回归中通过。
- 完整构建通过 TypeScript、1,520 文件大小门禁、91 个状态可达模块、77 个查询领域模块、Vite 及产物静态循环检查。两个大小豁免已移除；此批没有修改 UI 样式，也不以拆分或测试替代真实桌面性能与外部 CLI/AI 验收。

### AI 工具定义、工作区适配器与集成测试

- `coreTools` 从 1,916 行降为 202 行。工具定义按文件、连接、provider 目录、编辑器、元数据、查询、namespace、行修改、文档、键值、搜索和 LSP 分为 13 个模块；参数 schema 与领域校验靠近对应工具，共用输入读取器。组合入口保留 20 个工具组及其注册规则。
- `defaultRegistry` 从 1,310 行降为 21 行。16 个工作区模块分离 context、目标解析、文件/连接/编辑器、元数据、查询执行、执行计划摘要、修改与 LSP。8 个适配器工厂通过 `Pick<AiToolAdapters, ...>` 声明成员，由一个组合入口组装 21 个适配器，保持原顺序。
- 112 个定义经 AST 比较一致，32 个工具的 schema、描述、权限和调用实现保持原内容；21 个适配器属性与顺序及 7 个公共导出完整保留。没有改变审批、受管连接限制、只读执行、文件修订检查或取消清理。
- `ai-integration.test.ts` 从 1,301 行降为 14 行；原入口按原顺序注册 MCP、CLI、参数校验、LangGraph、计划归一化和模型 planner 六组测试，共用四个工厂 fixture。6 组断言与 4 个 fixture 经 AST 比较一致，测试组不会被单独重复收集。
- 新增 `verify:ai-tool-boundaries` 并接入构建：检查 39 个工具模块内部循环，以及定义/工作区适配器跨层直接引用和实现反向导入组合入口。5 个临时探针分别验证两种跨层、反向组合、动态跨层和循环引用会被拒绝，已清理探针。
- 三处依赖门禁共用 `scripts/lib/runtime-import-graph.mjs`；4 项 Node 测试覆盖类型擦除、路径解析、动态导入、实现文件发现及循环检测。既有状态/查询门禁覆盖数仍为 91 / 77。
- 最终前端回归 10 文件/94 项通过，4 项依赖图测试通过；完整构建通过。测试拆分后大小门禁再次检查 1,556 个文件通过。三个大小豁免已移除；真实数据库、CLI/在线 provider 和桌面性能的验证边界保持不变。

### 助手输入框与模型控制

- AssistantPromptBox 从 1,135 行降到 317 行，AssistantModelControl 从 1,191 行降到 225 行；公共组件和模型状态类型保持原入口。
- `features/assistant-composer/` 的 22 个模块分开公共契约、斜杠词元、上下文摘要、模型目录、推理强度规则、输入交互、模型面板状态及各类菜单/展示；新模块最大 358 行。
- 输入 hook 独占 textarea ref、IME 状态、词元、候选与关闭状态；入口持有模型弹层开关及按钮 ref，协调两个弹层。模型 hook 独占搜索、视图、自定义模型和选项切换状态。
- 中文输入法的 DOM 值所有权、WebKit 229 提交保护、光标范围替换、候选排序上限、模型目录渲染上限和 Ultra 权限确认逻辑保留。Radix 的 `asChild` 仍直接包装实际按钮/DOM。
- 27 个辅助函数、12 个回调、7 处 effect、7 个 textarea 事件处理器及 3 组 JSX 经 AST 归一化对比一致；两个历史大小豁免已移除。
- 9 文件/90 项回归及完整构建通过；24 个模块的局部依赖与 5 个公共导出核查通过。真实桌面性能与在线 provider 不属于本批验证结果。

### 查询编辑器的剩余组合与状态

- QueryEditor 从 1,974 行降到 935 行。新增 12 个查询编辑器 hook、3 个 UI 组件、1 个查询模型和 1 个连接模型模块；新模块最大 448 行。
- 连接能力/目录、Elasticsearch 服务版本、文档内容写入、执行提示、应用事件、格式化、主题与挂载、SQL 文件拖入、元数据刷新、SQL 补全和语言服务分别组合。
- 文档写入队列/计时器、提示计时器、版本请求状态、批量列候选会话、行内补全缓存/取消控制器/监听集合、MySQL 诊断缓存分别归对应 hook；根组件保留跨流程共享的编辑器、动作和视图引用。
- 工具栏、补丁审阅和 Monaco/差异/图片编辑区各有组件。运行当前语句仍在工具栏 pointer down 时捕获编辑器选区，补丁审阅保留修订校验、取消和范围定位路径。
- 目录名称解析从 PostgresDatabaseTree 移到连接模型；编辑器与 Explorer 调用方直接引用模型，原公共导出保持兼容。
- 191 个变量定义、13 处 effect、展开后的 JSX 和目录名称规则通过 AST 归一化核对。新增 6 个生命周期回归用例覆盖待写内容归属、卸载清理及旧连接响应隔离；QueryEditor 大小豁免已移除。
- 门禁发现补全模型通过旧 hook 导入纯函数，已将缓存补全规则抽到模型层；原 hook 从 482 行降到 48 行，保留原导出与缓存生命周期。5 个内部总入口导入已改为直接依赖；构建新增 78 模块的查询编辑器边界门禁，5 类临时违规探针均被拒绝并已清理。
- 最终回归 56 文件/288 项及完整构建通过，覆盖查询分析、LSP 同步/适配、缓存与行内补全、事务/执行、补丁审阅和目录发现。桌面性能与在线能力仍需对应环境验收。

### 表数据视图与数据传输会话

- TableDataView 从 1,508 行降到 927 行，TableDataTransferDialog 从 1,371 行降到 821 行。新增 17 个模块，最大 290 行。
- 表数据侧拆开文件选择、导入事件、导入/导出进度、导出报告、能力查询、视图加载、分页/筛选动作和工具栏。传输侧拆开源对象清单、报告、请求构造、进度订阅、外部驱动资格、目标元数据、步骤导航和侧栏。
- 进度 hook 持有导入/导出任务引用，能力 hook 持有请求结果；对象/目标加载 hook 持有加载状态，报告 hook 持有历史记录，步骤 hook 持有当前步骤与滚动锚点。预览、确认和执行共享的会话状态仍归弹层入口统一管理。
- 请求内容及对应 key、预览令牌匹配、取消标记、旧响应过滤、只读与跨库限制保留原逻辑。254 个变量初始化、22 处 effect 和两组展开后的 JSX 通过 AST 归一化核对。
- 新增 5 项生命周期测试，验证延迟监听清理、进度身份隔离、旧 schema 结果过滤、关闭后 readiness 不再发起元数据请求，以及旧外部能力响应不恢复过期连接。
- 两个大小豁免已移除；新增表数据/传输边界门禁覆盖 33 个模块，已接入构建。
- 5 类边界违规探针验证通过并清理；7 个公共导出保持原路径。最终 21 文件/102 项回归及完整构建通过，真实数据库导入导出与桌面性能仍需对应环境验收。

### 数据库侧栏第二轮拆分

- 侧栏入口从 5,904 行降到 1,581 行；新增 35 个生产模块，最大 968 行。连接/表/集合/schema 动作、传输/比较、历史菜单、目录搜索、元数据加载和视图组合按职责分开。
- 驱动能力、对象描述加载、搜索代次与树选择/展开状态分别归对应 hook；共享弹窗和目录上下文仍由侧栏协调。保留每个节点自己的连接/schema 绑定及请求取消、缓存与虚拟化规则。
- 553 个变量初始化、19 处 effect 和展开子组件后的 JSX 经 AST 归一化核对一致。新增 6 项异步状态测试，扩大回归 39 文件/202 项通过。
- 新增 94 模块的 Explorer 构建门禁；5 个临时探针验证循环、模型/hook 反向依赖与动态 UI 导入会被拒绝。DOM 树辅助方法归 runtime，旧 UI 路径保持兼容。
- 最终完整构建通过 TypeScript、1,650 文件大小门禁、所有依赖边界、Vite 和产物循环检查；保留已有第三方 PURE 与大 chunk 提示。
- 此入口仍超过 1,000 行，因此未移除豁免，仅收紧其基线。全量清单仍为 52 项，不能把本批进度视为所有模块化、DBX 功能或桌面性能验收完成。

### 侧栏状态所有权与功能组合

- `SchemaSidebar.tsx` 从 1,581 行进一步降到 764 行，已移除大小豁免；全量清单剩余 51 项。
- 新增 8 个模块，最大 299 行：目录可见性、数据源上下文、远程目录状态、对象编辑、数据工作区、SQL 导入、连接元数据读取和展示组合分别管理。
- 可见 schema/数据库偏好由单个 hook 持有；编辑目标和异步请求状态各有对应所有者。展示组件持有自己的悬停与成员展开状态，入口组合各职责的返回值。
- 144 个变量初始化、1 处 effect 和 394 处 renderer/视图参数绑定经核对保持一致。新增 5 项目录偏好测试，覆盖项目/连接切换、当前 schema 保留、目录结果隔离和清理。依赖门禁扩大到 102 个 Explorer 模块。
- 最终前端构建通过 TypeScript、1,659 文件大小检查、所有依赖门禁、Vite 和产物循环检查；保留已有第三方 PURE 与大 chunk 提示。
- 扩大回归 40 文件/207 项串行通过，沿用默认超时；之前并行执行中的 3 项超时未在整组串行运行中复现。

### 关系图画布与生命周期

- `SchemaDiagramView.tsx` 从 1,996 行降到 413 行，新增 21 个生产模块，最大 328 行；历史大小豁免已移除。
- 布局、视口、持久化、撤销历史、导出各有独立生命周期模块；导航、区域和便签动作与展示组件分离。标签 store 仍是画布历史唯一来源，保留加载失效检查、保存队列、防抖和卸载前保存。
- 171 个变量初始化、9 处 effect、根 JSX 和 9 个辅助定义的迁移核对通过。新增 6 项异步持久化回归；扩大回归 15 文件/70 项通过。
- 新增 31 模块关系图依赖门禁并接入构建，5 类反向依赖/循环探针均被拒绝。剩余 50 个历史大文件继续按全量清单处理。

### 工作台运行时与窗口交互

- `pages/workspaceRuntime.tsx` 从 1,310 行降到 426 行，新增 12 个生产模块，最大 310 行；移除对应大小豁免。
- 启动恢复、三个按需挂载组件、窗口事件、Vim 前缀生命周期、窗口拖动与查询结果展示分别归属独立模块，保留原有加载时序和状态来源。
- 128 个变量初始化、13 处 effect/layout effect、根 JSX 和 7 个辅助组件迁移核对通过；延迟加载整理错误已发现并修复。
- 新增 14 模块工作台依赖门禁，5 类违规探针均被拦截，正常图通过。剩余 49 个历史大文件继续推进。

### 远程目录与数据比较

- 远程目录入口从 1,294 行降到 150 行，新增 10 个模块：树状态、元数据加载、定位/刷新、节点展示和类型分离。成员加载新增上下文与请求代次检查，3 项先失败的交错返回测试在修复后通过。
- 数据比较入口从 1,185 行降到 345 行，新增 14 个模块：会话生命周期、筛选动作、全量比较、同步计划操作、行转换与展示分离，原有同步计划协议保持。
- 分别核对 91 / 80 个变量初始化、5 / 2 处 effect、展开 JSX 与 3 / 14 个辅助定义，纯迁移保持一致；远程成员请求保护属于单独验证的行为修复。
- Explorer 门禁扩大到 113 模块，新增 16 模块数据比较门禁。两处历史大小豁免已移除，历史大文件剩余 47 项。
- 数据比较同步预览/执行的异步返回作用域隔离已由下一批补齐，见下节；其他模块仍按全量清单继续。

### 数据比较操作所有权与失效

- 会话统一拥有比较取消、预览失效和派生状态清理。新 runtime 负责预览/执行/复制 token；标签或来源切换、卸载后，旧响应不能更新当前界面。
- 选中行、主键与比较列变化即时废弃对应结果；执行同步期间阻止重复提交和重叠比较/预览。成功或失败后均要求重新比较，保留后端冻结计划与原子执行协议。
- 统一 `FullComparisonMeta` 类型，减少动作模块重复字段和重置代码。新增 12 项组合测试，扩大回归 8 文件/47 项通过；18 模块数据比较门禁包含 runtime→hook/UI 约束，7 类违规探针通过拦截验证。
- 历史大文件仍有 47 项；本批补齐上一轮登记的状态边界，不缩小全量目标。

### Schema Diff 与 RocketMQ 客户端

- Schema Diff 入口从 1,168 行降为 276 行；新增 14 个生产模块，分离迁移会话、适用条件、执行/预览/定位动作与确认/日志/预览组件。
- RocketMQ 入口从 1,156 行降为 193 行；新增 10 个生产模块，分离原生资源加载会话和 8 个资源展示组件，沿用专用服务接口。
- 两个新增依赖门禁分别覆盖 23 / 12 个模块；禁止反向依赖入口、模型依赖 hook/UI、hook 依赖 UI 与运行时循环，动态导入参与检查。
- 新增 6 项会话/页面交互测试；扩大回归 10 文件/44 项通过。两处入口均移除大小豁免，全量历史清单剩余 45 项。
- 最终前端构建通过 TypeScript、1,749 文件大小检查、全部依赖门禁、Vite 与产物静态循环检查；新增测试语义类型检查和差异空白检查通过。
- 后续状态工作：Schema Diff 执行/重新比较迟到返回与复制计时器，RocketMQ 跨连接/Topic 请求隔离及失败重试。此次未声称这些问题或真实桌面性能已完善。

### 离线导入和企业管理客户端

- DBML / 项目 DDL 入口从 1,115 / 1,077 行降为 6 / 13 行；新增 23 个模块分离扫描、语法对象、关系组装和快照指纹，89 个原定义与 13 个公开导出保持一致。
- 导入模型不依赖运行时 React/store/service，不反向调用兼容入口；46 模块 Schema Diff 门禁纳入上述约束，10 类违规探针通过。回归 10 文件/73 项通过。
- 企业管理 App 从 1,614 行降到 475 行；新增 25 个模块分离会话、五类表单状态、五组操作与各管理面板，最大 576 行。导航继续保留隐藏面板和草稿。
- 企业管理迁移核对 85 个初始化、4 处 effect、根 JSX 和 2 个辅助函数保持一致；新增 4 项页面交互测试，与服务回归共 2 文件/6 项通过，语义类型检查通过。
- 新增 31 模块企业管理依赖门禁并接入根构建和独立管理端构建。管理端迟到请求隔离和共享操作状态仍在后续状态审查范围。
- 本批移除 3 个历史豁免，全量历史清单剩余 42 项；桌面客户端清单中的历史超限文件已拆完，但依赖/生命周期和真实功能验收的完成条件仍未全部满足。

### Agent Host 运行时与工具分发

- 两个生产入口从 1,369 / 1,079 行降到 7 / 13 行；新增 20 个模块分离协调器、单次执行状态、profile、消息、提示压缩、检查点、工具分发/审批/澄清/连接/产物/引用。
- 保留唯一线程与执行容器、事件顺序、并发限制、审批租约与后端权威协议；86 个原定义、3 次 Harness 注册和 18 个公开导出迁移核对通过。
- 运行时测试从 1,176 行降到 93 行，拆出六类场景和共享 fixture；12 项原测试完整保留，Agent Host 全套 10 文件/28 项通过。
- 新增 26 模块 Agent Host 依赖门禁；七类违规探针被拦截。共享图解析器支持 NodeNext `.js`→TypeScript 源码映射，五项图检查测试通过。
- 桌面前端、Agent Host、企业管理端最终构建通过；根门禁覆盖 1,825 文件。真实打包子进程通过初始化、线程打开、stdout 帧隔离和 SIGTERM 退出验证，未连接真实 provider/数据库。
- 三个历史豁免已移除，剩余 39 项。Agent Host 历史超限文件已拆完，仍需按全量条件继续验证状态、协议与实际运行。

### Rust CLI 安装与认证

- `ai_cli/setup.rs` 从 1,317 行降到 20 行，分离安装状态、包校验/激活、路径、认证状态、认证控制、两个 provider 认证流程、进程、协议和就绪验证。
- 10 个实现模块最大 255 行，保留两个唯一会话表及 7 个公开 API。52 个原定义的语法 token 迁移核对通过。
- 新增 CLI setup 依赖门禁，限制各层允许的依赖并检查会话唯一所有者；入口不得重新容纳实现。
- 新增取消终态、安装终态、暂存版本校验和激活回滚测试；扩大 Rust 回归 CLI 40 项、AI 命令层 11 项，共 51 项通过，最终编译无新增警告。6 类依赖违规探针与 rustfmt 检查通过；未进行真实安装/登录及跨平台交互验收。
- 最终前端构建通过 TypeScript、1,836 文件大小检查、全部依赖门禁、Vite 与产物循环检查。
- 移除此历史大小豁免，剩余 38 项，完整模块化与状态验收目标继续保留。

### Rust AI 命令与行内补全

- `commands/ai.rs` 从 1,651 行降到 66 行；13 个实现模块最大 199 行，测试独立为 461 行。
- 原有 21 个 Tauri 命令与公开请求/返回类型保留；CLI 环境、能力缓存、发现、安装认证，以及 provider 设置、HTTP 对话/行内传输、取消状态分别归属功能模块。
- 生产模块改用按需导入，新增 AI 命令边界门禁并接入根构建；门禁核对命令注册、关键状态/传输的唯一 owner 和入口无实现。
- AI 命令既有 11 项定向测试通过，Rust 编译无新增警告；真实外部 CLI、AI provider 和桌面交互仍需要独立验收。
- 再移除一项大小豁免，全量清单剩余 37 项。

### Rust LSP 命令

- `commands/lsp.rs` 从 1,307 行降到 22 行，9 个实现模块最大 219 行；请求/返回类型、补全条目解析、会话、补全/位置、文档、配置、格式化和泛型协议命令分离。
- 原有 17 个 Tauri 命令保持注册，60 个非测试定义经 Rust 语法 token 迁移核对一致；9 项现有 LSP 命令测试覆盖条目默认值、resolve 合并、限量/不完整响应、请求 token、泛型方法白名单和文档大小。
- 实现模块直接引用类型及所属模块；新增 LSP 命令边界门禁并接入构建，验证唯一状态 owner、命令注册和无环依赖。
- 再移除一项大小豁免，全量清单剩余 36 项。
- 最终 `npm run build` 通过 TypeScript、1,860 文件大小检查、两项新增 Rust 命令门禁、Vite 与产物静态循环检查；`source/dbx` 保持干净。

### Rust Agent Host 运行时与协议处理

- `agent/host.rs` 从 8,445 行降到 41 行；35 个实现模块最大 559 行，原有测试独立为 1,047 行。唯一 `AgentHostInner` 状态对象保留，80 个方法按 CLI 回合、交互/审批、生命周期、会话、工件、进程/RPC、模型、工具、连接、只读/审批查询、检查点与事件拆分。
- 顶层协议类型、工具 manifest、审批/连接状态、查询策略、事件投影、工件/检查点、身份摘要及错误处理分别归属功能模块。150 个非测试顶层定义与 80 个 Inner 方法经 Rust 语法 token 核对一致。
- 生产模块直接导入所属类型/帮助函数；截止时间检查归属错误模块后，帮助函数依赖图无环。新增 Rust Agent Host 边界门禁并接入构建，检查唯一 owner、单一状态扩展、无环依赖及入口无实现。
- 原有 Agent Host 34 项测试在纯迁移与直接导入版本均通过，Rust 编译无新增警告。全量大小豁免减少一项，剩余 35 项。

### Rust Agent Shell 策略与沙箱

- `agent/shell.rs` 从历史 2,083 行降到 17 行；8 个实现模块最大 408 行，原 15 项测试分离。策略类型、内置规则、声明式规则、配置、语法、命令目标判断和沙箱执行各有 owner。
- macOS Seatbelt 规则使用临时目录/项目目录的规范路径，修复 `/var/folders` 对应实际 `/private/var/folders` 时错误拒绝工作区内写入的问题；原沙箱集成测试单独复跑和拆分后均通过，外部写入仍被拒绝。
- 76 个非测试定义迁移语法 token 一致；生产模块直接导入所属模块，新增 Shell 边界门禁并接入构建，策略/执行依赖图无环。
- 再移除一项历史大小豁免，剩余 34 项。
- 最终 Rust Agent 范围 80/80 项通过；`npm run build` 通过 TypeScript、1,905 文件大小检查、Host/Shell 新门禁、Vite 与产物静态循环检查。`rustfmt --check` 和 `git diff --check` 通过，`source/dbx` 保持干净。

### SQL LSP 解析器与作用域

- `vendor/sql-lsp/src/parser/sql.rs` 从 7,093 行降到 27 行；21 个实现模块最大 690 行，原内嵌测试拆成共享帮助函数和 5 类场景，单文件最大 700 行。
- 单一 `SqlParser` 的 196 个方法按增量解析、补全上下文、INSERT/谓词/CASE、顺序/分组、外键/DDL、标识符、噪音屏蔽、查询作用域、语句边界、关系扫描、WITH/CTE、别名和行来源分离。公开类型和方法协议保留。
- 11 个非 impl 顶层定义、196 个解析器方法及 35 个测试函数经 Rust 语法 token 核对一致；原有 33 项解析器测试通过，覆盖 CTE 排除、相关子查询外层别名、行来源和完成上下文。
- 生产模块直接引用类型及软语句判断 owner，帮助模块无环。新增 `verify:sql-parser-boundaries` 接入根构建，检查单一解析器状态 owner、方法数量、场景测试和稳定公开类型。
- 再移除一项历史大小豁免，剩余 33 项。

### SQL 方言共享模块拆分

- `vendor/sql-lsp/src/dialects/common.rs` 从 2,467 行降为 14 行；五个实现模块最大 588 行，测试单独 406 行。73 个原生产函数保留在对应模块，18 项原测试通过。
- 引用查找独立于补全条目与模式目录，消除双向依赖；新增五模块/73 函数及依赖无环门禁，历史大小豁免由 33 降至 32。
- 完整 SQL LSP 回归 25 测试目标/318 项通过；最终 `npm run build` 通过 TypeScript、1,939 文件大小检查、新增 SQL 门禁、Vite 与产物循环检查。Rust 格式检查和差异空白检查通过。
- SQL LSP 子项目完整回归 318/318 项通过，桌面 LSP 模块 25/25 项通过；本机 release 二进制完成初始化/关闭/退出 stdio smoke，返回 17 类能力。
- 捆绑 manifest 按平台二进制名称拆分，当前 macOS/Windows 摘要分别匹配；本机 prepare、跳过时完整性核对及 `verify:sql-lsp-bundle` 通过。桌面 JSON-RPC 省略 null 参数，修复实际 shutdown 错误。
- 根 `npm run build` 最终通过 TypeScript、1,933 文件大小检查、新解析器门禁、Vite 和产物静态循环检查；真实数据库与完整 Tauri 安装包验收仍独立跟进。

### Rust schema diff 计划模块拆分

- `src-tauri/src/core/schema_diff.rs` 从 8,413 行降为 118 行；17 个生产模块按类型、快照、比较、跨方言转换、SQLite 重建、例程/对象、关系、DDL、依赖排序、预检、SQL 渲染及 PostgreSQL 引用重写分工，最大实现文件 902 行。
- 原 2,706 行内嵌回归按 6 类场景和共享构造函数拆为 7 个测试模块，最大测试文件 689 行。Rust AST 核对 133/133 个生产顶层定义和 76/76 个测试/帮助函数名称、token 均保留；差异仅为模块可见性和 rustfmt 尾逗号。
- 引用查找、预检查找、稳定 ID/摘要等共同能力移至计划模型；视图判断移至 DDL，消除原本拆分后的双向依赖。新增 `verify:rust-schema-diff-boundaries` 核对 17 模块/109 函数/7 测试模块和 56 条导入边的无环性；历史大小豁免由 32 降至 31。
- 最终 `npm run build` 通过 TypeScript、1,964 文件大小检查、全部依赖门禁、Vite 与产物静态循环检查。Rust 格式及差异空白检查通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib core::schema_diff` 的 71/71 项快照/DDL/预检/计划回归通过，没有新增编译警告；桌面真实数据库与安装包仍需验收。

### Rust 驱动包与 Registry 模块拆分

- `src-tauri/src/core/driver_package.rs` 从 5,692 行降为 166 行；20 个生产模块最大 539 行。模型、Registry 基础/Java 运行时、目录下载、安装/解析、目录绑定、包身份与路径/摘要、能力契约、版本策略、握手、归档、缓存、签名各有 owner。
- Registry 原 22 个方法拆到基础、Java、目录、安装及解析的 inherent impl 中，原公开方法与签名保留。原 1,799 行内嵌测试按目录、依赖、归档、契约、Registry、握手和安全场景拆为 8 个文件，最大 404 行。
- Rust AST 核对 122/122 个生产顶层定义、22/22 个 Registry 方法及 49/49 个测试/帮助函数 token 一致；只归一化模块可见性与 rustfmt 尾逗号。包身份和契约版本规则独立，打断目录绑定与包校验的依赖环。新增 `verify:rust-driver-package-boundaries` 检查 20 模块、77 函数、22 方法和依赖无环，历史大小豁免由 31 降至 30。
- 最终 `cargo test --manifest-path src-tauri/Cargo.toml --lib core::driver_package` 的 45/45 项回归通过；复跑编译无警告，覆盖签名目录、可续传依赖、包边界、安装激活、运行时握手和能力契约。
- 最终 `npm run build` 通过 TypeScript、1,993 文件大小检查、全部依赖门禁、Vite 与产物静态循环检查；Rust 格式与差异空白检查通过。

### Rust schema diff 命令层拆分

- `src-tauri/src/commands/schema_diff.rs` 从 4,147 行降为 148 行；20 个生产模块最大 673 行。目录来源采集按视图、例程、MySQL 对象、PostgreSQL 序列与依赖分开；快照采集、外部 sidecar 会话/计划/执行、本机执行、日志、预检、回滚各有 owner。
- 四个 `#[tauri::command]` 通过公开模块再导出保留 Tauri handler 宏路径；表数据对象迁移使用的 `capture_schema_snapshot_inner` 保留 `pub(crate)` 原路径。外部会话的单次消费、迁移日志状态与执行锁仍由唯一状态对象持有。
- 原内嵌回归按目录、外部语义/会话、预检、日志/确认及共享 fixture 拆为 5 个测试模块。Rust AST 核对 90/90 个生产顶层定义、5/5 个 impl 方法及 23/23 个测试/帮助函数 token 一致，只归一化模块可见性和 rustfmt 尾逗号。
- SQL 字符串转义和目录对象键归采集身份模块，打断视图、例程与 PostgreSQL 依赖捕获的双向导入。新增 `verify:rust-schema-command-boundaries` 检查 20 模块/63 函数/5 场景测试及导入无环；历史大小豁免由 30 降至 29。
- 最终 `npm run build` 通过 TypeScript、2,019 文件大小检查、全部依赖门禁、Vite 与产物静态循环检查；Rust 格式及差异空白检查通过。
- 最终 `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::schema_diff` 的 20/20 项回归通过，复跑编译无警告；Tauri handler 注册和表对象迁移原路径均参与编译。

### Rust MetaStore 持久化模块拆分

- `src-tauri/src/core/store.rs` 从 3,847 行降为 106 行；14 个生产模块最大 619 行。唯一 `MetaStore` 继续持有 SQLite pool 和加密凭据密钥，45 个方法按初始化/迁移、CLI 缓存、驱动遥测、项目/连接、SQL 库、查询历史、Assistant 任务及资源目录分工。
- 凭据密文、SSH 隧道秘密提取/恢复归凭据模块；CLI 缓存身份/MAC 规则和 Assistant checkpoint 校验各有独立 owner。原内嵌 13 项回归按缓存、遥测、连接/项目、历史、任务与 SQL 库拆为 6 个测试文件，最大 243 行。
- Rust AST 核对 40/40 个生产顶层定义、45/45 个 `MetaStore` 方法与 13/13 个测试函数。除模块可见性和 rustfmt 尾逗号外，遥测包令牌校验将原 `super::driver_package` 改为新位置对应的 `crate::core::driver_package`。新增 `verify:rust-meta-store-boundaries` 检查 14 模块/15 帮助函数/45 方法及无环导入；历史大小豁免由 29 降至 28。
- 最终 `npm run build` 通过 TypeScript、2,040 文件大小检查、全部依赖门禁、Vite 和产物静态循环检查；Rust 格式与差异空白检查通过。
- 最终 `cargo test --manifest-path src-tauri/Cargo.toml --lib core::store` 的 13/13 项回归通过、编译无警告，覆盖私有凭据加密、CLI 缓存 TTL、运行时遥测、SQL 库原子批量及项目/任务/历史边界。

### Rust Elasticsearch 驱动模块拆分

- `src-tauri/src/drivers/elasticsearch.rs` 从 3,459 行缩到 40 行，入口仅声明模块并保留 `ElasticsearchDriver` 的公开导出；10 个生产模块分别拥有模型、传输连接、控制台解析、文档分页、驱动契约、目录发现、结果转换、集合目录和字段映射。
- `ElasticsearchDriver` 仍是唯一连接状态所有者，持有 HTTP client、认证、服务器版本、mapping type 缓存、当前索引、连接标记与 PIT 能力状态。文档与控制台流程通过多个 inherent impl 共享该对象，没有复制运行时状态。
- 43 项原有测试按 HTTP fixture、文档分页、集合发现、传输、控制台、结果与元数据拆为 7 个场景模块；全部 47 个测试与辅助函数与拆分前逐名一致。
- 新增 `verify:rust-elasticsearch-driver-boundaries`，检查 10 个生产模块、60 个辅助函数、32 个驱动方法、关键符号所有权、7 个测试场景及无环直接依赖；大小基线从 28 项降至 27 项。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::elasticsearch` 通过 43/43 项。真实 Elasticsearch/Kibana 服务、打包客户端性能及跨平台网络环境仍需在对应环境验收。
- 根 `npm run build` 通过 TypeScript、2,058 个文件大小检查、全部边界门禁（含新驱动门禁）、Vite 与产物静态循环检查；构建保留既有大 chunk 提示。

### Rust PostgreSQL 驱动模块拆分

- `src-tauri/src/drivers/postgres.rs` 从 3,336 行缩到 30 行。模型/连接状态、目录元数据、查询与取消、函数参数、`DatabaseDriver` 适配、PostgreSQL 值编解码及测试各有 owner；最大生产模块为 1,000 行。
- 唯一 `PostgresDriver` 继续持有主连接池、只读元数据连接池、事务会话和活动查询映射。目录与查询模块通过 inherent impl 共享该状态，事务和取消流程没有复制 map 或 pool。
- 24 项测试拆为核心兼容、连接池与查询跟踪、SQL 多语句解析、真实数据库四个场景模块；拆分前后测试函数逐名一致。真实数据库用例继续保留原有 ignore 标记。
- 新增 `verify:rust-postgres-driver-boundaries`，检查 6 个生产模块、34 个辅助函数、76 个驱动方法、关键 owner、四组测试及无环直接依赖；大小基线从 27 项降至 26 项。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::postgres` 通过 23/23 项，另有 1 项真实 `TEST_POSTGRES_URL` 回归按原规则跳过。
- 根 `npm run build` 通过 TypeScript、2,069 个文件大小检查、全部边界门禁（含两套驱动门禁）、Vite 与产物静态循环检查；构建保留既有大 chunk 提示。

### Rust 项目文件命令拆分

- `src-tauri/src/commands/project_files.rs` 从 2,963 行缩到 48 行，稳定保留所有 Tauri command、`ProjectFileAppliedChange` 公共模型和 Agent Host 的四个 `pub(crate)` 调用路径。
- 模型、文件系统安全、补全索引、Git、Agent 适配和 Tauri 命令各有一个生产模块。`ProjectRoot` 继续集中拥有修订校验、原子写入、链接边界和递归删除保护；补全和 Git 通过显式依赖使用该能力，没有引入额外状态副本。
- 23 项原回归按 Git、文件安全/补全和平台符号链接辅助函数分为三组；`cargo test --manifest-path src-tauri/Cargo.toml --lib commands::project_files` 通过 23/23 项。
- 新增 `verify:rust-project-files-boundaries`，固定六个生产模块、58 个辅助函数、17 个 `ProjectRoot` 方法、三组测试和无环直接依赖；大小基线从 26 项降至 25 项。
- 根 `npm run build` 通过 TypeScript、2,079 个文件大小检查、全部边界门禁（含项目文件命令门禁）、Vite 与产物静态循环检查；构建保留既有大 chunk 提示。

### Rust 方言能力与 SQL 渲染拆分

- `src-tauri/src/core/dialect.rs` 从 2,698 行缩到 22 行，保留既有 `core::dialect::*` 能力协议、驱动目录和 `DatabaseKind` SQL 渲染 API。
- 能力模型与导出格式、内置驱动静态目录、驱动特定 SQL 与标识符渲染分别拥有模块。40 个 `DatabaseKind` 方法继续在 SQL 模块中共享同一个 `DatabaseSpec` 目录，未改变别名或能力契约。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib core::dialect` 通过 17/17 项；新增 `verify:rust-dialect-boundaries` 固定三模块、21 个辅助函数、40 个 SQL 方法和无环依赖，大小基线从 25 项降至 24 项。
- 根 `npm run build` 通过 TypeScript、2,083 个文件大小检查、全部边界门禁（含方言能力门禁）、Vite 与产物静态循环检查；构建保留既有大 chunk 提示。

### Rust 连接生命周期与驱动代理拆分

- `src-tauri/src/core/manager.rs` 从 2,538 行缩到 23 行，保留 `ConnectionManager`、外部驱动运行时摘要、重连结果和实时能力快照的稳定公共路径。
- 连接/隧道替换、schema 上下文、侧车重连预算及遥测归生命周期模块；99 个数据库驱动代理方法归操作模块；模型模块继续唯一持有连接、schema 和遥测锁，避免模块各自维护连接状态。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib core::manager` 通过 11/11 项，覆盖替换与断开、并发查询、能力快照、跨实例遥测、重连预算和目录发现。新增 `verify:rust-connection-manager-boundaries` 固定三模块、99 个方法、关键 owner 和无环依赖；大小基线从 24 项降至 23 项。
- 根 `npm run build` 通过 TypeScript、2,087 个文件大小检查、全部边界门禁（含连接管理器门禁）、Vite 与产物静态循环检查；构建保留既有大 chunk 提示。

### Rust MySQL 驱动、事务运行时和值编解码拆分

- `src-tauri/src/drivers/mysql.rs` 从 2,343 行缩到 24 行，保留 `MysqlDriver` 的公开路径和 `new` 构造入口。
- 模型模块唯一持有连接池、事务会话、活动查询映射及 MySQL 兼容判断；运行时模块负责连接池切换、多语句执行、查询跟踪、取消和事务会话；单一 `DatabaseDriver` 实现留在适配模块；JSON/二进制/参数值编码独立，避免驱动协议层重新膨胀。
- 21 个原回归场景保持同一模块，定向 `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::mysql` 通过 20 项，1 项依赖 `TEST_MYSQL_URL` 的真实数据库用例按原规则跳过。
- 新增 `verify:rust-mysql-driver-boundaries`，固定四个生产模块、27 个辅助函数、48 个驱动方法、关键 owner、21 个测试场景和无环直接依赖；大小基线剩余 22 项。

### Rust MongoDB 驱动、文档变更与查询结果拆分

- `src-tauri/src/drivers/mongodb.rs` 从 2,340 行缩到 33 行，保留 `MongoDbDriver`、公开构造入口和 OIDC URL 判定路径。
- 模型模块独占 client、活动数据库、服务端版本和命令输入；运行时处理本地 database 切换与命令执行；单一 `DatabaseDriver` 实现处理连接、目录、文档传输与变更执行；命令转换、文档 clone/edit/delete 计划和 BSON/结果元数据各有 owner。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::mongodb` 通过 41/41 项，包括原有原生 JSON/shell 命令、文档身份/指纹、集合目录、OIDC 相关的回归。
- 新增 `verify:rust-mongodb-driver-boundaries`，固定六个生产模块、35 个辅助函数、30 个驱动方法、关键 owner、31 个本地测试场景和无环直接依赖；大小基线剩余 21 项。

### Rust SQL 语句扫描、读策略与过滤验证拆分

- `src-tauri/src/core/statement.rs` 从 2,233 行缩到 37 行，保留语句类型、扫描方言、执行分类、语句切分、只读策略和过滤验证的公共路径。
- 词法/CTE/MySQL routine 扫描、软语句边界恢复、只读 SQL 规则和过滤表达式验证各有 owner；公共类型独立，跨模块只显式引用 scanner 或 types 的必要符号。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib core::statement` 通过 23/23 项，覆盖 CTE、RETURNING、MySQL delimiter/routine、PostgreSQL dollar quote/嵌套注释、SQL Server 标识符及只读/过滤边界。
- 新增 `verify:rust-statement-boundaries`，固定五个生产模块、47 个辅助函数、1 个类型方法、关键 owner、23 个测试场景和无环直接依赖；大小基线剩余 20 项。

### Rust 查询命令、导入导出与取消状态拆分

- `src-tauri/src/commands/query.rs` 从 2,094 行缩到 33 行，保留解析器与查询取消状态的稳定 crate 内入口。
- 诊断模型、状态/语法范围、标准执行、受限只读与 Explain、脚本及 Elasticsearch Console 导入导出、补全与取消命令分别拥有实现；跨模块只显式导入 owner。
- Tauri `generate_handler!` 直接注册各子模块中的命令定义，保持原 IPC 命令名，同时避免重新导出带来的私有宏辅助函数解析失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::query` 通过 18/18 项，覆盖语法诊断、UTF-16 光标范围、取消、只读、分页和脚本/Console 文件边界。
- 新增 `verify:rust-query-command-boundaries`，固定六个生产模块、38 个辅助函数、3 个类型方法、命令注册路径、关键 owner、18 个测试场景和无环直接依赖；大小基线剩余 19 项。

### Rust 项目 Git、补丁与 GitHub CLI 拆分

- `src-tauri/src/commands/project_git.rs` 从 2,059 行缩到 39 行，保留所有项目 Git 响应模型的稳定入口。
- Git 进程运行与输出脱敏、文件/远端/提交校验、仓库快照、常规工作区操作、补丁读取及应用、GitHub CLI 分别拥有实现；子模块通过显式 owner 导入协作。
- Tauri `generate_handler!` 直接注册命令定义所在的子模块，保持 20 个现有 IPC 命令名，并避免重新导出时私有宏辅助函数不可见。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::project_git` 通过 7/7 项，覆盖远端凭据拒绝、路径越界、状态/重命名、numstat、历史编码、revision 和补丁统计。
- 新增 `verify:rust-project-git-boundaries`，固定七个生产模块、48 个辅助函数、20 个命令注册路径、关键 owner、7 个测试场景和无环直接依赖；大小基线剩余 18 项。

### Rust 外部驱动侧车、迁移与 trait 适配拆分

- `src-tauri/src/drivers/external.rs` 从 1,975 行缩到 24 行，保留 `ExternalDriver` 的稳定构造入口。
- 连接状态与生命周期、协议结果转换、语义迁移边界验证和单一 `DatabaseDriver` trait 适配各有 owner；侧车超时、能力协商、分页游标和 Agent 只读限制不变。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::external` 通过 9/9 项，覆盖方言扫描、分页游标、权限协商和迁移快照/计划/预检边界。
- 新增 `verify:rust-external-driver-boundaries`，固定五个生产模块、16 个辅助函数、73 个类型方法、关键 owner、9 个测试场景和无环直接依赖；大小基线剩余 17 项。

### Rust SQLite 驱动运行、备份与 trait 适配拆分

- `src-tauri/src/drivers/sqlite.rs` 从 1,902 行缩到 26 行，保留 `SqliteDriver` 构造入口及 SQLite SSH 所需的备份/重建校验桥接。
- 模型、连接运行时、SQLite 值与参数编解码、在线备份/恢复文件安全，以及唯一 `DatabaseDriver` trait 适配各有 owner；内存数据库连接、只读 Agent、备份发布和重建回滚语义不变。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::sqlite` 通过 19 项匹配回归（其中 SQLite 模块保留 16 个场景，另有 3 个 SQLite SSH 兼容场景）。
- 新增 `verify:rust-sqlite-driver-boundaries`，固定五个生产模块、22 个辅助函数、32 个类型方法、关键 owner、16 个测试场景和无环直接依赖；大小基线剩余 16 项。

### Rust Agent 加密状态、图检查点与持久化拆分

- `src-tauri/src/agent/store.rs` 从 1,859 行缩到 32 行，保留 `AgentStore` 与 Agent Host 使用的图检查点类型出口。
- 数据模型和 scope 校验、密钥解析与 AES-GCM 认证加密、运行时后端初始化、普通记录读写、图检查点及写入、SQLite schema/持久化和过期清理各有 owner。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent::store` 通过 9/9 项，覆盖会话/持久化加密、错误密钥、project 清理、图检查点、写入与私有密钥文件。
- 新增 `verify:rust-agent-store-boundaries`，固定六个生产模块、23 个辅助函数、36 个类型方法、关键 owner、9 个测试场景和无环直接依赖；大小基线剩余 15 项。

## 已完成入口审计

原清单中的历史大文件均已完成职责拆分。以下保留入口的最终门面行数、模块所有权和对应边界校验；`scripts/module-size-baseline.json` 的 `legacy` 已为空，受管 TypeScript/TSX/Rust 文件均使用统一大小上限。

### Rust desktop backend

- [x] `src-tauri/src/agent/host.rs` — 8445 → 41 行，单一状态对象与功能模块分离
- [x] `src-tauri/src/core/schema_diff.rs` — 8413 → 118 行，快照、比较、DDL、预检和计划依赖拆分
- [x] `src-tauri/src/core/driver_package.rs` — 5692 → 166 行，模型、目录、安装、缓存、契约与运行时拆分
- [x] `src-tauri/src/commands/schema_diff.rs` — 4147 → 148 行，采集、计划、外部/本机执行、日志与预检拆分
- [x] `src-tauri/src/core/store.rs` — 3847 → 106 行，持久化、加密、SQL 库、任务和资源目录拆分
- [x] `src-tauri/src/drivers/elasticsearch.rs` — 3459 → 40 行，连接、控制台、文档、结果、目录与映射拆分
- [x] `src-tauri/src/drivers/postgres.rs` — 3336 → 30 行，连接状态、元数据、查询、参数和编解码拆分
- [x] `src-tauri/src/commands/project_files.rs` — 2963 → 48 行，模型、文件安全、补全、Git、Agent 与命令适配拆分
- [x] `src-tauri/src/core/dialect.rs` — 2698 → 22 行，能力模型、内置目录与 SQL 渲染拆分
- [x] `src-tauri/src/core/manager.rs` — 2538 → 23 行，生命周期、侧车遥测、状态模型与驱动代理拆分
- [x] `src-tauri/src/drivers/mysql.rs` — 2343 → 24 行，状态、运行、trait 适配和值编解码拆分
- [x] `src-tauri/src/drivers/mongodb.rs` — 2340 → 33 行，模型、运行、命令、文档、结果与 trait 适配拆分
- [x] `src-tauri/src/core/statement.rs` — 2233 → 37 行，类型、扫描、软边界、只读与过滤验证拆分
- [x] `src-tauri/src/commands/query.rs` — 2094 → 33 行，模型、状态、执行、只读、导入导出与补全取消拆分
- [x] `src-tauri/src/agent/shell.rs` — 2083 → 17 行，规则和沙箱执行拆分
- [x] `src-tauri/src/commands/project_git.rs` — 2059 → 39 行，运行时、校验、快照、操作、补丁与 GitHub CLI 拆分
- [x] `src-tauri/src/drivers/external.rs` — 1975 → 24 行，状态、侧车、转换、迁移与 trait 适配拆分
- [x] `src-tauri/src/drivers/sqlite.rs` — 1902 → 26 行，运行、备份、值与 trait 适配拆分
- [x] `src-tauri/src/agent/store.rs` — 1859 → 32 行，加密记录、图检查点与持久化拆分
- [x] `src-tauri/src/commands/ai.rs` — 1651 → 66 行，命令、传输、缓存和取消状态分别拆分
- [x] `src-tauri/src/commands/database.rs` — 1646 → 31 行，能力、包、运行时和命名空间命令拆分
- [x] `src-tauri/src/drivers/sqlite_ssh.rs` — 1559 → 27 行，SSH worker、传输、结果、元数据与 trait 适配拆分
- [x] `src-tauri/src/commands/sqlite_backup_schedule.rs` — 1443 → 36 行，持久状态、目录身份、计划、文件、执行与命令拆分
- [x] `src-tauri/src/drivers/mongodb_shell.rs` — 1425 → 22 行，命令降级、参数、值与语法扫描拆分
- [x] `src-tauri/src/commands/database_admin.rs` — 1377 → 25 行，身份、读取、写入、事件、表维护与 support 模块分离
- [x] `src-tauri/src/commands/document.rs` — 1320 → 21 行，协议、MongoDB、转移、Elasticsearch 与 support 模块分离
- [x] `src-tauri/src/commands/lsp.rs` — 1307 → 22 行，按会话、补全、文档及协议命令拆分
- [x] `src-tauri/src/enterprise/mod.rs` — 1242 → 21 行，模型、client、callback、credential、gateway 与命令模块分离

### Desktop client

历史超限文件已拆分；根构建中的依赖边界、状态所有权与取消路径门禁已复验通过。

### SQL LSP

- [x] `vendor/sql-lsp/src/parser/sql.rs` — 7093 → 27 行，语义分析与场景测试拆分
- [x] `vendor/sql-lsp/src/dialects/common.rs` — 2467 → 14 行，共享方言逻辑按格式化、光标、补全、模式与引用拆分
- [x] `vendor/sql-lsp/src/dialects/mysql.rs` — 1352 → 269 行，补全分派、helper 与 hover 拆分
- [x] `vendor/sql-lsp/src/dialects/postgres.rs` — 1319 → 220 行，补全分派、helper 与 hover 拆分

### Agent host

历史超限文件已拆分；协议和状态恢复的 owner 与依赖图已按完成条件复验。

### Enterprise services and UI

- [x] `enterprise/control-plane/src/store.rs` — 2257 → 28 行，访问、组织、网关、身份、设备、成员、审计与加密模块分离
- [x] `enterprise/gateway/src/service.rs` — 1510 → 13 行，授权、driver、策略、协议、RPC 与会话模块分离
- [x] `enterprise/control-plane/src/api.rs` — 1365 → 122 行，access、admin、gateway、identity、模型与 support handler 模块分离

### Regression suites

- [x] `tests/frontend/assistant-agent-sidebar.test.tsx` — 3474 → 6 行，harness、身份、生命周期、会话、composer 与 CLI 场景分离
- [x] `tests/frontend/schema-store.test.ts` — 1879 → 5 行，harness、集合、Redis、命名空间、缓存与项目竞态场景分离
- [x] `tests/frontend/table-editing.test.ts` — 1265 → 6 行，harness、行身份、粘贴、加载、保存与元数据刷新场景分离

## 最终模块化复审

- 大小基线的 `legacy` 为空；根构建对 2,530 个受管 TypeScript、TSX 和 Rust 文件执行统一上限。当前最大的受管 Rust 文件为 1,047 行（上限 1,200），TS/TSX 文件为 961 行（上限 1,000）。
- 根 `npm run build` 已通过 TypeScript、所有模块依赖/owner 边界、Vite 和产物静态循环检查；前端产物报告一个启动模块且无静态 import cycle。
- SQL LSP 方言拆分后 `cargo test --manifest-path vendor/sql-lsp/Cargo.toml --tests` 通过；MySQL/PostgreSQL completion、hover、定义跳转、引用和协议集成回归均在该测试集中执行。
- 对已拆分的桌面与企业入口，`commands::database_admin` 14 项、`commands::document` 11 项、`enterprise` 12 项定向 Rust 回归通过；`enterprise/Cargo.toml --workspace` 62 项通过。前端测试入口的三组场景共 131 项通过。
- 本清单验证模块职责和可构建性；没有把它表述为真实数据库吞吐、外部 CLI/AI provider 或打包桌面冷启动性能基准。

## 验证记录

- 定向回归：18 个文件、133 项测试通过（连接/元数据与侧栏流程 102 项，服务契约与运行时隔离 31 项）。
- 244 个契约定义未变；34 个动作除显式依赖访问外，AST 结构一致。
- 扩大回归：24 个前端 store 使用方文件、287 项测试通过；服务契约与实例隔离的 9 文件/31 项测试通过。
- 最终 `npm run build` 通过 TypeScript、文件大小、工作区状态边界、Vite 和产物静态循环检查；构建仍提示既有第三方 PURE 注释及大 chunk。

设置与顶栏批次回归：23 个文件、140 项测试通过，覆盖设置持久化、AI 配置、连接表单、驱动管理、工作台入口、项目创建/删除和更新流程。

本批最终 `npm run build` 通过 TypeScript、文件大小、工作区状态边界（64 个可达模块）、Vite 与产物静态循环检查。构建保留既有第三方 PURE 注释和大 chunk 提示；尚未测量真实桌面冷启动或切页性能。

数据表格批次最终 `npm run build` 通过类型检查、1,402 个文件的大小检查、工作区状态边界检查、Vite 与产物静态循环检查；参考 `source/dbx` 工作区保持干净。既有第三方 PURE 注释与大 chunk 提示仍存在。

查询语言批次最终 `npm run build` 通过 TypeScript、1,451 个文件的大小检查、64 个工作区状态可达模块与 36 个查询语言模块的依赖检查、Vite 及产物静态循环检查。既有第三方 PURE 注释和大 chunk 提示仍存在。`source/dbx` 保持干净；本批没有进行真实桌面性能基准或外部数据库验收。

驱动与安全规则批次最终 `npm run build` 通过：TypeScript、1,489 文件大小门禁、91 个工作区状态可达模块、77 个查询领域模块、Vite 与产物静态循环检查。第三方 PURE 注释和大 chunk 提示仍存在；`source/dbx` 保持干净。本批未执行真实数据库或打包桌面性能验收。

关系图批次最终 `npm run build` 通过 TypeScript、1,681 文件大小门禁、全部依赖边界检查、Vite 和产物静态循环检查。新增生命周期测试的语义类型检查也通过。既有第三方 PURE 注释与大 chunk 提示仍存在；`source/dbx` 保持干净。本批没有进行真实数据库、外部 CLI/AI provider 或打包桌面性能验收。

工作台批次回归 6 文件/35 项通过，包含新增 6 项生命周期测试：首帧前取消、恢复期间卸载、空闲回调取消、定时器/焦点监听清理、Vim 窗口前缀超时与卸载清理。最终 `npm run build` 通过 TypeScript、1,694 文件大小检查、全部依赖边界检查（含新增 14 模块工作台检查）、Vite 和产物静态循环检查。既有第三方 PURE 注释及大 chunk 提示仍存在，`source/dbx` 保持干净。真实数据库、外部 CLI/AI 和打包桌面性能验收仍独立跟进。

新增工作台生命周期测试的语义类型检查通过；测试 mock 的动画帧取消函数使用显式函数签名。

远程目录与数据比较批次扩大回归 14 文件/60 项通过，覆盖目录加载与成员展开、比较会话/同步确认、比较批次、Explorer 展示与生命周期、关系图和标签 schema 上下文。

本批最终前端构建通过 TypeScript、1,720 文件大小门禁、全部依赖边界检查（Explorer 113 模块、数据比较 16 模块）、Vite 和产物静态循环检查。新增两份生命周期测试的语义类型检查通过，数据比较纯算法入口也纳入 model→hook/UI 限制并复验通过。第三方 PURE 注释与大 chunk 提示仍存在；`source/dbx` 保持干净。本批未执行真实数据库同步或打包桌面性能验收。

数据比较状态批次最终 `npm run build` 通过 TypeScript、1,723 文件大小检查、全部依赖门禁（数据比较 18 模块）、Vite 和产物静态循环检查。新增组合测试的语义类型检查通过，`git diff --check` 通过，`source/dbx` 保持干净。构建仍有既有第三方 PURE 注释和大 chunk 提示；本批未运行真实数据库同步或打包桌面性能测试。
