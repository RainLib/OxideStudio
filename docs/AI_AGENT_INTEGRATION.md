# AI Agent Integration Design

> 当前基线：2026-07-15。产品能力、页面动作、安全状态机、DataGrip 对比和
> LSP 相关性要求见 [AI_AGENT_PRODUCT_SPEC.md](AI_AGENT_PRODUCT_SPEC.md)。运行时边界的
> 决策依据见 [ADR-0012](decisions/0012-deep-agents-desktop-runtime-boundary.md)。

## 1. 目标与边界

OxideStudio 需要让 Chat、Plan、Agent 使用同一套上下文、模型、工具和持久化语义，同时不把数据库凭据、driver handle、文件系统或进程权限交给模型运行时。

核心原则：

- React 只投影 Turn、过程、澄清、批准和最终回答，不拥有 tool loop、重试或恢复语义。
- TypeScript Deep Agents 负责编排、上下文治理、todo、只读子代理和中断。
- Rust 是数据库、模型、凭据、工具策略、批准、持久化和 sidecar 生命周期的唯一可信边界。
- 页面动作使用稳定语义 target，不允许模型操作 DOM selector。
- 应用内助手不通过 MCP 反向调用自己；MCP/CLI 只服务外部客户端。

## 2. 当前生产架构

```text
React turn UI
   ↕ Tauri commands + events
Rust AgentHostManager / model gateway / tool policy / encrypted store
   ↕ JSON-RPC 2.0 + Content-Length framing over stdio
signed Node 22 TypeScript sidecar
   └─ deepagents@1.10.8 via deepagents/node
```

生产环境的 Chat、Plan、Agent 已统一进入该 host。旧 `AssistantRuntime`、planner 和前端 MCP/CLI 代码仍作为迁移期兼容与契约测试资产存在，但生产 UI 不会静默降级到它们；开发时只有显式设置 `VITE_ASSISTANT_LEGACY_RUNTIME=1` 才启用旧 UI。

不采用以下方案：

- Python、PyTauri 或 Python sidecar；
- 把 `deepagents/browser` 打入 WebView；
- 给 WebView `shell:allow-spawn`、任意文件或进程权限；
- 让 sidecar 持有 provider/database secret 或直接连接数据库。

## 3. 工程与协议

### 3.1 TypeScript 工作区

- `agent-contract/`：Zod 定义的共享协议、tool manifest、workspace、provider capability 和 event schema。
- `agent-host/`：Deep Agents runtime、Rust 模型代理、动态工具代理、澄清/批准等待和 JSON-RPC peer。
- `src/services/tauri/agent-host.service.ts`：WebView 仅可见的 Tauri command/event 适配。
- `src/hooks/useAssistantAgentSession.ts`：把事件归并为稳定 Turn view model，不执行 agent 决策。

sidecar 固定 Node 22 与 `deepagents@1.10.8`。构建先经 esbuild，再由固定版本 `@yao-pkg/pkg` 生成目标平台自包含可执行文件。stdout 只承载协议帧；诊断写入经过脱敏的 stderr。

### 3.2 Rust 工作区

- `src-tauri/src/agent/host.rs`：启动、握手、帧限制、deadline、cancel、健康状态、一次 transport restart、事件转发和 tool/model/checkpoint 请求处理。
- `src-tauri/src/agent/model.rs`：OpenAI-compatible complete/stream 请求、usage/tool-call 归一化、超时、取消和响应大小限制。
- `src-tauri/src/agent/store.rs`：项目级 thread/checkpoint/artifact 与 LangGraph checkpoint/pending writes 加密存储。
- `src-tauri/src/agent/protocol.rs` 与 `src-tauri/src/commands/agent.rs`：Rust 侧契约和最小 Tauri command surface。

`AgentHostManager` 在 Tauri setup 时只创建无副作用状态。没有配置 provider 时不启动 sidecar；首次 AI 请求时懒启动。sidecar 缺失、协议不兼容、签名/打包错误或崩溃只会让 Assistant 进入 unavailable，不得阻塞应用主界面和数据库工作台。

WebView 只能调用：

- `agent_start_turn`
- `agent_resume_turn`
- `agent_cancel_turn`
- `agent_answer_clarification`
- `agent_approve_action`
- `agent_get_status`

### 3.3 JSON-RPC 契约

协议使用 JSON-RPC 2.0 与 LSP 风格 `Content-Length` framing，版本为 1，单帧上限 4 MiB。每个 Turn 相关请求都携带：

```text
requestId / threadId / turnId / contextVersion / deadline
```

host 到 sidecar 的主要方法为 initialize、openThread、start/resume/cancel turn、answerClarification 和 resolveApproval；sidecar 回调 Rust 的主要方法为 model complete/stream、tool invoke、graph checkpoint get/list/put/putWrites/deleteThread、兼容层 checkpoint load/save、artifact read 和 agent event。

握手校验协议版本、最大帧和必需 capability。未知可选字段向前兼容，缺少必需 capability 则拒绝启动该 runtime。

## 4. Deep Agents profiles

### Chat

