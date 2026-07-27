# ADR-0015：Loaded Data Compare Artifact

## 状态

已接受，2026-07-26。

## 背景

Table 与 Query tab 已有有界结果，但此前不能比较两个结果集。直接按行号对齐会在排序不同、缺行或复合键场景产生错误；直接把同名 key 的后一行覆盖前一行又会隐藏重复数据。查询结果还可能只包含当前页或因 1,000 行 hard cap 被截断。

## 决策

1. Data Compare 从两个已完成且无未提交 table draft 的 tab 捕获不可变 loaded-result snapshot。artifact 不会在源结果变化时静默更新；用户可显式 Refresh。
2. 用户选择一个或多个双方同名列作为 key。Table metadata 的共同 primary key 优先，其次使用共同 `id`，最后才回退到首个共同列。
3. 不按当前行号配对。key 使用 type-aware、结构稳定的编码；复合 key 保持列顺序。重复 key 标记为 ambiguous，不配对、不覆盖。
4. 值按共同列名映射，允许双方列顺序不同。重复列名会 fail closed，并要求查询使用唯一 alias；单侧独有列只报告结构差异，不伪装成逐行 value diff。
5. 精确比较区分 NULL、undefined、类型与结构值。可选 tolerance 只用于严格可解析的有限数值，规则为 `Δ ≤ absolute + relative × max magnitude`；其他类型保持精确比较。
6. 任一源标记 truncated 时，界面必须声明“缺失”只相对于已加载行。领域层最多接受每侧 5,000 行，UI 最多渲染 2,000 条 diff line。

## 边界

- 首版比较 loaded results/current table page，不执行服务端全表扫描，也不声称得到全量差异。
- 首版按同名列映射；可视化列映射、忽略列、collation/timezone/whitespace 规则和差异同步写回属于后续工作。
- Artifact 只读，不提供从一侧自动生成 DML 或同步数据。

## 验证

- 领域测试覆盖 changed/equal/left-only/right-only、absolute/relative tolerance、duplicate key、truncation、非对称列、重复列拒绝和 key 推荐。
- Store/组件测试覆盖不可变捕获、ordered-pair tab 复用、PK 自动选择、状态汇总及 tolerance 重算。
