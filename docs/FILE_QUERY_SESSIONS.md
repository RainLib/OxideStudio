# 文件即时查询：桌面入口与原生会话边界

2026-10-25 更新：G11 已接入文件侧栏和独立打开文件入口，复用 Monaco 与只读结果表格。实际生产组件 → Tauri IPC → 真实签名 DuckDB Host 已验收，覆盖 CSV、JSON、JSONL、Parquet 和 SQL 辅助。**G11 仍进行中**：系统文件对话框的实际选取、安装包完整流程与其他平台尚未验证；独立入口已验证到 provider 对话框。

最新验证（第九十五批）：WHERE 的 LIKE/ILIKE/SIMILAR TO 可选 ESCAPE 现在使用绑定的版本能力，明确区分支持、不支持和未知；配置改变、文档恢复与晚到回包不会沿用旧授权。两条快照共用原子语义解析。新增29前端、1 Rust库、1协议测试；全量前端 **3669 / 470文件**、vendor **1251 / 24目标**通过。实际桌面 LSP **179场景 / 3155断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07及文件双入口范围继续。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十五批where-版本能力与语义快照)。

历史验证（第九十四批）：主编辑器在完整匹配后主动发现可选 ESCAPE，完成匹配/转义后提供明确的 AND/OR 类型知识与完整 UTF-16 编辑；标准、目录和文档路径共用已有 AST 与类型策略。新增 4 Rust 库、4 协议测试；前端 **3640 / 469 文件**、vendor **1249 / 24 目标**通过。实际桌面 LSP **174 场景 / 3101 断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07 与文件双入口范围保持。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十四批匹配谓词续写与-escape-发现)。

历史验证（第九十三批）：补齐 LIKE/ILIKE 及已支持方言 SIMILAR TO 的 ESCAPE 结果类型与单字符提示，主编辑器、WHERE 和文件查询共用绑定后的语义角色。新增 26 前端、6 Rust 库、3 协议测试；全量前端 **3640 / 469 文件**、vendor **1241 / 24 目标**通过。实际桌面 LSP **160 场景 / 3019 断言**、签名文件 **6 / 191**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十三批escape-语义与单字符提示契约)。

历史验证（第九十二批）：签名 DuckDB 文件查询 **6 场景 / 174 断言**、共享 LSP **147 场景 / 2950 断言**通过，新增高级模式匹配的类型、值和实际补全验收。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十二批高级匹配运算与模式类型提示)。

历史验证（第九十一批）：签名 DuckDB 文件查询 **6 场景 / 158 断言**、共享 LSP **134 场景 / 2815 断言**通过，补充 EXISTS/NOT/CASE 的结果类型与真实编辑器逻辑补全验收。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十一批多方言谓词与条件结果推断)。

历史验证（第九十批）：生产组件和签名 DuckDB 文件查询 **6 场景 / 152 断言**、共享 LSP **125 场景 / 2762 断言**通过，新增逻辑标量转换实测；见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十批普通逻辑运算符与方言标量语义)。

历史验证（第八十九批）：生产组件经实际 Tauri 和签名 DuckDB 的文件查询 **6 场景 / 145 断言**通过；共享 LSP **121 场景 / 2734 断言**通过。原系统选择器、安装包与平台限制仍保留。细节见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第八十九批无目录类型推断与快照位置校验)；下方较早批次的数字保留为历史证据。

## 当前桌面流程

- 文件侧栏打开按钮，以及命令面板 `Open Data File for SQL…`，都可选择系统文件；项目树 CSV/Parquet 默认打开查询，四种格式的右键菜单提供查询。JSON/JSONL 默认仍打开文本。
- 只列出 active、ready、runtime-ready 且有签名格式授权的外部 provider；无 provider 时可直达驱动管理并刷新列表，不按驱动名字授予能力。
- CSV 首行可自动识别、作为列名或作为数据保留。标签不关联当前数据库连接，不作为原文件的可保存文本；运行/选区与 Ctrl+Enter 使用独立会话，结果显示在共享只读 grid。
- 关闭标签清理快照，关闭历史仅保留 SQL/来源选项。项目切换、单个打开取消、运行取消都调用 Host 生命周期；晚到结果被丢弃，单个取消不关闭同项目其他文件。重开先释放旧会话。
- 显示准备中、打开错误、SQL 错误、会话结束及重开入口。SQL 错误通过 Host 状态判断可否重试；每分钟及窗口焦点恢复时检查失效会话，短暂 IPC 失败不会被当作过期，状态检查不延长 Host 闲置期限。

- 打开后先以 `SELECT * FROM data LIMIT 0` 获取源列名与推断类型，再执行初始查询；底栏列信息弹层保存这份独立元数据，会话结束后显示“上次快照列信息”。SQL 结果改变不会覆盖源列信息。
- Ctrl+Shift+Enter 执行选区或光标当前语句，复用后端 UTF-16 语句扫描器；迟到解析在 SQL、模型或会话变化后被丢弃。Ctrl+Enter 仍执行选区或全文。
- 文件会话使用签名包 capabilities 建立独立 LSP 文档作用域，无需保存数据库连接；UUID schema 只发送 `data` 的列名与类型，不发送源文件路径或数据库 definition URI。已接入列补全、格式化及共享核心 provider；格式化前同步最新文本，失败保留错误，真实成功（含无修改）后才清除本次格式化错误。
- 打开设置、文件工具栏、底栏、列信息及新增入口提供中文/英文；共享结果栏、后台任务和原生错误尚未全面本地化。

