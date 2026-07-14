# OxideStudio AI Agent 产品与技术规格

> 版本：2026-07-14  
> 状态：目标设计。文中的“当前”以仓库代码为准，“目标”不代表已经实现。  
> 关联文档：[AI Agent 集成设计](AI_AGENT_INTEGRATION.md)、[DataGrip 能力差距](datagrip-gap-analysis.md)

## 1. 产品目标

OxideStudio 的 AI 不应只是聊天窗口或 SQL 生成器，而应成为一个可验证、可暂停、可恢复的数据库工作代理。它必须同时满足以下目标：

1. **理解当前工作现场**：项目、窗口、连接、database/schema、当前 tab、SQL 选区、光标语句、Explorer 选中对象、结果集选区、诊断和执行错误。
2. **能完成闭环任务**：从理解意图、收集元数据、生成或修改 SQL、预览影响、请求批准、执行、验证到给出结果，而不是在生成 SQL 后停止。
3. **能与页面协作**：定位对象、打开 Data/DDL、跳转错误行、选中执行计划节点、聚焦结果集、创建或更新文件，但不能依赖脆弱的 DOM selector。
4. **默认安全**：数据库写入、DDL、导出、外部网络和秘密信息都有独立安全边界；模型不能绕过工具策略。
5. **结果可解释**：用户可以看到使用了哪些上下文、做了哪些工具调用、为何需要批准、最终验证是否通过。
6. **多数据库一致**：关系型数据库、MongoDB、Redis、Elasticsearch 等通过 capability 和 provider 工具族扩展，避免在 Agent 中硬编码 driver 分支。

不作为目标：让模型直接操作任意 DOM、把连接凭据交给模型、让模型任意执行本机 shell、用 MCP 反向调用当前页面，或在没有影响预览时自动执行破坏性操作。

## 2. 技术决策

### 2.1 总体架构

```text
Assistant UI / Inline AI / Error Fix / Explain Plan
                      |
                      v
               AssistantRuntime
              /                \
   Fast path: Chat/Explain    Agent path: Deep Agents
          direct model       (built on LangGraph)
              \                /
               Planning + policy
                      |
          +-----------+-----------+
          |                       |
   AiToolRegistry            UiActionRegistry
   database/LSP/files        navigation/editor/UI
          |                       |
   Tauri services/Rust       typed host handlers
          |
   drivers + connection manager
```

技术边界如下：

- **保留 `AssistantRuntime` 作为应用门面**。UI 不绑定某个 agent 框架，切换 planner、模型或执行器时不重写 Sidebar。
- **保留 `AiToolRegistry` 作为数据库能力与安全策略的唯一边界**。Deep Agents、现有 LangGraph、MCP 和 CLI 都只能包装 registry tool，不能直接调用 driver。
- **Agent 模式采用 Deep Agents TypeScript，Chat/Plan/O2 走轻量路径**。Deep Agents 适合长任务的 todo、上下文卸载、子代理和持久状态，但短问答不应承担完整 agent bundle、checkpoint 和循环延迟。
- **Deep Agents 是 LangGraph 之上的 agent harness，不是替换底层图运行时**。现有两节点 `plan -> policy` 图可逐步替换成完整 Agent mode，同时保持 planner contract。
- **桌面 WebView 使用环境适配入口并延迟加载**。只有用户第一次进入 Agent mode 时加载 Agent 运行时，避免增加首屏启动风险和普通查询路径体积。
- **模型调用继续经过 Tauri/Rust**。API key、代理和 provider credential 不进入前端状态；前端只拿到流式事件和结构化响应。
- **持久化使用项目级本地 checkpoint store**。通过 Tauri adapter 存储 thread、checkpoint、approval 和 tool result 摘要；默认不永久保存原始结果行。
- **MCP 只用于外部客户端**。应用内页面交互使用直接 TypeScript action bus，避免序列化页面状态、额外网络跳转和外部 host 权限错配。

Deep Agents 的文件系统权限只约束其内置文件工具，不能替代 Oxide 对自定义工具、MCP 工具和数据库写操作的 policy。Oxide 的批准门和后端只读校验始终是最终裁决者。

### 2.2 当前基础与关键缺口

