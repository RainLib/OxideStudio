# XLSX 有界导入

G08 的 XLSX 路径现在共用有界批次和单一事务，预览、类型推断及写入均逐行读取首张工作表。共享字符串表使用两个匿名临时文件建立索引，内存只保留当前字符串/记录与有界批次。旧的 32 MiB 源文件和 100,000 行物化限制已移除；当前资源边界如下。

## 读取与类型契约

工作簿仍从 `xl/workbook.xml` 选择第一张工作表，并按关系定位工作表、共享字符串及样式部件。兼容已有标准位置文件；包内相对/绝对关系仅解析成 ZIP 条目，禁止外部目标和逃出包根的路径，不提取 ZIP 路径到磁盘。其他工作簿根布局和更多生产工具仍需专项验收。

- 以首个非空行作为标题，保留源列顺序，清理标题前后空白并按原有 ASCII 大小写规则拒绝重复。稀疏单元格补 null，空白行跳过，超出标题范围的有效值拒绝。
- 支持共享字符串、内联字符串、富文本、布尔、数值、ISO 日期文本、样式标记的日期序号与错误单元格；拼接富文本正文并忽略注音辅助文本。不信任 dimension 所声明的范围来分配整张二维表。
- 日期样式维持原有序号文本行为，不擅自解释时区或将序号转成日历日期。公式只读取文件保存的缓存值，不执行表达式或外部引用，符合 [Open XML Cell Value 说明](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/053027c9-6036-4155-a16a-ba3a10e4ecc0)。共享字符串的索引/富文本结构参见 [Microsoft 文档](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)。
- 落在 i64/u64 范围内的原始 XML 整数直接保留整数，避免额外经过 f64；标量数值仍以这些整数和 f64 为范围，不提供任意精度数值语义。文本型公式缓存中的前导零作为文本保留；不能恢复 Excel 写入文件之前已经舍入的精度。JSON/XLSX 预览把超出 JavaScript 安全整数范围的整数显示为十进制文本，原生导入值仍保留整数。

## 资源边界

| 范围 | 当前约束 |
| --- | --- |
| 压缩源文件 | 最多 512 MiB。 |
| ZIP 目录 | 构建 ZIP 索引前检查最多 4096 条目、8 MiB 中央目录，支持有界 ZIP64 目录；不按条目中的路径创建源数据文件。 |
| XML | 本次读取部件的累计展开最多 2 GiB；工作簿/关系/样式等每个元数据部件最多 16 MiB。读取过程中再次计数，声明长度不能绕过限制。 |
| 事件/记录 | XML 事件读取预算 512 KiB，单行/共享字符串项 XML 跨度读取预算 8 MiB；缓冲预读最多约 8 KiB，层级最多 128。拒绝 DTD、多个根、未闭合或尾随第二个 XML 文档。 |
| 工作表 | Excel 的 1,048,576 行、16,384 列物理边界；单元格文本最多 32,767 字符。重复/逆序坐标、非法样式或共享字符串索引拒绝。 |
| 数据行 | 解码值和规范化行 JSON 各有 2 MiB 边界，防止短小的共享字符串引用将一行扩张成无界内存。 |
| 字符串索引 | 数据文件与 16 字节/项索引合计最多 512 MiB；仅保留最后一次查询的字符串缓存，不在内存保存完整字符串表。 |
| 批次 | 最多两个等待批次，每批最多 500 行、2 MiB 行 JSON；数据库参数、临时编码及容器另占空间，不是 RSS 上限。 |
| 预览 | 最多 50 行、1 MiB 样本 JSON，另含有界标题和封装；达到字节预算同样标记 truncated。 |

源摘要、映射、连接/数据库选择、目标权限和参数化写入沿用现有导入契约。JSON 与 XLSX 都在同一显式事务里消费批次，完整解析成功且未取消才提交；晚期 XML 错误、字段/约束失败和显式取消回滚。Truncate 使用事务内 DELETE。进度表示事务已执行的行数，终态成功才表示提交；不能当作恢复游标。