SQL 辅助不可用时仍可查询。当前 DuckDB 使用已声明的 LSP 兼容方言基线；完整 DuckDB 语法、诊断流水线、进阶补全串联和全部数据库控制台辅助能力仍未齐备。

## 历史验证（列信息、当前语句与 SQL 辅助）

| 范围 | 结果与证据 |
| --- | --- |
| 前端 | **402 文件 / 2120 项通过**；完整 build、边界与 bundle 检查通过。新增会话隔离、LSP 同步失败传播、UTF-16 当前语句、选区优先、迟到结果、重开保留 SQL 与元数据取消用例。格式化回归通过实际共享 provider 验证“同步失败 → 格式化失败 → 成功重试”，覆盖真实客户端错误传播，不依赖编辑器 action 拒绝。 |
| 签名 Host | **2 passed / 0 failed / 0 ignored**；`C:/Users/housh/AppData/Local/Temp/oxide-file-query-host-O3Q1VP/evidence.json`。Host test exe SHA-256 `0518e638414cc4677176ba42225ed8d8d579537a0702f06bcd454cea922e8f16`。增加签名 capabilities 描述及 LIMIT 0 零行、真实列类型断言，保留生命周期验收；临时签名私钥已删。 |
| 原生 SQL 辅助 | `node scripts/test-file-query-lsp.mjs`：真实 DuckDB 的 LIMIT 0 元数据传给捆绑 sql-lsp，`data` 列补全成功；格式化保留中文与 `9007199254740993`，双方正常退出 0。证据 `C:/Users/housh/AppData/Local/Temp/oxide-file-query-lsp-HsKACq/evidence.json`；LSP SHA-256 `616ef87abb142f927e0034a3742f68091d207356436a2cb8562b66f9361ad259`，driver SHA-256 仍为 `acbf45da68e7116d3263fc42d52b407e0faddf9676895fdd9b1aef47b1069f64`。这是原生协议验证，非 Tauri 集成。 |
| 常规 Rust | Desktop 库 **1016 passed / 6 ignored**；无 Desktop 库 **392 passed / 4 ignored**、CLI **35**、外部只读调用 **9**；两种 all-targets 严格 Clippy 通过。未运行的 ignored 场景不计作验收。全部 Desktop 构建后已恢复开发 CLI `oxide-agent 0.1.18`。 |

本批未改 DuckDB 二进制，百万行性能证据沿用下节同一 SHA-256 的历史运行，没有重复记为本批实测。界面为默认 1280×720 英文与 1000×700 中文的 10 张明确标识合成数据截图；真实原生协议和合成界面不能合并视为完整 Desktop 端到端验收。独立 reviewer 的初次结论为 fix，发现共享 provider 将格式化失败当作无修改；已补显式结果回传、真实客户端严格错误传播及调用链回归，最终 verdict 为 **ship**，仅表示该格式化恢复问题已解决；同组 10 张重采截图均有效，不扩大为新一轮全界面或原生验收。复核记录见 `.impeccable/review/file-query-intelligence/finish-review.md`。detector 本批只执行一次，34 项字号建议、0 项 primary，不改变既有字号系统。

## 前批最终验证（双入口接入，历史）

| 范围 | 结果与证据 |
| --- | --- |
| 前端 | **401 文件 / 2109 项通过**，含 11 项文件查询/编辑器用例；完整 build、边界和 bundle 检查通过。覆盖 provider 过滤、专用查询分支、单个取消、迟到打开、项目切换、SQL 错误/会话结束、关闭资源、split editor 全局 Run 及状态检查失败。 |
| 界面 | 默认 1280×720 与 1000×700 小桌面窗口，12 张合成数据截图；独立 finish reviewer 给出 **ship**，范围仅为 fixture-backed desktop UI，无 material fixes。错误文字对比度与 Drivers 深链接问题已修复。记录在 `.impeccable/review/file-query-finish-review.md`；detector 只执行一次，输出 `[]`。 |
| 签名 Host | **2 passed / 0 failed / 0 ignored**。`C:/Users/housh/AppData/Local/Temp/oxide-file-query-host-f2fMBE/evidence.json`；test exe SHA-256 `51612462c55df71641ba6ddfa08f3016322a6c26617e19939b13898d1726cb82`。在前批生命周期基础上新增单个打开取消、取消先到、保留其他活会话、headerless CSV 两行保留与语言描述断言。临时签名私钥已删。 |
| 原生 DuckDB | **20/20**及 all-targets 严格 Clippy 通过，包含 AST/表头与常用数值、日期时间、日期无穷值；最终 driver SHA-256 `acbf45da68e7116d3263fc42d52b407e0faddf9676895fdd9b1aef47b1069f64`。 |
| 同二进制百万行 | `oxide-file-query-acceptance-M2RCMt/evidence.json`：**1,000,001 行 / 119,889,022 B**，源离线查询、哈希不变、正常清理和退出 0。打开约 **0.55 秒**、流程约 **4.24 秒**，峰值工作集 **130,990,080 B**，测量时 private memory **11,763,712 B**；通过该数据集 256 MiB 门禁，不外推为跨版本性能或 Desktop 总内存保证。 |
| 常规 Rust | Desktop 库 **1016 passed / 6 ignored**；无 Desktop 库 **392 passed / 4 ignored**、CLI **35**、外部只读调用 **9**，两种构建 all-targets 严格 Clippy 通过。ignored 场景不因普通测试通过而视为执行；本批只显式运行上述 2 项文件会话 Host 用例。 |