| 能力 | 当前状态 | 证据 | 目标 |
| --- | --- | --- | --- |
| 统一数据库工具 registry | 已具备 | `src/ai/tools` | 继续作为稳定内核 |
| read/write/destructive policy | 已具备 | `policy.ts`、tool permission | 增加风险分级、影响摘要、批准绑定 |
| MCP / CLI 复用工具 | 已具备 | `src/ai/mcp`、`src/ai/cli` | 保持外部适配器定位 |
| 模型 planner 与结果总结 | 已具备/部分 | `src/ai/assistant` | 增加 checkpoint、恢复、验证节点 |
| LangGraph | 部分具备 | 当前主要为 `plan -> policy` 两节点 | Agent mode 引入完整状态图 |
| 多轮工具循环 | 部分具备 | 循环和上限在 `AssistantSidebar` | 移入 runtime，UI 只渲染状态 |
| 页面导航/编辑动作 | 第一阶段已完成 | `src/ai/ui-actions`、`databaseNavigation.ts`、`editorNavigation.ts` | 补 patch/plan/task surface |
| 持久 thread / memory | 缺失 | 无 checkpoint store | 项目隔离、可恢复、可清理 |
| 子代理 | 缺失 | 无隔离的 subagent executor | 默认只读、受预算约束 |
| Agent 可观测性与评测 | 部分具备 | 有 audit hook，缺完整 trace/eval | 结构化 trace、回放、黄金任务集 |

## 3. Agent 运行状态与逻辑要求

### 3.1 状态机

```text
idle
  -> capturing_context
  -> planning
  -> executing_read_tools
  -> observing
  -> replanning ───────────────┐
  -> awaiting_approval         |
  -> executing_mutation        |
  -> verifying ────────────────┘
  -> completed | failed | cancelled
```

逻辑要求：

1. 每个状态转换生成递增 `stepId`，持久化 `threadId/checkpointId/contextVersion`。
2. `capturing_context` 只读取允许发送给当前 provider 的内容，并记录来源和截断情况。
3. `planning` 产出结构化 todo、依赖关系、预期工具、风险和完成条件；不直接执行模型生成的任意函数名。
4. 独立只读工具可有界并行；写工具、依赖前一步结果的工具和同一事务内工具必须串行。
5. 工具失败只在 `retryable=true` 且调用幂等时自动重试；写入失败不得由模型猜测是否成功后盲重试。
6. 每轮执行后必须观察结构化结果，再决定完成或重规划；不得只凭模型先前计划宣告成功。
7. 达到步数、工具调用、token、时间或结果字节预算时暂停并解释，而不是静默截断。
8. cancel 必须传播到模型 stream、tool `AbortSignal`、Tauri command 和数据库 cancel；已开始的事务按策略回滚。
9. 应用重启后只恢复到安全边界：未批准写操作恢复为 `awaiting_approval`，不能自动继续。
10. 页面、连接或项目变化导致 `contextVersion` 变化时，旧批准失效并重新规划目标。

### 3.2 工具调用契约

每个 Agent 可调用工具至少包含：

```ts
type AgentToolContract = {
  name: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  capabilities: string[];
  risk: "R0" | "R1" | "R2" | "R3" | "R4";
  idempotency: "read" | "idempotent" | "non-idempotent";
  timeoutMs: number;
  maxResultRows?: number;
  maxResultBytes: number;
  supportsAbort: boolean;
};
```

执行前后要求：

- 输入先做 JSON Schema 校验，再做 capability、连接状态、目标作用域、policy 和批准校验。
- 每次调用携带 `requestId/toolCallId/idempotencyKey/contextVersion`。
- 输出使用稳定 envelope：`status/code/data/warnings/truncated/retryable/durationMs`。
- 数据库错误保留 vendor code、SQLSTATE、position、object 和 retryable，但不泄露密码或完整 connection URL。
- 大结果只返回 schema、统计、采样和分页 token；不得把整表交给模型。
- 审计默认记录工具名、目标、风险、时长和状态；原始 SQL/结果是否持久化由用户隐私设置决定。

## 4. 完整 Agent 能力清单

### 4.1 上下文理解

