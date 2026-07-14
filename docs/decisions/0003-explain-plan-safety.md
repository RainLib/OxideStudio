# ADR-0003：Explain Plan 安全执行与规范化 Artifact

- 状态：Accepted
- 日期：2026-07-15
- 关联：DG-P0-04、DG-P0-09

## 背景

执行计划同时跨越 SQL 安全、driver 差异、长查询取消、UI 可视化和 AI 页面跳转。若由前端直接给 SQL 加 `EXPLAIN`，调用方可以绕过源语句检查；若 UI 直接依赖 PostgreSQL JSON 或 MySQL TREE 文本，后续 driver 扩展和 attachment 导航会变得脆弱。`EXPLAIN ANALYZE` 还会真实执行源查询，不能与 estimate 共用无提示入口。

## 决策

1. 前端只传原始单条查询、connection/database/schema、query id 和 `estimate | analyze`；driver-specific EXPLAIN 只能由 Rust 生成。
2. Rust 在拼接前复用 dialect-aware scanner 与只读校验，拒绝多语句、mutation、transaction/locking/external-write 语法、危险函数和已有 `EXPLAIN`。
3. Explain 沿用正式查询的 database/schema 路由、query id、取消机制和只读事务。数据库权限与 read-only transaction 是最终防线，前端确认不是安全边界。
4. Estimate 永不执行源查询；Analyze 会执行源查询，编辑器必须显示确认。AI `query.explain` 永远固定为 estimate，Agent 无权静默升级为 Analyze。
5. PostgreSQL 使用 JSON；MySQL estimate 使用 JSON，Analyze 使用 TREE text。后端同时返回原始计划和 provider-neutral 节点树，UI/AI 使用规范树，Raw 视图用于诊断和能力保真。
6. Artifact identity 为 `planId`，节点 identity 在单个 artifact 内稳定。页面动作必须携带 `tabId + planId + nodeId` 并拒绝 stale plan，禁止 selector 或仅按节点标题匹配。

## 规范模型

计划节点的共同字段包括 node type、relation/alias、access/join type、index、condition、cost、estimated rows、actual time/rows、loops 与 children。未由 driver 提供的字段保持 `null`，不能用 `0` 伪装已知数据。顶层保留 planning/execution time、generated duration、warnings 与 raw plan。

## 性能边界

- Tree UI 使用扁平化可见节点列表，折叠节点时不渲染其子树；后续超大计划可直接接入虚拟列表。
- 计划不会替换已有结果集，用户可在 Results/Explain Plan 间切换。
- 所有执行均有 query id，复用后端取消；计划解析只遍历返回的计划结构，不查询额外 metadata。
- Raw plan 原样保留但不进入错误 context、日志或默认 AI prompt；只有显式工具结果才按现有结果限制提供给模型。

## 后果与后续

该方案让 PostgreSQL/MySQL 共用一套稳定 UI 和 AI action，也把 Analyze 风险固定在后端与交互协议中。代价是新增 driver 必须实现 EXPLAIN 生成、解析和 capability 契约测试。后续 P1 可以在规范树上增加热点评分、节点到表/索引的双向导航、计划对比和 plan-grounded 优化，无需改动底层安全协议。