2619 文件模块检查、431 包无 Desktop 依赖图和 41 处本地文档链接检查通过。已在最终检查后重建无 Desktop CLI 并确认 `oxide-agent 0.1.18`，native driver 无残留。保留捆绑二进制，未发布驱动包或推送代码。上述 Host 是 Rust library test executable → 实际签名 sidecar；界面是实际 App/组件 → 合成服务，两份证据不能合并宣称已验证真实系统文件对话框和打包 Desktop IPC。

## 已实现的执行边界

独立 DuckDB sidecar 新增 `fileQueries`、`hostManagedFileQueries` runtime capabilities，旧包省略时默认为 false。专用连接使用已授权的绝对文件系统路径作为 `config.url`，同时设置字符串选项 `readOnly: "true"`、`fileQueryFormat: "csv" | "json" | "jsonl" | "parquet"`。签名 capabilities 的 `fileQueryFormats` 明确授权格式；Host 先重新验证签名、摘要和版本，再要求两项 runtime flags、query 及两项 read-only flags 全部成立，之后才发送源路径。目录或 query 能力不授予文件访问权限。

`core/file_query/` 管理原生会话，Desktop 注册 pick/open-project/run/close/close-project/cancel-open/status/resolve-statement 八个 IPC。原生 picker 不接受 renderer 提交绝对路径；项目入口必须带非空 expectedRoot，复用现有项目路径解析并验证格式和大小。会话绑定项目与真实 WebviewWindow label，查询时再次检查项目和项目来源的 root。打开票据使用 owner generation 和 UUID 请求 ID，处理作用域关闭、单个打开取消和取消先到的竞态。公开 CLI/MCP 不开放这个入口。连接后按签名 serverVersionRange 复用兼容性校验。

会话流式复制所选普通文件到自身临时目录，建立引用快照的 `data` VIEW，关闭建库连接后以 DuckDB 引擎 ReadOnly 模式重新打开私有 catalog。没有把文件行导入用户目标表，也没有修改原文件。复制前后的长度和修改时间用于检测常见的并发变化；这不是其他应用同时改写文件时的一致时点快照保证。

