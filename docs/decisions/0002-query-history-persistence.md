# ADR-0002：Query History 使用项目级 SQLite 执行日志

- 状态：已接受并实现
- 日期：2026-07-13
- 关联工作项：DG-P0-02

## 背景

旧实现只在查询成功且执行整页 SQL 时，把 `sql + timestamp` 写入 localStorage；相同 SQL 会被去重。这无法回答“哪一个数据源失败了、用了多久、影响多少行、能否按原上下文重跑”等专业排错问题。localStorage 还缺少事务、索引、项目隔离和可控的容量管理。

## 决策

Query History 是执行日志而不是收藏夹，使用 `MetaStore` 中独立的 `query_history` SQLite 表：

- 每次 console、选中 statement 和参数化执行都产生一条记录，不按 SQL 去重。
- 记录 project、connection、driver、database、schema、status、duration、row count、error、execution mode 和开始/结束时间。
- status 为 `success / error / cancelled`，避免 UI 解析展示文本来判断状态。
- connection 名称与 driver 作为快照保存；数据源被删除后历史仍能解释原执行上下文，因此不对 connection 建外键。
- project 删除时显式清理历史；每个 project 最多保留最近 500 条。
- 建立 project+time、project+status、project+connection 三组索引。
- 查询结果完成后先更新内存视图，再异步写 SQLite；持久化失败不阻塞结果展示，但在历史 UI 中显示可操作错误。
- 旧 `query-history` localStorage 数据在首次加载时批量迁移，成功后删除旧键。

## UI 与性能边界

- 500 条以内的过滤在前端纯内存完成，输入使用 `useDeferredValue`。
- DOM 每次最多渲染 60 条，通过“Show more”有界扩展。
- 列表可按 SQL/错误文本搜索，并按 status、data source 筛选。
- 单条删除和全部清空采用乐观更新；SQLite 失败时恢复原列表。

如果未来需要跨数万条历史进行长期审计，应增加按时间分页的后端查询和归档策略，而不是提高前端常驻上限。

## 安全重跑

- “Run again”优先使用记录中的 data source、database 和 schema。
- 原数据源不存在时不静默切换 driver，要求用户打开 SQL 后明确选择新数据源。
- 未连接的数据源走正常激活/连接流程。
- destructive SQL 继续执行现有确认策略，历史重跑不能绕过安全门。
- 重跑本身会产生新的历史记录，保留真实事件序列。

## 不采用的方案

- **继续扩展 localStorage**：没有索引、事务和项目级容量治理，长 SQL 会扩大同步序列化成本。
- **把历史放入 `resources` 表**：执行日志与元数据缓存生命周期、索引方式不同，混用会污染资源模型。
- **同步等待历史写入后再展示查询结果**：本地审计故障不应增加数据库查询主路径延迟。
