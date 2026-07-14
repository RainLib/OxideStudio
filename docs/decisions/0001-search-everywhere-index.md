# ADR-0001：Search Everywhere 分层索引

- 状态：已接受，第一阶段已实现
- 日期：2026-07-13
- 关联工作项：DG-P0-01

## 背景

Search Everywhere 需要统一发现 action、编辑器 Tab、数据源、数据库对象和项目文件。直接在每次按键时 introspect 所有数据库、递归读取整个项目目录，或者把全部候选项渲染到 DOM，会同时放大网络延迟、数据库负载、内存占用和 WebView 卡顿。

OxideStudio 已经有两类数据源：

1. React/Zustand 中已经加载的会话状态，适合即时、零 I/O 搜索。
2. Rust `MetaStore` 的持久化资源缓存和受控的项目文件边界，适合后续跨连接、跨 schema 的全局索引。

## 决策

采用两阶段分层索引，不在 React 中建立全量数据库/文件系统扫描器。

### 第一阶段：会话内即时索引

- 只索引当前已加载的 action、Tab、数据源、schema/table 和 Project Files 树节点。
- 打开面板不发起数据库、文件系统或 Tauri IPC 请求。
- 候选索引仅在相应 Zustand slice 变化时重建；输入通过 React `useDeferredValue` 延后低优先级排序。
- 使用本地确定性排序：exact、prefix、phrase、缩写、token 顺序；当前规模不引入 fuzzy-search 依赖。
- 空查询每组最多展示 12 项；有查询时 action 最多 30 项，其余每组最多 40 项。`cmdk` 只承担键盘选择与可访问性，过滤和边界由领域函数统一控制。
- 选择数据源必须调用连接激活流程，不能只打开属性编辑状态。

### 第二阶段：持久化全局索引

- Rust command 查询 `MetaStore.resources`，按 project/connection/kind/scope 做有界检索；不要求先连接全部数据源。
- 项目文件由 Rust 在目录变更、显式 refresh 或文件监听事件后增量更新路径索引，不在每次查询时递归扫描。
- IPC 请求携带 query generation 或 cancellation token，丢弃过期结果；分页返回并设置硬上限。
- 先用现有 SQLite 组合索引与前缀匹配做基准测试。只有数据规模和检索质量证明不足时再启用 FTS5；不预先引入 trigram/fuzzy 数据结构。
- 远程元数据刷新与搜索解耦：搜索可标注 cached/stale，但不会为了补全结果自动访问数据库。

## 性能预算

- 面板打开：零 I/O，候选 DOM 保持有界。
- 会话内按键：只执行纯内存匹配，排序在 deferred render 中完成。
- 全局搜索：单次 IPC 有 deadline、limit 和 stale-result 丢弃机制。
- 任何数据库 introspection 继续由显式展开或 refresh 触发，不由搜索输入触发。

预算需要在真实大项目上测量；若 10,000 个已加载候选的输入延迟超过 16 ms，应把排序迁移到 Web Worker 或 Rust。当前阶段不提前支付跨线程序列化成本。

## 结果与取舍

优点：首次打开快、不会惊扰数据库、实现与现有缓存一致，并为全局索引保留清晰边界。取舍是第一阶段只能搜索已经加载的对象和文件；未加载内容要等待第二阶段的 MetaStore/文件索引。

## 不采用的方案

- **每次搜索实时 introspection**：延迟和负载不可控，也会泄漏“输入即访问数据库”的副作用。
- **前端递归扫描项目目录**：绕过 Rust 文件安全边界，并会阻塞 WebView。
- **立即引入通用 fuzzy 库**：增加包体和排序不可解释性，尚无数据证明当前匹配不足。