| ID | 功能点 | 逻辑要求 | 验收标准 |
| --- | --- | --- | --- |
| CTX-01 | 项目上下文 | 捕获 project id、alias、root path 和当前 window；memory 必须按 project 隔离 | 切换项目后旧连接、tab、memory 不会串入新任务 |
| CTX-02 | 数据库上下文 | 使用稳定键 `(connectionId, databaseName, schemaName)`；显示 driver/capability/read-only | 同连接切换 PostgreSQL database 后工具与 LSP 都使用新 catalog |
| CTX-03 | 编辑器上下文 | 捕获 tab id、document uri、language、revision、选区、光标所在 statement，不默认发送整个大文件 | 回答中可显示采用了哪段 SQL；revision 变化后 patch 拒绝旧版本 |
| CTX-04 | Explorer 上下文 | 捕获选中对象的稳定 object id、类型和限定名，不只保存展示文本 | 重名表存在时能定位到正确 database/schema/table |
| CTX-05 | 结果集上下文 | 捕获 result tab、列定义、用户选中行/单元格和有界样本 | 未明确附加时不发送全部结果行 |
| CTX-06 | 诊断上下文 | 收集 LSP diagnostic、执行错误、SQLSTATE 和位置 | “修复这个错误”可定位当前 error 而非重新猜测 |
| CTX-07 | 上下文附件 | 用户可显式 attach schema/object/selection/result/plan/UI context，并能移除 | 每个 attachment 可点击导航，且显示大小与敏感级别 |
| CTX-08 | 上下文预算 | 按意图选择 metadata 摘要，必要时再取细节；记录省略与截断 | 111 个 schema 不会一次全部进入 prompt |
| CTX-09 | 数据治理 | 凭据永不进入模型；行数据默认最小化、脱敏、可预览发送内容 | provider request 前可查看“将发送什么” |

### 4.2 对话、规划与执行

| ID | 功能点 | 逻辑要求 | 验收标准 |
| --- | --- | --- | --- |
| AGT-01 | Chat / Plan / Agent 模式 | Chat 不执行工具；Plan 可读上下文但不变更；Agent 按 policy 执行 | 模式切换不会继承更高权限 |
| AGT-02 | 任务分解 | 生成有依赖、状态和完成条件的 todo；用户可展开查看 | 长任务能显示当前步骤、下一步和阻塞原因 |
| AGT-03 | 多轮 tool loop | 规划、执行、观察、重规划在 runtime，不依赖 React 组件生命周期 | 关闭 Sidebar 再打开任务仍在继续或可恢复 |
| AGT-04 | 并行只读研究 | 只有无数据依赖且不会加重同一连接的 read 可并行；有并发上限 | 多 schema 元数据读取更快且不打爆连接池 |
| AGT-05 | 子代理 | 主代理为 schema、query plan、test 等子任务分配隔离上下文；默认只读 | 子代理不能继承未声明的写权限或全部聊天历史 |
| AGT-06 | 检查点/恢复 | 在模型调用、批准和工具完成后 checkpoint；应用重启可恢复 | crash 后不会重复执行已成功写操作 |
| AGT-07 | 停止/撤销 | cancel 立即可见；UI 导航可撤销；数据库变更按事务/逆向 SQL 能力提供补救 | 用户可知道哪些操作已无法撤销 |
| AGT-08 | 结果验证 | SQL 用 parse/diagnostic/EXPLAIN 或只读执行验证；写入用 affected rows/targeted reread 验证 | Agent 不会仅因工具返回 200 就宣告业务完成 |
| AGT-09 | 模型路由 | 简单分类/总结用低延迟模型，复杂规划用强模型；provider 无配置时优雅禁用 | 未配置模型不影响编辑器和数据库主流程启动 |
| AGT-10 | 失败降级 | 模型不可用时保留 LSP/固定 quick fix；agent runtime 加载失败时回退 Chat | AI 故障不会让应用卡在 loading |

### 4.3 SQL、数据库与数据任务

| ID | 功能点 | 逻辑要求 | 风险 |
| --- | --- | --- | --- |
| DB-01 | 自然语言生成 SQL | 先确认 dialect、catalog/schema 和对象；限定字段来自 metadata；结果插入新 tab 或 diff preview | R0/R1 |
| DB-02 | SQL 解释 | 解释当前 statement、对象、过滤、连接、聚合、潜在数据量；对象可点击导航 | R0 |
| DB-03 | 诊断与修复 | 合并 parser/LSP/vendor error，生成最小 patch；修改前展示 diff | R1 |
| DB-04 | 查询优化 | 不能只凭 SQL 猜测；优先结合真实 EXPLAIN/ANALYZE、索引和统计；ANALYZE 单独提示风险 | R0/R2 |
| DB-05 | dialect 转换 | 输出不支持特性、语义差异和参数变化；保留原文件 | R1 |
| DB-06 | 只读查询 | 后端重新分类 SQL；限制 row/time/bytes；多语句只要含 mutation 即拒绝 read path | R1 |
| DB-07 | DML 生成与执行 | 明确表、WHERE、预计行数；先 preview 或 transaction；无 WHERE 默认升级风险 | R2/R3 |
| DB-08 | DDL / destructive | 生成 migration preview、依赖影响和 rollback 可能性；drop/truncate 逐目标批准 | R4 |
| DB-09 | Schema diff/migration | 比较 snapshot，不直接拿 display tree；生成有序 migration 和不可逆标记 | R1-R4 |
| DB-10 | 数据分析 | 对结果做统计/分组/异常解释，优先在 DB 聚合而不是搬运原始数据 | R1 |
| DB-11 | 导入/导出 | 映射预览、编码/格式/错误策略、目标路径与敏感信息确认 | R2/R3 |
| DB-12 | 运维诊断 | 查看 session、lock、slow query、容量和权限；kill/cancel session 单独批准 | R1/R3 |
| DB-13 | 非关系数据库 | Mongo/Redis/ES 使用结构化 native request builder，不把文本伪装成 SQL | 按操作分级 |
| DB-14 | 安全变更计划 | 可生成但不执行变更包：目标、前置检查、SQL、验证、rollback 和 owner | R0 |