匿名索引通过文件对象生命周期关闭；Windows 使用排他、delete-on-close 句柄，Unix 使用匿名/已解除目录链接的临时文件。进程终止清理只涉及临时索引，不构成任务崩溃后发现、目标恢复或断点续传证明。当前没有为所有输入建立持久不可变快照，也不保证外部程序并发改写源时获得同一时点视图。

## 复验与证据范围

```powershell
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --lib commands::table::tests::import_
node scripts/test-xlsx-import.mjs
node scripts/test-json-import.mjs
```

`test-xlsx-import.mjs` 使用独立临时目录，生成超过旧压缩文件上限的 1,000,001 行真实 ZIP/XML 工作簿和 1,000,003 条共享字符串。验证 50 行预览、完整类型推断、2001 批 SQLite 导入，逐键读取核对全部 payload 与摘要，采集仍存活进程的工作集，最后确认正常退出和大文件删除。另启动一个确认持有两个临时文件的原生进程，在解析回调仍活跃时终止它，检查索引由内核清理；该进程的终止属于预期故障探针，不能算普通测试通过。

小文件测试与原 calamine 读取结果对照，覆盖稀疏坐标、富文本、日期样式、缓存公式、错误值及缺失单元格；另验证精确整数、字符串缓存前导零、非默认元数据部件路径、尾部 XML 错误、ZIP 预算、异常输入与 Append/Truncate 的真实 SQLite 回滚/连接复用。

CI 的 `json_imports` / `xlsx_imports` 为手动开关，配置 Windows/Linux 矩阵，仅归档证据与日志。远端 job 尚未执行。当前证据不覆盖实际 Tauri IPC/系统文件对话框、打包 Desktop、其他数据库或平台；该段为普通导入的历史验收范围；持久任务与后续独立中断验收见下文。显式跳过坏行策略及更多产品验收仍待完成。

## 2026-10-22 Windows 最终原生实测

- 证据：`C:/Users/housh/AppData/Local/Temp/oxide-xlsx-import-acceptance-fx9vw0/evidence.json`；`success=true`、退出 0，百万行用例 **1 passed / 0 failed / 0 ignored**。
- 实际 **1,000,001 行 / 52,600,539 B** 压缩源文件、**1,000,003 条共享字符串**；50 行预览、全部行类型推断、**2001 批** SQLite 3.46.0 事务写入通过。逐键重读全部 id/payload，与生成器的逐值 SHA-256 和整体摘要核对一致，`allPayloadsVerified=true`。
- 源 SHA-256 `c2d766ab6ebde8567948d3d6037834675cd6a42e8ddba8807fa3cdcd7d39b80c` 前后一致；payload 摘要 `2b9b56f6f6880de5afdec4eec4552c5251e27c1bd16e6b2a7bd2f7f5525c5718`。源工作簿和目标数据库已删除，保留小型证据及日志。
- test exe SHA-256 `a1f69942f39cf1cbbf4c78ac4e0275c9968e81995f5dacf09255c0d28af83119`，Rust 1.91.1、win32-x64。峰值工作集 **20,426,752 B**，测量时 private memory **9,994,240 B**，通过该夹具的 256 MiB 门禁；后者不是峰值私有内存，也不是打包 Desktop 总内存。
- 调试构建写入约 **147.8 秒**，生成/预览/推断/写入/核对整体约 **468.6 秒**；同机并行 JSON/Clippy，不作为性能提升或其他硬件/数据分布的保证。
- 独立终止探针在读取回调仍活跃时确认 **2 个临时条目**，父进程终止自己启动的 child 后无匿名索引残留；`anonymousSpoolCleanup=true`、源夹具清理通过。该 child 以 SIGTERM 结束，**不能算普通测试通过或续传证明**。

