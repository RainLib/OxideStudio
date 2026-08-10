# DBChart 最新差距审计（2026-08-11）

## 基线

- ChartDB：`sources/dbchart` 的 `main`，`c24936a402bb3e24b4858f05282d69a04fcfe25b`（v1.20.1 后）。
- OxideStudio：`feature/dbx-lsp`。
- 本文只记录可由两个当前工作树证明的差异；SQL 语义、LSP 和真实连接功能继续以 DBX 为直接参考，因为 ChartDB 不提供 SQL LSP。

## 结论与优先级

| 优先级 | ChartDB 最新变化/能力 | ChartDB 实现位置 | OxideStudio 状态与行动 |
| --- | --- | --- | --- |
| P0 | SQL 编辑器、LSP、表数据流式导出 | 不适用：ChartDB 当前没有 SQL LSP 或连接式 Table Grid | Oxide 已有独立 LSP 文档同步、completion resolve、metadata/FK fallback、inline completion 和 CSV/SQL/JSON/JSONL/TSV/XLSX/Parquet/Arrow 导出；不能把 ChartDB 的代码编辑器当作替代实现。继续按 DBX 对齐。 |
| P0 | 常用命令的可导航代码块 | 不适用：ChartDB 的 Monaco completion 仅用于 DBML | 已在 `src/features/query-editor/model/sqlCommandSnippets.ts` 增加产品限定的 PostgreSQL/SQLite `ON CONFLICT`、MySQL `ON DUPLICATE KEY UPDATE`、SQL Server `MERGE`；不向其它产品泄漏语法。 |
| P1 | 复制的数据库 metadata JSON / CSV 包含双引号时的容错 | `src/lib/data/import-metadata/utils.ts`，提交 `3442936` | Oxide 的表数据 CSV 导入使用有界预览、映射与 Rust CSV 流式 preflight，不走 ChartDB metadata JSON 的粘贴修复路径。若增加“ChartDB metadata/DBML 粘贴导入”，必须复用其“先最小修复并 JSON.parse，再 CSV unwrap、再 wrapper 提取”的顺序，并加语义验证，不能采用破坏性全局反转义。待该导入入口立项后实现。 |
| P1 | DBML/SQL 导出中的索引注释、索引类型、默认值和引号保真 | `src/lib/dbml/dbml-export/dbml-export.ts`，`src/lib/data/sql-export/export-per-type/postgresql.ts`；提交 `ce95f83`、`1c49c7c`、`9fe2722`、`0b73295` | Oxide 的真实数据库 DDL/备份、表 SQL 数据导出与结构迁移是独立模型；PostgreSQL 整 schema 备份现已覆盖表、索引、FK、sequence 和 sequence state。DBML round-trip 仍是独立的 P1 审计项，不应以字符串替换接入。 |
| P2 | Area 的 move-to-area、auto-arrange-area 上下文菜单 | `src/pages/editor-page/canvas/{canvas,area-node,table-node}/*-context-menu.tsx`，提交 `c24936a` | 这是 ER 画布交互，不改变 LSP、迁移或表数据导出。Oxide 已有自己的画布/历史/视口路线；后续只在交互验收时按“移动关系、批量选择、撤销、布局性能”对齐。 |
| P2 | edge handle 注册竞态修复 | `src/pages/editor-page/canvas/*`，提交 `81dae56` | ChartDB 专属 React Flow 生命周期问题；Oxide 未复用该 edge handle 注册模型，无直接迁移价值。 |

## 本阶段实现与验证

- 新命令代码块有 Monaco snippet tab stop，且可被已有 SQL completion 的 trigger、排序、usage rank、取消与 generation guard 共同管理。
- `completionItem/resolve` 的延迟 documentation/additional edits 也已绑定到产生候选的 URI 和 Monaco model version；用户继续输入、切换 tab 或取消后，旧 resolve 响应只保留原候选，不会覆盖新文档的展示/编辑合同。
- 产品范围：PostgreSQL、CockroachDB、YugabyteDB、Neon、Supabase、TimescaleDB 和 SQLite 使用 `ON CONFLICT`；MySQL、TiDB、OceanBase MySQL、SingleStore 使用 `ON DUPLICATE KEY UPDATE`；SQL Server 只显示 `MERGE`。
- Table Grid 的导出菜单现在可选择全部匹配行或前 1,000/10,000/100,000 行；选择对 CSV、SQL、JSON、JSONL、TSV、XLSX、Parquet、Arrow 和 Markdown 共享，后端仍按当前过滤和排序流式读取，而不是从当前可见页截断。
- `src/features/query-editor/model/sqlCommandSnippets.test.ts` 已验证三种语法不会互相泄漏，及已有 Oracle、Db2、Dameng 专属块。
- 已执行：`npm.cmd exec vitest run src/features/query-editor/model/sqlCommandSnippets.test.ts`（16 tests）和 `npm.cmd run build`。真实数据库/LSP provider 组合验证继续在总体验收阶段执行。

## 下一批实际差距

1. 真实 Monaco + LSP provider 组合验证：快速输入、取消、Tab 接受、snippet tab stop、跨 tab/session 切换和 metadata 刷新竞态。
2. 对真实 PostgreSQL/MySQL/SQLite/SQL Server 恢复语法库执行 LSP/snippet 验证；当前只完成纯逻辑与构建验证。
3. 如需接受 ChartDB metadata JSON/CSV 或 DBML 文件，新增受限导入入口、预览、类型损失清单与 migration plan；不直接执行外部文本。
4. ER 画布交互在相应产品需求确认后，再评估 ChartDB Area 操作和布局算法；它不阻塞本目标中的 LSP、迁移和表格导出。