### 4.4 编辑器、LSP 与文件

| ID | 功能点 | 逻辑要求 | 验收标准 |
| --- | --- | --- | --- |
| EDT-01 | Inline completion | 使用 LSP 结构上下文 + 可选模型补全；模型建议必须再过 syntax/diagnostic 校验 | 不阻塞键入，超时静默退回 LSP |
| EDT-02 | 结构化 patch | patch 带 tab id、base revision、range 和 before hash；冲突时重新生成 | 不会覆盖用户刚输入的内容 |
| EDT-03 | Apply / Insert / New console | 用户可选择替换选区、插入光标或新建 query tab | 默认不破坏原 SQL |
| EDT-04 | 一键修复 | diagnostic/error 卡片提供 Explain、Fix、Jump、Run validation | 修复后 diagnostic 消失或显示剩余问题 |
| EDT-05 | SQL inspections | 检查未限定列、潜在笛卡尔积、无 WHERE 变更、类型转换和 dialect 风险 | 每条 inspection 有准确 range 与抑制方式 |
| EDT-06 | 文件任务 | 在项目根目录内创建/读取/修改 SQL、Markdown、JSON；路径规范化、防穿越 | Agent 不能越过项目 root |
| EDT-07 | 产物预览 | 报告、migration、diagram、CSV 结果作为 artifact tab 打开 | 用户可保存、比较、再次运行 |

### 4.5 记忆、知识与扩展

| ID | 功能点 | 逻辑要求 |
| --- | --- | --- |
| MEM-01 | Thread memory | 保存决策和任务摘要，不默认保存每一行结果；支持查看、编辑、清空 |
| MEM-02 | Project memory | 记录项目约定、schema 说明、命名/安全规则；只能在当前项目自动使用 |
| MEM-03 | Schema knowledge | 元数据缓存带 connection/catalog/schema/version；DDL 或 refresh 后失效 |
| MEM-04 | Skills | Skill 是可审计的说明与工具组合；版本固定、来源显示、可按项目禁用 |
| EXT-01 | Provider tools | provider 根据 capability 注册工具族，unsupported 返回可解释原因 |
| EXT-02 | MCP | 对外共享同一 tool manifest 和 policy；外部调用不能获得 UI 隐式批准 |
| EXT-03 | CLI | 用于自动化、测试、headless smoke；明确缺失的 in-app adapter |
| EXT-04 | 模型 provider | OpenAI-compatible、本地模型等统一接口；每 provider 有数据发送策略 |

### 4.6 可观测性与质量

| ID | 功能点 | 逻辑要求 |
| --- | --- | --- |
| OBS-01 | Trace | 展示 context capture、plan、tool、approval、verification 的时间线 |
| OBS-02 | 成本与性能 | 记录首 token、总耗时、token、工具时长、结果截断和 cache hit |
| OBS-03 | 用户反馈 | 支持对答案、tool step 和 patch 单独评价并附失败类型 |
| OBS-04 | Replay | 用脱敏 fixture 回放 planner/tool contract，不重放生产写入 |
| OBS-05 | 黄金任务集 | 覆盖 explain、修复、优化、跨 schema、重复列、批准取消和 crash resume |
| OBS-06 | 发布门禁 | Agent contract、policy 和 LSP ranking 回归作为 CI check |

## 5. 页面交互与跳转协议

### 5.1 设计原则

Agent 不直接输出 DOM selector 或模拟鼠标，而是输出有 schema 的语义动作。Host 根据当前状态解析稳定 ID，并负责权限、聚焦、路由和错误提示。