最终 Desktop 库 **1031 passed / 9 ignored**；独立 JSON 百万行也在同一最终 test executable 上通过，见 [JSON 记录](STREAMING_JSON_IMPORTS.md)。两种构建 all-targets 严格 Clippy 通过；无 Desktop 库 **392 passed / 4 ignored**、CLI **35**、外部只读调用 **9**、迁移 **17 passed / 25 ignored**、LSP 集成 **13** 通过。普通 ignored 未执行，不将其计入数据库/平台验收。前端专项 **4 文件 / 26 项**通过，未将前批全量前端重记为本批执行。2630 文件模块与 431 包无 Desktop 依赖检查通过。

全部 Desktop 检查结束后，以无效 PROTOC 重建无 Desktop 开发 CLI，确认 `oxide-agent 0.1.18`；捆绑二进制未改，原生验收进程无残留。52 处本地文档链接、新文件空白/冲突标记与 scoped diff 检查通过。

后续本批新增的可恢复任务可消费同一 XLSX 流式解析器，先复制已审阅源并归一化到私有 SQLite，再进入持久暂存/原子发布。协议、资源预算与未完成项见 [SQLite 文件任务](STREAMING_JSON_IMPORTS.md#sqlite-可恢复文件任务)。这不会把上方普通 XLSX 百万行或匿名临时索引清理证据改写成 XLSX 强杀续传验收；前批跨进程百万行夹具使用 JSON；XLSX 后续已取得下方独立证据，不改写上方普通导入的原始范围。

## 2026-10-22：XLSX 准备、交接及暂存三次中断

`node scripts/test-import-preparation-handoff.mjs --format xlsx` 的最终成功证据为 `C:/Users/housh/AppData/Local/Temp/oxide-import-preparation-handoff-xlsx-fNUM1E/evidence.json`；SQLite **3.46.0**，test exe SHA-256 `42f9839b8289d897ce5ad33e5b3fed9833e63ce117970cb914ad987685cd5e5c`。真实生成的 ZIP/XML 工作簿含 **1,000,001 行 / 59,198,839 B / 1,000,002 个共享字符串**，非默认 worksheet 路径，payload 含中文、café、引号、分隔符和换行。

四个原生进程实际完成：准备归一化强杀后恢复 **16500 行**，仅追加 **983501 行**；就绪交接清理前再次强杀；找回相同作业/令牌并在 **1500 行暂存 / 目标 0 行**时强杀；第四进程从 **9500 行**继续，完成原子发布。源已离线，SHA-256 `320dbefe83f48fa52a8593cabf446893d2f422a5dfa501e09898343010ce855a` 前后相同。逐键读取核对全部值；声明列的空白/省略单元格均为 null（**666667 行**），明确值 **333334 行**；未映射目标列全部 **1,000,001 行**使用默认值。固定列 XLSX 不采用 JSON 的逐行省略位图语义。

四进程峰值工作集 **25,542,656 / 33,988,608 / 27,652,096 / 34,766,848 B**，分别通过 256 MiB 门禁。最终 helper **1 passed / 0 failed / 0 ignored**；三个 SIGTERM 不算通过测试。认证账本核对唯一 v6 作业、completed、源/暂存均 **1,000,001 行 / 2001 批**；原始准备目录、源和目标大文件删除，成功验收根无 >32 MiB 残留。

首次尝试 `oxide-import-preparation-handoff-xlsx-UC5Pcz` 因内存观测子进程超时而失败，未计为通过。修复观测器为同一存活 PID 的有限异步重试后，独立新夹具成功；原失败证据保留，两份大工作簿已按明确路径清理，小型元数据保留。完整逐阶段 private memory、CSV 对照、观测器契约与证据边界见 [文件任务记录](STREAMING_JSON_IMPORTS.md#windows-xlsx-百万行独立实测)。这仍不是实际 Tauri IPC、系统文件对话框、打包桌面、其他生产者/产品/平台或桌面性能改善证明。