DuckDB 1.10505.0 要求数据库启动后、external access 尚未禁用时才能设置 `allowed_paths`，不能把该列表直接放进启动 Config。当前通过 Cargo `json`、`parquet` features **静态链接**两种扩展，关闭自动加载和自动安装，只加载固定扩展；执行内部设置 SQL，将允许路径绑定为唯一快照，再关闭 external access 并锁定配置，之后才暴露用户查询。未开放目录、HTTP 读取或磁盘溢写。设置依据见 [DuckDB 配置](https://duckdb.org/docs/lts/configuration/overview)、[安全配置说明](https://duckdb.org/docs/preview/operations_manual/securing_duckdb/overview) 与 [Rust client features](https://duckdb.org/docs/current/clients/rust/overview)；这不构成操作系统沙箱。

专用会话强制单条只读 SQL，即使调用者未附带 query context 的 read-only 标志。拒绝 DDL、DML、COPY、ATTACH、SET 及动态 SQL 函数 `query`/`query_table`，包含引号标识符写法。引擎自身再限制 catalog 写入和外部访问。普通 Agent 的 DuckDB ReadOnly 连接仍关闭全部 external access，不共享这个路径例外。

## 当前预算与限制

| 项目 | 当前边界 |
| --- | --- |
| 原始文件快照 | 每会话最多 1 GiB，流式复制，超额或常见复制期变化即拒绝。不是零复制打开。 |
| Host 总量 | 每个 Host 最多 4 个会话，每个预留完整 1 GiB 快照额度；准备中和清理失败都占用额度，关闭清理成功才释放。不是全机器或跨 Host 的磁盘容量保证。 |
| DuckDB | 128 MiB 引擎 memory limit、2 threads，禁用磁盘 spill。该设置不是进程 RSS/工作集上限。 |
| 文本解析 | CSV 表头 Auto/Present/Absent；行上限 1 MiB，JSON/JSONL 对象上限 1 MiB，推断样本 20,480。源列与推断类型已可预览；编码选择、手动类型覆盖和推断控制仍待实现。 |
| SQL | 64 KiB SQL、128 parameters；保留原生参数绑定。 |
| 返回结果 | 最多 1,000 行、256 列；列描述和行的累计 JSON 预算 2 MiB，给 Host 4 MiB frame 留出 envelope 空间。超额单元格/结果拒绝，不静默省略值。 |
| 截断 | 实际存在第 1,001 行时返回 `truncated=true` 和 `rowLimit=1000`。预览 SQL 应显式 LIMIT；客户端截断不等于数据库只计算这些行。 |
| 超时/取消 | Host 准备总时限 60 秒、查询总时限 20 秒；超时/取消终止该独立进程、等待退出再删除目录。丢弃服务 future 也安排清理；SQL 语法/只读拒绝错误保留健康会话。 |
| 清理 | Host 所有目录位于 app cache，使用存储、Host、driver 三层 OS 租约；只回收有版本标记、UUID 名称和边界验证的目录，拒绝链接/reparse point。清理失败保留额度并每秒重试；空闲 15 分钟回收。关闭/项目关闭/窗口销毁的后端已接线，Tab 关闭、项目切换及重开已接入界面调用。 |

已补常用列类型、JS 安全整数外的精确字符串、日期/时间文字、NaN/Infinity 和日期无穷值；复杂 JSON/嵌套类型、更多时区/极值和类型推断仍需专项验收，不代表完整类型保真。

执行前用绑定参数调用引擎 `json_serialize_sql` 校验 AST，避免 pinned duckdb-rs prepare 执行前置语句。同名 query/query_table 列和美元引号字符串可正常使用，动态函数调用和多语句仍拒绝。支持 DESCRIBE、SHOW、普通 EXPLAIN；未支持的 EXPLAIN 选项保守拒绝。

## 第一批证据，保留为历史

```powershell
cargo test --locked --offline --manifest-path src-tauri/crates/oxide-driver-duckdb/Cargo.toml
cargo clippy --locked --offline --manifest-path src-tauri/crates/oxide-driver-duckdb/Cargo.toml --all-targets -- -D warnings
cargo test --locked --offline --manifest-path src-tauri/crates/oxide-driver-protocol/Cargo.toml
node scripts/test-file-query-driver.mjs
```

- DuckDB **16/16**，含四项新增文件回归：CSV、JSON、JSONL、真实 Parquet、Unicode/空值、注释 SQL、源改写后的快照隔离、其他路径/HTTP/DDL/动态 SQL/配置放开拒绝、catalog 引擎只读、行/列/字节/源大小预算、正常释放，以及普通只读连接仍不能读 CSV。协议 **12/12**，两者 all-targets 严格 Clippy 通过。
- Windows 实际 sidecar 进程读取 **1,000,001 行 / 119,889,022 B** CSV。源文件改名离线后完整计数、SUM/MIN/MAX 仍正确，HUGEINT 聚合按原协议精确字符串返回；预览原生 SQL 显式 LIMIT 1001，再验证 1000 行截断。原文件与快照 SHA-256 相同，源文件前后哈希不变，Disconnect 后临时目录不存在，进程退出 0。生成的大文件已清理。
- 最终证据：`C:/Users/housh/AppData/Local/Temp/oxide-file-query-acceptance-bRlCYr/evidence.json`；binary SHA-256 `f3bb7349dc12db1055b49a57f514e93c457edbc1175fea226a1c40ffcb748941`。打开约 **2.60 秒**、本次流程约 **7.62 秒**，峰值工作集 **133,541,888 B**，通过该数据集 **256 MiB** 工作集门禁。测量时 private memory **10,821,632 B**，不是 peak private memory。只覆盖此 Windows debug sidecar、数据和查询，不外推到桌面总内存或其他平台。
- 无 Desktop 回归：库 **387 passed / 2 ignored**、CLI **35 passed**、外部只读调用 **9 passed**；这两个 ignored 未在本批重新执行。没有运行前端、打包桌面或远端 Actions。
- 无 Desktop all-targets 严格 Clippy、2605 文件模块检查、431 包无 Desktop 依赖图、37 处本地文档链接与 diff 检查通过。最后重建并确认开发 CLI `oxide-agent 0.1.18`；捆绑二进制未改动，native DuckDB 进程无残留。

## 前批 Host 管理与静态扩展证据（历史）

首次真正通过 Host 的 env-clear 启动失败，发现第一批 `LOAD json/parquet` 实际依赖用户缓存；第一批用例不能作为自包含驱动交付证明。本批显式静态链接扩展，并在没有 HOME/USERPROFILE 的生产启动环境中实际查询全部四种格式。另修正 Windows 锁住目录内文件后不能重命名目录的问题：持有存储 OS 锁发布完整实例记录，再取得最终位置的 Host 租约。测试没有通过补用户缓存、放宽自动安装或删除锁来绕过失败。

Host 通过 `OXIDE_FILE_QUERY_WORKSPACE` 在进程启动前绑定目录；driver 在发送 handshake 前持有 driver.lock，所有快照建在该目录中。独立有界 stdin reader 在输入 EOF 后等待最多约 1 秒，再结束仍在执行 SQL 的进程；这个分支不运行析构，回收由 Host/下次启动完成。原生证据使用实际管道句柄关闭与 Host 租约释放，尚未覆盖整个打包桌面 Host 被操作系统强杀的流程。普通 sidecar 不继承该环境变量。

```powershell
node scripts/test-file-query-host.mjs
node scripts/test-file-query-driver.mjs
```

| 检查 | 最终结果与证据 |
| --- | --- |
| 生产签名解析 + Host 生命周期 | **2 passed / 0 failed / 0 ignored**，约 70.48 秒。`C:/Users/housh/AppData/Local/Temp/oxide-file-query-host-8Mnoeb/evidence.json`；Host test exe SHA-256 `3ba7c4c73bc56b321b552d404ed5f4c4f271ff02cf071aed33eb0c196dbad1fc`。使用本次临时 Minisign key、生产 packager 和 `Registry::new`；篡改清单、签名正确但未授权格式均在源路径发送前拒绝。私钥已删除，不使用 release key，也未安装到全局驱动库。 |
| 生命周期覆盖 | 四格式、项目/窗口隔离、4 会话预算、迟到打开票据拒绝、语法错误后继续查询、真实长查询 deadline 终止/清理、丢弃 query/open future、长查询中关闭窗口作用域、EOF 结束执行、活 driver 租约拒绝删除、启动回收旧快照与源文件不变。取消/EOF 前明确断言查询仍未完成；timeout 必须报告 timed out。 |
| 最终 driver | SHA-256 `b08812d649e370da69da1da138521ecea27e3b2b742d6a1ccafda4e027231dee`，`json`/`parquet` 静态链接；同一个二进制用于下行百万行。 |
| 百万行 | `oxide-file-query-acceptance-MpvZvk/evidence.json`：**1,000,001 行 / 119,889,022 B** CSV，源离线后 count/SUM/min/max 正确，源与快照哈希相同、源不变、正常断开清理、退出 0。打开约 **0.97 秒**、流程约 **5.27 秒**；峰值工作集 **130,658,304 B**，通过该数据集 256 MiB 门禁，测量时 private memory **11,087,872 B**。不作为跨版本性能提升或 Desktop 总内存结论。 |
| 独立 crate | DuckDB **16/16**、协议 **12/12**，两者 all-targets 严格 Clippy 通过。 |
| 前端回归 | **399 文件 / 2098 项**及完整 build 通过；仅类型和桥接变化，没有 UI 原生交互验收。 |
| 常规 Rust 回归 | 默认库 **1016 passed / 6 ignored**；无 Desktop 库 **392 passed / 4 ignored**、CLI **35**、外部只读调用 **9**。新增两个 ignored 已由上表显式执行，既有 PG/MySQL smoke/采样 ignored 未在本批重跑。两种构建的 all-targets 严格 Clippy 通过。 |

本批 core 方法在 Rust library test executable 中执行实际签名 sidecar；不是 Tauri IPC、原生文件对话框或已打包桌面端到端验收。前批 unsigned fixture `4IxMDi` 为历史机制证明，最终以上表生产签名解析证据为准。

最终 2612 文件模块检查、431 包无 Desktop 依赖图、39 处本地文档链接、Node syntax 和 diff 检查通过。已在全部 Desktop 检查后重建无 Desktop CLI，确认 `oxide-agent 0.1.18`；捆绑二进制无改动、native driver 进程无残留，临时签名私钥和百万行大夹具已清理。

## 2026-10-25：真实 Tauri 文件界面验收

文件查询已通过生产侧栏、provider 对话框、FileQueryEditor、Monaco 和只读 grid 的真实 Tauri → 签名 DuckDB Host 链路：CSV/JSON/JSONL/Parquet、实际 CTE 字段推荐与采纳、格式化、SQL 报错后重试、关闭与重开共 **5 场景 / 98 断言**。修复一次会话状态 IPC 失败被误判为会话结束的问题，新增 **4 项单元测试**，全量前端 **3023 / 451 文件**、生产 build **2908 文件**和 Desktop all-targets 严格 Clippy 通过。正常 Desktop 签名配置和无 Desktop CLI 已恢复。原生选择器实际选取、签名安装 UI、完整 Workbench、跨平台及全部 G01–G13/E01–E07 继续，见 [第七十三批](lsp-complex-semantics-audit-2026-10-23.md#第七十三批真实文件界面与签名-host-会话)。

使用全新临时签名包、真实 MetaStore 项目根和实际 Host，通过生产组件读取四种实际文件。独立 Open File action 仅打开并取消 provider 对话框，没有实际系统选取或完整命令面板 widget 验收。一次 status 拒绝是明确注入的 renderer 故障，SQL 错误、存活校验和重试执行均走真实 Host。所有源文件 SHA 在 Rust 退出时不变、所属进程 0；归档及复验命令见专项清单。

## 2026-10-25：文件悬停与配置同步中的局部语义

文件编辑器已接入实际列/表达式悬停，配置确认期间保留文档内类型、CTE 导航和大纲；格式化仍等待已确认的偏好。修复文档语义、结构与诊断 RPC 拒绝已登记兼容方言的问题，保留明确请求名称和实际适配器身份。DuckDB 以独立身份保留现有 ANSI 完成基线，新增 CAST/TRY_CAST 局部类型并保留 CTE 绑定、格式偏好及共享诊断。新增 **14 项前端、7 项 Rust 库、2 项协议测试**；全量前端 **3037 / 451 文件**、vendor **1093**、实捆绑协议 **99**、真实 LSP **88 场景 / 2405 断言**和签名文件 **6 场景 / 132 断言**通过。DBX 固定参考 53 项已重跑，正常 Desktop 与 headless CLI 已恢复。全部 G01–G13 / E01–E07 继续。

物理列推荐仍需配置确认；本批增加局部 hover/大纲/CTE 导航，保持格式偏好屏障。签名 Host 实际执行 CAST 确认 INTEGER 类型和值，系统选取/安装版仍未验证。见 [专项证据](lsp-complex-semantics-audit-2026-10-23.md#第七十四批文件语义接入与兼容方言快照)。

## 仍需完成

1. 编码选择、手动类型覆盖与推断控制；完整 DuckDB 语法/诊断、进阶编辑辅助，以及共享结果/后台任务/原生错误等更广范围国际化。源列类型预览、基本列补全、当前语句和格式化已接入。
2. 更多类型、并发源改写、损坏/超长记录、大文件交互和其他签名 provider 的实证。
3. 实际原生对话框选取、签名包安装界面、完整 Workbench、整个打包 Host 强杀与重启、Linux/macOS。发行时分配新驱动包版本，遵守已安装版本不可覆盖的规则；临时版本与签名不构成发布。

## 第七十五批：配置确认期间的文档补全与表变量推断

文件 SQL 在配置确认期间现在保留文档内智能推荐：嵌套 CTE、显式 CAST 类型、限定成员和完整后缀替换使用独立的当前文档 RPC；真实已显示的 Monaco 列表自动恢复为局部候选，确认后恢复物理文件列。补齐 SQL Server TABLE 变量的列绑定、类型/批次隔离，以及 ClickHouse CAST 局部类型；大列表先匹配排序再限量，避免末尾字段丢失。新增 **32 前端、12 Rust 库、3 协议、1 Host 测试**；全量 **3069 前端 / 452 文件、1108 vendor / 24 目标、1085 Host / 12 ignored**，实捆绑 **102 协议**、真实文件 **6 场景 / 142 断言**与共享 LSP **88 场景 / 2405 断言**通过。DBX 固定 53 项复测通过；全部 G01–G13 / E01–E07 继续。

配置确认前的候选仅来自当前文档和明确方言，不含暖物理目录。确认后恢复物理列推荐；格式化仍等待已确认的偏好。实际控件自动恢复和后缀接受见 [专项证据](lsp-complex-semantics-audit-2026-10-23.md#第七十五批配置确认期间的文档补全与表变量推断)。

## 第七十六批：主查询局部推荐与空列表恢复

主查询编辑器现复用文档补全 RPC：物理 available=false 但文档语法授权仍有效时，保留显式方言、嵌套 CTE、CAST 类型、完整后缀替换及表变量候选；独立服务端授权恢复后继续物理推荐。修复本地结果为空时丢失原列表恢复意图的问题，失焦、光标/文本/模型变化和 Escape 仍取消恢复。共享列定义模块修复 unique_count 误判 UNIQUE、引号保留字列丢失，以及 CHECK/CASE/字符串/注释导致的约束误判。新增 **25 前端、2 Rust 库、1 协议测试**；全量 **3094 前端 / 453 文件、1111 vendor / 24 目标**，真实 LSP **90 场景 / 2418 断言**、签名文件 **6 场景 / 142 断言**通过。Host 1085/12 ignored 按 642 个未变输入沿用第七十五批；本轮重跑严格 Clippy、构建及 Native。全部 G01–G13 / E01–E07 继续。

新增场景、失败修复、配置确认的剩余问题与完整范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第七十六批主查询局部推荐与空列表恢复)。

## 第七十七批：配置校验与失败后的推荐授权撤销

修复无效配置仍获确认、保留旧推荐授权的问题：服务端先完整解析与校验，再一次提交配置，最后登记 token；拒绝时保留最近有效设置并撤销旧、新 token。前端同一上下文同步失败后清除来源授权，重新确认前仅保留文档内推荐。新增 **7 前端、9 Rust 库、2 协议测试**；全量 **3101 前端 / 454 文件、1122 vendor / 24 目标**，真实 LSP **92 场景 / 2433 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

配置原子校验、真实渐进同步反例与剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第七十七批配置校验与失败后的推荐授权撤销)。

## 第七十八批：Where 提示的文档隔离与复杂条件补全

表格 Where 提示现拥有独立 LSP 缓冲区，继承原查询明确配置的目录与方言，避免覆盖或关闭主编辑器文档。接入共享上下文授权、文档内补全、请求取消与接受前复核；配置失败时撤回旧字段，复杂子查询局部候选继续可用。修复多行 UTF-16 编辑范围及普通 SQL 插入中的美元参数。新增 **42 前端、2 Rust 库、1 协议测试**；全量 **3143 前端 / 456 文件、1125 vendor / 24 目标**，真实 LSP **96 场景 / 2458 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

Where 授权、文档隔离、复杂条件实际接受及剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第七十八批where-提示的文档隔离与复杂条件补全)。

## 第七十九批：Where 字段来源与首次空列表恢复

消除 Where 字段对 Grid 列数组引用的授权依赖：旧结果重新映射或改变显示布局不会重新授予字段权限。字段现从当前连接、操作代次和配置回执校验下的驱动元数据取得，稳定上下文合并重复读取并复用有界缓存；复用编辑器作用域绑定，避免把当前表字段注入其他子查询。同时修复主查询与文件编辑器首次空列表在目录就绪后不恢复的问题。新增 **46 前端测试**，全量 **3189 / 458 文件**及生产构建通过；原生 LSP **98 场景 / 2481 断言**、签名文件 **6 场景 / 142 断言**通过。真实 SQLite ALTER 通过生产同步器自动撤回并恢复 Where 字段，无手动发布配置或递增全局元数据版本。全部 G01–G13 / E01–E07 继续。

字段来源代次、作用域隔离、真实自动同步及沿用证据见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第七十九批where-字段来源与首次空列表恢复)。