```ts
type UiAction = {
  actionId: string;
  kind: string;
  target: {
    projectId: string;
    connectionId?: string;
    databaseName?: string;
    schemaName?: string;
    objectType?: string;
    objectName?: string;
    tabId?: string;
    resultId?: string;
    range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  };
  issuedAgainst: { contextVersion: number; documentRevision?: number };
  presentation?: { label: string; reveal?: boolean; focus?: boolean };
};
```

`UiActionRegistry` 与 `AiToolRegistry` 分开：导航/聚焦本身不是数据库 mutation；如果一个卡片要“跳到表并删除数据”，必须拆成 `database.revealObject` 和独立受批准的 `table.deleteRows`。

### 5.2 必需动作

| 动作 | 输入/行为 | 失败规则 |
| --- | --- | --- |
| `project.open` | 切换项目并恢复其窗口状态 | 有未保存文件时先走现有确认流程 |
| `project.revealFile` | 在 Project Files 展开并选中文件 | 路径必须位于 project root |
| `workspace.openTab` | 打开/激活指定 tab | 不存在时返回 `TARGET_NOT_FOUND` |
| `workspace.focusPanel` | 聚焦 editor/explorer/results/assistant/tasks | panel 隐藏时先显示再聚焦 |
| `database.selectConnection` | 激活数据源 | 只选择，不自动连接或发送凭据 |
| `database.revealObject` | 展开到 catalog/schema/object 并选中 | 精确 stable id 优先，禁止仅按同名匹配 |
| `database.openObjectData` | 打开表/collection data tab | 使用 object 所属 connection，不使用全局旧连接 |
| `database.openObjectDdl` | 打开对象 DDL/source tab | provider 不支持时显示 capability 原因 |
| `editor.revealRange` | 激活 tab、滚动并高亮 range | revision 不一致时只定位，不应用 patch |
| `editor.previewPatch` | 打开 before/after diff | apply 是另一个需要确认的动作 |
| `editor.createQueryTab` | 使用指定 connection/catalog/schema 创建 query tab | 缺目标时请求选择，不继承不相关项目状态 |
| `results.reveal` | 激活 result tab，可选定位列/行 | 行已分页丢弃时提示重新加载 |
| `plan.revealNode` | 选中 Explain Plan 节点并联动对象 | plan version 不一致时拒绝 |
| `settings.open` | 打开 AI/provider/privacy/keymap 等 section | 不允许 Agent 修改 secret 字段 |
| `task.reveal` | 打开后台任务 trace | task 被清理时显示摘要而非空跳转 |

### 5.3 交互场景

1. **解释 SQL**：回答中的 `users` attachment 点击后调用 `database.revealObject`；“查看数据/DDL”是二级 action。
2. **修复错误**：错误卡片调用 `editor.revealRange`；“预览修复”调用 `editor.previewPatch`；用户 Apply 后才写 editor model。
3. **优化查询**：先打开 Explain Plan artifact；点击热点节点调用 `plan.revealNode`，再联动 table/index。
4. **结果分析**：Agent 引用“第 42 行”时携带 `resultId + rowKey`，点击聚焦对应结果，不依赖易变的屏幕行号。
5. **跨项目/连接**：任何 action target 与当前 project 不同都先显示切换提示；批准不能跨 project 复用。
6. **后台任务**：Agent 运行时 Sidebar 可关闭；状态进入 Task Center，完成通知可跳回 thread 和 artifact。

验收要求：所有 AI 生成的对象、文件、错误、结果和 plan 引用都应是可点击 attachment；action 失败有稳定 code 和恢复建议；同名对象永远不会随机跳转。

### 5.4 已落地基线（2026-07-14）

- `UiActionRegistry` 与数据库 `AiToolRegistry` 已物理分离；导航 action 不获得 mutation approval，也不能调用 destructive tool。
- action target 使用 `projectId + connectionId + databaseName + schemaName + objectName`、`tabId` 或 project-relative file path；不接受模型生成的 selector。
- registry 返回 `PROJECT_CONTEXT_STALE`、`PROJECT_SWITCH_REQUIRED`、`DOCUMENT_REVISION_STALE`、`TARGET_NOT_FOUND`、`UNSUPPORTED_ACTION` 等稳定 code，并提供 recovery 文案。
- Assistant 已把 active tab、selection、metadata object、project file、query result 和 LSP diagnostic 转换为可点击 attachment。对象的 Reveal、Open data、Open DDL 是三个独立 action。
- Database Explorer 能定位当前 database 及远程 PostgreSQL database 下的 schema/object；Monaco range 统一为 one-based，LSP 的 zero-based range 在 attachment boundary 转换。
- `editor.previewPatch`、`plan.revealNode`、`task.reveal` 已占据 typed contract，但在 diff viewer、Explain Plan 和 durable task surface 完成前稳定返回 unsupported，不伪造成功。