- 由 Deep Agents 管理历史、长问题预处理、上下文压缩、澄清和最终回答。
- 不提供数据库、todo、mutation 或子代理工具。
- 可以使用 `ask_user`。

### Plan

- 只接收 Rust manifest 中的只读 discovery、metadata、LSP、query review 和 estimated EXPLAIN 能力。
- 可生成 todo，使用 `schema_analyst`、`query_reviewer` 只读子代理。
- 不接收 write/destructive tool，因此不能依靠 prompt 误执行变更。

### Agent

- 接收 Rust 按项目、连接、provider capability 和 policy 过滤后的 manifest。
- 无依赖的只读工作可有界并行，mutation 在 sidecar 内串行。
- 可使用只读 `schema_analyst`、`query_reviewer`、`plan_verifier` 子代理；通用和异步子代理未启用。
- write/destructive 调用必须经过 sidecar approval interrupt、UI 用户决定、Rust 一次性 lease 和调用时的 Rust 二次复核。

不支持 tool calling 的 provider 只能用于 Chat；Plan/Agent 返回明确的 capability error。

## 5. 模型与凭据

sidecar 中的 `OxideChatModel` 是 LangChain model adapter，但不会持有 API key。它通过内部 RPC 请求 Rust `ModelGateway`：

- Rust 从应用用户配置目录的 credential file 读取 provider secret；设置页保存后会重新打开验证，Zustand/localStorage 和项目目录不持久化 key。
- Rust 校验 provider URL，执行 OpenAI-compatible SSE 或非流式请求。
- sidecar 只得到 text delta、tool calls、usage、finish reason 和结构化错误。
- provider descriptor 显式声明 streaming、tool calling、structured output、最大输入/输出 token。
- cancel/deadline 从 UI 一直传播到 sidecar、Rust HTTP 和数据库路径。

provider secret 与 agent store master key 均使用应用用户级 credential file：Provider 文件按 endpoint hash 命名，Agent Store 使用独立随机主密钥文件；Unix 权限为文件 `0600`/目录 `0700`，Windows 继承用户 profile ACL。两者都不会进入项目、前端存储或 sidecar 环境。若 agent store 主密钥文件不可用，当前实现退回进程内加密 session store，而不是把明文写入 SQLite；运行时不会访问 Keychain、Credential Manager 或 Secret Service。

## 6. 工具、连接和结果边界

### 6.1 Tool manifest

`src/ai/tools` 仍是应用能力定义的重要来源；`agent-contract` 提供可跨进程验证的 portable manifest。每个工具至少声明 name、description、JSON Schema、permissions、timeout 和 result limit。sidecar 动态生成 Deep Agents tools，真正执行统一回到 Rust。

Rust 在执行时重新验证：

- project、connection、database/schema/namespace；
- connection config revision 与 `contextVersion`；
- manifest tool name、permission 和 canonical input digest；
- SQL/native request risk、result limit 和 deadline；
- approval lease 的 thread/turn/call/tool/input hash/expiry，且 lease 只能消费一次。

sidecar 不接收数据库密码、SSH secret、connection URL 或 driver handle。大结果只通过有界 observation 返回 schema、统计、采样和 artifact reference；完整结果留在 Rust 项目级 artifact store。

### 6.2 自动连接

Rust 按项目解析连接目标，优先级为：

1. 工具显式 connection；
2. 当前 tab 绑定连接；
3. 当前活动连接；
4. 项目内唯一保存连接；
5. 多候选时请求用户选择。

只读 metadata/query 可对活动或唯一保存连接进行懒连接。连接/session 必须绑定项目和 config revision，防止项目切换或乱序连接串库。只读幂等调用断线后至多重连重放一次；mutation 不自动重放。

当前 Rust bridge 已覆盖连接发现、metadata、对象描述、只读查询/estimated EXPLAIN 等首批路径。更多 provider-specific tools 应逐个迁移并通过 Rust 契约测试；不能因为前端 registry 有定义就宣称 sidecar 已能执行。

## 7. 上下文、澄清和持久化

### 7.1 上下文治理

Deep Agents 使用 provider 的真实 token profile，而不是固定 170k fallback。当前 runtime 包含：

- 长问题按段落、SQL statement 和 Markdown 边界切块并生成 digest；
- Deep Agents summarization/offload 事件；
- LangGraph checkpoint/pending writes 以 typed blob 加密保存，兼容层摘要只保留有界消息；后续 Turn 只追加新 prompt，避免重复注入完整历史；
- 过滤 `lcSource === "summarization"` 的流，不把内部 summary 当成最终回答；
- tool observation 超限时存 artifact，IPC 只返回摘要和 reference。

仍需继续加固：在 UI 中完整展示实际/估算 token 与所有省略来源、提供 artifact 全文按 range/search 读取，以及 100+ Turn 的质量基准。不能把自动摘要描述为不会丢失任何语义的形式保证。

### 7.2 主动澄清

所有 profile 都可调用 `ask_user`。单次支持 1–3 个问题、每题 2–3 个选项和自由输入；最多连续两轮。等待时不执行新工具，回答后在同一 Turn 内继续。连接多选和安全歧义也可由 Rust 确定性触发，不依赖模型猜测。