## 第八十批：Where 拼音、注释搜索与词法边界

Where 本地字段提示复用主编辑器的拼音、标识符缩写和列注释搜索，名称命中优先，完整匹配后再限制结果。字段缓存保留有界注释；异步词典加载后仍检查当前交互与来源授权。补上七种方言的字符串和注释边界，保留带引号字段补全及原有 LSP 值候选。另修复中文字段完成后可触发的 UTF-8 前缀切片崩溃，并保留中文列名以推断谓词值。新增 **35 前端、3 Rust 库、1 协议测试**，全量 **3224 / 460 文件、1129 vendor / 24 目标**及生产构建通过；真实 LSP **100 场景 / 2494 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

共享搜索、真实拼音候选接受、词法边界与沿用证据见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十批where-拼音注释搜索与词法边界)。


## 第八十一批：Where 嵌套表达式与合并候选语义

Where 本地提示改为复用方言词法扫描和有界表达式栈，区分函数参数、分组、BETWEEN、IN、CASE 与子查询；已完成的标量表达式提示比较运算符，字符串和注释中的关键字不再改变语法位置。加入保守类型与来源限定，并按当前语法位置筛选合并的服务端候选。候选接受按实际插入动作校验，同一动作刷新后继续有效，被移除的动作立即失效。新增 **117 前端测试**，全量 **3341 / 463 文件**及生产构建通过；真实 LSP **102 场景 / 2513 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。

