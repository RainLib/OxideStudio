# DBX MongoDB / Elasticsearch 编辑器对齐审计

审计基线：OxideStudio `feature/dbx-lsp`（2026-08-20 工作树）与
`sources/dbx` `c030835ac`。这里的“LSP”包含编辑器语言服务、语义补全、
元数据缓存与请求上下文；MongoDB 和 Elasticsearch 并不适合仅用 SQL LSP
描述。

## 已落地的高优先级对齐

| 能力 | DBX 位置 | 旧 Oxide 差距 | 本次处理 |
| --- | --- | --- | --- |
| Mongo 命令上下文 | `apps/desktop/src/lib/mongo/mongoCompletion.ts:184-325` | 只有建议触发分类，没有 Mongo 候选；`vendor/sql-lsp` 明确把 Mongo 视为非 SQL，返回空 builtins | 新增 `src/lib/mongodbCompletion.ts` 的容错 JSON 上下文与候选构建器；根命令、集合、采样字段、查询/更新操作符和聚合 stage 都有独立候选 |
| Mongo 元数据按需加载 | `QueryEditor.vue:3389-3438`；`connectionStore.ts:7047-7071` | 集合/字段没有绑定到 Monaco provider | `QueryEditor.tsx` 为仅 Mongo 文档注册 JSON provider；集合从 Explorer 共享状态或只读 `getCollections` 加载，字段复用 `loadTableMetadata`，并以连接/命名空间/集合作为缓存边界 |
| Mongo 执行语法安全 | DBX 是 shell (`db.collection.find`) | Oxide native 驱动只接受 JSON，不能直接复制 DBX shell 补全 | 模板严格生成 Rust 执行器接受的 `{ "find": "…", "filter": {} }`、`aggregate/pipeline`、CRUD JSON，拒绝引入无法执行的 `db.*` 语法 |
| Mongo provider 职责 | DBX 的 Mongo completion 不经 SQL language service | 通用 provider 会为 Mongo 发出一个没有 builtin 的 SQL-LSP 请求 | Mongo 文档由 JSON Console provider 独占；通用 LSP provider 立即返回，减少每次自动建议的一次 IPC 往返 |
| Elasticsearch 索引目录 | `QueryEditor.vue:3332`；`connectionStore.ts:6974` | 本地 Console 擅长 DSL，但路径索引主要依赖 LSP 目录；LSP 离线或迟到时没有稳定的 Explorer 元数据回退 | Elasticsearch Console provider 在 path 上通过 `getCollections` 读取 index 名称；index 与 mapping 都使用连接/命名空间 single-flight 缓存，并保留同一文档版本/取消保护 |
| ES provider 职责收口 | DBX Console provider 自己拥有 method/path/json | 通用 LSP provider 仍可能同时返回 ES path 条目，易与 live metadata 混入或重复 | Console provider 统一拥有 ES method、path、DSL、index、mapping-field 位置；LSP 仅作为该 provider 内的失败回退 |
| 文档目录缓存生命周期 | `connectionStore.ts` 按 connection 保存 completion metadata | Mongo collection、ES index 与 mapping 的 single-flight 过去仅存在于一个 `QueryEditor` 实例，切换标签会重新探测 | 新增 `documentMetadataCache`：连接/driver/namespace/object 精确分区、跨标签共享、2 分钟 TTL、过期时 stale-while-revalidate、失败保留短期 last-known 目录、256 项 LRU 上限；metadata revision 时按连接/driver 主动失效 |

## 保持而不倒迁的 Oxide 能力

Oxide 的 `src/lib/elasticsearchConsole.ts` 已超过 DBX 的轻量 Console：

- Elasticsearch 6/7/8 端点和 Query DSL version gate；
- 多请求解析、注释遮罩、当前请求定位、格式化、变量和 deterministic Smart Tab；
- mapping field 按当前 request index 加载并阻止跨 index 泄漏。

因此本阶段不以 DBX 的简化 Elasticsearch 规则替换 Oxide，而是迁移它的
“目录缓存 + 按需元数据 + provider 单一职责”设计。

## 仍有差距与后续顺序

1. **Mongo JSON 上下文深度（P1）**：DBX 已覆盖 `$lookup`、`$graphLookup`、
   accumulator、expression、field reference 和 stage option。Oxide 当前先覆盖
   native driver 可直接执行的常见 CRUD/filter/update/pipeline；下一阶段扩展
   这些高级 aggregate 位置，但仍输出 JSON。
2. **Mongo 字段类型推断（P1）**：Oxide 复用 driver 的 20-document sampling
   metadata；应补充嵌套 dotted-path 与多类型提示的专用测试。DBX 的对应实现是
   `inferMongoCompletionFields`（`mongoCompletion.ts:346`）。
3. **ES mapping 与 aliases/data streams（P1）**：索引候选当前来自 collection
   API；后续需以驱动能力明确标注 alias/data stream，而不能把它们一律当普通
   index。
4. **元数据刷新体验（P1）**：共享 cache 已有 TTL、single-flight 和有界淘汰；下一步是
   在 Explorer refresh 后主动重新触发当前 Monaco completion，而非等待用户下一次输入。

## 延后真实环境验证

本阶段没有连接真实数据库。实现完成后统一执行：

- MongoDB 4.4、5、6、7：严格 JSON command、数组批量 command、采样字段、
  nested path、读写命令的执行确认；
- Elasticsearch 6.8、7.10/7.13、8.x：版本 gated endpoint/DSL、index/alias、
  mapping field、无权限 metadata 和断线重连；
- 多连接、多标签并发：确认 Mongo collection / ES index / mapping 不跨连接或
  namespace 泄漏，取消后没有后台 metadata 请求影响新文档。