### 5.5 结构化错误基线（2026-07-15）

- Rust envelope error 与直接 Tauri command rejection 统一提供 `code + message + category + retryable + context`；前端无论调用哪类 command 都只消费 `ApiError`。
- `connection/query/schema/table/projectFile` 是稳定错误分类；未知 legacy rejection 由 command family 生成 fallback code，不再把 message 文本当协议。
- `context` 只允许 project、connection、driver、database、schema、table、view、queryId、relative path 等目标身份；SQL、connection URL、密码、文件内容和 revision 内容不得进入错误遥测。
- 写入型查询、DDL、文件 mutation 默认不可重试；只有幂等读取、连接建立/元数据刷新等明确安全路径可标记 `retryable=true`，最终是否重试仍由调用方结合幂等性决定。
- project file revision conflict 使用稳定 `REVISION_CONFLICT` code；UI 不再解析 `REVISION_CONFLICT:` 字符串前缀。
- 当前 envelope 尚未统一驱动 vendor code、SQLSTATE、position 与 object identity；这些字段应在 SQL error adapter 中作为后续可选 details 增加，不能退回字符串解析。

## 6. 安全与批准模型

| 风险 | 示例 | 默认行为 |
| --- | --- | --- |
| R0 | 读取 UI 状态、metadata、LSP、解释已有内容 | 自动执行、有界结果 |
| R1 | 只读查询、EXPLAIN、创建新草稿、页面跳转 | 自动执行；显示目标；可由 workspace 强制 read-only |
| R2 | 可撤销 editor/file 修改、事务内小范围 DML | 展示 diff/影响和一次批准 |
| R3 | 大范围 DML、导出敏感数据、外部网络、kill session | 强确认；绑定目标和参数；批准短时有效 |
| R4 | DROP/TRUNCATE、不可逆 migration、覆盖文件、无 WHERE 大变更 | 逐操作确认；要求显式目标；后端再次校验 |

批准 token 必须绑定：`toolName + normalizedArgsHash + targetIdentity + contextVersion + expiry`。模型修改参数、用户切换数据库、schema refresh 改变目标或批准过期，都必须重新批准。

数据库写入优先使用事务；无法事务化的 DDL/外部系统操作必须明确标注。rollback SQL 只能在语义可靠时提供，不能把“尽力生成”描述为可保证撤销。

## 7. LSP 重复列与相关性设计

### 7.1 原问题与已完成修复

原实现已经通过 `fileSchemas` 将 query tab URI 映射到一个目标 schema，所以大多数情况下不会把所有已同步 schema 混在一起。重复列主要发生在目标 schema 内：

1. `table_is_referenced` 在当前语句尚未识别到表时对所有表返回 `true`。
2. `add_schema_columns` 逐表追加列，不做 source-aware dedupe。
3. 当引用表数量不大于 1 时，候选 label 只是 `column`，不是 `table.column`。
4. 相同列名使用相同 `sortText`；Monaco 侧直接采用 LSP 顺序，没有二次上下文排序。

因此用户看到多个 `id/name/created_at`，通常确实是当前 schema 内多个表拥有相同字段，而不是单纯的 UI 重复渲染。

另外，PostgreSQL 的 tab 有 `databaseName`，但原 `LspSyncTab` 和 schema id key 没有把它作为独立 catalog 维度。因此同一保存连接打开多个 PostgreSQL database 时，metadata scope 不能得到严格保证。

上述 P0 问题已于 2026-07-14 完成实现：

- tab、同步计划、schema id、配置签名和 metadata cache 使用独立 catalog identity；显式 PostgreSQL database 走 database-scoped metadata commands。
- FROM 前的同名列使用 `table.column` 区分；多表 JOIN 使用 `alias.column`，并同步作为实际 insert text。
- completion item 携带 source identity，在 Rust LSP 内完成同源去重和稳定 `sortText`。
- 当前 statement、DML target 和活动 tab object 优先；字段匹配支持 exact、prefix、camel/snake abbreviation 与 subsequence fuzzy。
- TypeScript 与 Rust 回归覆盖跨 database、同名列、alias、CTE、DML、格式与 Clippy。

### 7.2 正确作用域与排序

补全必须先过滤作用域，再计算相关性，不能只把当前 database 加一点权重：