嵌套语法、保守类型、合并策略、实际接受和剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十一批where-嵌套表达式与合并候选语义)。


## 第八十二批：全局方言值候选与主编辑器验证

全局服务端、文档内补全与 Where 本地回退按实际方言区分 Boolean 和 BIT：SQL Server/SQLite 使用 0/1，PostgreSQL/MySQL 使用对应宽度的位串，现有 DuckDB 使用显式 BIT 转换。已知数组不再继承标量真值候选；补上 IN 后续项、BETWEEN/CASE 类型来源和完整关键字后的插入范围。新增 **17 前端、4 Rust 库、11 集成、2 协议测试**；全量 **3358 / 464 前端文件、1146 vendor / 24 目标**通过。原生 LSP **104 场景 / 2527 断言**，签名文件 **6 场景 / 143 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。

方言字面量、复杂类型来源、原生主编辑器验证与剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十二批全局方言值候选与主编辑器验证)。


## 第八十三批：IS 复杂谓词推荐与长注释性能

标准与文档内补全共用 IS 关键字槽位；已知 PostgreSQL 非布尔字段不再推荐真值测试，SQL Server/ClickHouse 的现代空值安全比较按已知版本提供。Where 增加 IS [NOT] DISTINCT FROM、必填 FROM 及字段 RHS，保留 SQLite 任意表达式操作数。长注释剥离改为单次逆向消费。新增 **35 前端、8 Rust 库、5 协议测试**；全量 **3393 / 465 前端文件、1159 vendor / 24 目标**通过；原生 LSP **106 场景 / 2543 断言**，签名文件 **6 场景 / 144 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

