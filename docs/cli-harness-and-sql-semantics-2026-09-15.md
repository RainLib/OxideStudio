# CLI harness 修复与 SQL 语义模块化审查

## 1. 审查基线

- OxideStudio：本工作区；SQL 服务端是独立 Git 子模块 `vendor/sql-lsp`。
- DBX：只读获取 `t8y2/dbx`，提交 `8e7d4c387f0bff0b237112028cdb697078eacc44`。本机没有旧文档中的 `sources/dbx`，不沿用旧文档的完成状态作为证据。
- Codex：本机 `codex-cli 0.153.4`；协议字段核对本机 `app-server generate-json-schema --experimental` 和 [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。
- DBX 本节比较的是编辑器 SQL **语义层**，不是假设 DBX 与 Oxide 使用相同的 LSP wire 服务。参考 [semantic 模块说明](https://github.com/t8y2/dbx/blob/8e7d4c387f0bff0b237112028cdb697078eacc44/apps/desktop/src/lib/sql/semantic/README.md)。

## 2. CLI 故障证据和修复

### 可复现原因

本机 Codex 位于 `~/.nvm/versions/node/v22.17.1/bin/codex`。用 GUI 常见的精简 PATH 启动：

```sh
env PATH=/usr/bin:/bin "$HOME/.nvm/versions/node/v22.17.1/bin/codex" --version
```

返回 `env: node: No such file or directory`。原先的 Unix 查找仅覆盖 PATH、Homebrew 和 `~/.local/bin`，存在两层故障：找不到 npm 全局 CLI；填写绝对路径后，CLI 的 `#!/usr/bin/env node` 仍找不到 Node。模型发现、登录和实际 turn 又分别构造 Command，容易出现“检测成功、运行失败”。

### 新的模块边界

| 模块 | 负责的事实 | 不应持有的状态 |
| --- | --- | --- |
| `ai_cli/executable.rs` | 配置路径校验、路径发现、Windows shim、Node 运行环境、绝对路径 | 登录账号、数据库凭据、会话消息 |
| `ai_cli/codex_protocol.rs` | 初始化/thread/turn JSON-RPC、参数和 server request 响应 | 进程句柄、窗口状态、数据库授权 |
| `ai_cli/runtime.rs` | 进程 I/O、有界输出、超时、取消 | provider 模型目录策略 |
| `ai_cli/codex.rs` / `codebuddy.rs` | provider 能力发现、认证验证、协议方言 | 桌面数据库写授权 |
| `agent/bridge.rs` / tool broker | 每次 turn 的私有端点、令牌、冻结目标、审批租约 | provider 自称的授权 |

修复包含：

1. Unix 发现 nvm 版本目录、`NVM_DIR`、Volta、asdf 和 npm-global 的常见目录；继承 PATH 仍先用于选择 CLI。
2. 所有 provider 启动共用 `CliCommandSpec::command()`：把所选 CLI 的目录置于子进程 PATH 前端，补充常见工具目录，不执行用户 shell 初始化脚本，不修改系统 PATH。
3. 自定义相对路径在切换隔离 cwd 前转成绝对路径。Unix 发现跳过无执行权限的文件。
4. JSON-RPC 按 `method` 区分 provider 发起的 request 与客户端 response；支持字符串 ID，避免 provider 使用 ID 1/2/3 时误触发初始化或 turn 状态迁移。文件/命令审批仍返回拒绝；未实现的交互返回 `-32601`，不再悬挂等待。
5. 继续保持现有 public MCP 只读、private bridge 审批和令牌边界。

实际验证已确认本机登录有效，修复后的精简 PATH 能完成 `initialize`、`model/list`（5 个模型）和隔离临时目录的 ephemeral `thread/start`。这不能替代带数据库工具的完整生成/审批/取消验证。

## 3. WITH 与子查询的具体缺陷

原局部关系分析截断为 `text[..cursor]`。因此下面同一条 SQL 在 WHERE 末尾可能能补全，移到 SELECT 列表就失败：

```sql
SELECT sq.| FROM (SELECT id, name AS display_name FROM users) sq;
```

同一个分析器还存在以下不一致：

- Parser 能识别 `AS MATERIALIZED`，但局部 schema 推断器只接受 `AS (`。
- 后一个 CTE 使用 `SELECT * FROM 前一个CTE` 时，推断仍使用物理 schema，丢失前一个 CTE 的输出。
- 整篇前缀扫描会让上一条语句、已结束的嵌套 WITH 污染当前语句。
- 未绑定物理 schema 时，局部推断根本不会运行，即使 `SELECT 1 AS id` 已能确定字段名。

本轮将约 800 行局部关系及扫描函数从 `server.rs` 提取到 `server/local_relations.rs`：保留 UTF-8 字节位置和行号，扫描当前语句的完整文本，按光标所在括号作用域筛选，复用 parser 语句起点规则。CTE 依次扩展可用列，接受 `MATERIALIZED` / `NOT MATERIALIZED`；有显式列名的 recursive CTE 在尚未闭合的自身查询体内也可补全。后续 CTE 和非递归自身不会提前进入当前查询体。补全上下文不再把 CTE 内的 FROM 误用于外层 SELECT；语句终点也复用软分隔规则，避免无分号的后续查询串入。限定星号 `a.*` 只展开该 source 的非隐藏字段。派生表使用已解析的 CTE 字段，保持来源 query URI 和行号。

无物理 metadata 时使用只含文档内局部表的临时形状，不写入 schema manager，不伪报 catalog 已同步。

## 4. 逐项对照 DBX

以下 DBX 路径均相对固定提交的 `apps/desktop/src/lib/sql/`，结论来自源码和测试形状，未进行 DBX 产品端运行验收。

| 能力 | DBX 证据 | Oxide 本轮后状态 | 尚缺/下一步 |
| --- | --- | --- | --- |
| 分层语义模型 | `semantic/{tokens,dialect,model,completion,references,diagnostics,types}.ts` | 已拆出局部关系分析；保留独立 LSP transport | 未形成各功能共用的带 revision 的完整 QueryScopeGraph |
| 普通 WITH、显式列名 | `model.ts:parseCteSources` | 已有基础支持，增加作用域隔离回归 | 精确引用图和大小写/引号策略仍需统一 |
| MATERIALIZED / NOT MATERIALIZED | DBX 当前 `parseCteSources` 在 AS 后直接要求 `(` | 本轮补齐局部形状推断 | 这是两边都需核对的边缘语法，不应称为照搬 DBX |
| CTE 串联与星号继承 | `parseCteSources` 从 projection 提取输出名 | 本轮按前序 CTE schema 传播字段 | 复杂表达式、递归类型固定点推导未实现 |
| WITH RECURSIVE 编辑中补全 | `parseCteSources` 跳过 RECURSIVE 标记 | 显式列名在未闭合体内可用；首个 UNION 分支决定输出名 | SEARCH/CYCLE 自动生成列、相互递归和方言合法性未完整建模 |
| 派生表前向解析 | `parseSubquerySource`、`sourceSpan` | 修复光标在 SELECT、FROM 在后面的字段发现 | 多层嵌套 projection lineage 仍需独立推断器 |
| 子查询来源地址 | `references.ts`、`sourceSpan/aliasSpan` | LSP 使用当前 query URI + 定义行 | 列级精确 range、表达式来源链、跨层跳转需要统一 symbol 图 |
| 嵌套 WITH、同名遮蔽 | `SqlSemanticScope`、row source scopes | 本轮覆盖内层遮蔽和闭合子查询不泄露 | 引号敏感名不能一直用大小写无关的字符串去重 |
| 相关子查询、LATERAL/APPLY | `isPostgresLateralSource`、`parseRowSource` | parser 已有外层限定 alias 和 LATERAL/APPLY | 需证明非 LATERAL 派生表不得捕获外层、LATERAL 仅可见左侧 source 的完整规则 |
| 括号包裹 JOIN group | `parseRowSourceList` 区分透明 group 与独立 query | parser 的括号屏蔽仍较粗 | 高优先级：透明 JOIN group 与 SELECT 子查询需要不同 scope 类型 |
| Doris LATERAL VIEW [OUTER] | `parseDorisLateralView` | 没有同等独立 row-source 解析器 | 高优先级：函数展开列及 alias AS col，按 Doris/Hive/Spark 分别测试 |
| 函数表、相关列重命名、WITH ORDINALITY | `parseTableFunctionSource`、`correlationColumnsAfter` | 已有相关列列表、table function 目录和 ordinality alias 识别 | 无显式列名时的返回表结构、ordinality 合成列仍需逐函数补充 |
| projection alias 可见性 | `dialect.ts:projectionAliasVisibility` | 方言实现与 parser 中已有多处规则 | 抽出统一策略：Postgres ORDER BY、MySQL GROUP BY/HAVING 等，不应靠关键字集合混用 |
| schema/catalog/package qualifier | `dialect.ts:qualifierRole` | 已有多 catalog schema、Oracle routine/package 分支 | 将局部 relation 命名解析与物理 metadata resolver 分开；添加同名对象矩阵 |
| confidence/fallback | `types.ts:SqlSemanticCursorIntent` | completionContext 与客户端 fallback 已有入口 | 需统一“完整/局部/不确定”原因与 metadata 完整性，防止未知列误报 |
| completion/diagnostics/navigation 共用解析结果 | `references.ts`、`diagnostics.ts` | LSP 已有这三种能力，但各自还存在扫描副本 | 按 URI+revision+dialect+metadataRevision 缓存只读语义快照 |
| 格式化、签名、inlay、rename、跨文件索引 | 对照 `sqlFormatter`、`insertValueHints`、`sqlNavigation` 等 | Oxide 已有 LSP 实现与受限项目虚拟文档 | 不是功能从零缺失；重点是作用域一致性、范围正确性和大型文档成本 |

### 明确不等同于完成支持

补全出一个关键字不代表能正确推断其字段。`WITH` 关键字、CTE 名称、CTE 输出列、递归绑定、字段源定位、rename 引用集合是不同验证层。物理数据库的方言接受能力也不由本地解析测试证明。

## 5. 后续模块化顺序与验收

1. **Query scopes**：span-preserving tokens → statement boundaries → scopes → row sources。结构包含稳定 symbol ID、parent scope、定义/可见 range、source kind；区分 SELECT 子查询、透明 join group、CTE body、LATERAL 与 set operation 分支。
2. **Projection inference**：独立处理显式列列表、星号/限定星号、表达式 alias、UNION 首分支、表函数返回列；未知类型明确保留 unknown，禁止借用无关物理同名列。
3. **Metadata resolution**：只解析物理对象；局部 CTE 或派生表已占用的名称不能回退请求同名远端表。metadata revision 改变使语义缓存失效。
4. **LSP feature adapters**：completion、hover、definition、references、rename、diagnostics 只读同一快照；transport 负责文档生命周期、同步与取消。
5. **编辑器层**：Monaco adapter、document sync、fallback、导航映射保持 feature 内模块。fallback 只补当前确定的语法/本地字段，不另建一套完整语义引擎。
6. **验收矩阵**：方言 × 光标位置（SELECT/WHERE/CTE body）× 未闭合文本 × metadata 缺失/完整 × Unicode/引号 × 相同名字/嵌套 × 多条 SQL。每个修复至少覆盖错误结果不能出现的负向断言。

以上是渐进设计顺序；本轮没有宣称整个应用已完成重构，也没有一次性改写所有方言。

## 6. 验证记录

| 验证 | 结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib ai_cli --quiet` | 36 项通过，包含精简 GUI PATH、隔离 cwd、JSON-RPC request ID、超时与取消 |
| `cargo test --manifest-path vendor/sql-lsp/Cargo.toml --quiet` | 25 组、317 项通过，包含真实 stdio LSP completion/definition 请求 |
| `npm test -- --maxWorkers=1 tests/frontend/lsp-client.test.ts tests/frontend/lsp-navigation.test.ts tests/frontend/query-editor-lsp-monaco-adapter.test.ts tests/frontend/ai-cli-capability-service.test.ts tests/frontend/ai-cli-catalog-cache.test.tsx tests/frontend/sql-statement-scope-conformance.test.ts` | 6 文件、28 项通过 |
| `npm run build` | TypeScript、Vite、启动 bundle 验证通过；现有第三方注解/chunk 大小提示仍存在 |
| 本机 Codex 0.153.4，精简 PATH + 隔离 cwd | login status、initialize、model/list、ephemeral thread/start 通过 |

真实 CLI 测试不读取或导出登录令牌；CodeBuddy 未安装，无法声称完成其真实账号验收。Windows/Linux 启动、打包应用、数据库工具调用和完整 provider turn 必须单独验证。

修改包含 SQL LSP 子模块的源码；本轮不提交生成二进制。通过 `npm run tauri dev` 或 `npm run tauri build` 启动的构建流程会重新准备 LSP，已在运行的桌面进程不会自动获得这些 Rust 修改。

## 7. 编辑器 AI 灰字补全修复

编辑器 Inline Completion 使用单独的 HTTP provider 和 `inline` 凭据作用域。侧栏 CLI 登录成功不代表已经配置编辑器补全；在 Settings → AI Assistant → Inline Completion 中设置 URL、API Key、协议、模型，并开启补全。默认快捷键为 `Alt+\` 触发、`Tab` 接受；普通补全菜单打开时，Tab 优先处理菜单候选。

本次修复的阻断点：

- LSP 未就绪时不再直接跳过 AI；语义上下文和返回结果校验各最多等待 600 ms。不可用时使用文本上下文，不宣称已通过语义校验。
- 普通补全菜单打开时，按照 Monaco 的候选替换范围提供兼容的 AI 延续；不再一律返回空结果。与当前菜单候选冲突的建议仍不显示。
- 完整引号字符串后的 SQL 可继续触发补全；使用公共 SQL scanner 识别未闭合字符串、转义引号、dollar quotes 和注释。
- Rust 请求超时遵守设置中的 1–15 秒，默认仍为 4 秒。
- 修正设置页 assistant/inline 凭据存在状态读反的问题；编辑器响应 URL、API Key、超时变更，缓存按 endpoint 隔离。
- 丢弃旧版本或旧请求结果，释放取消监听；状态区分 ready、unconfigured、thinking 和 error，失败提示指向 Inline Completion 设置。

LSP 等待和 Monaco 插入范围逻辑抽到 `src/features/query-editor/model/inlineCompletionRuntime.ts`，便于脱离大型编辑器组件验证。前端回归覆盖不可用/失败/超时 LSP、菜单替换范围、引用 SQL、缓存隔离和凭据作用域，同时保留 Elasticsearch 的确定性补全限制。

这里的回归测试不等于真实账号的桌面端端到端验证；实际模型可用性仍取决于 Inline Completion 的独立服务配置。

验证结果：8 个前端测试文件共 74 项通过；`cargo test --manifest-path src-tauri/Cargo.toml --lib inline_completion_ --quiet` 的 2 项通过；`npm run build` 和启动 bundle 检查通过。Vite 仍有第三方 PURE 注解和 chunk 大小提示。