1. **硬边界**：当前 project → connection → database/catalog → schema。普通自动补全不展示边界外对象。
2. **显式限定符**：用户输入 `alias.` / `schema.` / `database.schema.` 时，只返回该作用域。
3. **当前 statement/CTE**：FROM/JOIN 中已引用的 relation 和 CTE 高于其他表。
4. **DML target**：INSERT/UPDATE/DELETE 的目标表最高。
5. **活动对象**：从某表创建的 console、当前 Data/DDL tab 对应表作为 fallback context。
6. **最近上下文**：当前 query tab 最近成功执行或导航过的 relation，仅用于同级 tie-break。
7. **扩展补全**：只有用户再次手动触发“全部对象”时，才加入同 database 其他 schema 或其他 catalog，并显式显示限定名。

同一作用域内的文本匹配顺序：exact > prefix > camel/snake subsequence > fuzzy。最终 `sortText` 应编码稳定分数与 source identity，不能只编码 column name。

### 7.3 歧义显示和插入

- 一个列只来自一个候选 relation：显示和插入 `column`。
- 同名列来自两个及以上当前 relation：显示并插入 `alias.column`；没有 alias 才使用 `table.column`。
- FROM 之前没有 relation：不再列出多个不可区分的 `id`。优先活动对象；若没有活动对象，同名列显示为 `table.column`，detail 显示 `database.schema.table · type`。
- 完全相同的 `(catalog, schema, table, column, kind, insertText)` 只保留一条。
- `preselect=true` 只允许一个明确且唯一的最高候选；歧义候选不得预选。
- completion item 的 `data` 携带稳定 source identity，后续 resolve/telemetry 不依赖 label 反查。

建议的相关性分数（数值仅用于表达优先关系，最终应由测试锁定）：

```text
explicit qualifier       +1000
current statement/CTE     +800
DML target                +750
active table context      +500
current catalog/schema    +300  (hard filter in normal mode)
recent relation           +100
exact/prefix/fuzzy match  +120/+80/+20
ambiguous unqualified     -200
outside normal scope      excluded
```

### 7.4 后续增强与测试要求

已完成 catalog identity、Rust source-aware dedupe/ranking、alias insertion 以及当前 statement、CTE、DML 和 active object 回归。后续增强保留：

1. 将 invocation mode 显式加入 completion context，支持“再次手动触发”扩展作用域。
2. 增加派生表、CTE 输出列推导、临时表生命周期和 routine overload 的语义模型。
3. 继续保持以下回归：
   - 同 schema 两表同 `id`，FROM 前不出现两个相同 label；
   - `FROM users u JOIN orders o` 返回 `u.id/o.id`；
   - `u.` 只返回 users 列；
   - 当前 schema 与其他 schema 同名表不串入普通补全；
   - 同 connection 的两个 PostgreSQL database 不串 metadata；
   - CTE 列高于基础表同名列；
   - DML target 列最高；
   - 重新手动触发才展示扩展作用域。

P0 正确性问题已经关闭；上述高级 SQL 语义增强转入 P1。

## 8. 相对 DataGrip 的 AI 差距

DataGrip 当前 AI 基线包含 schema-aware chat、自然语言生成 SQL、SQL 错误解释/修复、查询优化、Explain Plan 解释，以及将 schema/object/selection/UI context 作为可导航附件。OxideStudio 已有更开放的 provider/tool registry、MCP/CLI 和多数据模型方向，但用户闭环仍落后。

| 能力 | DataGrip 基线 | OxideStudio 当前 | 结论 |
| --- | --- | --- | --- |
| Schema-aware AI | 对象可附加、可导航 | 已有带 provenance 的对象/文件/结果/diagnostic attachment 与 stable navigation；metadata citation 和 patch preview 仍缺 | P0/P1 补 citation 与 patch workflow |
| Text-to-SQL | 成熟编辑器入口 | 已有模型 planner/inline 能力基础 | P0 补 dialect grounding、patch preview、验证 |
| Error fix | 执行错误可 Explain/Fix | 有 LSP diagnostic tool，缺统一 vendor error 与一键 patch | P0 |
| Query optimization | 可基于查询与计划解释优化 | 无 Explain Plan 主路径 | 先做 Explain Plan，再做 AI 优化 |
| Plan explanation | 支持 query plan AI explanation | 缺 plan artifact/节点联动 | P0/P1 |
| 页面交互 | attachment 可回到对象/代码 | `UiActionRegistry` 已支持稳定对象、文件、tab、结果和 diagnostic 跳转；plan/task surface 尚未完成 | 随 Explain Plan 与 durable task surface 补齐 |
| 长任务代理 | 以 IDE AI 工作流为主 | registry 架构适合扩展，但 runtime 循环在 UI | 引入 Deep Agents Agent mode 后可形成差异化 |
| 多数据模型 | 重点是 SQL/database IDE | 已覆盖 Mongo/Redis/ES 的结构化工具方向 | Oxide 的差异化优势 |
| 外部生态 | JetBrains 生态 | 已有 MCP/CLI/provider registry | 继续保持统一 policy |
| 数据隐私 | 默认不把原始数据库数据提供给 AI | 有截断/隐藏 credential，缺“发送内容预览” | P0/P1 |