方言语法、类型/版本来源、原生接受行为与性能边界见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十三批is-复杂谓词推荐与长注释性能)。


## 第八十四批：表达式类型探测复用与光标前缀性能

IS 推荐复用现有 AST 表达式类型推断，覆盖 PostgreSQL CAST、CASE、COALESCE、部分标量函数和布尔聚合，保留原始字符串常量的上下文转换。类型探测限制完整文档预算，光标转换在目标位置停止。新增 **8 前端、10 Rust 库、3 协议测试**；全量 **3401 / 465 前端文件、1172 vendor / 24 目标**通过；原生 LSP **108 场景 / 2592 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

共享推断、类型预算、原生接受与验证边界见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十四批表达式类型探测复用与光标前缀性能)。


## 第八十五批：PostgreSQL 类型身份与复杂推荐一致性

前后端补齐 PostgreSQL 内部别名、pg_catalog 限定名、引用大小写和数组类型身份；值候选、IS、算术、CASE/COALESCE、聚合、比较及重载排序共用后端类型解析。前端保留 CAST/postfix cast 的类型参数。新增 **52 前端、7 Rust 库、2 协议测试**；全量 **3453 / 466 前端文件、1181 vendor / 24 目标**通过；原生 LSP **110 场景 / 2640 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

类型身份、复杂表达式、真实控件接受及未完成范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十五批postgresql-类型身份与复杂推荐一致性)。


## 第八十六批：Where 语义约束与目录补全快照

关闭上一批复现的两个 Where 缺口：运算符过滤传递显式方言，IS 本地/远端合并使用后端完整关键字约束。新增目录补全快照绑定文档版本、位置、产品 profile 与已提交配置标识；文档内约束不读取目录。新增 **40 前端、4 Rust 库、5 协议、1 Host 测试**；全量 **3493 / 467 前端文件、1190 vendor / 24 目标、1086 Host 库 / 12 ignored**通过；原生 LSP **114 场景 / 2674 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。