澄清和批准已改为 LangGraph 原生 `interrupt()`，恢复使用同一 thread/turn 的 `Command({ resume })`。`OxideCheckpointSaver` 在每个 graph step 通过 Rust RPC 加密保存 checkpoint 与 pending writes，因此 sidecar 进程重启后仍可恢复等待中的 interrupt。完整应用进程重启后的 pending UI 重建仍属于发布前 hardening，不得把它与已验证的 sidecar-restart 恢复混为一谈。

### 7.3 加密 checkpoint

Rust 的 `agent_threads`、`agent_checkpoints`、`agent_artifacts`、`agent_graph_checkpoints`、`agent_graph_writes` 按项目存储：

- AES-256-GCM；每条记录独立 96-bit nonce；
- AAD 绑定 record kind、project、record id 和 version；
- 主密钥仅在 OS credential manager；
- 默认七天过期，在初始化和后续读写时清理；
- thread/checkpoint/artifact 使用本地私有主密钥写入独立 `agent-state-v2.db` 密文。

凭据、SSH secret、connection URL、可复用批准 token 和无界 raw rows 不得持久化。LangGraph typed blobs 由 sidecar serializer 生成，Rust 将其视为不透明密文 payload；AAD 绑定 project/thread/namespace/checkpoint/task/write index。批准 decision 可以进入 `Command({ resume })`，一次性 lease 只能作为 transient resume 参数存在于 Rust/sidecar 内存，sidecar 崩溃丢失 lease 后 mutation 必须 fail-closed。最终回答只在 Rust 接受本轮 checkpoint 后发出。

该语义提供 turn-boundary durability，不等于数据库 exactly-once。任何不确定 mutation 必须进入 verify，绝不自动重放。

旧 `assistant_tasks` 安全摘要/receipt 仍可用于迁移期 Task Center 历史，但不再是 Deep Agents 可执行 checkpoint；关系见 [ADR-0011](decisions/0011-agent-task-summary-persistence.md)。

## 8. Codex 式 Turn UI

一个 Turn 固定为：用户问题 → 执行过程 → coordinator 最终答案。

- tool、todo、subagent 和 compaction 映射为当前 Turn 的 compact process disclosure，不创建独立聊天消息。
- 成功过程默认收起；clarification、approval、failure、stale context 默认展开。
- 最终 coordinator 输出才是 Assistant 正文；artifact、patch 和导航 action 位于正文下方。
- minimap 以每个完整问答 Turn 生成一个中性灰 marker，中间 stage 不单独记录。
- minimap 仅在宽面板且真实溢出时显示；支持 hover/focus、键盘和 reduced motion。
- React reducer 根据 sidecar event 更新 view model，不在组件中实现 tool loop 或重试。

`UiActionRegistry` 与 database tool registry 继续分离。对象、文件、tab、editor range、result、Explain Plan、Schema Diff 和 revision-bound patch 都使用 stable target；项目、文档或 artifact 版本过期时必须拒绝，不降级为 DOM 查找。

## 9. 外部 MCP 与 CLI

外部入口的目标是 Rust 原生 `oxide-agent`：

```text
oxide-agent mcp stdio --project <id> [--connection <id>]
oxide-agent tools list
oxide-agent tools inspect <name>
oxide-agent tools call <name> --input @file
```

首个发布范围为 stdio/CLI 与只读工具：连接摘要、metadata、只读查询、estimated EXPLAIN 和 headless LSP。HTTP/OIDC、UI/editor tool 和外部 mutation 不在首版范围。Rust-native binary 已使用固定版本 `rmcp`/`clap` 接入 Cargo，并作为 target-specific Tauri `externalBin` 构建、验证和随包签名。

现存 TypeScript MCP/CLI adapter 继续承担契约测试和迁移参考，但不能接受调用者自报 `_meta.approved` 或 CLI `--approve`。调用者自批准始终无效。未来若开放外部写入，必须由运行中的 GUI 签发 60 秒、单次、绑定 tool input hash 与 project/connection grant 的 lease。

客户端配置、项目/连接 ID 查询、完整命令示例和故障排查见
[外部 AI 接入指南](EXTERNAL_AI_INTEGRATION.md)。

## 10. 发布与验证

发布矩阵：

- macOS arm64
- macOS x86_64
- Windows x86_64
- Linux x86_64

macOS 不再生成 universal bundle。每个平台独立构建/测试 sidecar 与 SQL LSP，先签 helper binaries，再签 Tauri app/installer，并发布 architecture-specific Aliyun OSS updater artifact。

最低门禁：

- `npm run build`、frontend tests；
- `agent-contract` schema/compatibility tests；
- `agent-host` RPC/model/tool/runtime tests；
- Rust unit/integration tests；
- `cargo fmt --check`；
- `cargo clippy --all-targets --all-features -- -D warnings`；
- 真实 production bundle 的 handshake、Chat stream、clarification/approval、read-only tool、cancel 和退出 smoke。

发布前剩余 hardening 需单独跟踪：crash 中断恢复、跨平台安装包 smoke、长期上下文质量、完整 provider tool bridge，以及 sidecar 内存/冷启动基准。