AI 不能掩盖数据库 IDE 主能力差距。Value Editor 的 P0 闭环已完成；Explain Plan、schema diff/migration、diagram/FK navigation、data compare、semantic refactor/find usages、import mapping、session/lock 等仍需按 [DataGrip 能力差距](datagrip-gap-analysis.md) 路线推进。

## 9. 分阶段路线图

### Phase A：可信上下文与页面闭环（P0）

1. `UiActionRegistry`、稳定 target identity、可点击 attachment。
2. context snapshot/version、发送内容预览、database catalog identity。
3. LSP duplicate/ranking 修复及回归测试。
4. 统一 diagnostic/vendor error envelope，一键 Jump/Explain/Preview Fix。
5. 把工具循环从 `AssistantSidebar` 移到 runtime，Sidebar 变成纯视图。

完成定义：AI 回答中的对象/错误/结果可以准确跳转；旧上下文和旧批准不能作用于新项目/数据库；重复列补全不再不可区分。

### Phase B：Deep Agents Agent mode（P0/P1）

1. 延迟加载 desktop-compatible Deep Agents runtime，包装现有 registry tools。
2. 项目级 thread/checkpoint store、cancel/resume、预算和 trace。
3. 默认只读 subagent，按 schema research、query review、verification 隔离上下文。
4. HITL 与现有 approval UI 对接；数据库 policy 仍由 registry/Rust 执行。
5. 未配置 provider、runtime 加载失败或离线时可靠降级。

完成定义：10 步以上任务可暂停恢复；关闭 Sidebar 不丢任务；crash 后不会重复 mutation；Agent bundle 不阻塞应用首屏。

### Phase C：专业数据库 AI（P1）

1. Explain Plan artifact、热点导航和 AI plan explanation。
2. schema snapshot/diff/migration plan 与安全验证。
3. result analysis、data compare、导入映射和报告 artifact。
4. session/lock/slow-query 诊断工具。
5. project memory、skill 管理和黄金任务评测。

### Phase D：平台化（P2）

1. 第三方 provider/skill 的签名、版本、权限和隔离。
2. Agent trace 导出、脱敏 replay、质量 dashboard。
3. 可选受限代码执行 sandbox；默认关闭，禁止直接访问凭据和网络。

## 10. 发布门禁

- `npm run build`、前端 AI contract tests、Rust tests、`cargo fmt --check`、`cargo clippy -- -D warnings` 通过。
- 每个新 AI tool 有 schema、risk、timeout、abort、result limit、policy 和失败测试。
- 每个 UI action 有稳定 target、stale context、not found、同名对象和项目切换测试。
- 写操作有 preview/approval/backend enforcement；批准 replay 测试必须失败。
- Agent runtime/provider 未配置或初始化失败时，应用主界面仍可进入并正常查询。
- LSP completion 有作用域、歧义、排序和跨 database 隔离测试。
- 发布说明明确哪些是自动执行、哪些需要批准、哪些仍是实验能力。

## 11. 官方能力参考

- [Deep Agents TypeScript overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Deep Agents customization](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [Deep Agents human-in-the-loop](https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop)
- [Deep Agents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- [Deep Agents permissions](https://docs.langchain.com/oss/javascript/deepagents/permissions)
- [DataGrip AI for databases](https://www.jetbrains.com/help/ai-assistant/use-ai-with-databases.html)
- [DataGrip AI chat modes and attachments](https://www.jetbrains.com/help/ai-assistant/chat-mode.html)
- [DataGrip AI problem fixing](https://www.jetbrains.com/help/ai-assistant/find-and-fix-problems-with-ai.html)
- [DataGrip code completion](https://www.jetbrains.com/help/datagrip/auto-completing-code.html)
- [DataGrip data editor](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html)
- [DataGrip schema comparison and migration](https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html)
- [DataGrip diagrams](https://www.jetbrains.com/help/datagrip/creating-diagrams.html)
- [DataGrip data handling in AI Assistant](https://www.jetbrains.com/help/ai-assistant/how-we-handle-your-code-and-data.html)
