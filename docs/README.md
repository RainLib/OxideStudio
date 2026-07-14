# OxideStudio 文档索引

- [当前架构](architecture.md)：前后端分层、状态域、驱动边界、关键数据流与架构债务。
- [DataGrip 能力差距与路线图](datagrip-gap-analysis.md)：2026.1 对标矩阵、P0/P1/P2 优先级和验收标准。
- [ADR-0001：Search Everywhere 分层索引](decisions/0001-search-everywhere-index.md)：会话内搜索边界、性能预算与持久化全局索引方案。
- [ADR-0002：Query History 项目级执行日志](decisions/0002-query-history-persistence.md)：SQLite 持久化、容量边界、迁移和安全重跑规则。
- [AI Agent 产品与技术规格](AI_AGENT_PRODUCT_SPEC.md)：完整能力矩阵、状态机、页面动作协议、安全模型、Deep Agents 分层方案和 LSP 相关性规则。
- [AI / Agent 集成](AI_AGENT_INTEGRATION.md)：应用内 Assistant、CLI、MCP、工具策略与审计。
- [LSP 集成](LSP_INTEGRATION.md)：SQL LSP 生命周期、文档同步和协议边界。
- [样式系统](STYLE_GUIDE.md)：CVA 变体、tokens 和组件约定。
- [应用更新](UPDATES.md)：签名更新、发布配置和验证流程。

文档中的“已支持”必须能在当前源码和测试中找到证据。规划性内容应放在差距分析/路线图中，不应混入当前架构事实。