约束语义、来源隔离、真实 Where 接受和完整剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十六批where-语义约束与目录补全快照)。


## 第八十七批：Where 真值类型知识与未知结果合并

修正显式关键字约束中的知识强度：truthTests=true 表示类型模型确认支持，false 表示确认不支持，省略表示未知。未知结果不再覆盖本地已知的文本/数值限制，已确认 Boolean 仍可覆盖本地内置函数假设。新增 **8 前端、1 Rust 库、1 协议测试**；全量 **3501 / 467 前端文件、1192 vendor / 24 目标**通过；原生 LSP **115 场景 / 2683 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。

三态类型知识、真实 Where 接受和完整剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十七批where-真值类型知识与未知结果合并)。


## 第八十八批：普通比较值的表达式类型贯通

普通比较值候选接入共享 AST 类型推断：标准补全与两类快照共用类型/模板策略，Where 使用绑定后的正面类型知识，且异步列刷新不能恢复旧的未知值。补齐 SQLite CAST 亲和性推断。新增 **24 前端、5 Rust 库、2 协议测试**；全量 **3525 / 467 前端文件、1199 vendor / 24 目标**通过；原生 LSP **119 场景 / 2718 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。

语义推断、SQLite 亲和性、实际控件验证与剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十八批普通比较值的表达式类型贯通)。


## 第八十九批：无目录类型推断与快照位置校验

关闭上一批独立协议探针复现的两项缺口：没有目录时，标准/目录补全复用文档内类型环境；两类快照共用严格 UTF-16 位置校验，拒绝越界与半个代理对。新增 **4 Rust 库、2 协议测试**；全量 **1205 vendor / 24 目标、3525 / 467 前端文件**通过，原生 LSP **121 场景 / 2734 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。

无目录类型回退、严格快照位置校验、实际控件与剩余范围见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第八十九批无目录类型推断与快照位置校验)。


## 第九十批：普通逻辑运算符与方言标量语义

新增显式 AND/OR 逻辑操作数知识，区分 true、false 与未知；目录返回类型刷新、文档隔离、延迟回包和完整关键词后缀替换贯穿实际 Where 控件。补齐 ClickHouse Decimal64(2) 等自定义数值类型参数语法。全量前端 **3576 / 467 文件**、vendor **1214 / 24 目标**通过；本轮原生 LSP **125 场景 / 2762 断言**、签名文件 **6 / 152**通过。G01–G13 / E01–E07 全范围保留。

具体语义、证据和剩余项目见 [专项清单](lsp-complex-semantics-audit-2026-10-23.md#第九十批普通逻辑运算符与方言标量语义)。


## 第九十一批：多方言谓词与条件结果推断

补齐 DuckDB/Hive/ClickHouse 的固定谓词结果模型，并让谓词在 NOT、逻辑组合、CASE 与本地 CTE 中保留类型；SQLite 也支持这些已知相同类型的条件分支。前端 **3576 / 467 文件**、vendor **1220 / 24 目标**通过；实际桌面 LSP **134 场景 / 2815 断言**、签名文件 **6 / 158**通过。原 G01–G13 / E01–E07 与文件双入口范围继续。

谓词与条件类型的修复、实际控件验收及剩余项目见 [专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十一批多方言谓词与条件结果推断)。

## 2026-10-25：第九十三批：ESCAPE 语义与单字符提示契约

补齐 LIKE/ILIKE 及已支持方言 SIMILAR TO 的 ESCAPE 结果类型与单字符提示，主编辑器、WHERE 和文件查询共用绑定后的语义角色。新增 26 前端、6 Rust 库、3 协议测试；全量前端 **3640 / 469 文件**、vendor **1241 / 24 目标**通过。实际桌面 LSP **160 场景 / 3019 断言**、签名文件 **6 / 191**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十三批escape-语义与单字符提示契约)。参考固定提交，不能证明远端最新；尚未全方言/全复杂语句对齐。

## 2026-10-25：第九十四批：匹配谓词续写与 ESCAPE 发现

主编辑器在完整匹配后主动发现可选 ESCAPE，完成匹配/转义后提供明确的 AND/OR 类型知识与完整 UTF-16 编辑；标准、目录和文档路径共用已有 AST 与类型策略。新增 4 Rust 库、4 协议测试；前端 **3640 / 469 文件**、vendor **1249 / 24 目标**通过。实际桌面 LSP **174 场景 / 3101 断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07 与文件双入口范围保持。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十四批匹配谓词续写与-escape-发现)。完整原范围继续，参考未再次fetch。

## 2026-10-25：第九十五批：WHERE 版本能力与语义快照

WHERE 的 LIKE/ILIKE/SIMILAR TO 可选 ESCAPE 现在使用绑定的版本能力，明确区分支持、不支持和未知；配置改变、文档恢复与晚到回包不会沿用旧授权。两条快照共用原子语义解析。新增29前端、1 Rust库、1协议测试；全量前端 **3669 / 470文件**、vendor **1251 / 24目标**通过。实际桌面 LSP **179场景 / 3155断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07及文件双入口范围继续。见 [当前专项记录](lsp-complex-semantics-audit-2026-10-23.md#第九十五批where-版本能力与语义快照)。完整原范围继续，参考未再次fetch。
