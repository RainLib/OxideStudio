# OxideStudio 文档索引

- [当前架构](architecture.md)：前后端分层、状态域、驱动边界、关键数据流与架构债务。
- [DataGrip 能力差距与路线图](datagrip-gap-analysis.md)：2026.1 对标矩阵、P0/P1/P2 优先级和验收标准。
- [ADR-0001：Search Everywhere 分层索引](decisions/0001-search-everywhere-index.md)：会话内搜索边界、性能预算与持久化全局索引方案。
- [ADR-0002：Query History 项目级执行日志](decisions/0002-query-history-persistence.md)：SQLite 持久化、容量边界、迁移和安全重跑规则。
- [ADR-0003：Explain Plan 安全执行与规范化 Artifact](decisions/0003-explain-plan-safety.md)：后端 SQL 生成、只读/Analyze 边界、规范计划树和稳定节点跳转。
- [ADR-0004：CSV 导入安全边界](decisions/0004-csv-import-safety.md)：预览映射、事务批次与失败原子性。
- [ADR-0005：Schema Snapshot 与 Diff](decisions/0005-schema-snapshot-diff.md)：版本化结构基线、指纹、差异 artifact 与隔离范围。
- [ADR-0006：Migration 依赖排序与 Preflight](decisions/0006-migration-dependency-preflight.md)：拓扑排序、blocked 传播和只读数据检查。
- [ADR-0007：外键行导航](decisions/0007-foreign-key-row-navigation.md)：系统目录反向索引、复合键原子映射和结构化过滤。
- [ADR-0008：选择聚合性能预算](decisions/0008-selection-aggregate-budget.md)：多选去重、有界计算和 decimal/bigint 精度策略。
- [ADR-0009：AI 编辑器补丁预览](decisions/0009-revision-bound-editor-patch.md)：只读 artifact、文档 revision、before 校验和显式 Apply 边界。
- [ADR-0010：Assistant Runtime 工具循环](decisions/0010-assistant-runtime-tool-loop.md)：运行时状态推进、预算、审批绑定、事件协议与取消边界。
- [ADR-0011：Agent Task 安全持久化](decisions/0011-agent-task-summary-persistence.md)：项目级任务摘要、session 恢复、数据最小化和保留策略。
- [ADR-0012：Deep Agents 桌面运行边界](decisions/0012-deep-agents-desktop-runtime-boundary.md)：Node-only 发布物审计、WebView 禁止直接打包、sidecar/服务协议与降级路径。
- [AI Agent 产品与技术规格](AI_AGENT_PRODUCT_SPEC.md)：完整能力矩阵、状态机、页面动作协议、安全模型、Deep Agents 分层方案和 LSP 相关性规则。
- [AI / Agent 集成](AI_AGENT_INTEGRATION.md)：应用内 Assistant、CLI、MCP、工具策略与审计。
- [外部 AI 接入指南](EXTERNAL_AI_INTEGRATION.md)：通过 Rust `oxide-agent` 使用 MCP/CLI、固定项目与连接授权、调用五个只读工具。
- [LSP 集成](LSP_INTEGRATION.md)：SQL LSP 生命周期、文档同步和协议边界。
- [样式系统](STYLE_GUIDE.md)：CVA 变体、tokens 和组件约定。
- [应用更新](UPDATES.md)：签名更新、发布配置和验证流程。

文档中的“已支持”必须能在当前源码和测试中找到证据。规划性内容应放在差距分析/路线图中，不应混入当前架构事实。
