# ADR-0014：Schema Diagram 快照 Artifact

## 状态

已接受，2026-07-26。

## 背景

Explorer 已能读取 column、primary key、index 和 foreign key metadata，Schema Snapshot 也已把这些信息绑定到稳定的 `project + connection + database + schema` 身份，但此前没有可浏览的关系图。直接从可变 Explorer 树或 DOM 生成图会导致远程 PostgreSQL database、缓存刷新和同名对象定位不稳定。

## 决策

1. Diagram 只消费完整 `SchemaSnapshot`，不读取 Explorer 展示树，也不自行查询数据库。
2. 每个 `connection + database + schema` 复用一个 `schema_diagram` artifact tab；再次打开会替换快照，并只在关系仍存在时保留选中项。
3. FK 采用 `constraint.columns[] → referenced_columns[]` 的复合键映射；跨 schema 或快照外目标计入 external relationship，但首版不伪造缺失节点。
4. 布局是确定性的：按 FK 的 parent → child 拓扑分层，同层按名称排序并有界换列；cycle 保留在 rank 0，不删除关系。
5. 搜索、keys-only 和列数上限只改变当前投影，不改变底层 snapshot。缩放和 Fit 仅是本地视图状态。
6. relation 选择写入 tab 状态；Reveal 通过稳定数据库身份联动 Explorer，不使用 DOM selector。

## 边界

- 首版不提供节点拖拽后的持久布局、图片/SVG 导出、跨 schema 虚拟节点、自动刷新或对象依赖图。
- 图反映 snapshot 抓取时刻；时间戳必须可见，不能描述为持续同步的 live schema。
- 关系筛选后，如果一端不可见，对应边不显示；全量关系计数仍保留。

## 验证

- 领域测试覆盖复合 FK、parent-first 布局、cycle-safe 确定性、搜索、列上限、keys-only、external relationship 和 tab snapshot refresh。
- 组件测试覆盖节点/关系渲染、选中持久化、列搜索和 keys-only 投影。
