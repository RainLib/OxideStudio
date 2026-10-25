# 2026-10-25 发布前校验

本次整合 `feature/dbx-lsp` 分支累计的 SQL 智能提示、文件查询、导入传输、桌面交互及配套测试。LSP 源码由 `vendor/sql-lsp` 独立子模块提交管理；DBX 参考仓库及本机技能、临时文件、构建缓存不纳入提交。

## 本地验证

第九十五批已完成以下完整验证，详细范围与剩余差距见 [复杂语义审计](lsp-complex-semantics-audit-2026-10-23.md#第九十五批where-版本能力与语义快照)。

| 检查 | 结果 |
| --- | --- |
| 前端单元测试 | 470 个文件，3,669 项通过 |
| Rust LSP | 24 个目标，1,251 项通过，0 ignored |
| 发布 LSP 精确字节协议测试 | 147 项通过 |
| 实际 WebView / Monaco / Tauri LSP | 179 个场景，3,155 条断言通过 |
| 签名 DuckDB 文件流程 | 6 个场景，207 条断言通过 |
| Root / vendor 严格 Clippy | 通过 |
| 普通 Desktop 库与应用构建 | 通过 |
| 禁止 protoc 的 headless CLI | 构建及 `oxide-agent 0.1.18` 运行通过 |
| 固定 DBX 参考样例 | Oxide 53/53；DBX 无头 EditorState 19/53，不代表完整产品对比 |

整理提交时，仅对五个 Rust 文件应用标准 rustfmt，并移除两个文件末尾的多余空行；随后 Root 格式检查与严格 all-targets Clippy 重新通过。上表的完整场景验收属于格式整理前的已冻结快照，未将其描述为整理后重新执行。

远端 LSP CI 的 Rust 1.99 检出了两个迭代写法及 async_trait 生成代码的重复 must_use 提示。已改用等价的 zip/while let 写法，并仅对该 trait 的宏生成提示增加有说明的局部兼容属性；未关闭整体警告检查。修复后 LSP PR #6 的测试及 Ubuntu、macOS、Windows 构建全部通过，并已合并。

当前捆绑 LSP 从干净源码 `941dc0b91fe3fb5c97b17de1d9144a7c306482eb` 重新构建，SHA-256 为 `ea13c15a7ef20f977fe395c0065f0831a1a4b4ecc99ddab0df89c6acd48f30dd`。这份新字节重新通过 147 项协议测试和实际桌面 LSP 179 场景 / 3,155 断言；Rust 全量 1,251 项、严格 Clippy、格式检查亦重新通过。签名文件 6/207 为前述第九十五批基线，未冒充新字节重跑结果。

主仓库跟进修复了 rustfmt 模块顺序与边界检查的冲突，以及 Linux shell helper 缺少 PathBuf 导入的问题。CI 百万行迁移测试已把证据输出到日志；遇到 GitHub 附件存储配额时，可选附件上传不再阻止后续依赖检查和 Clippy，测试本身仍保持失败即阻断。

完整 SQL 方言与复杂表达式、更多真实数据库版本、性能基准及安装包/系统 picker/跨平台产品验收仍有未完成项目。合并本次代码不表示这些范围已经全部实现。
