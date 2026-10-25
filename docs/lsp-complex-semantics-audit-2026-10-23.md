# LSP 复杂语义、推荐列表与 DBX 差距

创建日期：2026-10-23；最新验收日期：2026-10-25。按用户确认，对标对象为 `sources/dbx`，不是 DBChart。
参考源码为 `b160d130560f71c5c429be15cec6147f677a4b3a`；本批未重新 fetch。
原第九十五批验收基于 `vendor/sql-lsp@8c80923` 加当时未提交改动。发布源码现为 `941dc0b91fe3fb5c97b17de1d9144a7c306482eb`，已通过 [LSP PR #6](https://github.com/RainLib/lsp_sqls/pull/6) 合并；新制品复验与发布检查见 [发布校验](PUBLISH_VALIDATION_2026-10-25.md)。

## 当前结论（第九十五批）

WHERE 的 LIKE/ILIKE/SIMILAR TO 可选 ESCAPE 现在使用绑定的版本能力，明确区分支持、不支持和未知；配置改变、文档恢复与晚到回包不会沿用旧授权。两条快照共用原子语义解析。新增29前端、1 Rust库、1协议测试；全量前端 **3669 / 470文件**、vendor **1251 / 24目标**通过。实际桌面 LSP **179场景 / 3155断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07及文件双入口范围继续。见 [第九十五批](#第九十五批where-版本能力与语义快照)。

| 优先级 | 当前具体差距 | 已有验证与下一步 |
| --- | --- | --- |
| P1 | SQL mode、常量表达式限制、扩展与版本组合 | 本轮关闭WHERE版本能力丢失；更多匹配函数、会话设置和动态表达式仍待验证。 |
| P1 | BETWEEN/IN完整操作数、普通运算符、混合CASE、window/FILTER | 继续使用共享AST与类型规则增加复杂SQL正反例及编辑态验收。 |
| P1 | domain/复合类型、重载、search_path与真实厂商矩阵 | 已有证据按具体版本报告，不能推断所有数据库与会话。 |
| P2 | 列表排名/去重、跨provider与其他编辑器消费者 | 已覆盖主Query、WHERE、文件及新版本切换；继续核对剩余场景。 |
| P2 | 冷热启动、p95、内存、取消和大文档成本 | 本轮复用原解析与RPC，尚未证明整体性能改善。 |
| P2 | 完整可见Workbench、安装包、系统picker和其他平台 | 隐藏真实WebView/生产组件/Tauri通过，其余产品验收仍保留。 |

## 此前结论（第九十四批）

主编辑器在完整匹配后主动发现可选 ESCAPE，完成匹配/转义后提供明确的 AND/OR 类型知识与完整 UTF-16 编辑；标准、目录和文档路径共用已有 AST 与类型策略。新增 4 Rust 库、4 协议测试；前端 **3640 / 469 文件**、vendor **1249 / 24 目标**通过。实际桌面 LSP **174 场景 / 3101 断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07 与文件双入口范围保持。见 [第九十四批](#第九十四批匹配谓词续写与-escape-发现)。

| 优先级 | 当前具体差距 | 已有验证与下一步 |
| --- | --- | --- |
| P1 | Where 本地回退的完整版本感知可选匹配关键字 | 主编辑器已按目录版本/文档未知分别实测；Where 的未知版本语法回退仍不能等同目录版本能力。 |
| P1 | SQL mode、常量表达式限制、扩展与版本组合 | 当前匹配、ESCAPE 和续写有明确支持范围，仍不是任意运行时表达式或会话设置验证器。 |
| P1 | BETWEEN/IN 完整操作数、普通运算符、混合 CASE、window/FILTER | 继续增加复杂 SQL 及共享类型规则，避免将单项谓词支持外推全表达式。 |
| P1 | domain/复合类型、重载、search_path 与真实厂商版本矩阵 | 已有专项按真实验证范围报告，更多引擎/版本/会话仍待覆盖。 |
| P2 | 编辑态列表、排名/去重和跨 provider 一致性 | 当前14个新主编辑器场景覆盖实际接受，继续加入更多未完成语句和目录组合。 |
| P2 | 冷热启动、p95、内存、取消及大文档成本 | 新检查复用原树、受32层和文档预算限制；尚未证明整体速度改善。 |
| P2 | 完整可见 Workbench、安装包、系统 picker 和其他平台 | 隐藏真实 WebView/生产组件/Tauri 已测；其余原产品验收范围继续。 |

## 此前结论（第九十三批）

补齐 LIKE/ILIKE 及已支持方言 SIMILAR TO 的 ESCAPE 结果类型与单字符提示，主编辑器、WHERE 和文件查询共用绑定后的语义角色。新增 26 前端、6 Rust 库、3 协议测试；全量前端 **3640 / 469 文件**、vendor **1241 / 24 目标**通过。实际桌面 LSP **160 场景 / 3019 断言**、签名文件 **6 / 191**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。见 [第九十三批](#第九十三批escape-语义与单字符提示契约)。

| 优先级 | 当前具体差距 | 已有验证与下一步 |
| --- | --- | --- |
| P1 | 主编辑器匹配后尚缺可选 ESCAPE 发现与明确逻辑类型知识 | 独立发布字节探针确认 PG/DuckDB/SQLite 的 AND 候选存在，但 logicalContinuation 仍未知；Where 已有可选 ESCAPE，继续统一两个入口。 |
| P1 | 高级匹配的 SQL mode、常量表达式限制、扩展与版本组合 | 本轮补 ESCAPE 基础类型、字符角色与 NULL；不能保证任意运行时表达式合法。 |
| P1 | BETWEEN/IN 完整操作数、普通运算符、混合 CASE、window/FILTER | 继续扩充共享 AST 类型规则和复杂 SQL 矩阵；当前结果不是全表达式推导。 |
| P1 | domain/复合类型、重载、search_path 与真实厂商版本矩阵 | 每个专项按已验证版本报告；更多引擎和会话设置仍待覆盖。 |
| P2 | 编辑中智能列表、排名/去重、跨 provider 一致性 | 当前 Query/Where/文件、文档隔离和旧回包有回归；继续增加真实编辑过程。 |
| P2 | 冷热启动、p95、内存、取消及大文档成本 | 复用 AST/RPC 并保留预算；生成表体积增加，未证明端到端整体加速。 |
| P2 | 完整可见 Workbench、安装包、系统 picker、其他平台 | 隐藏真实 WebView、生产组件和 Tauri 已测；这些产品验收继续保留。 |

## 此前结论（第九十二批）

高级匹配的结果类型、右侧模式字符串和 NOT 候选统一按方言处理；覆盖 ILIKE、SIMILAR TO、REGEXP/RLIKE、GLOB 与已建模正则函数。新增 38 前端、8 Rust 库、4 协议测试；全量前端 **3614 / 468 文件**、vendor **1232 / 24 目标**通过。实际桌面 LSP **147 场景 / 2950 断言**，签名文件 **6 / 174**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。见 [第九十二批](#第九十二批高级匹配运算与模式类型提示)。

| 优先级 | 当前具体差距 | 已有验证与下一步 |
| --- | --- | --- |
| P1 | 高级匹配仍缺 ESCAPE、更多函数/扩展、版本与会话组合 | 本批 8 个已知结果缺口已关闭；继续加入真实 SQL、结果类型、编辑态和非法输入测试。 |
| P1 | BETWEEN/IN 的完整期望操作数、普通运算符、混合 CASE、window/FILTER | 当前比较值/逻辑知识不能代替完整表达式推导；继续复用共享 AST 与类型规则。 |
| P1 | domain/复合类型、重载、search_path 与更多专用方言 | PostgreSQL/SQL Server/MySQL/SQLite/Hive/DuckDB/ClickHouse 的专项通过范围各自记录；继续增加专用版本矩阵及真实引擎证据。 |
| P2 | 智能列表的更多未完成语句、排名/去重和跨 provider 一致性 | 当前实际 Query/Where、目录刷新/文档隔离和 UTF-16 接受已有回归；持续扩充编辑过程。 |
| P2 | 性能成本和规模化快照/失效 | 当前保留预算并复用 AST/RPC；生成语法表变大，仍需 cold/warm、p95、内存、取消和复杂文档基准。 |
| P2 | 完整可见产品、安装包、系统 picker 和跨平台 | 本批是实际隐藏 WebView + 生产组件 + Tauri，不等同于这些验收；原 G01–G13/E01–E07 范围保持。 |

## 此前结论（第九十一批）

补齐 DuckDB/Hive/ClickHouse 的固定谓词结果模型，并让谓词在 NOT、逻辑组合、CASE 与本地 CTE 中保留类型；SQLite 也支持这些已知相同类型的条件分支。前端 **3576 / 467 文件**、vendor **1220 / 24 目标**通过；实际桌面 LSP **134 场景 / 2815 断言**、签名文件 **6 / 158**通过。原 G01–G13 / E01–E07 与文件双入口范围继续。见 [第九十一批](#第九十一批多方言谓词与条件结果推断)。

## 此前结论（第九十批）

新增显式 AND/OR 逻辑操作数知识，区分 true、false 与未知；目录返回类型刷新、文档隔离、延迟回包和完整关键词后缀替换贯穿实际 Where 控件。补齐 ClickHouse Decimal64(2) 等自定义数值类型参数语法。全量前端 **3576 / 467 文件**、vendor **1214 / 24 目标**通过；本轮原生 LSP **125 场景 / 2762 断言**、签名文件 **6 / 152**通过。G01–G13 / E01–E07 全范围保留。见 [第九十批](#第九十批普通逻辑运算符与方言标量语义)。

## 此前结论（第八十九批）

关闭上一批独立协议探针复现的两项缺口：没有目录时，标准/目录补全复用文档内类型环境；两类快照共用严格 UTF-16 位置校验，拒绝越界与半个代理对。新增 **4 Rust 库、2 协议测试**；全量 **1205 vendor / 24 目标、3525 / 467 前端文件**通过，原生 LSP **121 场景 / 2734 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。见 [第八十九批](#第八十九批无目录类型推断与快照位置校验)。

## 此前结论（第八十八批）

普通比较值候选接入共享 AST 类型推断：标准补全与两类快照共用类型/模板策略，Where 使用绑定后的正面类型知识，且异步列刷新不能恢复旧的未知值。补齐 SQLite CAST 亲和性推断。新增 **24 前端、5 Rust 库、2 协议测试**；全量 **3525 / 467 前端文件、1199 vendor / 24 目标**通过；原生 LSP **119 场景 / 2718 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。见 [第八十八批](#第八十八批普通比较值的表达式类型贯通)。

## 此前结论（第八十七批）

修正显式关键字约束中的知识强度：truthTests=true 表示类型模型确认支持，false 表示确认不支持，省略表示未知。未知结果不再覆盖本地已知的文本/数值限制，已确认 Boolean 仍可覆盖本地内置函数假设。新增 **8 前端、1 Rust 库、1 协议测试**；全量 **3501 / 467 前端文件、1192 vendor / 24 目标**通过；原生 LSP **115 场景 / 2683 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。见 [第八十七批](#第八十七批where-真值类型知识与未知结果合并)。

## 此前结论（第八十六批）

关闭上一批复现的两个 Where 缺口：运算符过滤传递显式方言，IS 本地/远端合并使用后端完整关键字约束。新增目录补全快照绑定文档版本、位置、产品 profile 与已提交配置标识；文档内约束不读取目录。新增 **40 前端、4 Rust 库、5 协议、1 Host 测试**；全量 **3493 / 467 前端文件、1190 vendor / 24 目标、1086 Host 库 / 12 ignored**通过；原生 LSP **114 场景 / 2674 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。见 [第八十六批](#第八十六批where-语义约束与目录补全快照)。

## 此前结论（第八十五批）

前后端补齐 PostgreSQL 内部别名、pg_catalog 限定名、引用大小写和数组类型身份；值候选、IS、算术、CASE/COALESCE、聚合、比较及重载排序共用后端类型解析。前端保留 CAST/postfix cast 的类型参数。新增 **52 前端、7 Rust 库、2 协议测试**；全量 **3453 / 466 前端文件、1181 vendor / 24 目标**通过；原生 LSP **110 场景 / 2640 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。见 [第八十五批](#第八十五批postgresql-类型身份与复杂推荐一致性)。

## 此前结论（第八十四批）

IS 推荐复用现有 AST 表达式类型推断，覆盖 PostgreSQL CAST、CASE、COALESCE、部分标量函数和布尔聚合，保留原始字符串常量的上下文转换。类型探测限制完整文档预算，光标转换在目标位置停止。新增 **8 前端、10 Rust 库、3 协议测试**；全量 **3401 / 465 前端文件、1172 vendor / 24 目标**通过；原生 LSP **108 场景 / 2592 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。见 [第八十四批](#第八十四批表达式类型探测复用与光标前缀性能)。

## 此前结论（第八十三批）

标准与文档内补全共用 IS 关键字槽位；已知 PostgreSQL 非布尔字段不再推荐真值测试，SQL Server/ClickHouse 的现代空值安全比较按已知版本提供。Where 增加 IS [NOT] DISTINCT FROM、必填 FROM 及字段 RHS，保留 SQLite 任意表达式操作数。长注释剥离改为单次逆向消费。新增 **35 前端、8 Rust 库、5 协议测试**；全量 **3393 / 465 前端文件、1159 vendor / 24 目标**通过；原生 LSP **106 场景 / 2543 断言**，签名文件 **6 场景 / 144 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。见 [第八十三批](#第八十三批is-复杂谓词推荐与长注释性能)。

## 此前结论（第八十二批）

全局服务端、文档内补全与 Where 本地回退按实际方言区分 Boolean 和 BIT：SQL Server/SQLite 使用 0/1，PostgreSQL/MySQL 使用对应宽度的位串，现有 DuckDB 使用显式 BIT 转换。已知数组不再继承标量真值候选；补上 IN 后续项、BETWEEN/CASE 类型来源和完整关键字后的插入范围。新增 **17 前端、4 Rust 库、11 集成、2 协议测试**；全量 **3358 / 464 前端文件、1146 vendor / 24 目标**通过。原生 LSP **104 场景 / 2527 断言**，签名文件 **6 场景 / 143 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。见 [第八十二批](#第八十二批全局方言值候选与主编辑器验证)。

## 此前结论（第八十一批）

Where 本地提示改为复用方言词法扫描和有界表达式栈，区分函数参数、分组、BETWEEN、IN、CASE 与子查询；已完成的标量表达式提示比较运算符，字符串和注释中的关键字不再改变语法位置。加入保守类型与来源限定，并按当前语法位置筛选合并的服务端候选。候选接受按实际插入动作校验，同一动作刷新后继续有效，被移除的动作立即失效。新增 **117 前端测试**，全量 **3341 / 463 文件**及生产构建通过；真实 LSP **102 场景 / 2513 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。见 [第八十一批](#第八十一批where-嵌套表达式与合并候选语义)。

## 此前结论（第八十批）

Where 本地字段提示复用主编辑器的拼音、标识符缩写和列注释搜索，名称命中优先，完整匹配后再限制结果。字段缓存保留有界注释；异步词典加载后仍检查当前交互与来源授权。补上七种方言的字符串和注释边界，保留带引号字段补全及原有 LSP 值候选。另修复中文字段完成后可触发的 UTF-8 前缀切片崩溃，并保留中文列名以推断谓词值。新增 **35 前端、3 Rust 库、1 协议测试**，全量 **3224 / 460 文件、1129 vendor / 24 目标**及生产构建通过；真实 LSP **100 场景 / 2494 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。见 [第八十批](#第八十批where-拼音注释搜索与词法边界)。

## 此前结论（第七十九批）

消除 Where 字段对 Grid 列数组引用的授权依赖：旧结果重新映射或改变显示布局不会重新授予字段权限。字段现从当前连接、操作代次和配置回执校验下的驱动元数据取得，稳定上下文合并重复读取并复用有界缓存；复用编辑器作用域绑定，避免把当前表字段注入其他子查询。同时修复主查询与文件编辑器首次空列表在目录就绪后不恢复的问题。新增 **46 前端测试**，全量 **3189 / 458 文件**及生产构建通过；原生 LSP **98 场景 / 2481 断言**、签名文件 **6 场景 / 142 断言**通过。真实 SQLite ALTER 通过生产同步器自动撤回并恢复 Where 字段，无手动发布配置或递增全局元数据版本。全部 G01–G13 / E01–E07 继续。见 [第七十九批](#第七十九批where-字段来源与首次空列表恢复)。

## 此前结论（第七十八批）

表格 Where 提示现拥有独立 LSP 缓冲区，继承原查询明确配置的目录与方言，避免覆盖或关闭主编辑器文档。接入共享上下文授权、文档内补全、请求取消与接受前复核；配置失败时撤回旧字段，复杂子查询局部候选继续可用。修复多行 UTF-16 编辑范围及普通 SQL 插入中的美元参数。新增 **42 前端、2 Rust 库、1 协议测试**；全量 **3143 前端 / 456 文件、1125 vendor / 24 目标**，真实 LSP **96 场景 / 2458 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。见 [第七十八批](#第七十八批where-提示的文档隔离与复杂条件补全)。

## 此前结论（第七十七批）

修复无效配置仍获确认、保留旧推荐授权的问题：服务端先完整解析与校验，再一次提交配置，最后登记 token；拒绝时保留最近有效设置并撤销旧、新 token。前端同一上下文同步失败后清除来源授权，重新确认前仅保留文档内推荐。新增 **7 前端、9 Rust 库、2 协议测试**；全量 **3101 前端 / 454 文件、1122 vendor / 24 目标**，真实 LSP **92 场景 / 2433 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。见 [第七十七批](#第七十七批配置校验与失败后的推荐授权撤销)。

## 此前结论（第七十六批）

主查询编辑器现复用文档补全 RPC：物理 available=false 但文档语法授权仍有效时，保留显式方言、嵌套 CTE、CAST 类型、完整后缀替换及表变量候选；独立服务端授权恢复后继续物理推荐。修复本地结果为空时丢失原列表恢复意图的问题，失焦、光标/文本/模型变化和 Escape 仍取消恢复。共享列定义模块修复 unique_count 误判 UNIQUE、引号保留字列丢失，以及 CHECK/CASE/字符串/注释导致的约束误判。新增 **25 前端、2 Rust 库、1 协议测试**；全量 **3094 前端 / 453 文件、1111 vendor / 24 目标**，真实 LSP **90 场景 / 2418 断言**、签名文件 **6 场景 / 142 断言**通过。Host 1085/12 ignored 按 642 个未变输入沿用第七十五批；本轮重跑严格 Clippy、构建及 Native。全部 G01–G13 / E01–E07 继续。见 [第七十六批](#第七十六批主查询局部推荐与空列表恢复)。

## 此前结论（第七十五批）

文件 SQL 在配置确认期间现在保留文档内智能推荐：嵌套 CTE、显式 CAST 类型、限定成员和完整后缀替换使用独立的当前文档 RPC；真实已显示的 Monaco 列表自动恢复为局部候选，确认后恢复物理文件列。补齐 SQL Server TABLE 变量的列绑定、类型/批次隔离，以及 ClickHouse CAST 局部类型；大列表先匹配排序再限量，避免末尾字段丢失。新增 **32 前端、12 Rust 库、3 协议、1 Host 测试**；全量 **3069 前端 / 452 文件、1108 vendor / 24 目标、1085 Host / 12 ignored**，实捆绑 **102 协议**、真实文件 **6 场景 / 142 断言**与共享 LSP **88 场景 / 2405 断言**通过。DBX 固定 53 项复测通过；全部 G01–G13 / E01–E07 继续。见 [第七十五批](#第七十五批配置确认期间的文档补全与表变量推断)。

## 此前结论（第七十四批）

文件编辑器已接入实际列/表达式悬停，配置确认期间保留文档内类型、CTE 导航和大纲；格式化仍等待已确认的偏好。修复文档语义、结构与诊断 RPC 拒绝已登记兼容方言的问题，保留明确请求名称和实际适配器身份。DuckDB 以独立身份保留现有 ANSI 完成基线，新增 CAST/TRY_CAST 局部类型并保留 CTE 绑定、格式偏好及共享诊断。新增 **14 项前端、7 项 Rust 库、2 项协议测试**；全量前端 **3037 / 451 文件**、vendor **1093**、实捆绑协议 **99**、真实 LSP **88 场景 / 2405 断言**和签名文件 **6 场景 / 132 断言**通过。DBX 固定参考 53 项已重跑，正常 Desktop 与 headless CLI 已恢复。全部 G01–G13 / E01–E07 继续。见 [第七十四批](#第七十四批文件语义接入与兼容方言快照)。

### 较早批次记录

以下段落保留各批次验收时的状态；当前结果和未完成范围以第七十九批为准。

本轮将同一连接/操作代次屏障接入 **12 个 core provider（13 个回调）及 hover/DDL 预览**：拒绝晚到的导航、签名、重命名、修复建议、tokens 和 inlay 结果，并关闭可见旧 hover/签名、刷新行内提示。修复开放事务时连文档内推荐也被阻断的问题：保留嵌套 CTE 显式投影和 INSERT 显式列提示，不借用旧物理字段。新增 **42 项测试**，全量 **2566 / 430 文件**、生产 build **2859 文件**通过；真实 SQLite/生产 hooks/Monaco **58 场景 / 1784 断言**通过。诊断推送、inline/Console、事务内真实物理 metadata、真实角色切换等仍未完成。见 [第五十九批](#第五十九批其他编辑器提示的上下文屏障与事务内文档语义)。

本轮把驱动操作/事务状态接入生产推荐与元数据同步：操作前撤回旧列表，订阅后回读快照，装配前后核对后端代次；开放事务/未知状态暂缓物理字段。同连接突发 40 次状态变化只做一次稳定扫描。新增 **42 项前端测试**，全量 **2524 / 430 文件**、生产 build **2858 文件**通过；真实 SQLite、生产 hooks 和 Monaco **56 场景 / 1767 断言**通过。用户确认许可后，隔离 **SQL Server 16.00.4305** 的 JDBC conformance 通过并清理容器。真实 SQL Server 编辑器/角色切换、事务内专属补全、其他 LSP 方法与全部原目标仍未完成。见 [第五十八批](#第五十八批驱动事件接入推荐消费者与真实-sql-server)。

新增共享驱动操作/事务代次和只读快照/事件，覆盖 24 个 manager 分发入口；错误也推进，取消/未结束事务不冒充已恢复。新增 22 项 Rust、12 项 wire 测试；本轮 Desktop 库 **1082 / 12 ignored**、headless **427 / 4 ignored**、应用集成 **13**、前端 **2482 / 427 文件**及生产构建通过。真实 SQLite/Tauri 的隐藏 WebView **55 场景 / 1755 断言**通过。**新信号尚未接入前端自动失效消费者**，不能称任意角色/会话 SQL 已自动刷新。见 [第五十七批](#第五十七批驱动操作代次与真实事务信号)。全部原目标继续进行。

已将编辑器实际推荐、缓存降级候选、详情 resolve 和批量选列绑定到连接运行状态、元数据版本、项目与文档目标：跨上下文迟到结果不再显示或写回字段/外键缓存；已显示的旧列表会撤回，仅在原交互仍有效且新来源安全时恢复。同步期间不借用旧物理类型/注释，文档内显式声明和语法候选继续可用。新增 **25 项测试**；本轮全量 **2470 前端 / 426 文件、54 隐藏 WebView 场景 / 1743 断言**通过，生产 build **2845 文件**通过。真实 Monaco 验证了无编辑的旧列表撤回、新字段恢复与实际接受。见 [第五十六批](#第五十六批推荐列表的上下文失效与真实控件恢复)。这些校验依赖已观察到的运行状态/元数据事件，任意 SQL 的角色/会话变化、其他 LSP 方法、真实数据库与完整产品验收仍保持未完成。

同一连接 ID 重连时，能力/版本上下文现按运行状态重新读取，拒绝旧响应；LSP 配置先清空旧来源，再装配新元数据。修复内存缓存失效后又读回持久旧字段的问题：新运行状态或已完成同步后的 metadataVersion 变化会强制读取字段/索引/约束，稳定会话仍复用缓存。配置发送按同一客户端串行，失败不阻塞后续清空/恢复。新增 **18 项测试**；本轮全量 **2445 前端 / 424 文件、53 隐藏 WebView 场景 / 1735 断言**通过，生产构建通过。新 Native 场景实际清空 CTE 的物理来源类型，再经并发配置恢复推荐和 hover；数据库仍为边界夹具。见 [第五十五批](#第五十五批重连上下文与持久元数据刷新)。查询中的角色/会话改变检测、编辑器缓存降级列表的即时失效和全部原目标仍继续，未宣称所有上下文已经闭环。

新增驱动发布门禁 **27 项测试**，连同原有 5 项共 **32 passed / 0 failed / 0 skipped**；另有实际 H2/JVM/打包 **3 项回归**无跳过通过。支持 lookup context 的 runtime 必须证明当前/跨库默认 schema 与独立查询观察到的恢复；同时修复 runner 的 Windows 包路径越界、测试启动覆盖绕过 classpath 校验及 junction 接受问题。实际 Microsoft JDBC 候选包已构建并完成真实 JVM 握手，仍未签名、安装或发布。隔离 SQL Server Developer 测试已准备，等待用户明确接受微软许可后才能启动；本批没有真实 SQL Server 结果。应用与 LSP 输入哈希均未变，前端/Host/桌面沿用第五十三批，LSP/DBX 矩阵沿用第五十二批。见 [第五十四批](#第五十四批驱动发布门禁与真实引擎候选)。全部 G01–G13 / E01–E07 和文件查询双入口继续进行。

新增驱动确认的 SQL Server 当前数据库/默认 schema 只读链路：JDBC → 协议 → Host → Tauri → 同步任务，自动加载实际默认 schema 并保持文档目录绑定；旧驱动返回未知，目录列表不授予缺表证明。本轮发现并修复 JDBC Agent 在 Windows 下中文标准输入输出乱码。新增 **14 前端、2 Host、2 协议、1 JVM 测试组**；前端 **2427 / 422 文件**、Host Desktop 库 **1060 passed / 12 ignored**、headless 库 **405 / 4 ignored**、协议 **14**、JVM **4**、应用集成 **13**通过。真实隐藏 WebView **52 场景 / 1730 断言**，新增场景使用生产同步/元数据命令和真实 LSP/Monaco，但数据库边界为夹具，未执行真实 SQL Server。LSP 字节未改，1023/80/固定 DBX 53 结果明确沿用第五十二批。见 [第五十三批](#第五十三批驱动确认的默认上下文与实际推荐链路)。签名 JDBC 包尚未更新部署，完整缺表/权限/模块上下文和其他原目标继续进行。

服务端配置现以同一事务更新 schemas、文件映射、默认方言与偏好；真实请求可并发读取，分析过程中配置不会被拆开替换。诊断使用原子的文本/版本/内部 revision 快照，并在排队发送前复核文档与配置版本，关闭后重开相同版本也不复用旧计算。新增 **9 项库 + 2 项真实协议测试**；全量 **1023 Rust / 24 目标**、新捆绑 release 实字节 **80 协议测试**、真实隐藏 WebView **51 场景 / 1718 断言**、应用集成 **13 项**通过。DBX 固定 53 夹具已用新 release 重跑；前端生产输入不变，2413 单测明确沿用第五十一批，本批新跑 build 和桌面链路。见 [第五十二批](#第五十二批配置事务与诊断快照的一致性)。真实连接上下文、完整复杂类型/方法一致性、可见 Workbench/安装版等原目标继续进行。

元数据更新后，真实 Monaco 行内提示与语义着色现在通过文档分析通知失效，无需修改 SQL；同会话/文档/LSP 版本校验、过期响应和取消隔离已接入查询编辑器与文件查询。修复 Monaco 0.55.1 监听器生命周期问题，并锁定安装补丁的版本和字节摘要。新增 **24 项前端测试 + 5 项安装补丁测试**；本轮前端 **2413 项 / 419 文件**、安装补丁 **8 项**、真实隐藏 WebView **51 场景 / 1718 断言**及应用集成 **13 项**通过。Rust LSP、捆绑字节、源码包与固定 DBX 53 夹具均未变，后端测试结果明确沿用第五十批；详见 [第五十一批](#第五十一批元数据变化后的真实行内提示刷新)。服务端多来源原子快照、真实连接默认上下文和完整 Workbench 仍待继续。

文档级 INSERT 提示与 OXIDE004 字段歧义诊断已接入逐来源元数据查找，跨 catalog/schema/server 与同 SQL 的元数据刷新不再只看活动 schema；显式 INSERT 列名在无物理元数据时仍可提示。新增 **10 库 + 2 真实协议测试**，本轮全量 **1012 Rust / 24 目标**与捆绑 release 实字节 **78 协议测试**通过；真实隐藏 WebView **50 场景 / 1700 断言**通过，包含生产核心 provider 的实际 Monaco 行内提示渲染。前端生产代码未改，2389 项单测沿用第四十九批记录，本轮重跑 build 与新的桌面链路。DBX 固定 53 夹具已用新 release 复测。见 [第五十批](#第五十批跨来源的文档提示与歧义诊断)。实际连接默认上下文采集、屏幕旧行内提示的无编辑重绘、各方法来源一致性及完整 Workbench 仍待继续。

原生 LSP 不再把省略 schema 的 `db..table` 自动改成 dbo。显式提供有效默认 schema 和表枚举完整性时，先用默认 schema 的对象，确认默认 schema 缺表后才允许 dbo 回退；未知、缺失、冲突或未完成快照不猜类型。新增 **8 项 Rust 库、2 项真实协议、1 项前端测试**；全量 **1000 Rust / 24 目标、2389 前端 / 417 文件**通过，捆绑 release 实字节 **76 项协议测试**通过；隐藏 WebView **48 场景 / 1583 断言**通过。DBX 固定 53 夹具已用新二进制复测。详见 [第四十九批](#第四十九批省略-schema-的显式解析与完整性证明)。应用侧自动采集会话元数据、文档级 hints/检查路径、模块执行上下文和完整 Workbench 仍待补齐。

本批修复 SQL Server 四段式表名忽略服务器的问题，并给 CTE/派生表加入按来源匹配的跨命名空间类型推断；生产缓存推荐能证明多输入中唯一的未限定字段，未知来源/真歧义不借用本地类型或注释。新增 **60 项前端测试、6 项 Rust 库测试和 2 项原生协议测试**。全量 **2388 项前端 / 417 文件、990 项 Rust / 24 目标**通过；捆绑 release 实字节 **74 项协议测试**、隐藏 WebView **47 场景 / 1473 断言**通过。固定 DBX 53 夹具使用新二进制重新运行。详见 [第四十八批](#第四十八批来源身份唯一字段证明与跨服务器类型)。默认 schema 的会话语义、远程元数据传输和完整 Workbench 尚待补齐。

生产缓存推荐已能沿 CTE、派生表和直接投影传递真实字段类型/注释，支持重命名、限定通配符、多层来源及 MATERIALIZED/带引号列名声明；计算、歧义、集合分支和递归未知输出不借用同名字段注释。新增 **48 项前端测试**，全量 **2328 项 / 415 文件**通过；真实隐藏 WebView 为 **45 场景 / 1397 断言**，包含实际推荐控件的引用名称插入、真实 LSP 缺少元数据时的局部结果合并。详见 [第四十七批](#第四十七批局部直接投影的类型注释与声明识别)。完整表达式/连接类型、厂商词法/会话/版本与完整 Workbench 仍在推进。

生产缓存推荐已能从光标后的 FROM 绑定 SELECT 字段，支持相关子查询、窗口表达式、集合分支、逗号输入以及显式 CTE/派生表/表函数输出。当前语句边界与光标查询位置分别定位；ON、普通派生表、后续 JOIN/语句和未声明 CTE 有隔离反例。新增 **70 项前端测试**，全量 **2280 项 / 414 文件**通过；真实隐藏 WebView 为 **44 场景 / 1288 断言**，包括实际推荐控件接受 SELECT 列表中的注释搜索字段。详见 [第四十六批](#第四十六批光标后的-from-与完整文档查询绑定)。完整投影类型/注释、所有方言规则和完整 Workbench 仍在推进。

前端实际 provider 的缓存推荐现已支持列注释、中文/拼音首字母与规范标识符插入；补齐相关子查询、集合分支、同名别名及非 LATERAL 派生表的来源隔离，并修复长 SQL 后缀匹配的平方级扫描。新增 **47 项前端测试**，全量 **2210 项 / 413 文件**通过；真实隐藏 WebView 为 **43 场景 / 1202 断言**，包括生产 provider/coordinator、实际推荐控件接受候选及空 LSP 响应合并。详见 [第四十五批](#第四十五批缓存推荐的语义隔离与长-sql-性能)。下段后端数字复用第四十四批相同源码/捆绑字节的验收，本批不重复宣称运行全部 Rust LSP 测试。

已将拼音首字母与列注释搜索接入真实字段绑定和推荐排序，保留字段类型、规范名称及完整 TextEdit；直接字段投影/重命名的 CTE 和派生表继承真实注释，计算表达式不借用同名列注释。支持六种实测 SQL profile、混合中英文、跨层来源、同 SQL 元数据刷新及有界重查。最新为 **982 项 LSP 测试（789 库 + 193 集成，24 目标）、72 项最终捆绑协议、13 项应用集成，以及真实 WebView 40 场景 / 1108 断言**。本批新增 12 项库与 2 项原生测试；详见 [第四十四批](#第四十四批拼音与列注释搜索的绑定和排序)。

固定 **53 组 SQL/schema/UTF-16 光标对比**现均符合原有检查，候选 46/46、原类型 44/44、隔离/抑制 7/7；四处历史缺口已在本矩阵内修复。输入和 DBX 运行 bundle 摘要不变，详见 [专项比较](dbx-sql-completion-comparison-2026-10-24.md)。这些计数不证明全方言/版本、所有复杂语句、可见弹窗、完整 Workbench 或安装版均已对齐；G01–G13、E01–E07 全目标继续进行。

| 优先级 | 仍需补齐的差距 | 需要的证据 |
| --- | --- | --- |
| P1 | Hive 基础输出绑定已修复；自定义 UDTF 元数据、完整转换和版本语义待补齐 | 更多复杂构造器/隐式转换、UDTF 签名/定义、真实引擎与厂商版本正反矩阵 |
| P1 | QUALIFY 直接别名 hover/定义与完整窗口函数/会话规则 | 统一绑定模型、窗口返回类型、重名设置与更多版本/真实引擎 |
| P1 | 拼音/注释基础已修复；字典/多音词组、长注释与更大 catalog 的完整交互待补齐 | 搜索偏好、更多元数据来源、大 catalog 连续编辑/RSS、可见推荐与安装版 |
| P1 | 缓存直接投影的类型/真实注释、光标后 FROM 和基础作用域已修复；计算/集合/递归类型及完整方言词法仍需补齐 | 统一来源模型、完整连接树/厂商版本、更多方言正反例及真实元数据加载 |
| P0 | 分组/隐式键基础已修复；完整方言连接树、类型强制转换、会话与名单限制仍待补齐 | 更完整正反矩阵、真实厂商/版本与同夹具效果核验 |
| P0 | 分组 LATERAL/APPLY 基础已修复；完整关联图、FROM/逗号/隐式函数、所有恢复与深层预算仍待补齐 | 更完整厂商正反作用域与引擎/版本、编辑刷新回归 |
| P1 | 统一类型/控制流模型及更多表值函数 | 候选、hover、定义、签名在复杂投影中一致 |
| P1 | 可见推荐弹窗与完整 React Workbench/安装版效果 | 自动触发/重查、实际接受编辑和安装路径验收 |
| P1 | 全平台/真实厂商版本覆盖与性能 | 远端 CI、Linux/macOS、真实引擎、连续编辑/冷启动/RSS/桌面延迟 |

## 已复现并修复

检查真实 `LanguageServer::completion` 返回的候选、字段类型及作用域，不把关键词识别或方言别名注册当作完整支持。

| 场景 | 复现的问题 | 当前行为 |
| --- | --- | --- |
| MySQL / Oracle / PostgreSQL JSON_TABLE | COLUMNS 与 NESTED PATH 声明的列未进入推荐列表 | 提取显式名称、类型、嵌套列和序号列；序号列的产品具体类型保持 unknown，不伪造统一类型 |
| PostgreSQL record 函数 | `AS r(city text, postal_code integer)` 没有列候选 | 支持 json/jsonb 的 to_record / to_recordset 显式类型声明 |
| SQL Server OPENJSON | WITH 声明被当成无法识别的尾部 | 支持显式 WITH 列；无 WITH 时提供固定的 key/value/type 结构 |
| 同名函数多次调用 | 单一函数名不足以表达不同调用的输出 | 限定成员查询绑定当前函数别名；测试两次 JSON_TABLE 调用的字段互不串用 |
| JSON 表函数 → CTE / 派生表 | `SELECT j.*` 的结构跨层后丢失 | 投影分析先建立当前查询的函数输出结构，再展开限定及非限定星号 |
| 列重命名后的类型 | `SELECT u.id AS name` 可能错误拿到原表 name 的 text 类型 | 类型从当前行来源中的 id 继承；不再按输出别名搜索整个 catalog |
| 转义标识符 | 双引号、反引号、方括号中的转义终止符截断列名 | 共享标识符读取保留转义字符；声明扫描区分被噪声掩码隐藏的标识符与注释 |

例如：

```sql
WITH projected AS (SELECT u.id AS name FROM users u)
SELECT p. -- 推荐 name，类型来自 id，而不是原表 name
FROM projected p;
```

```sql
WITH expanded AS (
  SELECT j.*
  FROM JSON_TABLE('[]', '$[*]' COLUMNS (
    city VARCHAR(30) PATH '$.city',
    NESTED PATH '$.items[*]' COLUMNS (amount DECIMAL(10,2) PATH '$.amount')
  )) j
)
SELECT e. -- 推荐 city、amount
FROM expanded e;
```

声明语法按官方文档核对：[MySQL JSON_TABLE](https://dev.mysql.com/doc/refman/8.4/en/json-table-functions.html)、[PostgreSQL JSON/record 函数](https://www.postgresql.org/docs/current/functions-json.html)、[Oracle COLUMNS](https://docs.oracle.com/en/database/oracle/oracle-database/26/adjsn/columns-clause-sql-json-function-json_table.html)、[SQL Server OPENJSON](https://learn.microsoft.com/en-us/sql/t-sql/functions/openjson-transact-sql?view=sql-server-ver17)。本批是编辑器语义验收，不是连接这些数据库执行 SQL 的兼容性认证。

## 测试矩阵

新增 [complex_semantics.rs](../vendor/sql-lsp/src/server/tests/complex_semantics.rs) 使用合成且字段互不重叠的 users/orders/audit schema，通过真实服务器方法断言候选列表。

| 分组 | 覆盖内容 |
| --- | --- |
| 5 个基础 SQL 方言入口 | PostgreSQL、MySQL、SQLite、Hive、ClickHouse：JOIN、相关 EXISTS、内外层别名遮蔽、并列派生表、多层 CTE、CASE、GROUP/HAVING、窗口与窗口 frame、UNION 首分支命名、跨语句隔离、未来 FROM、Unicode、注释与未完成谓词 |
| 专用/兼容路径 | 三类关系方言的递归 CTE；PostgreSQL MATERIALIZED/LATERAL；SQL Server APPLY；JSON_TABLE 的 MySQL/Oracle/PostgreSQL 路径；record 和 OPENJSON |
| 推荐项质量 | 应出现及不应出现的字段、类型详情、插入文本、可选 textEdit 的 UTF-16 范围、限定符保留、函数调用隔离、跨 CTE/派生表传播 |
| 导航一致性 | 声明列的 hover 类型、当前文档 URI 和定义声明行 |
| 退化与预算 | 超过 256 列或 16 层声明不生成虚假部分结构；64 KiB 连续空白仍保留有效字段并受时间门禁约束 |

首批 36 个新单元测试内部有 **133 个带方言/预期结果的场景检查**，其中包括预算拒绝和导航检查；这不是 133 条不同 SQL，更不是所有数据库场景均已覆盖。后续缓存/刷新增量另列在下方，不重复记入这 133 组。Oracle/SQL Server 仍走兼容方言实现，本批只证明矩阵中列出的行为。

## 模块与性能

- [table_functions.rs](../vendor/sql-lsp/src/server/local_relations/table_functions.rs) 只解析已知表函数的显式行结构，不执行 JSON，也不猜测任意用户函数的返回类型。复用调用方的噪声掩码；限制递归深度与列数，关键字扫描先跳过空白，避免长空白的重复后缀扫描。
- [projection.rs](../vendor/sql-lsp/src/server/local_relations/projection.rs) 负责当前查询的行来源、星号展开和普通源列的类型传递。一次推断只建立一次 parser/行来源；不再为每个星号表达式重新解析整段查询。
- [syntax.rs](../vendor/sql-lsp/src/server/local_relations/syntax.rs) 复用注释、引号和顶层分隔工具。投影边界与逗号切分共享一次噪声扫描，替代逐关键字重新分配掩码；删除已无调用者的旧包装函数。

这些是对应路径的工作量改善。全局 schema 克隆、请求缓存、超长文档和桌面输入延迟尚未因此取得全面性能结论。

## 第二批：共享作用域扫描与有界语法树复用

按相同 64 KiB 连续空白夹具拆分旧路径耗时：完整诊断解析 **52.3224 ms**，上下文判断 **0.3525 ms**，别名分析 **70.6447 ms**，完整服务器方法 **391.6312 ms**。据此处理语法/作用域重复工作，没有扩大扫描上限或缓存最终推荐列表。

- [query_scopes.rs](../vendor/sql-lsp/src/parser/sql/query_scopes.rs) 返回同一作用域的可见源码及噪声掩码；statement 边界、嵌套范围、别名和行来源复用已有掩码。等长字节替换保留 UTF-8、CR/LF、引号和偏移。共享掩码后的一次独立观测为别名 **17.4513 ms**、完整服务器方法 **207.6079 ms**。
- 新 [syntax_tree.rs](../vendor/sql-lsp/src/parser/sql/syntax_tree.rs) 分离纯语法树与诊断渲染。PostgreSQL、MySQL、Hive、ClickHouse 补全使用纯语法树，SQLite 沿已有 MySQL 适配路径受益。相同 SQL 复用树，编辑按最小 InputEdit 增量解析；完整诊断仍重新收集。
- 每个 parser 最多额外保留一棵树，输入限 **256 KiB**、节点限 **32768**；超限仍解析而不保留额外树。缓存只依赖原始 SQL 和构造时固定的语法/占位符方言；schema、候选和诊断不缓存。该限额只约束新增保留的树，不代表整个 parser 的总内存预算。

新增 **16 个库测试**：6 个作用域/Unicode/CRLF/相关别名/噪声/软边界检查，6 个语法缓存、增量一致性、诊断及资源上限检查，4 个编辑/schema 更新或删除/方言切换检查；另增 **1 个真实进程测试**，保持 SQL 不变，经配置刷新列名后确认旧候选消失、新候选出现。缓存命中用仅测试构建中的实际解析计数及 AST 一致性验证，不使用 Tree-sitter clone 的根句柄作为共享证明。

当前全量 **371 passed / 0 failed / 0 ignored**（248 库 + 123 集成），严格 all-targets Clippy 通过。检查位于 [scopes.rs](../vendor/sql-lsp/src/parser/sql/tests/scopes.rs)、[syntax_cache.rs](../vendor/sql-lsp/src/parser/sql/tests/syntax_cache.rs)、[complex_semantics.rs](../vendor/sql-lsp/src/server/tests/complex_semantics.rs)、[原生协议测试](../vendor/sql-lsp/tests/integration_test_client.rs)。日志为 `.impeccable/review/lsp-scope-*`、`lsp-syntax-*`、`lsp-cache-*`、`lsp-performance-*`。

同机 debug 构建、同一极端空白输入，最终三次独立进程观测：

| 观察 | 纯语法冷解析 | 同 SQL 语法树复用 | 完整服务器首次请求 | 同服务器重复请求 |
| --- | --- | --- | --- | --- |
| 1 | 33.9902 ms | 10.9 μs | 315.8681 ms | 199.7344 ms |
| 2 | 62.3941 ms | 8.3 μs | 250.7051 ms | 212.3869 ms |
| 3 | 26.9337 ms | 4.9 μs | 212.3649 ms | 177.9617 ms |

分段值来自分别调用，不相加，也不作为 p95、固定加速比或发布版桌面延迟。调度波动明显，完整语义路径仍有数百毫秒成本。最新 2500 表 catalog 单次观测为 PostgreSQL **13.4111 ms**、MySQL **1.3057 ms**、Hive **3.3125 ms**、ClickHouse **2.5385 ms**，通过原 5 秒粗回归门禁；不复用上一批 1–3 ms 的记录作为本批结果。仍需发布构建、连续编辑与真实桌面基线。

本批受测原生可执行文件 SHA-256：`90462b5ebf5b2f6cf791184811bfceb7c4ebc6f44686854ef7251c9c72208988`。没有修改捆绑二进制/清单、提交子模块或执行远端 CI。统一跨 provider 语义图、表达式类型和超大文档降级继续推进。

## 第三批：表达式类型、成员编辑态与别名 hover

本批新增 12 个库测试和 1 个真实 stdio 进程测试。当前全量 **384 passed / 0 failed / 0 ignored**（260 库 + 124 集成，24 个目标），all-targets 严格 Clippy、Rust fmt 和模块大小检查通过。本批只改 LSP 源码及文档，未更新捆绑二进制、提交子模块、推送或运行远端 CI。

| 已实现并测试的范围 | 推荐列表与 hover 的结果 |
| --- | --- |
| PostgreSQL/MySQL/T-SQL 的显式 CAST | 从 AST 类型节点读取目标类型及参数；嵌套 CAST/CASE 内部的 AS 不再被误作输出别名 |
| PostgreSQL 聚合 | SUM 的 smallint/integer→bigint、bigint/numeric→numeric、real→real；AVG 的整数→numeric、real→double precision；限定内置有序类型的 MIN/MAX |
| MySQL 聚合 | SUM/AVG 对整数/decimal 提示 decimal 类型族，对 float/double 提示 double；不伪造聚合结果的精度与小数位 |
| COUNT 与窗口 | PostgreSQL/MySQL 为 bigint，SQLite 为 integer，T-SQL 为可空 int 元数据；覆盖 DISTINCT、分区窗口；PostgreSQL 的 row_number/rank/dense_rank 为 bigint，空窗口 frame 的 SUM 保持可空 |
| PostgreSQL CASE/COALESCE | 仅分析结果分支，支持相同类型及 smallint/integer/bigint/numeric 的保守合并；CASE 缺 ELSE 可空，COALESCE 有确定非空回退时可标非空 |
| CTE/派生表及方言刷新 | 表达式类型传递到外层成员候选与 hover；同 URI、同 SQL 从 MySQL 切 PostgreSQL 后 SUM 类型重新计算，使用配置方言而非文件后缀 |
| 字段中间编辑 | `t.re<cursor>sult` 保持成员候选；修复普通别名的 hover 绑定，并换算 hover 输入的 UTF-16 光标；保留 DDL 表名、外键 REFERENCES、schema 函数推荐，排除小数点、字符串和注释 |

复用每个投影查询已有的一棵语法树，不为每个表达式新建 parser；表达式递归限 32 层，仍保留 512 KiB 局部关系增强上限。物理字段可空性保守处理，避免外连接把 NOT NULL 输入扩展为 NULL 后仍显示非空。无法识别的函数、schema/引号限定函数、混合不兼容 CASE、未建模方言和 SQLite 动态 SUM 保持 unknown；不按函数名跨方言套规则。

规则依据：[PostgreSQL 聚合](https://www.postgresql.org/docs/current/functions-aggregate.html)、[窗口函数](https://www.postgresql.org/docs/current/functions-window.html)、[CASE/COALESCE](https://www.postgresql.org/docs/current/functions-conditional.html)、[公共类型解析](https://www.postgresql.org/docs/current/typeconv-union-case.html)、[MySQL 聚合](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html)、[SQLite 聚合](https://www.sqlite.org/lang_aggfunc.html)、[SQL Server COUNT 元数据](https://learn.microsoft.com/en-us/sql/t-sql/functions/count-transact-sql?view=sql-server-ver17)。这些是编辑器静态推断测试，没有连接各数据库执行这批 SQL；bare built-in 的 search_path/UDF 重载仍需完整 catalog 解析。

源码与测试：[类型推断模块](../vendor/sql-lsp/src/server/local_relations/expression_types.rs)、[表达式单元测试](../vendor/sql-lsp/src/server/local_relations/expression_types/tests.rs)、[服务器语义矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics.rs)、[成员上下文测试](../vendor/sql-lsp/src/parser/sql/tests/completion.rs)、[原生协议测试](../vendor/sql-lsp/tests/integration_test_client.rs)。新增原生用例包含 emoji 注释、字段中间光标、CTE→CAST→SUM→COALESCE，并故意让文件后缀及 didOpen 语言与 PostgreSQL 配置冲突，验证候选及 hover 都显示 bigint，正常关闭进程。首轮空候选复现日志在 `.impeccable/review/lsp-expression-completion-initial.log`；最终全量及 Clippy 日志为 `lsp-expression-all-targets.log`、`lsp-expression-clippy.log`。

DBX 静态核对：[SqlSemanticProjection / SqlSemanticCteOutputColumn](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 保存名称、表达式、跨度及普通列来源；这里没有完整的聚合返回类型字段或执行器。对齐重点仍是作用域、来源与推荐的正确性；本批不把表达式推断称作 DBX 已有能力，也没有运行 DBX 桌面做主观效果等同验收。

本机 debug 的独立 64 KiB 空白夹具观测：纯语法冷解析 **27.7776 ms**、缓存命中 **9.5 μs**，局部结构 **53.9448 ms**、方言补全 **78.131 ms**、完整服务器冷/重复请求 **211.0103 / 163.9352 ms**，原粗回归门禁通过。分段分别调用，不相加；一次样本不代表 p95 或固定性能提升。日志为 `.impeccable/review/lsp-expression-performance.log`。受测原生 exe SHA-256：`a7fa358b0c98161db4e48c70b64407c867e10021e8780f96eea786970f462e52`。

第三批结束时的边界（第四批进展见下节）：PostgreSQL `::`、TRY_CAST、算术/字符串与日期表达式、字符串字面量隐式转换、域/自定义类型与重载、UNION 跨分支类型统一、CTE 显式列名单的类型传递、其他方言的完整表达式规则尚未完成。显式非星号集合投影暂不从首分支猜类型。整个 JOIN 结果的可空性分析、共享语义图、发布构建与安装版推荐体验继续验收。

## 第四批：位置投影、显式名单与 PostgreSQL 集合类型

继续核对实际工作树后，六个新增场景全部复现失败：显式 CTE 名单丢失类型/剩余列、派生表未命名表达式错位、PostgreSQL 后缀转换无法识别，以及 UNION 类型被统一降为 unknown。原始日志保留在 `.impeccable/review/lsp-output-initial.log`，不把后来通过的结果覆盖为原有能力。

本批新增 **19 个库测试 + 1 个真实进程测试**。最终全量 **404 passed / 0 failed / 0 ignored**（279 库 + 125 集成、24 个目标）；all-targets 严格 Clippy、Rust fmt、2681 文件模块大小和局部关系边界检查通过。

| 修复 | 证据与边界 |
| --- | --- |
| 位置投影模块 | 新增 [query_output.rs](../vendor/sql-lsp/src/server/local_relations/query_output.rs)，保留未命名及同名投影的占位，先按位置应用显式列名单，再过滤无法命名的公开候选。部分名单仅重命名前缀，后续列保留。未知星号宽度、集合列数不匹配或资源不足时，不把后续类型配到错误名称 |
| CTE/派生表类型传播 | COUNT、CAST、COALESCE、普通字段及星号可经显式 CTE 名单和派生表 correlation list 传递。两层 CTE 在 PostgreSQL/MySQL/SQLite/Hive/ClickHouse 以及 Oracle/T-SQL 兼容入口的候选类型有服务器方法证据；这只证明这些合成 schema 场景，不代表兼容入口具有独立 grammar |
| 行来源和星号顺序 | 集合各分支独立绑定物理表和派生表；混合星号按实际 FROM/JOIN 顺序展开，嵌套来源行号按父查询基线累加。覆盖嵌套派生表、重复列改名、未命名窗口表达式、带注释/中文引号的限定星号；歧义列不取第一个同名字段的类型 |
| PostgreSQL UNION/INTERSECT/EXCEPT | 按列合并相同类型与已建模数值类型族，保留左侧名称；使用成对解析、左结合及 INTERSECT 更高优先级，括号可改变顺序。覆盖 NULL UNION 1、NULL UNION NULL UNION 1 的不同结果，以及整数/numeric/real/double precision 类型提升。其他方言的集合转换规则没有套用 PostgreSQL，而保留 unknown |
| PostgreSQL 后缀转换 | 修复占位符归一化把第二个冒号后的类型名误认成 :参数的问题，真正的 :bind/$1 仍可识别；覆盖连续 ::、带参数类型、空数组维度、中文/emoji 偏移。投影 parser 使用实际配置的占位符方言 |
| 数组语法与诊断 | 新增 [array_casts.rs](../vendor/sql-lsp/src/parser/sql/array_casts.rs)，针对上游把后缀数组类型的空括号读成缺失下标的形状做 PostgreSQL 专用恢复。保留普通下标/字符串下标的原语义，不把它们当类型后缀。同时补报 has_error=true、is_missing=false 的零宽度 identifier 中隐藏的缺失表达式；有效转换无诊断，转换参数内的真实错误仍有诊断，MySQL 不使用该恢复 |

同一输出推断最多分析 **64 个 SELECT 分支（含嵌套派生表）/32 层查询递归**，嵌套派生表共用预算，未为每层重新开启预算。测试验证平衡的 64 分支得到类型、65 分支与过深输入保留显式名称但降为 unknown。此预算是单次输出推断的边界，不是整个服务器的总 CPU/内存承诺；文档级 512 KiB 上限和表达式 32 层上限仍在。

测试入口：[输出语义单元测试](../vendor/sql-lsp/src/server/local_relations/output_tests.rs)、[占位符识别](../vendor/sql-lsp/src/placeholder.rs)、[语法/诊断验证](../vendor/sql-lsp/src/parser/sql/tests/syntax.rs)、[服务器候选与 hover](../vendor/sql-lsp/src/server/tests/complex_semantics.rs)、[真实 stdio](../vendor/sql-lsp/tests/integration_test_client.rs)。新增 stdio 用例在一个服务器中验证两份文档：未命名投影→显式名单→UNION→后缀 CAST，以及数组转换；包含 emoji 和与配置冲突的 mysql 文件后缀/didOpen 语言，候选与 hover 均断言具体类型并正常退出。全量/Clippy 日志为 `.impeccable/review/lsp-output-all-targets.log`、`lsp-output-clippy.log`；诊断漏报的语法树原始记录在 `lsp-array-error-recovery.log`。

类型和语法依据：[PostgreSQL 集合运算优先级](https://www.postgresql.org/docs/current/queries-union.html)、[公共类型和成对解析](https://www.postgresql.org/docs/current/typeconv-union-case.html)、[WITH](https://www.postgresql.org/docs/current/queries-with.html)、[类型转换](https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-TYPE-CASTS)、[数组类型](https://www.postgresql.org/docs/current/arrays.html)。这些是静态编辑器与协议证据，本批没有连接数据库执行 SQL，也没有运行 DBX 桌面或更新参考仓库。

最终独立 debug 观测：64 KiB 空白夹具的局部形状 **53.7303 ms**、方言补全 **73.734 ms**、完整服务器首次/重复请求 **218.55 / 177.2987 ms**；纯语法冷解析 **25.5592 ms**、缓存命中 **9.7 μs**。通过现有粗门禁；分段独立调用，不相加，一次样本不证明固定提速或 p95。日志为 `.impeccable/review/lsp-output-performance.log`。本批原生 exe SHA-256：`a163baa929c514524a16424396445e60472bdd68026fa0e2be26b5beeea049bd`。

后续仍包括：其他方言集合类型规则、字符串/日期/JSON/算术与 TRY_CAST、域和函数重载、递归 CTE 的类型收敛、嵌套 WITH 的统一语义快照、默认表达式名称、更多数组表达式与 grammar 诊断、JOIN 可空性、超大文档和真实桌面延迟。没有修改捆绑二进制/清单、提交或推送；G01–G13、E01–E07 全目标保留进行中。

## 第五批：算术表达式、TRY_CAST 与原文位置

首批 6 个新单元测试中 5 个失败，确认普通计算、聚合内计算及 TRY_CAST 缺少类型；日志保留在 `.impeccable/review/lsp-arithmetic-initial.log`。之后新增独立的 [算术规则模块](../vendor/sql-lsp/src/server/local_relations/expression_types/arithmetic.rs) 和 [解析适配模块](../vendor/sql-lsp/src/parser/sql/normalization.rs)，不通过查询执行或跨方言猜测补类型。

| 方言/范围 | 本批支持与明确边界 |
| --- | --- |
| PostgreSQL 数值算术 | +、-、*、/、% 按 smallint/integer/bigint/numeric/real/double precision 的已建模内置数值规则合并；浮点 % 保持 unknown。支持字段/括号表达式的一元正负号、带指数的数值字面量、数值 typmod 去除，以及与 SUM/AVG、CASE、COALESCE、窗口组合 |
| MySQL 数值算术 | 整数 +、-、* 提示 bigint，整数 / 提示 decimal 类型族，精确小数参与时提示 decimal，近似值参与时提示 double；保留无符号结果。无符号整数减法依赖 NO_UNSIGNED_SUBTRACTION，缺少该配置时保留 unknown。除法考虑 NULL 结果；没有伪造 div_precision_increment 或精度/小数位。% 与非字面量的一元规则仍待扩充 |
| T-SQL 数值算术 | 已建模 tinyint/smallint/int/bigint/decimal/real/float 的二元数值优先级、float(24)/float(53) 区别和大整数字面量的 decimal 类型族；不把所有整数提升为 bigint。decimal 只提示类型族，不虚构参数化后的精度；运行设置未知时可空性保守。money、字符串重载、日期运算等不在本批规则中 |
| TRY_CAST | 共享 grammar 可读取未限定的 TRY_CAST(... AS ...) 结构；返回类型推断限定 sqlserver/mssql/tsql 配置，失败可空。覆盖参数化目标、嵌套 CAST 和后续算术；同一拼写在 PostgreSQL/MySQL 不被赋予 T-SQL 返回类型。普通 UDF 调用、schema 限定名及引号名不做该适配 |
| 推荐与 hover | 实际 LanguageServer 方法验证 6 类表达式，各经 CTE 显式名单和派生表传播，共 12 条服务器路径；另在真实 stdio 服务器中分别验证 PostgreSQL 聚合+一元运算、MySQL 聚合乘法、T-SQL TRY_CAST+加法，均断言具体候选及 hover 类型 |

上游 grammar 把字段或括号表达式前的 +、- 读为 ERROR。解析适配保持源字节数不变，语义规则继续读取原运算符；原文、位置、候选插入和格式化不会显示内部适配符号。TRY_CAST 的原文名称/范围完整保留为 8 个字符，避免生成假的 TRY_ 列引用；函数大小写策略仍作用于完整名称。适配前掩码给引号/字符串保留不透明操作数标记，避免把引号后的二元减法误判成一元符号。PostgreSQL 适配掩码处理嵌套注释，既有通用噪声掩码的方言行为未因此统一改写。

TRY_CAST 的括号/AS 识别使用单次扫描和栈，避免每个嵌套调用重新扫描整个参数。增量和缓存解析统一经过同一适配；Unicode/emoji、UTF-16 范围、真实绑定参数、注释/字符串/引号保护、普通 UDF 名称、错误类型语法、完整函数 token 和函数大小写均有单元证据。仅做语法适配不等于判定该数据库支持一种语法；实际方言的完整诊断仍属后续工作。

新增 **13 个库测试 + 1 个真实进程测试**；原有位置投影用例中 1+2 的预期从 unknown 更新为已实现的 integer。最终全量 **418 passed / 0 failed / 0 ignored**（292 库 + 126 集成、24 个目标）；all-targets 严格 Clippy、fmt、2684 文件模块与局部关系边界检查通过。测试见 [算术与 TRY_CAST](../vendor/sql-lsp/src/server/local_relations/expression_types/tests/arithmetic.rs)、[解析/范围回归](../vendor/sql-lsp/src/parser/sql/tests/syntax.rs)、[服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics.rs)、[原生 stdio](../vendor/sql-lsp/tests/integration_test_client.rs)。最终日志为 `.impeccable/review/lsp-arithmetic-all-targets.log`、`lsp-arithmetic-clippy.log`。

规则依据：[PostgreSQL 数值运算](https://www.postgresql.org/docs/current/functions-math.html)、[MySQL 运算及无符号规则](https://dev.mysql.com/doc/refman/8.4/en/arithmetic-functions.html)、[MySQL 精确/近似表达式](https://dev.mysql.com/doc/refman/8.4/en/precision-math-expressions.html)、[MySQL Item_int 内部类型实现](https://github.com/mysql/mysql-server/blob/8.4/sql/item.h)、[SQL Server 加法优先级](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/add-transact-sql?view=sql-server-ver17)、[整数字面量与参数化](https://learn.microsoft.com/en-us/sql/t-sql/data-types/int-bigint-smallint-and-tinyint-transact-sql?view=sql-server-ver17)、[精度规则](https://learn.microsoft.com/en-us/sql/t-sql/data-types/precision-scale-and-length-transact-sql?view=sql-server-ver17)、[TRY_CAST](https://learn.microsoft.com/en-us/sql/t-sql/functions/try-cast-transact-sql?view=sql-server-ver17)。这些是静态类型/类型族与编辑器协议验证，没有执行这批 SQL 做真实数据库返回元数据认证，也没有运行 DBX 桌面效果对比。

本机 debug 的一次独立 64 KiB 空白夹具观测：局部形状 **66.3655 ms**、方言补全 **92.5038 ms**、完整服务器首次/重复请求 **248.9841 / 201.2897 ms**；纯语法冷解析 **30.6896 ms**、缓存命中 **9.3 μs**。通过原粗门禁；分段独立调用不相加，不作为 p95 或固定提速结论。日志为 `.impeccable/review/lsp-arithmetic-performance.log`。本批 exe SHA-256：`e746232014c4b0e0545f14a26ded035c95390934f0f77ff70d1e737c41a45513`。

仍需继续：更多 SQL 运算符、字符串/日期/JSON、money/bit 等类型、更多方言的完整表达式和诊断、UDF/域/操作符重载、递归 CTE 类型收敛、统一语义快照、默认投影名称、发布构建与真实桌面延迟。没有更新捆绑二进制/清单、fetch、提交或推送；G01–G13、E01–E07 整体目标继续进行。

## 第五批后的差距记录（历史，当前状态见顶部）

| 优先级 | 差距/证据边界 | 下一步验收 |
| --- | --- | --- |
| P1 | DBX 有统一的 row-source / cursor-intent / dialect adapter；Oxide 的局部关系、投影、导航仍是多层扫描组合 | 为每个行来源建立稳定身份、父作用域及投影依赖；补全、hover、导航、诊断共用版本化快照，避免相同函数名/同名列各自推断 |
| P1 | Oracle/SQL Server 等大量名字仍是兼容路由；特定候选通过不等于专用 grammar、诊断、格式化齐全 | 按产品和版本补引号、别名可见性、routine、PIVOT/UNPIVOT、层级查询等专项；逐项记录实际结果，不靠扩大别名表声明支持 |
| P1 | 第三至五批已补部分 CAST/::/TRY_CAST、数值算术、CASE、聚合/窗口、COALESCE、位置名单及 PostgreSQL 集合数值类型；完整推导仍缺更多运算符、字符串、日期、JSON、域/重载及其他方言规则 | 扩充递归/嵌套 WITH、TRY_CAST、JOIN 可空性、歧义和错误恢复；无法确定时保留 unknown |
| P1 | 当前仍有 512 KiB 文档级局部关系增强上限；已有单元测试明确记录超限降级 | 按 statement/revision 缓存有界语义快照，验证编辑、schema 更新、方言切换和取消后的失效；不能只增大扫描阈值 |
| P2 | 智能列表的推荐排序、更多不完整编辑状态、跨查询块作用域还需持续扩充 | 加入成员前缀、模糊匹配、歧义消解、列表去重、textEdit 与 provider 一致性矩阵 |
| P2 | DBX 特殊语句和各厂商扩展尚缺全面专项证据 | 从双方语法/测试及官方 SQL 示例扩充 fixtures，覆盖 MERGE、JSON/XML 表函数、LATERAL VIEW、数组、QUALIFY、MATCH_RECOGNIZE 等；未验证项不标为已支持或已确定不支持 |
| P2 | 单元/原生 LSP 与安装版用户体验是不同证据 | 验证新的 LSP 构建在桌面中的装载、Monaco 推荐列表、schema 刷新、输入延迟和取消；本批不改已捆绑的 LSP 二进制及签名清单 |

DBX 对照源码：[语义模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts)、[方言策略](../sources/dbx/apps/desktop/src/lib/sql/semantic/dialect.ts)、[推荐适配](../sources/dbx/apps/desktop/src/lib/sql/semantic/completion.ts)、[fixtures](../sources/dbx/apps/desktop/src/lib/sql/semantic/fixtures.ts)。这些能力分层值得对齐，不把前端语义工具等同于完整数据库语言服务器。

## 复验入口

```powershell
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$env:CARGO_BUILD_JOBS='4'
cargo test --locked --offline --manifest-path vendor/sql-lsp/Cargo.toml --lib
cargo clippy --locked --offline --manifest-path vendor/sql-lsp/Cargo.toml --all-targets -- -D warnings
```

首批详细日志位于 `.impeccable/review/lsp-complex-*`。基础库基线为 196 项；新增矩阵保留最初失败日志。首批 **354 passed / 0 failed / 0 ignored**（232 库 + 122 集成），第二批为 **371 项**，第三批为 **384 项**，第四批为 **404 项**，第五批当前全量为上方的 **418 项**。全量命令为 `npm run test:lsp`（有缓存时也可直接使用上述 offline Cargo 入口）。

替换了原来嵌套 `cargo run --release`、只等待进程存活和空初始化用例的旧测试；当前直接测试已编译服务器，读写/请求/退出均有 deadline，正常关闭 stdin 并要求进程退出 0。夹具最初两次因为参数为 null 而非省略、以及未释放 stdin 句柄而失败，已修正测试客户端，原日志保留，不算服务端语义修复。Root CI 新增 Windows/Linux 的格式、严格 Clippy 和全目标回归；远端 Actions **未执行**。LSP Cargo.lock 开始纳入版本控制，锁定本批实际受测依赖。修改仍在子模块工作树，未提交、推送或更新根项目的 gitlink。

本机 Windows x64、debug/no-debuginfo 的一次独立观测：2500 表 catalog 补全 PostgreSQL **1.505 ms**、MySQL **1.0519 ms**、Hive **2.6165 ms**、ClickHouse **2.5372 ms**。64 KiB 连续空白的分段观测为局部结构 **53.3534 ms**、方言补全 **175.3214 ms**、完整服务器方法 **380.5718 ms**，三者为分开调用，不相加，也不是 p95 或桌面端到端延迟。极端长空白仍有数百毫秒成本，不能因此声明性能问题全部解决；后续需在发布构建上分析共享快照、重复上下文扫描和增量失效。

首批受测本地 LSP 可执行文件 SHA-256：`f639dfdef752c90016632ba2c571f0f06749bbeb52e67c10f47a64dc244386f7`；第二批摘要另列，不混用原生证据。G01–G13、E01–E07 整体对齐目标保持进行中。


## 第六批：高级搜索语义、函数推荐与字符串边界

本批从实际服务器候选入手，最初 5 个测试组 **1 passed / 4 failed**：字段作用域原本可用，但 PostgreSQL 搜索函数目录、返回类型、嵌套签名和 MySQL MATCH 片段缺失。扩展测试又复现了 PostgreSQL `&&` 解析、MySQL 中文反引号字段，以及搜索字符串内部误推荐字段的问题。原始日志分别保留为 `.impeccable/review/lsp-search-initial.log` 和历史测试输出；最终结果不表示这些能力原本已支持。

本批新增 **19 个库测试组 + 1 个真实 stdio 进程测试**，每组包含多条表达式、方言或编辑状态。最终全量 **438 passed / 0 failed / 0 ignored**（311 库 + 127 集成、24 个目标），严格 all-targets Clippy、Rust fmt、2691 文件模块大小及解析器/局部关系/协议边界检查通过。修正两个旧边界脚本：解析器现在有 25 个模块、214 个方法，归一化由增量和完整解析共用；初始化参数已经是引用，检查器相应核对实际调用。没有改动协议行为以迎合检查字符串。

| 实现与验证 | 当前结果和边界 |
| --- | --- |
| 搜索函数统一目录 | [search_functions.rs](../vendor/sql-lsp/src/search_functions.rs) 同时提供函数候选、重载参数及固定返回类型族；包含 TO_TSVECTOR、TO_TSQUERY、PLAINTO/PHRASETO/WEBSEARCH_TO_TSQUERY、SETWEIGHT、TS_RANK/CD、TS_HEADLINE、JSONB_PATH_EXISTS/MATCH/QUERY_FIRST/QUERY_ARRAY，以及 MySQL 的 MATCH、REGEXP_LIKE/INSTR、JSON_CONTAINS/PATH/EXTRACT/SEARCH。AGAINST 仅提供子句签名，不伪装成独立函数候选 |
| 方言与版本 | PostgreSQL 短语搜索从 9.6、websearch 从 11、JSON path 从 12；MySQL JSON 从 5.7、REGEXP_LIKE/INSTR 从 8.0 类型族启用。沿用现有 major/minor 版本模型，不能区分 MySQL 8.0 的 patch 版本。删除被版本排除的旧目录同名条目，验证同 URI/同 SQL 的版本升降级重新生成候选；未给 MariaDB/SQLite/T-SQL 套用 MySQL/PostgreSQL 规则 |
| MySQL MATCH…AGAINST | [match_against.rs](../vendor/sql-lsp/src/parser/sql/match_against.rs) 对完整复合表达式做等字节适配；支持默认、BOOLEAN MODE、NATURAL LANGUAGE MODE、WITH QUERY EXPANSION 及自然语言加查询扩展，嵌套查询表达式和绑定参数。完整表达式结果为 double，单独 MATCH 不猜类型；候选插入包含 AGAINST 的可编辑片段。列名单不接受字符串或 LOWER(column) 等任意表达式 |
| PostgreSQL 搜索运算符 | [search.rs](../vendor/sql-lsp/src/server/local_relations/expression_types/search.rs) 根据已知操作数处理 tsvector/tsquery 的 @@、连接、&&、短语和包含，文本正则，以及 JSON 的 ->/->>/#>/#>>、包含、键存在和路径谓词；支持字符串键数组。补充已知数值比较、布尔 AND/OR/NOT 和 tsquery 否定的组合。类型不匹配或未知自定义操作数保留 unknown；没有实现完整 PostgreSQL 运算符重载解析 |
| 编辑过程和原始坐标 | 不带空格的 @@/@? 不再吞掉相邻函数名或被识别为参数；真实 @bind/:bind/$1/? 仍有反例验证。`&&`、MySQL 反引号字段只适配 parser 输入，原始 SQL、UTF-8 字节/CRLF 和 UTF-16 字段坐标保留；验证中文、emoji、转义反引号、原始 token 及增量/重新解析一致 |
| 字符串和注释内候选 | [completion_regions.rs](../vendor/sql-lsp/src/server/completion_regions.rs) 在 SQL 推荐入口做无分配的前缀扫描，避免字符串中的 u.name 被当作字段；覆盖单引号/转义、PostgreSQL dollar quote/嵌套注释、MySQL # 注释，保留引号/方括号字段补全位置。没有将该 SQL 规则施加到 MongoDB/Redis/Elasticsearch DSL |
| 复杂推荐与 hover | [服务器搜索矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/search.rs) 检查字段中间编辑、排除无关表字段、显式 CTE 输出类型和 hover；另有加权向量→三层 CTE→相关度/窗口排序→派生表→外层 score 的完整语句，候选及 hover 均为 real。真实 stdio 测试验证 PostgreSQL/MySQL 结果类型及嵌套参数位置 |

规则依据：[PostgreSQL 全文搜索](https://www.postgresql.org/docs/current/functions-textsearch.html)、[加权检索与排序](https://www.postgresql.org/docs/current/textsearch-controls.html)、[9.6 短语搜索目录](https://www.postgresql.org/docs/9.6/functions-textsearch.html)、[11 websearch 目录](https://www.postgresql.org/docs/11/functions-textsearch.html)、[12 SQL/JSON path](https://www.postgresql.org/docs/12/release-12.html)、[JSON 运算符](https://www.postgresql.org/docs/current/functions-json.html)、[MySQL 布尔检索](https://dev.mysql.com/doc/refman/8.4/en/fulltext-boolean.html)、[MySQL 正则函数](https://dev.mysql.com/doc/refman/8.4/en/regexp.html)、[MySQL MATCH 的实数表达式实现](https://github.com/mysql/mysql-server/blob/8.4/sql/item_func.h)。MySQL REGEXP_LIKE/JSON 谓词提示 integer 语义族，不认证驱动返回的整数元数据位宽。

DBX 核对仍基于固定源码：其 [投影及 CTE 结构](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 保存表达式跨度、名称及普通列来源；[推荐目录](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 包含部分正则/搜索词及 Manticore MATCH。未从这些代码得到“DBX 已完整推断所有高级搜索返回类型”的证据，也未运行 DBX 桌面做效果等同验收。后续仍应按共同 SQL 夹具比较作用域、候选排序、插入编辑范围、错误恢复和实际桌面交互。

性能处理保留原有 32 层表达式/查询、64 个输出分支及 512 KiB 局部增强预算。MATCH 识别先建立括号配对，搜索模式后缀至多读取 8 个词，避免为每个候选位置分配完整剩余后缀；未引入保存旧 schema 候选的缓存。既有 64 KiB 空白夹具单次本机 debug 观测：纯语法冷/缓存命中 **25.5408 ms / 8.7 μs**，结构 **47.0255 ms**，方言 **127.4316 ms**，完整服务器冷/重复请求 **176.5596 / 136.0236 ms**；粗门禁通过。分段分别调用，不相加，不据单次样本宣称性能提升或 p95 已达标。

本批原生 exe SHA-256：`198ff7ffec09bab492cdbc9204a85959b7206ad29a597a9df60593d2552efd7a`。日志为 `.impeccable/review/lsp-search-all-targets.log`、`lsp-search-clippy.log`、`lsp-search-performance.log`，汇总为 `lsp-search-evidence.json`。没有连接各数据库执行这些 SQL，也未更新桌面捆绑二进制、提交/推送、重新 fetch DBX 或执行远端 CI。

仍需推进：共享跨 provider 语义图、更多方言的表达式/搜索规则、search_path/UDF 完整重载、函数参数类型验证、全文索引/配置检查、搜索字符串自身的语法提示和 SQL modes 感知；Oracle/T-SQL/Spark/Trino/DuckDB 等高级查询的独立 grammar/类型覆盖及发布版桌面体验尚不能称为全支持。此处提供固定返回类型族，不把合法的调用参数数量当作数据库执行有效性的证明。G01–G13、E01–E07 总目标保持进行中。


## 第七批：SQL Server 搜索行集与 Oracle Text 分数

继续按实际推荐效果核对：首轮 5 个测试组 **0 passed / 5 failed**，复现 SQL Server 全文行集没有 KEY/RANK、推荐和签名目录缺失，以及 Oracle SCORE 的派生输出类型为 unknown。原始日志为 `.impeccable/review/lsp-vendor-search-initial.log`。扩展用例又定位 LANGUAGE 参数误报和 CASE WHEN 的文本上下文错误；这些问题已修复后重新执行完整测试。

新增 **13 个库测试组 + 1 个真实进程测试**，最终全量 **452 passed / 0 failed / 0 ignored**（324 库 + 128 集成、24 个目标）。严格 all-targets Clippy、fmt、2694 文件模块大小以及解析器/局部关系/协议边界检查通过。解析器现为 26 个模块、214 个方法，新增适配模块仍由归一化统一调用。

| 能力 | 实现与验证范围 |
| --- | --- |
| SQL Server 全文行集 | CONTAINSTABLE/FREETEXTTABLE 在 FROM/JOIN 位置提供参数片段，保留 ClickHouse 原有表函数推荐；不把行集函数混入 SELECT 标量函数目录。支持普通列、列名单、星号、搜索变量/Unicode 字符串、LANGUAGE 和 top_n_by_rank 的受测组合 |
| 返回列和来源 | [全文行集结构](../vendor/sql-lsp/src/server/local_relations/table_functions/fulltext.rs) 提供 KEY 和 RANK，RANK 为 int。现有 Schema 未保存实际全文唯一键索引关联，KEY 保持 unknown，不能按主键类型猜测。验证无别名、显式别名、完整两列重命名、同函数多次调用、限定星号及 CTE 传递；不泄漏原表 name/email 或其他表字段 |
| 参数类别 | [搜索目录](../vendor/sql-lsp/src/search_functions.rs) 显式区分 Scalar/Predicate/Table；SQL Server CONTAINS/FREETEXT 的签名用于条件提示，不把它们推断为可直接投影的 boolean/bit。Oracle CONTAINS 和 SCORE 则为 number，支持 label 参数和派生输出。未把 Oracle Text 扩展到 OceanBase Oracle 兼容入口 |
| LANGUAGE 语法 | [fulltext.rs](../vendor/sql-lsp/src/parser/sql/fulltext.rs) 用一次括号/参数位置扫描，只在全文函数的指定参数槽适配 LANGUAGE 前缀。原文字节、换行和语言值保留，不改普通函数、限定 UDF、字符串或注释中的相似文本；保留真正的损坏表达式诊断。原始文本仍是用户文档，适配属于共享 grammar，不表示其他引擎也支持此语法 |
| CASE 与条件推荐 | 修复文本上下文路径把 searched CASE WHEN 当成 SELECT 已完成的问题，以及 JOIN ON 的条件位置。简单 CASE 的 WHEN 值、DDL ON、ORDER BY 和直接 SELECT 的候选有反例；函数提示先判断当前不完整前缀之前的语境，搜索谓词复用这次有界扫描结果，不额外扫描整个文档 |
| 版本/配置和错误边界 | 同一 URI 的 SQL Server→PostgreSQL→SQL Server 配置变化重新计算行集结构。反例覆盖错误方言、schema 限定 UDF、错误参数数量/表参数/列参数/第五参数和标量误用。这里只校验静态行集结构所需形状，不认证完整引擎调用有效性 |

[服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/vendor_search.rs) 包含多组 LANGUAGE/CRLF/注释/字符串形式、NEAR/FORMSOF/ISABOUT 搜索表达式及跨 CTE 的 RANK 候选和 hover。[原生 stdio](../vendor/sql-lsp/tests/integration_test_client.rs) 在一个真实进程内验证两份带 emoji 的文档，故意使用与配置冲突的 mysql 后缀：SQL Server 行集→两列改名→CTE→成员推荐/hover 为 int，Oracle 派生 SCORE 为 number，且两份 pull diagnostics 都为空；进程正常关闭。未连接 SQL Server/Oracle 执行查询，因此不能以此证明全文组件、索引、权限、语言包或搜索结果正确。

依据：[Microsoft CONTAINSTABLE](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/containstable-transact-sql?view=sql-server-ver17)、[FREETEXTTABLE](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/freetexttable-transact-sql?view=sql-server-ver17)、[Microsoft 的 int 排名投影示例](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew)、[Oracle CONTAINS 返回声明](https://docs.oracle.com/en/database/oracle/oracle-database/26/ccref/contains.html)、[Oracle SCORE 返回 NUMBER](https://docs.oracle.com/database/121/ADXDB/app_depr_otext.htm)。本批没有伪造这些长期存在功能的精确引入版本；目录可用不等于目标安装启用了全文功能。

与 DBX 的比较仍是固定源码核对：通用投影/CTE 模型强调名称、跨度和普通列来源，不能据此证明其已提供本批所有引擎返回类型推断。此次按引擎规则增加静态行集及分数类型，没有做 DBX 桌面交互等同验收。

性能预算仍为 512 KiB 局部增强、32 层表达式/查询及 64 个输出分支；新增 LANGUAGE 扫描和参数识别按输入线性处理，不增加候选/schema 的持久缓存。既有 64 KiB 空白夹具单次本机 debug 观测：纯语法冷/命中 **18.4524 ms / 2.7 μs**，局部结构 **29.8493 ms**，方言 **47.2823 ms**，完整服务器冷/重复请求 **124.5097 / 103.4637 ms**，粗门禁通过。它不是本批搜索语句的专项延迟分布，也不证明稳定加速或 p95 改善。

本批受测原生 exe SHA-256：`979e4a9c41bdb88b14bf012d61a6facda63d19fba0176f2c6ad56eb10f8e2cb3`。全量、Clippy、性能与汇总分别为 `.impeccable/review/lsp-vendor-search-all-targets.log`、`lsp-vendor-search-clippy.log`、`lsp-vendor-search-performance.log` 和 `lsp-vendor-search-evidence.json`。未更新桌面捆绑二进制/清单，未 fetch、提交、推送或执行远端 CI；固定 DBX 参考不变。

剩余重点：全文唯一键元数据接入、SCORE label 的关联/有效性验证、搜索字符串自身的 mini-language 提示、独立方言 grammar/重载和嵌套注释/SQL mode 覆盖、真实 SQL Server/Oracle 与发布版桌面验收、共享语义图及更多方言复杂查询。原 G01–G13、E01–E07 完成标准及未完成项保持不变。


## 第八批：递归 CTE 锚点、作用域与类型

本批核对递归 CTE 的实际成员候选和 hover。首轮新用例中 3 组通过、2 组失败：字段名单和若干作用域限制原本已有，但锚点类型在 UNION 中丢失，无法传到递归成员、后续 CTE 和外层推荐。过滤命令还运行了 1 个旧场景，首轮日志总计 4 passed / 2 failed；原始日志为 `.impeccable/review/lsp-recursive-initial.log`，不把已有字段名单能力算作本批新增。

新增 **14 个库测试组 + 1 个真实进程测试**，最终全量 **467 passed / 0 failed / 0 ignored**（338 库 + 129 集成、24 个目标）。严格 all-targets Clippy、fmt、2697 文件模块大小及解析器/局部关系边界检查通过。没有扩大远端 CI 或安装版的验收结论。

| 实现 | 验证与边界 |
| --- | --- |
| 独立递归输出分析 | [recursive_ctes.rs](../vendor/sql-lsp/src/server/local_relations/recursive_ctes.rs) 从顶层 UNION 找到非递归锚点与实际自引用成员，先推断锚点并应用显式列名，再给递归成员绑定这份结构；不执行递归、不做固定点展开。普通 WITH RECURSIVE 中没有自引用的 UNION 仍使用原集合类型解析 |
| 方言规则 | PostgreSQL、MySQL 和 SQL Server 的受测锚点类型可传入递归成员与外层。MySQL 按锚点决定类型，不用递归成员的数值提升覆盖锚点；PostgreSQL/T-SQL 的可静态确认类型冲突降为 unknown。递归输出保守标可空；SQL Server 不要求 RECURSIVE 关键字。Oracle 隐式递归可识别作用域，但本批未为其增加完整递归表达式类型规则 |
| 作用域 | 成员内部可以推荐自己的列，锚点中的物理表别名不会混入后续/兄弟 CTE 的列；递归自引用会遮蔽同名物理表。依赖识别排除 schema 限定物理表、字符串/注释中的伪引用，区分 PostgreSQL 引号名称的大小写。含嵌套 WITH 的分支暂不用于识别此层自引用，避免把同名内层 CTE 误当递归关系 |
| 复杂投影 | 覆盖显式名单、从锚点别名推导名称、后续 CTE 星号、括号包裹成员和注释；数组路径→递归 JOIN→后续窗口→派生表的成员候选与 hover 保持 bigint[]。同 URI、相同 SQL 在 metadata 的 bigint/text/integer 变化后重新推断锚点，不保存旧类型候选 |
| 宽度与预算 | 使用 [原有位置输出模型](../vendor/sql-lsp/src/server/local_relations/query_output.rs) 的真实宽度，不按公开候选数量错配递归列。已知宽度不匹配、无锚点自引用、错误显式名单或资源不足时保留可用名称并降级类型；锚点与递归成员共用 64 分支预算，测试 63 锚点分支+1 递归成员通过、64+1 降级。外层括号和锚点嵌套也共用 32 层查询限制，不能在进入新阶段时重置 |

[递归单元测试](../vendor/sql-lsp/src/server/local_relations/recursive_ctes/tests.rs) 检查锚点规则、可空性、类型/宽度反例、引用边界及精确资源边界；[服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/recursive.rs) 验证候选/hover 和 schema 刷新。[真实 stdio 测试](../vendor/sql-lsp/tests/integration_test_client.rs) 在一个原生进程内验证 **3 方言×成员/外层 2 个位置，共 6 份文档**，包含 emoji、字段中间光标、后续 CTE 和派生表，并故意使用与配置冲突的 mysql 后缀。候选/hover 分别保持 integer、SIGNED 和 int 的已建模锚点类型，6 份 pull diagnostics 均为空，进程正常退出。SIGNED 是当前 CAST 静态目标标签，不是数据库驱动返回位宽的认证。

规则依据：[PostgreSQL WITH/递归形状](https://www.postgresql.org/docs/18/queries-with.html)、[PostgreSQL 锚点类型与递归类型检查源码](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/parser/parse_cte.c)、[MySQL 递归输出类型/可空性](https://dev.mysql.com/doc/refman/8.0/en/with.html)、[SQL Server 递归 CTE 类型与可空性](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql?view=sql-server-ver17)。本批没有在三个实际引擎中执行这些语句；空 LSP 语法诊断不能证明递归次数、运行结果、类型转换、宽度/排序规则或产品限制均通过引擎验证。无法静态识别的递归表达式只保留锚点所约束的预期类型，不记为该表达式已被完整验证。

DBX 静态核对：[CTE 模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 记录显式名单、锚点投影及 preceding CTE；[CTE 来源追溯](../sources/dbx/apps/desktop/src/lib/sql/semantic/cteNavigation.ts) 对 cycle/过深来源返回空后回退。这些源码不是递归查询执行器或完整函数返回类型系统；本批没有据此宣称 DBX 已具备全部锚点类型规则，也没有运行 DBX 桌面做效果等同验收。

既有 64 KiB 空白夹具单次本机 debug 观测：纯语法冷/缓存命中 **18.3898 ms / 2.5 μs**，局部结构 **29.2927 ms**，方言 **46.0975 ms**，完整服务器冷/重复请求 **123.7509 / 105.0164 ms**，粗门禁通过。它不是递归查询的专项 p95，也不表示固定性能改善。新的递归分析没有引入元数据候选缓存；大型 schema 复制、跨 provider 共享语义图和发布版长查询时延仍待优化。

本批受测原生 exe SHA-256：`bcf417fee895d89d3cf54210b73463b58034e014673ad27f8de29988798b44b0`。全量、Clippy、性能及汇总为 `.impeccable/review/lsp-recursive-all-targets.log`、`lsp-recursive-clippy.log`、`lsp-recursive-performance.log` 和 `lsp-recursive-evidence.json`。未更新桌面捆绑二进制/清单、fetch、提交、推送或执行远端 CI，固定 DBX 参考不变。

剩余：嵌套 WITH/互相依赖 CTE 的统一绑定图、完整 SEARCH/CYCLE 自动列、同名物理表与 schema 限定引用并存、多锚点非 PostgreSQL 的集合转换、字符串字面量隐式类型与 typmod/collation、更多递归成员表达式和其他方言、实际数据库及桌面发布验证。本批是递归静态提示的增量，不将完整 LSP 或 G01–G13、E01–E07 总目标标为完成。


## 第九批：同名对象绑定、调用级字段与推荐身份

新增测试先复现 **1 passed / 4 failed**：CTE/派生别名与物理表同名时，局部形状覆盖 catalog，导致显式 `app.users` 仍拿到局部字段或丢失类型。初始日志为 `.impeccable/review/lsp-namespaces-initial.log`。本批新增 **20 个库测试组 + 1 个真实进程测试**，最终全量 **488 passed / 0 failed / 0 ignored**（358 库 + 130 集成、24 个目标）；每个矩阵组包含多条 SQL、光标或方言路径。

| 推荐/语义场景 | 当前结果及实现范围 |
| --- | --- |
| 局部名称与限定物理名称 | 新增 [关系绑定模块](../vendor/sql-lsp/src/relation_bindings.rs)，保留 catalog 对象；裸 `users` 绑定可见局部形状，`app.users` / catalog.schema.table 不绑定 CTE、派生别名或调用别名。作用于字段解析、投影和通用推荐；不是完整的各方言引号/大小写身份模型 |
| 列表中同名字段 | 候选数据记录 query-local 身份，字段去重与别名插入保持来源；同一列表中的 `p.name: text` 与 `c.name: bigint` 不再混用类型或别名。别名展开先建立表身份索引，避免为每条候选重复查找完整表列表 |
| 表名推荐与外键片段 | 未限定输入同时保留裸 CTE 和限定物理表；输入 schema 后排除局部对象。外键仍按 catalog 约束解析，不通过 CTE 名字猜测约束；受遮蔽物理目标插入限定名称。已有 ALTER TABLE/MODIFY/CHANGE 字段范围回归保持通过 |
| 调用/关联列名单 | `app.users AS u(id, display_name, ...)` 的改名字段挂在调用别名 u 上，另一次物理表引用仍保留 name；两次 JSON_TABLE 的不同输出形状分开绑定。投影、CTE 星号及不带限定符的列表使用相同调用来源 |
| 当前输入所在查询块 | 关闭的 CTE/子查询中的 FROM/WHERE 不再污染外层 SELECT 的补全上下文；保留原始字节和换行。共享查询括号识别不把已结束的子查询、普通函数参数或全文搜索模式当作当前查询；不是统一的全查询语义图 |
| hover 与刷新 | Hive/ClickHouse hover 改为光标节点及可见来源解析，排除仅出现在字符串/注释里的表名。五个 provider 验证限定物理表与裸 CTE 的表/列 hover；MySQL/PostgreSQL 表名解析保留完整限定符。schema 元数据更新后类型随之变化，局部增强不修改同步 catalog |

测试入口：[服务器命名空间矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/namespaces.rs)、[通用候选与外键测试](../vendor/sql-lsp/src/dialects/common/tests.rs)、[作用域识别](../vendor/sql-lsp/src/parser/sql/tests/scopes.rs)、[真实 stdio](../vendor/sql-lsp/tests/integration_test_client.rs)。五个 provider 为 PostgreSQL、MySQL、SQLite、Hive、ClickHouse；基础同名字段矩阵另走 SQL Server/Oracle 兼容路由，不能据此认证它们的专用 grammar 或完整语义。真实进程在一个服务器内验证 **10 份文档**，含配置与 mysql 后缀冲突、同一行 emoji/UTF-16 与 CRLF，断言两种来源的具体候选类型、hover、位置、空语法诊断及正常退出。

DBX 对照仍为固定 `b160d130560f71c5c429be15cec6147f677a4b3a`：[row-source 数据模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 保存 id、kind、qualifiedName、alias、columnAliases 和 bodySources；[推荐适配](../sources/dbx/apps/desktop/src/lib/sql/semantic/completion.ts) 将限定信息与调用列名单传给列表。Oxide 本批补齐上述具体行为，但仍用现有 Table/object_type 形状表达局部身份，尚未达到 DBX 的统一来源模型；没有运行 DBX 桌面做交互效果对比。

规则依据：[PostgreSQL 表别名及限定名称](https://www.postgresql.org/docs/current/sql-select.html)、[MySQL CTE 名称遮蔽](https://dev.mysql.com/doc/refman/8.0/en/with.html)、[SQL Server 同名 CTE 规则](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql?view=sql-server-ver17)。本批为静态语义与协议验证，没有连接数据库执行这些 SQL。

严格 all-targets Clippy、fmt、2700 文件模块大小及解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界检查通过。公共方言模块为 6 个、78 个函数，解析器 26 个模块、215 个方法；两个计数脚本同步核对实际模块所有权与无环依赖。全量、Clippy、性能和汇总分别为 `.impeccable/review/lsp-namespaces-all-targets.log`、`lsp-namespaces-clippy.log`、`lsp-namespaces-performance.log`、`lsp-namespaces-evidence.json`。

本机 debug 的一次独立 64 KiB 空白夹具观测：局部形状 **76.1945 ms**、方言补全 **80.2421 ms**、完整服务器首次/重复请求 **322.9579 / 152.867 ms**；纯语法冷解析 **25.781 ms**、缓存命中 **8.6 μs**。通过原有粗门禁；这些是独立调用，不相加，也不证明固定提速或 p95。与上一批的一次样本差异明显，仍需发布构建和受控重复测量定位长文档的重复扫描，不能宣称性能优化完成。

本批 exe SHA-256：`a66a0957d66342d2a3c82e574e4143fdac5cdb0a794d09356d8a2733228a55df`。仍需：完整引号/大小写策略、临时表真实命名空间（本批保留原替换行为）、嵌套 WITH/互相引用的稳定身份图、更多方言与隐式类型规则、增量语义快照及桌面 Monaco 候选验收。未更新捆绑二进制/清单、fetch、提交、推送或执行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十批：嵌套 WITH 输出与当前来源的字段提示

新矩阵最初 **2 passed / 4 failed**，复现未限定 hover 误读未引用 catalog 表、同名字段误当表名，以及派生查询内部 WITH 误用外层 CTE 输出。行为失败保留在 `.impeccable/review/lsp-visibility-initial.log`。本批新增 **14 个库测试组 + 1 个真实进程测试**；最终全量 **503 passed / 0 failed / 0 ignored**（372 库 + 131 集成、24 个目标），严格 all-targets Clippy 和 fmt 均通过。

| 场景 | 已实现、验证与边界 |
| --- | --- |
| 未限定字段 hover | 五个 provider 共用 [字段来源解析](../vendor/sql-lsp/src/dialects/common/references.rs)，按当前查询的行来源查找，不再从整个 catalog 挑第一个同名字段。无 FROM、仅其他表拥有该字段、以及两表/同表两别名产生歧义时，不伪造唯一字段说明；推荐列表仍保留可选择的限定候选 |
| 派生表与字段/表同名 | 当前行来源收集包括派生别名，隐藏子查询内部表；从派生表读取名为 users 的列时，hover 显示列和实际类型。MySQL/PostgreSQL 表 hover 按 relation 语法节点区分身份，保留各自说明格式 |
| 成员限定符边界 | [限定符读取](../vendor/sql-lsp/src/parser/sql/identifiers.rs) 在字段/名称节点内终止，不再向上从整个 SELECT、算术表达式或其他子查询中的点号截取一个假表名。直接解析测试覆盖限定路径、未限定字段和引号内点号 |
| 嵌套 WITH 输出 | 新增 [WITH 输出推断模块](../vendor/sql-lsp/src/server/local_relations/with_queries.rs)，按定义顺序构造当前推断的局部 catalog，再解析最终查询。覆盖同名内层覆盖、后续 CTE 引用、显式列名单、星号、递归锚点，以及整个 WITH 的集合分支；内层形状不修改原 catalog，也不替换外层绑定 |
| 查询预算 | WITH 正文、最终查询、派生表及递归锚点/成员共用现有每次输出推断的 64 分支/32 层预算。验证 63 个单 SELECT 正文加最终查询仍推断，64 个正文加最终查询降为 unknown；递归正文同样消耗外层剩余预算，深层和未完成输入保留外部显式名称而不猜 catalog 类型。并不代表整个服务器只有这一个预算 |
| 投影顺序 | 加入派生行来源后继续保留 FROM/JOIN 的物理、派生和未命名投影位置；已有混合星号顺序测试发现的退化已修复，没有修改旧预期来允许错误字段顺序 |

新增库测试为 [服务器作用域矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/visibility.rs) 6 组、WITH 输出单元 6 组，以及 [解析器关系/限定符回归](../vendor/sql-lsp/src/parser/sql/tests/relations.rs) 2 组。服务器正向矩阵验证内层同名别名和显式相关外层别名分别绑定；嵌套 WITH 的专项服务器矩阵为 PostgreSQL/MySQL/SQLite。新增 [真实 stdio 测试](../vendor/sql-lsp/tests/integration_test_client.rs) 在五个 provider 中验证 **25 份文档**，包括普通字段、不可见字段、同表双别名歧义、字段/表同名和嵌套 WITH。断言候选类型/限定名、hover 来源或 null、emoji/CRLF 行位置、空语法诊断和正常退出。该测试夹具首次漏传必需 nullable 字段，导致 schema 配置未被加载；补齐夹具后验证通过，此处不记为服务端语义修复。

五个 provider 为 PostgreSQL、MySQL、SQLite、Hive、ClickHouse；通用 provider 的原生协议通过不认证每个真实引擎都接受该 SQL。本批没有连接数据库执行 SQL、运行 DBX 桌面或测试安装版推荐弹窗。DBX 参考仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`；其 [scope/row-source 数据结构](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 具有父作用域、来源和投影列表。本批补充局部推断路径，没有将 Oxide 改造成该统一版本化语义图。

规则参考：[PostgreSQL WITH 的有序辅助查询与递归锚点](https://www.postgresql.org/docs/current/queries-with.html)、[MySQL WITH 的查询块与名字解析](https://dev.mysql.com/doc/refman/8.4/en/with.html)、[PostgreSQL 相关子查询](https://www.postgresql.org/docs/current/functions-subquery.html)。未限定相关字段从内向外回退、别名隐藏原表名的完整诊断、合法 LATERAL 边界与 CTE 前向/互相引用仍需更完整的共享作用域模型；本批不将这些未完成项标为支持。

模块大小 **2702 文件**和解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界检查通过；解析器为 26 模块、216 方法，公共方言为 6 模块、80 函数。全量、Clippy、性能与证据为 `.impeccable/review/lsp-visibility-all-targets.log`、`lsp-visibility-clippy.log`、`lsp-visibility-performance.log`、`lsp-visibility-evidence.json`。本批原生 exe SHA-256：`db6b82e0bbb038b9cb32de83001480415c11dd056eaa068f0647358989a84eb8`。

一次独立 debug 64 KiB 空白夹具：局部形状 **26.5768 ms**、方言补全 **44.1547 ms**、完整服务器首次/重复请求 **121.7774 / 107.549 ms**；纯语法冷解析 **18.4888 ms**、缓存命中 **2.6 μs**。通过原有粗门禁；与之前单次结果不构成固定提速或 p95 证据，各分段为独立调用，不能相加。

下一步仍包括：内外层统一来源身份及未限定相关字段、导航/诊断与推荐同源、前向 CTE/数据修改 CTE/VALUES 锚点、方言专有规则、增量缓存失效和真实桌面延迟。未更新捆绑二进制/清单、fetch、提交、推送或运行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十一批：相关子查询、LATERAL 与 APPLY 的推荐作用域

初始新增 6 个服务器测试组为 **1 passed / 5 failed**，复现外层未限定字段缺失、未引用表的限定字段泄漏、派生表越界读取同层来源、LATERAL 读取右侧来源，以及 CTE 正文误用主查询行别名。原始行为及 AST 记录在 `.impeccable/review/lsp-correlation-initial.log`；临时 AST 输出已移除。本批新增 **19 个库测试组 + 1 个真实进程测试**，最终全量 **523 passed / 0 failed / 0 ignored**（391 库 + 132 集成、24 个目标）。

| 语义路径 | 本批实现与验证 |
| --- | --- |
| 作用域链 | 新增 [相关来源解析](../vendor/sql-lsp/src/parser/sql/correlation.rs)，按光标从内到外保留独立查询块的来源与别名；AST 识别完整语句，显式引入词处理部分未完成语句。普通函数括号不增加查询层级，32 个以内的可见作用域有界收集，超限不继续猜来源。作用域链内复用同一份 SQL 噪声掩码，避免逐层重新清理整份文本 |
| 未限定字段 | [共享字段解析](../vendor/sql-lsp/src/dialects/common/scope_columns.rs) 同时服务推荐与 hover：先查当前查询，字段不存在时才查允许访问的外层；内层歧义不向外层任选唯一字段。未知内层行形状不足以证明回退安全时保守停止。外层候选标明来源并排在内层之后，保留引号别名的插入文本 |
| 限定字段 | 已有 FROM 来源才参与语义绑定；未引用表和被别名隐藏的原表名不再通过 catalog 获得字段。内层同名别名优先，即使目标列不存在也不回退到外层同名别名。为编辑过程保留根查询尚未写 FROM 时的 catalog 成员候选，不把这些候选当成已成立的字段绑定 |
| 派生/CTE 边界 | 普通派生查询和 CTE 正文跳过自身主查询的行来源；相关祖父查询仍可参与查找。LATERAL 仅导入左侧已有来源，排除自身/右侧别名；RIGHT/FULL 形式不导入左侧。覆盖显式 JOIN、逗号来源、未闭合括号和函数参数中的标量子查询 |
| APPLY 解析与提示 | 通用 grammar 不能正确读取部分 OUTER APPLY，新增 [等字节适配](../vendor/sql-lsp/src/parser/sql/apply.rs) 将解析输入建模为 cross-join 结构，相关作用域继续读取原始 APPLY；原文、APPLY 完整 5 字符 token、UTF-16 范围、注释/字符串/UDF 保护及内部真实错误均有测试。此结构适配不提供 OUTER APPLY 结果可空性推断，也不认证其他引擎支持该语法 |
| 语法与既有表函数 | 补报 grammar 将裸 FROM 当作 SELECT 字段而隐藏的缺失表达式；引号与限定字段不误报。函数参数之后的 WITH(...) 声明可继续找到真实调用别名，保留 OPENJSON 原有列推荐；这条规则不读取普通基表的 WITH table hints 作为字段名单 |

新增库测试为 [服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/correlation.rs) 9 组、[作用域 API](../vendor/sql-lsp/src/parser/sql/tests/scopes.rs) 6 组和 [APPLY/原文范围/诊断](../vendor/sql-lsp/src/parser/sql/tests/syntax.rs) 4 组。两项旧集成用例原本要求一律排除合法相关外层字段，现改为要求外层候选带限定名称、保持正确插入文本且排在内层字段之后；无关/闭合子查询和同名别名隔离的原反例继续保留，未放宽歧义及越界读取的期望。

新增 [真实 stdio](../vendor/sql-lsp/tests/integration_test_client.rs) 在 PostgreSQL/MySQL/SQLite/Hive/ClickHouse 五个 provider 与 SQL Server 兼容 profile 中共验证 **36 份文档**：19 个正向类型/来源/坐标场景，17 个隔离反例。包含配置与 mysql 后缀冲突、emoji、CRLF、两层相关查询、LATERAL 和 CROSS/OUTER APPLY；断言候选与 hover 的类型/来源或缺失，进程正常退出。正向场景要求没有 PARSE_ERROR 或错误级诊断，保留 SELECT * 的 OXIDE003 提示；不能将提示级检查误记为语法失败。反例 SQL 用于字段隔离，不作为完整语义诊断已实现的证据。

规则来源：[PostgreSQL FROM/别名/LATERAL 与外层名称作用域](https://www.postgresql.org/docs/current/queries-table-expressions.html)、[MySQL 相关查询从内向外解析](https://dev.mysql.com/doc/refman/8.4/en/correlated-subqueries.html)、[派生查询](https://dev.mysql.com/doc/refman/8.4/en/derived-tables.html)、[LATERAL 限制](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html)。DBX 仍对照固定 `b160d130560f71c5c429be15cec6147f677a4b3a` 的 [语义类型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 与 [模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts)；没有运行 DBX 桌面，也不宣称 DBX 已通过或未通过本批相同 SQL。此次属于静态语义和协议验证，没有连接数据库执行这些语句。

严格 all-targets Clippy、fmt、2706 文件模块大小及解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界检查通过。解析器为 28 模块、220 方法，公共方言为 7 模块、81 函数；字段解析只有新模块一个 owner，公共边界检查增加对限定模块调用的依赖核对，避免遗漏非 use 形式的循环引用。未增加 Schema JSON 字段或修改客户端协议。

最终日志为 `.impeccable/review/lsp-correlation-all-targets.log`、`lsp-correlation-clippy.log`、`lsp-correlation-performance.log`、`lsp-correlation-evidence.json`。本批 exe SHA-256：`f77cb92b99e866b9a6aafba4195a3e85889bbe1724d68a1bfc1ed144a2b80800`。一次独立 debug 64 KiB 空白夹具：局部形状 **41.303 ms**、方言补全 **86.1568 ms**、完整服务器首次/重复请求 **206.5539 / 160.958 ms**；纯语法冷解析 **24.4472 ms**、缓存命中 **3.5 μs**。通过原有粗门禁；各分段独立，不相加。新增语义验证仍有成本，这些单次结果不能证明整体提速或 p95；需要发布构建、受控重复测量及整个请求的快照/失效优化。

尚需：同名内外 CTE/调用形状的稳定来源身份、复杂括号 JOIN 与隐式 lateral 函数参数的完整可见性、APPLY/LATERAL 输出类型及 JOIN 可空性、方言/版本专用诊断、导航与推荐同源，以及缓存、取消和真实桌面延迟。未更新捆绑二进制/清单、fetch、提交、推送或执行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十二批：APPLY/LATERAL 输出类型与来源复用

新增服务器矩阵最初 **1 passed / 5 failed**：内层相关字段本身已有提示，但作为派生输出后仍为 unknown，相关星号的列也会丢失。初始行为保留在 `.impeccable/review/lsp-correlated-output-initial.log`。本批新增 **12 个库测试组 + 1 个真实进程测试**；最终全量 **536 passed / 0 failed / 0 ignored**（403 库 + 133 集成、24 个目标），严格 all-targets Clippy、fmt 和模块检查通过。

| 语义路径 | 本批结果与边界 |
| --- | --- |
| 原文来源 | 新增 [来源上下文](../vendor/sql-lsp/src/server/local_relations/provenance.rs)，推断保留原始 SQL/AST 及子查询实际范围；嵌套切片按来源身份和边界定位，不用字符串 find 猜重复 SQL 的位置。相同正文分别出现在普通派生与 LATERAL 中时仍有不同可见来源，复制到无关分配的同内容字符串不会借用原作用域 |
| 字段解析复用 | [ColumnScopes](../vendor/sql-lsp/src/dialects/common/scope_columns.rs) 为当前推断保存已解析的外层绑定，多字段共用；hover 使用同一解析器。输出推断保留自身分支的局部来源，外层查找跳过全局 AST 中的当前块，避免把集合运算的其他分支输入合并进来 |
| 顺序依赖 | 派生表按来源顺序加入当前推断快照，后续 LATERAL/APPLY 可读取先前派生输出；同名输出列分别保留各调用类型。内层字段/别名先解析，内层歧义或未知来源不通过外层 catalog 猜类型 |
| 星号与 CTE | 支持相关限定星号、显式位置名单、CTE 星号和外层命名字段的类型传播；未限定星号仍只展开当前块。覆盖 PostgreSQL/MySQL 的 LATERAL、SQL Server 兼容 profile 的 CROSS/OUTER APPLY，以及聚合 COALESCE/SUM→CTE→窗口排序→外层 amount 的组合 |
| 可空性 | OUTER APPLY 和 LEFT 派生连接的右侧输出按可空处理，避免从星号或常量复制 NOT NULL 结论；CROSS APPLY/CROSS JOIN LATERAL 的常量不被这个规则强制改为可空。表达式字段沿用既有保守可空规则；不是完整 JOIN 可空性和基数分析 |
| 隔离与预算 | 普通派生表、右侧尚未出现的来源、未知内部表及被遮蔽字段继续保留显式名称并降为 unknown。外层 SELECT 与相关正文共用原有 64 分支/32 层查询预算；验证外层 1 分支加正文 63 分支可推断、正文 64 分支降级，未为每次相关查找重开推断预算 |

新增库测试为 [服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/correlated_outputs.rs) 8 组、[输出顺序/可空性/预算](../vendor/sql-lsp/src/server/local_relations/output_tests.rs) 3 组，以及来源上下文的重复正文/Unicode/CRLF 隔离 1 组。服务器同 URI 文档编辑可在 bigint→text→bigint 之间重新推断，局部表不写回同步 catalog。原有递归 CTE 测试仅补内部来源参数，预期类型/预算未放宽。

新增 [真实 stdio](../vendor/sql-lsp/tests/integration_test_client.rs) 在 PostgreSQL、MySQL 和 SQL Server 兼容配置中验证 **14 份文档**：12 个正向传播/可空性场景，2 个越界来源保留 unknown 的反例。断言具体候选类型、hover、emoji/CRLF 行位置、配置优先于 mysql 文件后缀及正常退出；正向场景无 PARSE_ERROR 或错误级诊断，保留提示级检查。此处不是独立 SQL Server grammar 或真实服务端类型往返认证。

规则来源：[PostgreSQL LATERAL/连接/限定星号](https://www.postgresql.org/docs/current/queries-table-expressions.html)、[SQL Server APPLY 的逐行右侧来源及 OUTER 语义](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql?view=sql-server-ver17)、[MySQL LATERAL](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html)。DBX 仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`，参考其 [来源/投影类型结构](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts)；没有运行 DBX 桌面或连接数据库执行本批 SQL，不能据此声称达到全部实际效果。

模块大小检查 **2708 文件**通过；解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界仍通过。来源、投影与有序 WITH 使用显式内部上下文，未新增 Schema JSON 字段。原始树按发现/推断上下文延迟创建和复用，字段查找不会为每列重扫完整原文；这仍是请求内快照，不是按文档版本缓存的统一语义图。

最终全量、Clippy、性能和证据为 `.impeccable/review/lsp-correlated-output-all-targets.log`、`lsp-correlated-output-clippy.log`、`lsp-correlated-output-performance.log`、`lsp-correlated-output-evidence.json`。本批 exe SHA-256：`69faf495f086bd0ba4b7df0ca2e7aaeb4367e9ac4658258333f7502fa2faf2a7`。一次独立 debug 64 KiB 空白夹具：局部形状 **28.6848 ms**、方言补全 **63.8141 ms**、完整服务器首次/重复请求 **146.0692 / 123.2662 ms**；纯语法冷解析 **19.9925 ms**、缓存命中 **4.2 μs**。通过原粗门禁，各分段独立且不相加；单次结果不证明固定提速或 p95，完整发布构建和桌面延迟仍待验证。

后续包括：同名内外 CTE 的稳定身份、复杂括号 JOIN/隐式 lateral 的完整边界、标量子查询输出、完整 JOIN 可空性、方言/版本诊断、导航及版本化语义快照。未更新捆绑二进制/清单、fetch、提交、推送或执行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十三批：带引号的路径、语义字段与推荐插入

本批继续检查推荐候选、类型/来源及接受候选后的 SQL。最初新增用例筛选为 **2 passed / 7 failed**，其中包含 1 个已有测试；新增 8 组中为 1 passed / 7 failed。原始日志 `.impeccable/review/lsp-quoted-names-initial.log` 保留。问题包括引号内点号被拆成多段、转义终止符未正确还原，以及带引号别名与物理 metadata 无法匹配。后续另发现字段中间补全留下后缀、特殊字段误用整条路径替换、Unicode 字段中的点号误作限定符，以及注释内引号干扰替换范围。

| 路径 | 已实现与验证范围 |
| --- | --- |
| 标识符结构 | [路径组件](../vendor/sql-lsp/src/parser/sql/identifier_paths.rs) 区分 `app.users` 两段与 `"app.users"` 单段；双引号、反引号和方括号支持各自的双终止符转义。内部规范路径保留组件边界；Schema 中 database/catalog/table 的名称按已解码的单个 metadata 值匹配，不再将名字里的点号重复拆分 |
| 作用域与输出 | 别名保留解码名称及原始 SQL 拼写；带点号的别名必须整体引用。PostgreSQL/MySQL 的字段、带引号 CTE、派生别名及 LATERAL 输出继续携带实际来源类型，未带引号的多段路径不能误命中单个点号别名。PostgreSQL 物理表名含点、MySQL 物理表名含空格分别验证；不把 MySQL 禁止的物理表名含点场景记为合法 SQL 支持 |
| 推荐接受 | 新增 [字段编辑处理](../vendor/sql-lsp/src/server/completion_quotes.rs)，将 metadata 列名作为一个组件按实际 provider 引用；SQL Server 兼容 identity 使用方括号。替换完整成员及已有结尾引号、单词后缀，保留限定别名；外层候选的限定名也按方言生成。metadata 本身含字面引号时继续正确转义，而非当成已写 SQL |
| 原文与坐标 | 共享 [光标路径读取](../vendor/sql-lsp/src/parser/sql/identifiers.rs) 给公共方言和服务器使用，注释内的引号不捕获后续编辑。PostgreSQL 的转义双引号仅在解析输入中作等字节适配，读取仍用原 SQL；普通双引号、字符串、注释、数组索引及 MySQL 双引号输入保留原行为。验证中文字段、同一行 emoji 和 CRLF 的 UTF-16 范围 |
| 性能与模块 | 路径解码/规范表示、语义绑定与插入编辑分别有单独模块；路径 token 扫描复用同一实现。字段编辑范围每次请求计算一次，不为每个候选重新扫描文档的 UTF-16 位置；没有待处理字段时直接返回。保留既有缓存和有界输出推断，未引入新 Schema 协议字段 |

新增库测试为 [服务器语义与实际编辑](../vendor/sql-lsp/src/server/tests/complex_semantics/quoted_names.rs) **15 组**、[解析器路径与原文保护](../vendor/sql-lsp/src/parser/sql/tests/quoted_names.rs) **5 组**及 [catalog/schema 含点隔离](../vendor/sql-lsp/src/server/tests/schema_resolution.rs) **1 组**。原 schema qualifier 的字符串预期从已解码空格名改为保留组件边界的内部规范引用；对应 schema 选择同时按组件匹配。未关闭引号可能遮住后续 FROM，尚不保证该错误输入有语义候选；专项测试仅证明给定候选的编辑不会删除后续 SQL，不能据此宣称未闭合输入补全已完成。

新增 [真实 stdio 测试](../vendor/sql-lsp/tests/integration_test_client.rs) 验证 **7 份文档**：PostgreSQL/MySQL 各 3 份要求候选 text 类型、hover、无错误级/语法诊断及准确的完整成员 textEdit；SQL Server 兼容配置 1 份只验证方括号别名候选与实际编辑，**共享 grammar 下的方括号 hover/诊断仍未通过，未将其标记为支持**。配置覆盖 mysql 文件后缀；全部文档带 emoji/CRLF，进程正常退出。没有连接实际数据库执行 SQL 或运行安装版推荐弹窗。

DBX 仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`。其 [语义 tokenizer](../sources/dbx/apps/desktop/src/lib/sql/semantic/tokens.ts) 已将引号 token、原始 span、闭合状态与双终止符解码分开表示，本批补齐 Oxide 的组件路径与插入处理；没有运行 DBX 桌面对比，不能认证总体效果相同。规则来源：[PostgreSQL 标识符与双引号](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)、[MySQL 名称与反引号规则](https://dev.mysql.com/doc/refman/8.4/en/identifiers.html)、[SQL Server 限定标识符](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers?view=sql-server-ver17)。

最终全量 **558 passed / 0 failed / 0 ignored**（424 库 + 134 集成、24 个目标），本批新增 21 个库测试组 + 1 个真实进程测试。`cargo test --locked --offline --all-targets`、严格 all-targets Clippy `-D warnings`、fmt、2712 文件模块大小及解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界检查通过。解析器为 29 模块/220 方法；公共方言为 7 模块/81 函数。

全量、Clippy、性能及最终证据为 `.impeccable/review/lsp-quoted-names-all-targets.log`、`lsp-quoted-names-clippy.log`、`lsp-quoted-names-performance.log`、`lsp-quoted-names-evidence.json`。本批 exe SHA-256：`cb35fed279077abaaae2ad05183f65d25584175aa3b194229e8cb6f0e2504821`。独立 debug 64 KiB 空白夹具：局部形状 **55.4561 ms**、方言补全 **74.2781 ms**、完整服务器首次/重复请求 **170.7992 / 143.504 ms**；纯语法冷解析 **24.776 ms**、缓存命中 **8.3 μs**。通过原粗门禁；分段是独立调用，单次本地数字不证明提速或 p95，发布构建和桌面延迟仍待验证。

后续差距仍包括：独立 T-SQL 方括号 grammar/hover/诊断、按产品大小写及 collation 的引用规则、SQL mode/ANSI_QUOTES、错误输入的可恢复绑定、带引号前缀的精确候选排序，以及统一稳定来源身份、标量子查询输出、完整 JOIN 可空性、版本化语义快照和真实桌面延迟。未更新捆绑二进制/清单、fetch、提交、推送或运行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十四批：SQL Server 方括号语义与独立解析配置

针对上一批明确保留的方括号缺口，新增 3 组服务器测试首先为 **0 passed / 3 failed**（`.impeccable/review/lsp-tsql-identifiers-initial.log`）：合法方括号 SQL 误报语法错误，含转义右括号的字段缺 hover，CTE 输出字段为 unknown。本批保留共享 tree-sitter grammar，同时为 SQL Server 单独注册 provider 实例及解析配置，继续验证推荐、类型、悬浮和原文范围；不再将它直接作为 PostgreSQL 的同一实例别名。

| 路径 | 本批实现与边界 |
| --- | --- |
| 配置传递 | `SqlPlaceholderDialect::SqlServer` 及统一的 `for_name` 选择供 provider、服务器分析树、输出投影及原始来源上下文使用；`sqlserver`、`mssql`、`tsql` 指向独立 SQL Server 实例，其 provider identity 为 sqlserver。文件后缀和 languageId 的 sqlserver/mssql/tsql 别名也能选择正确配置；SQL Server 的格式/检查/语义功能名单保留原有可用路径，hover 与关键字说明不再误标 PostgreSQL |
| 方括号 AST | [方括号解析适配](../vendor/sql-lsp/src/parser/sql/bracket_identifiers.rs) 只在 SQL Server 配置下将完整 bracket identifier 的解析输入变为同字节 quoted identifier。转义 `]]`、点号、空格和 Unicode 均保留单一标识符范围；AST 消费者继续从原文解码名字。字符串/注释不替换，未闭合方括号保持错误，真实表达式错误仍报告 |
| 类型传播 | [服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/tsql_identifiers.rs) 验证方括号基表/别名/字段、带点号 CTE/派生别名、CROSS APPLY 引用和输出类型；来源配置同时进入局部输出及外层来源树，修复仅补主 provider 而输出仍为 unknown 的不完整路径 |
| 合法保留字别名 | 发现 `[order]`、`"order"` 和反引号 order 被解码后误按普通关键字排除；来源及派生/相关别名读取现在区分原始引用符。PostgreSQL/MySQL/SQL Server 三个配置验证限定字段与派生结果；普通未引用关键字仍保留原有边界判断 |
| 方言隔离 | PostgreSQL/MySQL/Generic 的 `arr[1]` 不执行该适配；测试原文长度、Unicode/emoji UTF-16 范围、嵌套注释和未闭合/缺失表达式反例。SQL Server 的嵌套块注释不再在第一层闭合后错误产生字段候选。注册表验证 SQL Server 与 PostgreSQL 的 provider 实例相互独立 |

新增库测试共 **11 组**：服务器方括号/保留字/注释矩阵 6 组、解析保护与范围 4 组、输入方言识别 1 组；另加注册表独立实例和同文档原生配置切换 **2 个集成测试**。

本批沿用 [原生 quoted-name stdio 测试](../vendor/sql-lsp/tests/integration_test_client.rs)，将上一批 7 份文档扩大到 **13 份**，并将 SQL Server 原先跳过的 hover/诊断提升为必需检查：7 个 SQL Server 场景、PostgreSQL/MySQL 各 3 个，全部检查候选 text 类型、hover、准确完整成员替换及无错误级/语法诊断。含转义右括号、带点别名、CTE/派生输出、APPLY 和保留字别名，带 emoji/CRLF 且显式配置优先于 mysql 后缀；另加同 URI、同 SQL、同 metadata 的 PostgreSQL→SQL Server→PostgreSQL→tsql 原生配置切换测试，检查错误诊断随实际解析配置出现/消失并恢复正确类型与 SQL Server hover，防止旧分析缓存跨配置复用。此前其他相关查询、递归、搜索与函数测试继续保留。

引用规则见 [Microsoft 标识符与 `]]` 转义](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers?view=sql-server-ver17)、[T-SQL 嵌套块注释](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/slash-star-comment-transact-sql?view=sql-server-ver17)。DBX 仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`，其 [tokenizer](../sources/dbx/apps/desktop/src/lib/sql/semantic/tokens.ts) 已显式区分方括号 token/span。本批补齐 Oxide 对应解析和语义链路，没有运行 DBX 桌面或连接 SQL Server 执行这些语句。

最终全量 **571 passed / 0 failed / 0 ignored**（435 库 + 136 集成、24 个目标）。`cargo test --locked --offline --all-targets`、严格 all-targets Clippy `-D warnings`、fmt、2715 文件模块大小及解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界检查通过；解析器为 30 模块/220 方法。全量、初始失败、Clippy、性能和最终证据在 `.impeccable/review/lsp-tsql-identifiers-*.log` 与 `lsp-tsql-identifiers-evidence.json`。本批原生 exe SHA-256：`12de3285994222998a3bd0711012a7ac1a9c0446a5b6afed1545449cde015793`。

既有 PostgreSQL debug 64 KiB 空白粗门禁仍通过：局部形状 **29.0557 ms**、方言补全 **61.3175 ms**、完整服务器首次/重复请求 **138.6132 / 120.2677 ms**；纯语法冷解析 **18.5781 ms**、缓存命中 **3.5 μs**。这不是新增 T-SQL 压测或发布版桌面 p95，分段是独立调用；单次数字不证明固定提速。

这些证据仅推进方括号及其组合语句；共享 grammar 尚不覆盖全部 T-SQL。GO/DECLARE/过程批次、完整专有查询结构、临时表/session 上下文、QUOTED_IDENTIFIER 与 collation 的动态设置及真实引擎类型仍需专项实现与验收。同名 CTE 稳定身份、标量子查询输出、完整 JOIN 可空性、版本化语义快照和桌面延迟保持未完成。未更新捆绑二进制/清单、fetch、提交、推送或远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十五批：标量子查询输出、相关类型与表达式上下文

新增 4 个服务器测试组最初为 **1 passed / 3 failed**（`.impeccable/review/lsp-scalar-outputs-initial.log`）：内部字段已有类型，但 `(SELECT ...) AS value` 经 CTE 输出后仍为 unknown；多层相关查询、局部别名遮蔽及外层表达式也未传递类型。初始日志的 unused import 为测试文件导入，后续已移除。本批复用已有输出推断、来源范围和全查询预算，继续验证实际推荐与 hover。

| 路径 | 实现与验证边界 |
| --- | --- |
| 单列输出 | 新增 [标量查询推断](../vendor/sql-lsp/src/server/local_relations/scalar_queries.rs)，在投影现有 AST 上按范围收集最外层 scalar subquery，按当前输入 schema、真实来源切片和配置方言递归推断。仅已知 arity 且恰好一列时传类型；多列、未知星号、未知来源和歧义保留 unknown。已知单列星号可传类型，EXISTS 的 SELECT 输出不当作标量字段类型 |
| 相关与遮蔽 | [服务器矩阵](../vendor/sql-lsp/src/server/tests/complex_semantics/scalar_outputs.rs) 覆盖 PostgreSQL/MySQL/SQLite/SQL Server 的单列相关输出；PostgreSQL 多层 scalar、内层同名别名、缺失内层列向合法外层回退、LATERAL 与普通派生隔离；标量内部有序 WITH 和 COUNT 输出经过 CTE 到外层。绑定继续用同一来源上下文，不用相同 SQL 内容的字符串查找定位 |
| 表达式组合 | scalar 的结果类型存入请求内的范围映射，供既有算术、CASE 和 COALESCE 消费；不会为每次表达式访问重做该 scalar 的推断。PostgreSQL 字符串常量新增 [未定类型表示](../vendor/sql-lsp/src/server/local_relations/expression_types/literals.rs)，在 CASE/COALESCE 中跟随已知类型，最终投影才物化为 text。验证数值 scalar 与 `'1'` 选择 integer、text scalar 与 fallback 选择 text；已物化 text 的 `(SELECT '1')` 不与 integer 任意合并。内部标记不会作为输出类型发给客户端；不做常量转换值有效性或任意 UDF 重载验证 |
| 可空性 | 标量查询可能无行，结果按 nullable 处理，不继承物理 NOT NULL 或仅凭 SELECT 语法证明基数；外层 COALESCE 仍沿用已有可空性选择。没有实现运行时返回超过一行的基数诊断，也不将字段类型已知解释为整个 SQL 一定可执行 |
| 预算与性能 | scalar 正文、WITH/派生/集合分支共用现有每次输出推断的 64 分支/32 层预算。验证父 SELECT 加 scalar 内 63/64 个 WITH 正文/最终查询的阈值、64 个相邻 scalar 仅在剩余预算内保留各字段类型、深层超限保留显式输出名称。收集遍历另有 32768 节点访问/64 层 AST/64 个 scalar 上限；无括号投影直接跳过。原 AST、mask 切片和来源身份复用，未为各 scalar 重开独立预算 |

新增库测试为服务器 **6 组**及 [单列/可空性/预算/深度/字面量/星号](../vendor/sql-lsp/src/server/local_relations/output_tests.rs) **5 组**，合计 11 组。预算夹具最初使用嵌套括号的平衡 UNION，发现共享 grammar 将它解析为 ERROR，无法用来证明该路径预算的精确阈值；AST 记录保留于 `.impeccable/review/lsp-scalar-outputs-debug.log`，临时输出已移除。最终阈值使用同样多查询分支、可被当前 grammar 正确解析的 scalar 内 WITH；64 个相邻 scalar 另独立核对共享预算。原生矩阵还暴露了没有 FROM 的 SELECT 后跟 WHERE 的共享 grammar 缺口，首次协议日志保留于 `.impeccable/review/lsp-scalar-outputs-protocol-initial.log`；UNION 正向夹具补入实际 FROM 来源，仍由 WHERE FALSE 保证该分支不产生行。**这两类合法语法与相应 scalar 输出仍未修复**，没有压掉诊断或为该语法声称通过。

新增 [真实 stdio 测试](../vendor/sql-lsp/tests/integration_test_client.rs) 覆盖 **16 份文档**：12 个正向类型/表达式/内层绑定场景，4 个多列/未知/越界/歧义反例；包括 PostgreSQL/MySQL/SQLite/SQL Server、COUNT、简单 UNION、内部 WITH、T-SQL 方括号、emoji/CRLF 和配置覆盖 mysql 后缀。断言具体候选类型、hover 及行位置；正向场景无错误级/语法诊断，反例保留 unknown。不连接真实数据库执行查询，也未测 DBX 或安装版推荐弹窗。

规则来源：[PostgreSQL scalar subqueries](https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-SCALAR-SUBQUERIES)、[MySQL scalar operand](https://dev.mysql.com/doc/refman/8.4/en/scalar-subqueries.html)、[SQL Server 子查询](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries?view=sql-server-ver17)。DBX 仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`；其 [输出与来源结构](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 将 plain-column origin 与表达式输出分开。本批针对 Oxide 的类型链路补实现，不据此断言 DBX 对所有这些表达式的类型或实际体验相同。

最终全量 **583 passed / 0 failed / 0 ignored**（446 库 + 137 集成、24 个目标），本批新增 11 个库测试组 + 1 个真实进程测试。严格 all-targets Clippy `-D warnings`、fmt、2718 文件模块大小及解析器/公共方言/局部关系/协议/MySQL/PostgreSQL 边界通过；未扩充解析器公开方法。两个语法缺口另由原生协议探针确认仍有错误诊断，证据为 `.impeccable/review/lsp-scalar-grammar-gaps.json`，探针正常退出；这份证据不算入 583 个 Cargo 测试。

全量、Clippy、性能、模块和最终证据在 `.impeccable/review/lsp-scalar-outputs-*.log` 与 `lsp-scalar-outputs-evidence.json`。本批 exe SHA-256：`0f14ef3889e8e9c2ba6b1bbc3cd7dcd25cfa7fd79176bc10444851820b33861d`。既有 debug 64 KiB 空白夹具：局部形状 **32.4311 ms**、方言补全 **69.1847 ms**、完整服务器首次/重复请求 **169.2965 / 142.0914 ms**；语法冷解析 **20.2136 ms**、缓存命中 **3 μs**。通过原粗门禁；不是标量查询专项压测或桌面发布版 p95，独立分段不相加，单次结果不证明固定提速。

后续保留：嵌套括号集合及无 FROM 的 WHERE grammar、EXISTS/IN 等完整谓词输出、动态 SQL/session/临时对象、同名 CTE 稳定身份、完整 JOIN 可空性、全局/版本化语义快照与取消、更多方言规则和真实桌面延迟。未更新捆绑二进制/清单、fetch、提交、推送或远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十六批：直接修复 SELECT 尾部子句与嵌套集合 grammar

本批继续处理第十五批保留的两份原始失败 SQL，而非只补输出名称。新增解析器测试初始为 **1 passed / 3 failed**，记录在 `.impeccable/review/lsp-query-grammar-initial.log`：两个正向组分别复现省略 FROM 的 WHERE 与嵌套括号集合；第三项将正在编辑的 `SELECT 1 WHERE` 错误要求为诊断失败。核对现有 EOF 策略后，该反例改为以分号终止，同时明确测试未终止编辑输入仍采用已有策略。这项夹具修正不记为服务端错误抑制的修复。

| 路径 | 实现与验收范围 |
| --- | --- |
| grammar 来源 | 将已锁定的 tree-sitter-sequel 0.3.11 已发布 crate 源码纳入 [grammars/sql](../vendor/sql-lsp/grammars/sql/OXIDE_PATCHES.md)，保留 MIT LICENSE、原发布清单、scanner/binding 和元数据。crate archive SHA-256 为 `9d198ad3c319c02e43c21efa1ec796b837afcb96ffaef1a40c1978fbdcec7d17`；实际本机缓存归档摘要匹配。上游 crate 报告 VCS dirty=true，故不把其报告 commit 当成全部文件精确来源证明 |
| SELECT 子句 | [窄 grammar 补丁](../vendor/sql-lsp/grammars/sql/oxide-grammar.patch) 将 WHERE/GROUP/WINDOW/ORDER/LIMIT 放在 SELECT 的可选 FROM 之后。实际生成树保留 where/group/order/limit 原节点名，支持 SELECT 无 FROM 时继续使用这些子句；没有为这两项语法改写 SQL 文本或消除诊断 |
| 集合分组 | set operand 可以递归包含括号内的 set operation，真实 AST 中保留多个 set_operation 与原始括号，替换先前 ERROR 恢复树。验证 nested UNION、与 INTERSECT 组合的 CTE、相关 scalar 输出、emoji/CRLF 坐标，并恢复上一批原始无 FROM 的 WHERE scalar 协议夹具；原先无法解析的平衡集合 63/64 分支预算测试现在另独立验证 |
| 方言类型 | [集合类型模块](../vendor/sql-lsp/src/server/local_relations/expression_types/set_types.rs) 保留 PostgreSQL 的现有合并规则，补 MySQL/SQL Server 相同固定整数类型的合并与保守可空性。MySQL 相同 unsigned 类型可保留，signed/unsigned、不同整数类型、DECIMAL 精度及字符串/collation/UDT 不任意合并；已有 MySQL DECIMAL unknown 反例仍通过。该增量不代表完整厂商类型优先级已实现 |
| 构建与分发 | LSP 的 [build.rs](../vendor/sql-lsp/build.rs) 直接编译已生成 C，私有 [LanguageFn 绑定](../vendor/sql-lsp/src/sql_grammar.rs) 接入原 parser。直接复用已有锁定的 cc 1.2.66、tree-sitter-language 0.1.7 和 Tree-sitter runtime 0.26.10，移除 tree-sitter-sequel 依赖；其他注册表版本未升级。这样 Cargo source package 保留补丁，不依赖发布后会转回注册表版本的 path override；没有嵌套 Cargo.toml 令 Cargo 排除 grammar 目录 |
| 可复现与门禁 | 使用 tree-sitter-cli 0.26.3、ABI 14 重新生成，显式 ABI 14 第二次生成的 7 个输出与首次结果逐项一致。新增 [源码门禁](../scripts/verify-sql-grammar-source.mjs)，验证 grammar 补丁可反向还原发布版本、生成源码/绑定等 12 个规范化文本摘要、ABI、许可证及构建入口，已接入现有 parser boundary 检查。普通 Cargo 构建使用已保存 C，不下载或运行 CLI；CommonJS 作用域由独立私有 package.json 提供，不改变应用 npm 依赖 |

本批新增 **8 个库测试组 + 1 个真实进程测试**：解析器 4 组、服务器语义 2 组、集合类型与原始 scalar 分支预算 2 组。新的 [stdio 模块](../vendor/sql-lsp/tests/integration_test_client/query_grammar.rs) 单独收纳该功能测试，主协议 helper 复用现有进程生命周期。覆盖 **13 份文档**：PostgreSQL/MySQL/SQL Server 的 8 份候选类型、hover、坐标与无错误级/PARSE_ERROR 诊断场景；2 份原始语法探针；3 份以分号终止的真实错误。原有 16 份 scalar 矩阵也恢复了最初无 FROM 的 WHERE SQL。额外原生探针读取第十五批原始 SQL，确认两份的 SYNTAX_ERROR/PARSE_ERROR 已消失，正常退出，见 `.impeccable/review/lsp-query-grammar-native-fixed.json`；原始多行 scalar 夹具在此只证明语法，不证明运行时基数合法。

最终全量 **592 passed / 0 failed / 0 ignored**（454 库 + 138 集成、24 个目标），严格 all-targets Clippy `-D warnings`、fmt、2722 文件模块与原有边界检查通过；解析器仍为 30 模块/220 方法。相关日志和最终证据为 `.impeccable/review/lsp-query-grammar-*.log`、`lsp-query-grammar-evidence.json`。当前原生 exe SHA-256：`5a33b0cca4e1cf7b00cb97805651d51ce4cb3010da87c61dd04dfd4d5c719f83`。

另执行 `cargo package --locked --offline --allow-dirty`，源码包 204 文件、1229588 字节，Cargo 已验证其编译；归档内的 12 份 grammar 摘要、构建脚本和绑定与当前源码匹配，发布清单无 tree-sitter-sequel 注册表回退。归档保留于 `.impeccable/review/lsp-query-grammar-source-package.crate`，SHA-256 为 `85f582302eb28a9cddb1fb428930e11ae4a0776f242544dbd73369a006eb1879`，证据为 `lsp-query-grammar-package-evidence.json`。Cargo 对被既有 exclude 规则排除的 integration test target 发出的 packaging 警告不等于运行这些测试；592 项来自前述独立 all-targets 运行。没有执行 cargo publish。

既有 debug 64 KiB 粗门禁继续通过：局部形状 **29.1862 ms**、方言补全 **65.301 ms**、完整服务器首次/重复请求 **143.5072 / 122.835 ms**；语法冷解析 **19.0495 ms**、缓存命中 **3.5 μs**。分段是独立调用，单次数字不证明固定提速或桌面 p95；没有将 grammar 可解析等同于实际数据库执行正确。

规则与构建参考：[PostgreSQL SELECT/集合语法](https://www.postgresql.org/docs/current/sql-select.html)、[MySQL set operations](https://dev.mysql.com/doc/refman/8.4/en/set-operations.html)、[T-SQL UNION](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql?view=sql-server-ver17)、[Cargo multiple locations](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#multiple-locations)。DBX 仍固定为 `b160d130560f71c5c429be15cec6147f677a4b3a`，本批未 fetch、运行 DBX 桌面或连接真实数据库执行 SQL。完整 T-SQL/会话/临时对象、其他厂商类型提升和专有查询结构、稳定同名 CTE 身份、谓词输出、统一语义快照/取消及桌面验收仍在清单中。未更新应用捆绑二进制/清单、提交、推送或运行远端 CI；G01–G13、E01–E07 全目标继续进行。


## 第十七批：复杂谓词的输出类型与智能推荐

本批将谓词的结果类型传递到 CTE/派生输出的字段候选及 hover。新增服务器测试最初 **1 passed / 5 failed**（`.impeccable/review/lsp-predicate-outputs-initial.log`），复现 EXISTS、IN、比较/NULL 检查、逻辑组合及 MySQL/SQL Server CASE 结果为 unknown。后续还复现了 IS DISTINCT FROM 的 FROM 被文本扫描误认成表来源，以及 MySQL `<=>` 缺少完整语法节点；这些均通过规则修复，没有屏蔽诊断。

| 范围 | 当前行为与边界 |
| --- | --- |
| EXISTS / NOT EXISTS | PostgreSQL 为 boolean、MySQL 为 bigint、SQLite 为 integer，结果非空；相关子查询、SELECT NULL 和多列投影不借用子查询输出列的类型 |
| IN / NOT IN | 列表和子查询返回对应方言的谓词类型。列表检查 NULL 和操作数可空性；子查询保持可空，不静态假设其行内容或执行结果。列表最多检查 256 项，超出后保留固定类型并保守标记可空 |
| NULL / 空值安全判断 | IS NULL / IS NOT NULL、PostgreSQL IS [NOT] DISTINCT FROM、MySQL `<=>` 和 SQLite IS 返回非空谓词结果；操作符中的注释、空白和 emoji 保留原文坐标 |
| 比较、模式、范围与逻辑 | 支持已知内置操作数的 PostgreSQL 比较、LIKE/ILIKE/SIMILAR TO、BETWEEN/NOT BETWEEN 及 AND/OR/NOT 组合；MySQL/SQLite 已覆盖比较、成员、NULL 和逻辑路径。PostgreSQL json、未知函数和 UDT 普通比较保持 unknown，不猜测自定义操作符返回类型 |
| CASE 和整数/NULL 合并 | MySQL/SQL Server CASE 支持同类型固定整数分支及 NULL 分支，缺 ELSE 保持可空；相同规则可用于整数集合输出。不同整数、signed/unsigned、DECIMAL 精度等提升仍保持保守。SQL Server 裸谓词不是可投影的布尔列，不伪造 bit 结果；SQLite CASE 类型推断仍为 unknown |
| 语法与来源 | grammar 新增 `<=>` 单一二元运算符；parser 和 local-relation 边界扫描区分 IS [NOT] DISTINCT FROM 与真正 FROM，仍提取实际 users 来源。生成版本继续固定 CLI 0.26.3 / ABI 14，12 份摘要和可反向还原补丁验证通过 |
| 模块和预算 | 新的 [predicates.rs](../vendor/sql-lsp/src/server/local_relations/expression_types/predicates.rs) 独立处理方言谓词和可空性。EXISTS/IN 右侧不做无关的 scalar 输出推断，避免耗尽邻接 scalar 的共享预算；IN 左侧 scalar 仍正常推断。原 32 层表达式/64 查询分支限制继续生效，不为谓词新建无界递归预算 |

NULL 规则按 [PostgreSQL IN/NOT IN](https://www.postgresql.org/docs/current/functions-comparisons.html)、[PostgreSQL 子查询谓词](https://www.postgresql.org/docs/current/functions-subquery.html)、[MySQL 比较](https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html)、[MySQL 三值逻辑](https://dev.mysql.com/doc/refman/8.4/en/logical-operators.html) 和 [SQLite 表达式](https://www.sqlite.org/lang_expr.html) 核对。MySQL bigint 类型依据上游 [Item_bool_func](https://github.com/mysql/mysql-server/blob/mysql-8.4.0/sql/item_cmpfunc.h) 调用 [set_data_type_bool](https://github.com/mysql/mysql-server/blob/mysql-8.4.0/sql/item.h) 设置 MYSQL_TYPE_LONGLONG；没有复制上游实现。这是静态类型推断，不是实时数据库协议元数据认证。可空性保守处理，不进行 FALSE AND NULL 等常量折叠或以查询结果推断空值。

新增 **14 个库测试组 + 1 个真实 stdio 测试**：服务器推荐 6 组、输出类型/可空性/预算 6 组、parser 运算符/来源 1 组、配置 I/O 挂起前的状态一致性 1 组。[输出测试](../vendor/sql-lsp/src/server/local_relations/predicate_tests.rs) 验证含 NULL 列表、相关子查询、CASE 无 ELSE/NULL 分支、未知类型反例、300 项列表降级，以及 100 分支的 EXISTS/IN 不耗尽邻接 scalar 的预算。[协议测试](../vendor/sql-lsp/tests/integration_test_client/predicate_outputs.rs) 验证 **20 份文档**：PostgreSQL 9、MySQL 5、SQLite 4、SQL Server 2；其中 18 个正向类型、2 个 PostgreSQL unknown 反例。每份都检查候选类型/可空性、hover、完整 value 的 textEdit 范围及无错误级/PARSE_ERROR 诊断，使用 emoji/CRLF 和与配置冲突的后缀检验配置方言。

复测还发现旧的同文档方言切换协议用例偶发失败（`.impeccable/review/lsp-predicate-outputs-config-race.log`）：didChangeConfiguration 在写入 schema、文件方言映射之间 await 发送日志，后续诊断可能先观察到旧方言。新增 [确定性回归](../vendor/sql-lsp/src/server/tests/configuration_state.rs) 将客户端输出队列填满且不消费，首次 poll 配置更新即断言 schema/方言路由；修复前稳定失败，修复后通过。现在 [协议处理](../vendor/sql-lsp/src/server/protocol.rs) 在首个客户端 I/O 之前完成全部配置写入与推断路由刷新，然后发送日志/诊断。原生同文档 PostgreSQL/SQL Server/tsql 往返从 4 次增至 24 次。此修复消除该 await 间隙，不将多张 DashMap 宣称为跨线程事务或完整版本化语义快照。

当前全量 **607 passed / 0 failed / 0 ignored**（468 库 + 139 集成、24 个目标），严格 all-targets Clippy、fmt、2726 文件模块及 parser/common/local-relation/provider 边界通过。本批可执行文件 SHA-256：`7842f62bc85b2b0d1ecbbd51856a4f50f4180dd16ab2d44bd132771bed9250fe`。日志与证据位于 `.impeccable/review/lsp-predicate-outputs-*`。64 KiB 空白夹具通过原门禁，本次 debug 完整服务器冷/重复请求为 169.0047 / 133.2726 ms，纯语法冷/缓存命中为 21.3982 ms / 7.1 μs；这些是独立调用，不相加，单次时间不代表发布版桌面延迟或已证明整体加速。

DBX 固定参考 `b160d130560f71c5c429be15cec6147f677a4b3a` 的 [语义类型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 将 row source 的 id、跨度、CTE 跳转及普通列来源作为统一模型；projection/CTE output 接口本身没有表达式结果类型和可空性字段。因此本批以数据库规则校验谓词类型，以 DBX 的作用域/来源设计核对结构，不将静态检查称为已达到 DBX 桌面整体效果。现有差距继续明确保留：

| 优先级 | 待完成内容 |
| --- | --- |
| P1 | 补全、hover、导航与诊断复用版本化语义快照；同名 CTE/行来源的稳定身份、完整 JOIN 空值扩展与依赖图 |
| P1 | 完整厂商类型提升、SQLite 动态表达式/CASE、ANY/ALL/行值谓词，以及扩展操作符/会话模式和真实引擎元数据核对 |
| P1 | 连续编辑时的取消/过期请求隔离、超大文档降级，发布版桌面输入和推荐延迟的量化验收 |
| P2 | MERGE、临时对象/批次及各厂商专有复杂语法的专项矩阵；DBX/Oxide 相同操作的真实桌面对照 |

本批未 fetch 参考仓库、连接真实数据库执行 SQL、运行 DBX/应用桌面、更新应用捆绑二进制/清单、提交、推送、publish 或运行远端 CI。G01–G13、E01–E07 全目标继续进行；没有将本批通过视为所有方言、复杂语句或产品对齐已完成。


## 第十八批：ANY/ALL、行值与数组内部的字段推荐

本批从上一批明确保留的量词和复合值继续推进。初始新增 5 组测试 **2 passed / 3 failed**，确认 ANY/ALL 子查询、PostgreSQL 数组量词和行值比较能解析，但外层候选/hover 丢失类型（`.impeccable/review/lsp-quantified-initial.log`）。扩充结合顺序和内部光标后，又复现了数组类型的错误下标节点、`1+2::integer*3` 将 1+2 全部纳入 cast、ARRAY 内候选为空。另一个测试曾将已有 bigint 字段误写为 integer；核对夹具后改用内外层互不重叠的 email/status 字段，不把该错误预期记作服务端类型修复。

| 场景 | 已实现及验证边界 |
| --- | --- |
| ANY / SOME / ALL 子查询 | PostgreSQL 提示 boolean，MySQL 提示 bigint；覆盖七种普通比较、相关查询、NULL 和省略 FROM 的 WHERE/集合正文。结果不借用子查询的投影类型，保守标记可空。T-SQL CASE 条件可包含量词，输出仍来自整数分支；裸谓词不伪造可投影 bit 类型 |
| PostgreSQL 数组量词 | 数组常量、类型明确的 NULL/空数组、catalog 数组列、ARRAY(SELECT)、重复维度及 CAST/:: 类型可作为操作数；空数组在 NULL 左值下也可得到非空谓词类型。仅在已知内置严格比较/文本模式规则下细化为非空；子查询、未知元素、嵌套数组与搜索操作符继续保守处理，不计算真假或执行隐式转换 |
| 量词与高级搜索 | LIKE/ILIKE、正则及全文/JSON 等已建模布尔操作符可与量词组合；验证带语言参数的 to_tsvector/to_tsquery、CASE 结果和外层 CTE。并非任意同名自定义操作符的类型解析，非法 arity 和厂商执行限制也不因生成 boolean 提示而获得认证 |
| 行值比较与范围 | PostgreSQL/MySQL/SQLite 的多列元组、PostgreSQL/MySQL 的 ROW 构造、相关多列单行子查询，以及行值 BETWEEN 可把结果类型传到外层。按完整列数和对应分量处理，PostgreSQL 只细化已知内置可比较类型；不同列数、未知 UDT、超限结构保持 unknown。子查询可能没有行，因此分量保持可空 |
| 子查询输出结构 | [scalar_queries.rs](../vendor/sql-lsp/src/server/local_relations/scalar_queries.rs) 为同一投影中的原文范围保留完整标量/行输出，一次推断后复用；scalar 接口仍只接受一列，`SELECT (SELECT 1,2)` 不变成虚假 scalar 类型。沿用父查询 64 分支/32 层预算，量词正文不消耗无关的输出类型预算，真实 scalar/row 子查询仍共享预算 |
| 内存与工作量 | [量词](../vendor/sql-lsp/src/server/local_relations/expression_types/quantified.rs) 和 [行值](../vendor/sql-lsp/src/server/local_relations/expression_types/row_values.rs) 分别负责复合表达式；每个列表/行最多检查或保存 256 项。每份投影的子查询类型映射最多额外保留 256 KiB 类型名称字节，超限拒绝完整形状且继续处理较小的后续 scalar。该限制不代表整个服务或输入 catalog 的总内存上限 |
| ARRAY 内字段输入 | [标识符扫描](../vendor/sql-lsp/src/parser/sql/identifiers.rs)、PostgreSQL 前缀和共享列解析使用实际 parser 方言。PostgreSQL 的 [] 作为表达式分隔符，SQL Server/Generic 的括号标识符保持原规则；支持限定/未限定成员、ARRAY 与括号间空白、相关内外层字段及带引号名称。字段 [接受推荐的编辑](../vendor/sql-lsp/src/server/completion_quotes.rs) 不吞掉闭合 ]，共享前缀偏移保留 CRLF |
| 真实数组类型 AST | [grammar 补丁](../vendor/sql-lsp/grammars/sql/oxide-grammar.patch) 将数组类型/维度的优先级与结合方向明确化，完整 cast 拥有 array_size_definition；括号包裹的 cast 结果仍可真正取下标。移除旧的合成缺失下标恢复/错误忽略路径，[array_casts.rs](../vendor/sql-lsp/src/parser/sql/array_casts.rs) 现在只识别完整节点用于方言诊断；非 PostgreSQL 路径继续报告 UNSUPPORTED_DIALECT_SYNTAX，参数内部真实错误保留 |
| :: 结合顺序 | 给 postfix cast 明确优先级和左结合，回归要求 `1+2::integer*3` 的 cast 节点只包含 `2::integer`，另核对数组类型维度与真实下标；保留原文字节坐标。修复的是 AST 结合范围，未执行这条 SQL 或以静态结果证明实际执行值 |

规则依据：[PostgreSQL 数组量词与行比较](https://www.postgresql.org/docs/current/functions-comparisons.html)、[子查询量词](https://www.postgresql.org/docs/current/functions-subquery.html)、[数组类型与维度](https://www.postgresql.org/docs/current/arrays.html)、[行构造](https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-ROW-CONSTRUCTORS)、[转换与运算符优先级](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-PRECEDENCE)、[模式匹配](https://www.postgresql.org/docs/current/functions-matching.html)、[MySQL ANY/SOME](https://dev.mysql.com/doc/refman/8.4/en/any-in-some-subqueries.html)、[MySQL ALL](https://dev.mysql.com/doc/refman/8.4/en/all-subqueries.html)、[SQLite 行值](https://www.sqlite.org/rowvalue.html)、[T-SQL SOME/ANY](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/some-any-transact-sql?view=sql-server-ver17)。这些支持静态编辑器规则，不代替引擎执行、session/collation/重载或元数据协议验收。

新增 **18 个库测试组 + 2 个真实进程测试**：parser 4、输出类型/空值/预算 9、服务器语义/光标 5。重点入口为 [parser](../vendor/sql-lsp/src/parser/sql/tests/quantified.rs)、[输出测试](../vendor/sql-lsp/src/server/local_relations/quantified_tests.rs)、[服务器测试](../vendor/sql-lsp/src/server/tests/complex_semantics/quantified.rs) 及 [原生协议测试](../vendor/sql-lsp/tests/integration_test_client/quantified.rs)。预算测试包括 63/64 分支、100 分支量词不饿死邻接 scalar、300 分量拒绝部分行结构，以及超大不透明类型不进入保留映射。

原生新增 **38 份文档**：29 份外层输出（PostgreSQL 18、MySQL 6、SQLite 3、SQL Server 2，其中 27 个已知类型、2 个 unknown 反例）、6 份 PostgreSQL 内部字段光标、3 份真实语法错误。输出检查类型/可空性、hover、完整字段 textEdit 与诊断；内部字段检查限定/未限定数组成员、内外相关来源，实际应用编辑后 SQL 原样保留分隔符。均使用 emoji/CRLF，并让配置方言覆盖 mysql 后缀/languageId。

最终全量 **627 passed / 0 failed / 0 ignored**（486 库 + 141 集成、24 个目标），严格 all-targets Clippy 和 fmt 通过；2731 文件模块检查、parser 30 模块/224 方法、common 7 模块/83 函数及局部关系/provider/协议边界通过。64 KiB 空白夹具通过原门禁，单次 debug 完整服务器冷/重复请求为 145.1464 / 127.8699 ms，纯语法冷/缓存命中为 20.2481 ms / 2.9 μs；不据此声明 p95、发布版桌面延迟或固定加速比。

源码包验证后，对最终重建产物额外运行 20 个原生协议测试，全部通过（不重复累计入 627 项）；本批最终可执行文件 SHA-256：`e133a7f674a0646e4f0b936b6fba6a120a0645c7e9840ee0ee6daa9198e601ce`。证据为 `.impeccable/review/lsp-quantified-*`；上游归档、生成器版本和 ABI 继续按 [grammar 维护说明](../vendor/sql-lsp/grammars/sql/OXIDE_PATCHES.md) 固定，规范化摘要检查及反向补丁仍接入 parser 门禁。

固定 CLI 0.26.3 / ABI 14 再次生成的 6 份 C/header/JSON 输出逐项一致，12 份来源摘要与反向补丁通过。`cargo package --locked --offline --allow-dirty` 本地验证编译成功，保留归档 `.impeccable/review/lsp-quantified-source-package.crate`（SHA-256 `c89a2db5b18a5e7b801ca798e34f0dcf0a3b587e2b6df5dff4fe4b7177e406ae`）；核对包内 12 份 grammar 摘要及 18 份当前 Rust 文件一致，无注册表旧 grammar 回退。Cargo 因已有 tests/* 排除规则提示部分集成目标不进入包；627 项测试是独立 all-targets 运行的结果，包验证不代替它们。未执行 publish。

DBX 参考仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`。其 [row source / projection 模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 的统一身份、跨度及来源链仍是结构对照；本批扩展的局部输出映射没有替代为完整统一语义图。当前优先差距继续保留：版本化补全/hover/导航/诊断快照、稳定同名 CTE/行来源身份、完整 JOIN 可空性、完整厂商运算符优先级、会话/隐式提升与 UDT 规则、SQLite CASE、更完整的函数/窗口输入矩阵、取消和超大文档降级，以及相同 SQL 的真实引擎/DBX/应用桌面验收。

本批未 fetch、连接真实数据库执行 SQL、运行 DBX/应用桌面、更新应用捆绑二进制/清单、提交、推送、publish 或运行远端 CI。G01–G13、E01–E07 全目标继续进行，未将这一批的静态语义和协议检查扩写为全部产品或所有复杂 SQL 已对齐。

## 第十九批：数组和嵌套表达式中的函数推荐与参数提示

本批按 DBX 的推荐上下文、函数族、窗口 snippet 和参数组行为继续核对。静态参考为 [semantic/completion.ts](../sources/dbx/apps/desktop/src/lib/sql/semantic/completion.ts)、[函数族测试](../sources/dbx/apps/desktop/src/lib/__tests__/sql/sqlCompletion.functionFamilies.spec.ts) 和 [签名测试](../sources/dbx/apps/desktop/src/lib/__tests__/sql/sqlCompletion.signature.spec.ts)。DBX 将 replacementRange、列/函数意图和来源信息传给候选生成，并测试 ClickHouse 参数化聚合的第二参数组。本批对齐这些可检查行为，没有运行 DBX 桌面进行观感或延迟评分；DBX HEAD 仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。

| 核对项目 | 当前补齐行为 | 边界 |
| --- | --- | --- |
| 数组内推荐列表 | PostgreSQL ARRAY、ANY(ARRAY)、ClickHouse 裸数组/lambda、Hive array 和 MySQL JSON_ARRAY 中提供当前方言函数；数组内窗口函数提供 OVER snippet | 仅对已有函数目录生成候选，不把任意 UDF 或数组输出类型猜成已知类型 |
| 推荐接受后的 SQL | TextEdit 替换整个函数词，包括光标后的后缀；已有调用仅换名称，保留参数、注释、数组闭括号和已有 OVER；新调用保留 snippet | 软语句切分的上下文可截短，编辑范围和后续实参仍从完整原文计算；UTF-16/emoji/CRLF 有实际协议断言 |
| 复杂签名定位 | 区分数组内部逗号与函数参数逗号，跳过匿名括号找到外层调用；识别名称与左括号间注释、嵌套注释及 ClickHouse 参数组 | 扫描上限 64 KiB，参数组回溯最多 3 次；超出窗口或未知调用不承诺提示 |
| 词法一致性 | 推荐排除与调用扫描共享方言规则；区分数组和 T-SQL/SQLite 方括号名称，PG 普通/E 字符串、ClickHouse 转义/heredoc/注释及 Hive 双引号字符串 | 未完整建模 MySQL ANSI_QUOTES/NO_BACKSLASH_ESCAPES、PostgreSQL 非默认会话设置及所有厂商标识符语法 |
| 真实 grammar | 新增 ClickHouse `[arrayMap(...)]` 和 Hive `array(...)` 的完整数组节点；PostgreSQL 配置对裸数组和 ARRAY(value,...) 给出方言错误 | 沿用未结束语句 EOF 诊断延迟策略；明确方言拒绝用分号结束的 SQL 验证；未据共享 grammar 推断所有厂商语法均合法 |

首轮服务器聚焦测试 **1 passed / 3 failed**，复现数组内缺少函数/窗口候选及签名定位问题。真实进程随后暴露了 ClickHouse 裸数组的真实 grammar 缺口，保留失败日志并修复语法源。另一条缺少分号的双 SELECT 夹具原本就有错误，测试改为要求接受推荐前后错误数不变；其余 **11 条合法接受编辑的 SQL** 均要求无错误级/语法诊断，没有屏蔽错误。PostgreSQL 完整反例使用分号，以免与现有 EOF 编辑策略混淆。

新增 **14 个库测试组 + 2 个真实进程测试**。最终全量 **643 passed / 0 failed / 0 ignored**（500 库 + 143 集成、24 个目标）；新 stdio 覆盖六个配置的 **30 份文档**：12 条接受编辑、9 条签名、9 条字符串/注释/方括号名称排除。配置故意与 `.mysql.sql` 后缀冲突，确认实际文件配置优先。测试源码：[解析器](../vendor/sql-lsp/src/parser/sql/tests/routine_inputs.rs)、[共享调用扫描](../vendor/sql-lsp/src/server/tests/routine_context.rs)、[服务器候选](../vendor/sql-lsp/src/server/tests/complex_semantics/routine_inputs.rs)、[真实进程](../vendor/sql-lsp/tests/integration_test_client/routine_inputs.rs)。

[sql_lexical.rs](../vendor/sql-lsp/src/sql_lexical.rs) 统一方言词法策略，匹配方言名不分配小写 String；[routine_context.rs](../vendor/sql-lsp/src/server/routine_context.rs) 承担有界调用扫描，[signature_help.rs](../vendor/sql-lsp/src/server/signature_help.rs) 保留格式与重载选择。内置函数和窗口候选复用一次上下文，实参是否为空复用操作数掩码，避免重复扫描；2 万层匿名分组使用粗时间门禁防止明显平方退化，不代表桌面输入延迟或固定倍数提速。

严格 Clippy（all-targets、`-D warnings`）、fmt、2736 文件模块门禁及 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界检查通过。parser 保持 30 模块/227 方法，common 保持 7 模块/83 函数。固定 CLI/ABI 再生成的 6 份文件摘要完全一致，12 份 grammar 指纹与反向补丁验证通过。Cargo 离线源码包验证编译成功：218 文件，包内 180 份 Rust 源与当前 src 一致；归档 SHA-256 为 `2bca8103c28802d15b82662a5b7584df5a0125fe11d512b2f92bac2d50996776`。Cargo 按既有 exclude 排除集成测试并给出提示，源码包编译和全量测试是两项独立证据；未发布。日志、保留源码包与机器清单见 `.impeccable/review/lsp-routine-inputs-*`。

语法依据：[PostgreSQL 数组构造](https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-ARRAY-CONSTRUCTORS)、[词法与转义](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)、[ClickHouse syntax](https://clickhouse.com/docs/reference/syntax)、[Hive 类型/字符串](https://hive.apache.org/docs/latest/language/languagemanual-types/)、[MySQL 字符串与模式](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)。未连接实际引擎执行这些 SQL，也未验证安装版 Monaco snippet/参数弹层。

最终全量测试所用本地 debug LSP SHA-256 为 `ef358cd4786be2cec83aae6e80d919c00abfeb71ee98ff873864de6cbf19d95f`。既有 64 KiB 夹具独立复核：形状 26.8596 ms、方言补全 62.7309 ms、完整服务器首次/重复 158.0214 / 129.1484 ms，语法缓存命中 2.1 μs。各阶段是独立调用的单次 debug 观测，不是固定提速或桌面 p95。

剩余优先项：P1 为稳定来源身份、完整 JOIN 可空性、schema/引号限定的 UDF 重载、厂商会话/类型规则和统一请求快照/取消；P2 为真实桌面接受推荐与长文档 p95、各引擎执行验收及更多专有语法。仍不能宣称所有复杂 SQL 或全部 DBX 交互均已对齐。本批未更新应用捆绑二进制/清单、提交、推送或执行远端 CI，G01–G13、E01–E07 全目标继续进行。

## 第二十批：限定 UDF 身份与一致的参数提示

继续核对 DBX 对 routine 的 namespace、引用插入和重载标识处理。[buildObjectItems](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 按 objectMatchesCompletionContext 过滤对象，再分别处理 schema 引用、applyName 和 routineId/signature 去重；[签名测试](../sources/dbx/apps/desktop/src/lib/__tests__/sql/sqlCompletion.signature.spec.ts) 另覆盖内置签名参数组。这是固定源码 `b160d130560f71c5c429be15cec6147f677a4b3a` 的静态参照，本批没有运行 DBX 桌面对比。

本地首轮新增服务器测试 **2 passed / 5 failed**：`other.calc(...)` 错配到当前 schema 的 calc，PostgreSQL CALC 同时返回 calc/Calc，带点号或转义的引号名称丢失身份，未知限定名回退普通内置，注释中的逗号破坏参数标签。修复完整引用后，旧测试从“丢弃限定名”改为断言完整引用；没有降低最终协议输出断言。

| 项目 | 当前行为 | 仍有的边界 |
| --- | --- | --- |
| 限定名和引号 | 保留 schema/catalog、引号、引号内点号、双写终止符、Unicode 以及名称间的注释/空白；PostgreSQL 未加引号的 ASCII 大写折成小写，带引号严格匹配；ClickHouse live 名称严格匹配 | 支持至三段引用，不完整覆盖 SQL Server 四段名/省略 namespace、Oracle package 与所有厂商大小写/会话规则 |
| namespace 选择 | 当前 schema 直接借用；其他 schema 只在已有当前 catalog 名称中寻找唯一匹配；缺少 catalog、重复候选或错误限定名不使用当前同名函数 | catalog 是名称，不是连接身份；同名 catalog 跨连接、完整 search_path、临时对象和会话 namespace 仍需结构化身份。没有把这项当作完整连接隔离证明 |
| 内置回退 | 未知 `other.CONCAT`、`app.CONCAT` 不再变成普通 CONCAT；PG 支持普通 pg_catalog 函数和正确的小写引号名称，拒绝把 `"LOWER"` 当 lower | 非 PG 厂商的限定内置和引号/别名规则未完整建模；PG live 元数据优先策略保留，未实现引擎完整类型/搜索路径决议 |
| PG 条件表达式 | 普通 COALESCE/GREATEST/LEAST/NULLIF 使用语法提示，不被同名 UDF 覆盖；其引号/限定形式只能匹配真实 live 元数据 | 不将这些语法形式伪装为任意 pg_catalog 函数 |
| 参数内联标签 | 与签名共享身份规则，方言噪声/操作数掩码各构建一次，跳过字符串、heredoc、嵌套注释及数组内逗号；标签落到实际实参起点，支持 UTF-16、CRLF 和请求范围 | 只在可接受实参数量的重载之间名称唯一时给标签；完整类型选择、VARIADIC/OUT 模式和命名实参绑定仍待补齐 |

[新增 routine_identity.rs](../vendor/sql-lsp/src/server/routine_identity.rs) 只承担 SQL 名称组件、namespace 选择和内置资格；[routine_context.rs](../vendor/sql-lsp/src/server/routine_context.rs) 保留有界调用定位，[routine_hints.rs](../vendor/sql-lsp/src/server/routine_hints.rs) 负责标签。移除末段比较与重复手写字符串扫描。当前 schema 使用 Cow 借用；SchemaManager 先确认唯一命中再克隆一份外部 metadata，避免遍历时克隆每份 schema。身份判断不缓存最终结果，仍不是完整跨请求原子快照。

新增 **10 个库测试组 + 2 个真实进程测试**；全量 **655 passed / 0 failed / 0 ignored**（510 库 + 145 集成、24 个目标）。[服务器测试](../vendor/sql-lsp/src/server/tests/routine_identity.rs) 包括错误/缺失 catalog、重复 namespace、引号/点号、默认词法、命名实参、歧义重载标签、范围和预算。[真实进程测试](../vendor/sql-lsp/tests/integration_test_client/routine_identity.rs) 覆盖 PostgreSQL/MySQL/SQL Server/ClickHouse 的 18 份签名文档，另用 1 份原文不变的文档连续替换六次 metadata：旧参数→更新→移除→其他 catalog→恢复→重复 namespace，同时检查签名和标签。合计 **19 份文档、24 次签名、6 次标签请求**，19 份完整 SQL 均检查无错误级诊断；这只证明编辑器的语法和元数据行为，不代表函数存在、参数类型可执行或实际引擎兼容性。

真实进程首次还纠正了一条夹具：测试查询 `"lower"(...)` 时同时提供了同名 live UDF，却期待内置签名。内置专用夹具移除了冲突 UDF，另保留 `app.lower` 的 live 优先断言，失败日志留存；没有为使测试通过而修改既有优先策略。

原有调用定位保持 64 KiB 扫描限制；新增标签对每个实参列表最多扫描 64 KiB、最多返回 500 个标签。标签仍为完整文档建立两份等长词法掩码，该成本不是全局内存上限。2 万层匿名分组的粗时间门禁和超长实参拒绝通过，不据此报告桌面 p95 或固定提速。严格 Clippy、fmt、2738 文件模块及 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界通过，parser/common 保持 30/227 与 7/83。grammar 未修改，12 份指纹/反向补丁验证通过。Cargo 离线源码包验证编译通过，220 文件、182 份包内 Rust 源与当前 src 一致，SHA-256 `cf10e45b53a478b3cef2e42ff685c6eed957aa90b1afd42b0e0c1b105343d5b7`；集成测试按既有 exclude 不随源码包发布，全量测试另有日志。证据与归档在 `.impeccable/review/lsp-routine-identity-*`，未 publish。

规则依据：[PostgreSQL 名称/注释](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)、[函数解析与限定 schema](https://www.postgresql.org/docs/current/typeconv-func.html)、[条件表达式](https://www.postgresql.org/docs/current/functions-conditional.html)、[ClickHouse 标识符与大小写](https://clickhouse.com/docs/reference/syntax)。本批不连接数据库执行 SQL，不替换应用捆绑二进制或清单；完整类型重载/连接身份、JOIN 可空性、稳定来源、快照/取消及真实桌面验收继续列为未完成。未 fetch、提交、推送或执行远端 CI，G01–G13、E01–E07 全目标继续进行。

最终第二十批本地 debug LSP SHA-256：`810a7e2a34f2b6632347be4a8a6424f55f0fab7d001d2dee8fdceb4da9598a54`，对应 package 校验后的全量测试；未替换桌面捆绑文件。

## 第二十一批：按实参表达式排序重载

本批继续核对 DBX 的 [getSqlFunctionSignatureHelp](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 和 [签名测试](../sources/dbx/apps/desktop/src/lib/__tests__/sql/sqlCompletion.signature.spec.ts)：该入口分别选择普通内置签名与 ClickHouse 参数组，并按当前参数位置调整提示。本地补齐 live metadata 重载的表达式依据；这是固定源码 `b160d130560f71c5c429be15cec6147f677a4b3a` 的静态核对，不是 DBX 全部编辑器推断能力的运行比较。

新增服务器测试最初 **1 passed / 5 failed**：明明输入整数、显式 CAST、字段或标量查询，首项仍按 metadata 原顺序/参数位置选择。修复后使用已有 projection 表达式推断，保留实际 SQL、AST 和查询来源，不为每个实参拼接 SELECT 或重新创建 parser。

| 场景 | 当前行为 |
| --- | --- |
| 已知字面量/转换 | PostgreSQL 整数、大整数、布尔、numeric、显式 text 和数组类型转换参与排序；int4/int8/bool 等已知内置别名按方言统一，未指定类型的字符串和 NULL 不伪造确定类型 |
| 复杂表达式 | CASE、COALESCE、算术、括号与标量聚合查询复用现有类型规则；不支持的函数、UDT、未知字段保持未知 |
| 查询作用域 | 当前 FROM、CTE、派生表和允许的相关外层字段提供类型；未引用 CTE、缺失限定符及非 LATERAL 隔离来源不参与。PG/MySQL/T-SQL 兼容别名也在局部推断入口统一 |
| 光标与完整调用 | 语法完整时读取完整实参列表，考虑光标后已有参数、可选参数和总数量；不完整时使用有界的已输入片段，不把未完成表达式的前缀认作完整类型 |
| 排序与保留 | 先检查可用参数数量，再按已知内置类型的精确匹配数排序；同分保持原顺序，先排序再限制 50 项，其他候选仍保留 |

新增 [routine_overloads.rs](../vendor/sql-lsp/src/server/routine_overloads.rs) 只负责类型身份与排序；[argument_types.rs](../vendor/sql-lsp/src/server/local_relations/argument_types.rs) 组织当前行来源、标量输出和表达式类型；[projection.rs](../vendor/sql-lsp/src/server/local_relations/projection.rs) 提供同一语法树上的实参节点。调用扫描保留原文字节范围，注释/字符串/数组逗号不拆分参数，范围在超过 64 KiB 前缀窗口后仍为原文绝对偏移。原有签名上下文的四项断言继续保留，并独立增加范围与预算断言。

仅在至少两个 live 重载、普通参数组且文档不超过 512 KiB 时分析实参；不为单一签名增加这条分析路径。每次复用输入绑定与语法树处理所有参数，类型 key 对每个候选只计算一次；未知信息不用于删除候选。最多 256 个实参，每个保留类型名最多 256 字节，单份名称列表最多 64 KiB；继续沿用表达式 32 层、标量查询 64 分支/32 层和其已有的名称预算。超预算退回参数位置及稳定顺序。以上不等于整个请求的内存/时间上限，也没有给 metadata 总候选数量增加新上限。

新增 **9 个库测试组 + 2 个真实进程测试**，全量 **666 passed / 0 failed / 0 ignored**（519 库 + 147 集成、24 个目标）。[服务器测试](../vendor/sql-lsp/src/server/tests/routine_overloads.rs) 包括 60 个先行候选后的正确排序、光标后参数、可选参数、未知保持、作用域隔离、绝对范围、超 256 个参数、513 KiB 文档粗门禁和超长 metadata 类型名称拒绝。[真实进程测试](../vendor/sql-lsp/tests/integration_test_client/routine_overloads.rs) 覆盖 PostgreSQL（含 postgresql 别名）、MySQL、SQL Server：18 份复杂表达式/查询文档均断言首项、保留两项、活动参数及无错误级诊断；另 1 份文档不改原文，连续六轮替换 bigint/text/custom_domain/int8/删除重载/恢复，确认排序不会使用旧字段类型。共 **19 份文档、24 次签名请求、19 份无错误级诊断检查**。这些是编辑器证据，不是各引擎允许相同定义或实际执行的兼容性认证。

严格 Clippy、fmt、2741 文件模块和 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界通过；parser/common 保持 30/227 和 7/83。grammar 未修改，12 份指纹和反向补丁检查通过。离线 Cargo 源码包验证编译通过，223 文件，185 份包内 Rust 源与当前 src 一致，SHA-256 `b4b334c11e78e3d9befe21c9da7a3231010678711e85126f470bf8f490afebcf`；集成测试按既有 exclude 不随包发布，全量测试另有日志。证据与保留归档见 `.impeccable/review/lsp-routine-overloads-*`，没有 publish。时间断言是 debug 粗退化门禁，未据此报告固定提速或桌面 p95。

规则参考：[PostgreSQL 函数解析](https://www.postgresql.org/docs/current/typeconv-func.html) 中的候选、精确类型与未知参数规则。本批仅对已有类型知识排序，不实现 pg_cast 隐式转换图、类型类别/首选类型、domain/search_path 决议、VARIADIC/OUT 或完整命名参数绑定，也未将 UDF 返回类型自动传到投影。参数内联标签继续使用已验证的保守歧义规则。本批未 fetch、替换桌面捆绑 LSP/清单、提交、推送或运行远端 CI；完整重载、连接身份、稳定来源/JOIN、快照/取消及桌面/真实引擎验收仍待完成，G01–G13、E01–E07 全目标继续进行。

最终第二十一批本地 debug LSP SHA-256：`f900e6d72dd1ac353fbfe2da831c53ec60d02235cf5bc0e27b4d0c7c180d9ac6`，对应源码包核验后的全量测试；未替换应用捆绑文件。

## 第二十二批：参数模式贯通、VARIADIC 与 CALL

本批沿 [DBX routine 对象候选](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 的 signature/applyName/routineId 信息继续核对参数提示链路。参照仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch 或运行 DBX 桌面；不据此宣称两者所有过程编辑能力已经持平。

真实缺口不只在 LSP：PostgreSQL 驱动解析时丢弃模式、前端 catalog 同步没有转发、LSP 参数模型也没有字段。服务器新增测试初始 **1 passed / 5 failed**；修正夹具 API 后的前端初始测试 **1 passed / 2 failed**，复现模式丢失（签名 hash 原本已经支持 mode）。显式 VARIADIC 又复现 **6 passed / 2 failed** 的真实语法缺口；原生测试随后发现合法 CALL 被报语法错误，保留 **27 passed / 1 failed** 日志，再补实际语法节点，没有豁免合法语句的错误检查。

| 范围 | 当前实现与边界 |
| --- | --- |
| 元数据传递 | [FunctionParameterInfo](../src-tauri/src/core/protocol.rs)、[PG 参数解析](../src-tauri/src/drivers/postgres/parameters.rs)、[MySQL metadata](../src-tauri/src/drivers/mysql/driver.rs) 保留 mode；[前端类型](../src/services/tauri/types/schemaCatalog.ts) 与 [catalog 同步](../src/features/lsp-sync/runtime/loadLspCatalogs.ts) 转发至 LSP，旧参数没有 mode 时兼容原行为。未知模式原样保留，按普通输入保守处理 |
| PG 函数与过程 | 函数的 OUT/TABLE 不占输入位置，INOUT 保留；RETURN 不作为调用参数。普通 CALL 的过程 OUT 仍占实参位置，MySQL OUT 也保留。CALL 与标量调用按已知 routine_type 区分，嵌套函数不会误用外层过程；未知 kind 保留旧 metadata 兼容行为 |
| 变长参数 | 已知 PG 最后一个输入参数为 VARIADIC 且声明 `[]` 数组时，普通多实参按元素类型排序/标注，活动参数钳到最后一个声明槽；未声明默认值时至少需要一个元素。非数组、不在最后输入槽或其他产品的模式不擅自扩展 |
| 显式数组传参 | `VARIADIC ARRAY[...]::integer[]` 和空数组形式有真实语法节点，按数组类型匹配；即使光标位于关键字之前，也从完整调用读取标记。非 PG、重复 VARIADIC 或并非最后实参给出错误级方言诊断，未删除关键字或压平 AST |
| CALL 与标签 | 补有括号的 CALL 语法及真实 invocation；签名和参数内联标签共享 [RoutineParameters](../vendor/sql-lsp/src/server/routine_parameters.rs)。零输入参数不再伪造活动参数索引；文档仍展示完整输出声明，避免把“隐藏输入槽”误当成删除元数据 |
| PG catalog 参数字符串 | 保护引号名称、双写引号、数组/括号中的逗号、E 字符串、dollar 常量、嵌套注释和 DEFAULT 文本；不再把未命名 double precision、timestamp with time zone、numeric(...) 或限定类型拆成假参数名。这是 catalog 字符串读取，不是完整任意 DDL 编译器 |

[LSP 模型/显示](../vendor/sql-lsp/src/schema.rs)、[签名](../vendor/sql-lsp/src/server/signature_help.rs)、[排序](../vendor/sql-lsp/src/server/routine_overloads.rs)、[标签](../vendor/sql-lsp/src/server/routine_hints.rs) 使用同一调用参数视图；PG 名称别名/大小写沿现有词法策略识别。模式加入 schema 快照的排序身份与序列化，新增 [指纹回归](../src-tauri/src/core/schema_diff/tests/metadata.rs)；旧 JSON 缺省 mode 为 None，序列化时不增加空字段。没有把 mode 缓存进仅依赖 SQL 的语法缓存。

新增 **9 个 LSP 库测试组 + 2 个真实进程测试**，全量 **677 passed / 0 failed / 0 ignored**（528 库 + 149 集成、24 个目标）。[模式测试](../vendor/sql-lsp/src/server/tests/routine_modes.rs) 覆盖 JSON/旧字段、输出槽、过程、变长参数、无参数、kind/嵌套区分、未知模式与语法限制；原有构造夹具显式设 mode=None。[原生协议测试](../vendor/sql-lsp/tests/integration_test_client/routine_modes.rs) 共 **16 份文档**：12 份 PG/MySQL 正向签名及标签、3 份必须报错的反例、1 份不改原文的六轮模式替换；18 次签名、18 次标签，13 份无错误级诊断、3 份保留方言错误，含 emoji/CRLF 位置断言。源码包验证后另跑全部 **28 个真实进程测试**，全部通过。

应用侧还验证了：前端相关 **25 项通过**（其中 3 项新模式测试）、TypeScript 通过；无桌面构建 PG 驱动 **26 passed / 1 ignored**、MySQL 驱动 **20 passed / 1 ignored**，两个忽略项均为既有真实数据库用例，未当作已执行。最初无桌面 schema_diff 过滤得到 0 项，未计入有效验收；随后启用 desktop 特性实际执行 **82 项快照测试，0 失败/忽略**，包括新增模式指纹测试。未启动桌面窗口、连接真实数据库或调用实际过程。

严格 Clippy：LSP all-targets、应用 lib 无桌面与 desktop 两种构建全部通过；Rust 格式/TypeScript、2744 文件模块、parser/common/local-relation/protocol、PG/MySQL 驱动与 LSP、schema-config/sync-plan/schema-diff 边界通过。parser/common 保持 30/227 与 7/83；PG 驱动因三个参数词法 helper 从 34 变为 37，仍为 6 模块/76 方法，门禁按实际职责更新。

grammar 的 CALL 与 VARIADIC 补丁可从固定上游反向还原；12 份指纹、ABI 14 和固定 CLI 再现的 6 份文件一致。离线 Cargo 源码包验证编译通过，225 文件、187 份包内 Rust 源与当前 src 一致，SHA-256 `a3e1778686f29bc682565eae907b9852e914341fc7192ead920eb035215ac3ff`；集成测试仍按既有 exclude 不随源码包发布，全量/原生测试另有日志。证据与归档在 `.impeccable/review/lsp-routine-modes-*`，未 publish。参数视图复用已有有界扫描和实参类型分析，未声称全局内存上限或桌面 p95 提升。

语义依据：[PG 函数 OUT/INOUT/VARIADIC](https://www.postgresql.org/docs/current/xfunc-sql.html)、[CALL 的 OUT 实参](https://www.postgresql.org/docs/current/sql-call.html)、[MySQL 过程参数](https://dev.mysql.com/doc/refman/8.4/en/create-procedure.html)。剩余包括完整命名实参绑定、VARIADIC 多态、SQL Server EXEC/其他产品过程语法、PL/pgSQL 语境、CALL 目标候选的完整区分、隐式转换/search_path、UDF 投影类型、结构化连接身份、稳定来源/JOIN、快照/取消及真实桌面/引擎验收。未 fetch、更新应用捆绑 LSP/清单、提交、推送或运行远端 CI；G01–G13、E01–E07 全目标继续进行。

最终第二十二批本地 debug LSP SHA-256：`6e0ef555126d71049b12f0fac5cf53fd3c2fdb0528c31c0f72e274126e6dea2a`，对应源码包核验后通过 28 项原生进程测试的可执行文件；全量测试验证同一份源代码。

## 第二十三批：CALL 目标推荐与接受后的参数提示

继续静态核对 [DBX buildObjectItems/buildRoutineApply](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts)：参考在 exec 上下文筛选 procedure，处理限定名、引号、签名及 routineId 去重，排序后截断候选，并提供参数片段。固定参考仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`；本批没有 fetch 或运行 DBX，不能据此宣称桌面效果已经全面持平。

新增测试先复现 **0 passed / 8 failed**：CALL 名称位置混入其他候选、限定名/完整叶子替换有缺口、已知过程会进入标量列表。新增独立 [call_completion](../vendor/sql-lsp/src/server/call_completion.rs)，由 [runtime](../vendor/sql-lsp/src/server/runtime.rs) 在通用表/列推断之前识别 CALL 目标；不把参数表达式当作目标位置。普通表达式不额外读取或克隆 CALL schema，新增回归断言这一点。

| 核对项 | 本批行为与剩余边界 |
| --- | --- |
| 类型与作用域 | CALL 名称列表只接收明确标记 procedure 的实时元数据；function、未知 kind、表/列和关键词不混入。复用 RoutineIdentity 的当前 schema、限定名、同 catalog 唯一查找；缺失或歧义不猜测。标量表达式列表去掉已知 Procedure 项；签名链路对未知 kind 的历史兼容策略不变 |
| 匹配和重载 | 未加引号时复用精确/前缀、驼峰缩写和子序列排序；PG 引号前缀保留大小写，MySQL 沿现有大小写策略。不同参数签名保留、重复签名去重；排序/去重后最多 100 项，1001 条元数据中位于末尾的精确候选仍能排首位 |
| 接受推荐 | 按方言引用完整元数据名称并转义内部引号；名称中的点仍是单个原子。替换整个叶子及其引号/尾部空格，保留已有 qualifier、注释、括号和实参。现有调用仅替换名称；新调用插入 `name($0)`，光标进入空实参位置，没有自动猜测参数值 |
| 编辑态和位置 | 空目标、限定名后的点、光标位于名称中间、双写引号中间、未闭合引号、Unicode/emoji 与 CRLF 有测试。未闭合名称在光标后的首个换行或分号处截止，保留后续语句；没有把后续 SELECT 吞进 TextEdit |
| 性能与模块 | CALL 识别窗口为光标前后各 64 KiB，先进行词法扫描，识别为目标后才取 schema；目标路径绕开通用投影/字段分析。上限约束输出和文本窗口，元数据匹配/排序仍随实际例程数量增长，不宣称全局内存上限、固定提速或桌面 p95 |

[库测试](../vendor/sql-lsp/src/server/tests/call_completion.rs) 新增 **9 组**，全量 **688 passed / 0 failed / 0 ignored**（537 库 + 151 集成、24 目标）。[真实进程测试](../vendor/sql-lsp/tests/integration_test_client/call_completion.rs) 新增 **2 项**：12 份 PG/MySQL 文档逐项请求推荐，通过独立 UTF-16 范围转换接受实际 TextEdit，保留完整 SQL 并填入显式测试实参，再断言签名、OUT 活动参数、两个内联标签及无错误级诊断。另 1 份原文不变文档做六轮名称/kind/重载/删除/恢复，及 4 份字符串、注释、未知 namespace 和参数内反例；合计 **17 份文档、22 次推荐、12 次签名、12 次标签、12 份无错误级诊断检查**。带 `.mysql.sql` 的 URI 在 PG 配置下也验证实际配置优先。初次原生检查发现测试模板重复追加分号，修正模板后通过，未为该夹具放宽诊断断言。

严格 all-targets Clippy、fmt、2746 文件大小及 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界通过，parser/common 保持 30/227、7/83。grammar 未修改，12 份指纹及固定上游补丁检查通过。离线 Cargo 源码包验证编译通过：227 文件、189 份包内 Rust 源与当前 src 一致，SHA-256 `3474638d9029b0345c5d07b6fcd4e560b787d14945697b5e324f46493cf54edf`。集成测试按既有 exclude 不随包发布；源码包之后额外执行全部 **30 项真实进程测试**。本批只改 LSP，未重复计入上一批的前端/应用驱动检查。证据和保留归档：`.impeccable/review/lsp-call-completion-*`，没有 publish。

语义依据：[PostgreSQL CALL](https://www.postgresql.org/docs/current/sql-call.html) 的过程名称、输入和 OUT 实参规则；编辑范围遵循 [LSP CompletionItem](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#completionItem)。上述是编辑器协议和语法验证，没有实际执行过程。与 DBX 仍有差距：没有完整参数片段选项、稳定 routineId 身份、编辑 schema/catalog 组件时的名称推荐、Oracle 包过程及 SQL Server EXEC；还需完整命名参数绑定、search_path/隐式转换/多态、UDF 投影类型、结构化连接身份、稳定来源/JOIN、快照/取消和打包桌面/真实引擎验收。未更新应用捆绑 LSP/清单、提交、推送或远端 CI；G01–G13、E01–E07 完整目标继续进行。

最终第二十三批本地 debug LSP SHA-256：`3085db576abe9f1e335a977470b3ab8b0a2795b4e34bd59ab81f07b267f5ac54`，对应源码包核验后的原生测试文件；应用捆绑二进制未替换。

## 第二十四批：命名参数绑定、推荐与复杂实参

继续核对 [DBX getSqlFunctionSignatureHelp/buildRoutineApply](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts)。该签名入口按顶层逗号计算活动参数，并查询内置/driver profile 签名；routine 推荐能生成参数片段。这里没有看到按实参名称重新绑定声明位置的实现，但这不是对 DBX 全项目能力的否定。参考仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch、运行 DBX 或测量两款桌面的时延。

新增测试先得到 **0 passed / 9 failed**，复现 PG 命名参数重排后活动槽错误、默认参数匹配/重载排序错误、引号参数出现多余标签及参数名列表缺失。新增 [routine_arguments](../vendor/sql-lsp/src/server/routine_arguments.rs) 共享有界实参扫描与绑定，由 [签名](../vendor/sql-lsp/src/server/signature_help.rs)、[重载排序](../vendor/sql-lsp/src/server/routine_overloads.rs)、[标签](../vendor/sql-lsp/src/server/routine_hints.rs) 和 [参数名推荐](../vendor/sql-lsp/src/server/named_completion.rs) 共同使用；绑定随每次实时 metadata 计算，没有加入只依赖 SQL 的语法缓存。

| 范围 | 当前行为与边界 |
| --- | --- |
| 名称与默认值 | 支持 PostgreSQL 实时例程的 `name => expression` 和兼容写法 `name := expression`，按声明名称映射，允许重排和跳过任意有默认值的参数。未加引号名称按 PG 折叠；双引号保留大小写、双写引号和 Unicode。完整调用核对实际绑定的必需参数，保留未匹配重载作为备选 |
| 模式与变长参数 | 复用 RoutineParameters 的函数 OUT/TABLE 隐藏、INOUT 和过程 OUT 输入槽规则。命名 VARIADIC 参数要求显式 `VARIADIC name => array` 且位于最后实参，数组/元素类型仍按既有模式区分；没有实现多态 VARIADIC 决议 |
| 复杂值与排序 | [实参类型分析](../vendor/sql-lsp/src/server/local_relations/argument_types.rs) 只剥离外层命名绑定，保留值的绝对 AST 坐标；既有 CTE、字段、CAST、CASE、相关/标量子查询类型继续参与排序。光标后的参数也参与；重排后比较对应声明的类型，不再把第二个实参机械对齐第二个声明 |
| 活动槽和标签 | 每个重载显示自己的活动声明槽；命名参数本身不再重复生成参数名标签，混合调用只标注前面的未命名实参。重复名称、重复占用位置、命名之后再给位置实参、未知名称或大小写不匹配时不伪造活动槽和标签。无匹配时可继续展示已有签名备选；这不是完整例程语义错误诊断器 |
| 参数名列表 | 在 PG 实时例程的实参开头/名称前缀提供尚未占用的参数名；支持空槽、引号名称、重载类型说明和元数据刷新。已有 `=>`/`:=` 时仅替换完整名称，保留运算符、注释和值；新增绑定插入引用名称和 `=> $0`，转义片段中的美元、反斜线和右花括号。字段/表达式候选仍可共存，不猜测内置签名展示标签是否为真实 catalog 参数名 |
| grammar 和方言 | `named_argument` 有真实 name/operator/value 节点，未用替换空白或忽略错误绕过解析。MySQL/SQL Server profile 拒绝这一调用语法；Generic grammar 保持多方言联合能力，不据此宣称其他产品已经有完整命名绑定。Oracle 等产品仍待单独语义与版本验收 |
| 性能与模块 | 实参窗口最多 64 KiB、最多 256 项；标签扫描复用该次文档已有的词法掩码，避免每个调用重新分配整个窗口。参数名推荐每个重载只计算一次其他参数占用，再筛选名称；排序/去重后最多 100 项。合成 1002 参数 metadata 验证末尾精确候选优先和 debug 粗退化门禁，不代表 PG 可定义如此多参数，也不是桌面 p95 或全局内存预算 |

[库测试](../vendor/sql-lsp/src/server/tests/named_arguments.rs) 新增 **11 组**，加上 **2 个真实进程测试**，全量 **701 passed / 0 failed / 0 ignored**（548 库 + 153 集成、24 目标）。[原生协议测试](../vendor/sql-lsp/tests/integration_test_client/named_arguments.rs) 共 **23 份文档**：12 份复杂正向签名、4 份绑定反例、6 份接受实际参数名 TextEdit 后的文档，以及 1 份原文不变的六轮 kind/名称/类型/删除与恢复刷新。实际 **12 次推荐、22 次签名、22 次标签、18 份无错误级诊断检查**；含 PG 别名、`.mysql.sql` URI 配置覆盖、emoji/CRLF 独立 UTF-16 编辑范围核对、OUT/VARIADIC 和片段特殊字符。反例核对活动槽/标签抑制，没有宣称已生成完整数据库语义诊断。

严格 all-targets Clippy、fmt、2749 文件模块及 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界通过；parser/common 保持 30/227 和 7/83。命名参数补丁可反向还原固定上游，12 份指纹通过；固定 CLI/ABI 14 再生的 6 份文件一致。离线 Cargo 源码包编译验证通过：230 文件，192 份 Rust 源与当前 src 一致，SHA-256 `e0a152b17c9251b3939a171aea15afb2182d8185f110f368f87c48c57dc66845`。集成测试按既有 exclude 单独保留，源码包之后全部 **32 项真实进程测试**再次通过。日志、证据及源码归档为 `.impeccable/review/lsp-named-arguments-*`，没有 publish；本批未修改前端/应用驱动，未重复计入其历史测试。

规则依据：[PG 命名/位置/混合调用与默认值](https://www.postgresql.org/docs/current/sql-syntax-calling-funcs.html)、[PG 命名 VARIADIC 数组](https://www.postgresql.org/docs/current/xfunc-sql.html)、[CALL 的命名与 OUT 实参](https://www.postgresql.org/docs/current/sql-call.html)。剩余包括内置 catalog 参数身份、聚合/窗口例程种类的完整约束、Oracle/SQL Server 等语法绑定、EXEC、例程完整参数片段选项/稳定 routineId、namespace 组件推荐、search_path/隐式转换/多态、UDF 投影类型、结构化连接身份、稳定来源/JOIN、快照/取消和打包桌面/真实引擎验收。没有替换应用捆绑 LSP/清单、提交、推送或运行远端 CI；G01–G13、E01–E07 完整目标继续进行。

最终第二十四批本地 debug LSP SHA-256：`b3fe66a8ccc2cc15e82ddeb4c5e32952d516610713a56116dc722166c041c116`，对应源码包核验后通过 32 项原生测试的文件；应用捆绑二进制未替换。

## 第二十五批：实时 UDF 返回类型与嵌套推荐

静态参照 [DBX SqlCompletionObject/buildObjectItems/buildRoutineInfo](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 的 dataType、签名和例程说明。本批补齐本项目从实时函数声明到查询输出字段、推荐与悬浮类型的链路；没有运行 DBX 或据此宣称其整个投影推断能力缺失。固定参考仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。

新增库测试初始 **1 passed / 7 failed**，复现 UDF 返回类型无法进入输出字段；复核精确匹配与变长参数规则、无空格 VARIADIC 邻接表达式时，各保留了 **0 passed / 1 failed** 的回归日志。新增 [routines](../vendor/sql-lsp/src/server/local_relations/expression_types/routines.rs) 推断模块，复用 RoutineIdentity、RoutineArguments、RoutineParameters 和已有内置类型身份规则；不按候选首项或部分匹配分数直接断定返回类型。

| 范围 | 本批实现与边界 |
| --- | --- |
| 声明身份 | 普通、引号、转义引号、名称中的点、schema/catalog 限定及路径间注释使用同一例程身份。明确 procedure 不作为标量函数；旧 metadata 的未知 kind 沿已有兼容规则。实时函数按既有优先策略覆盖同名内置类型猜测，绑定/声明不能解析时不回退成另一种内置类型；PG 的未引用 COALESCE 等 SQL 结构仍保留语法语义 |
| 重载与类型 | 先核对模式、名称、数量、默认值、变长槽；已有实参类型全部精确匹配时优先该组，PG 同 schema 的普通展开 VARIADIC 与固定声明均精确匹配时优先固定声明。其他情况仅在适用候选的返回声明身份一致时传播；类型分歧保留 unknown。复用内置别名规范化，保留具体 metadata 类型文本，不实现完整隐式转换合法性检查 |
| 未知和空值 | void、record、显式 SETOF/TABLE、已识别伪类型/多态类型及其数组形式、空/unknown 或超预算类型不当作具体标量。具体 UDT 名称可作为声明类型展示，不据此展开复合字段或解析 domain。实时函数结果默认 nullable，不能从普通非空输入证明其非空；外层 COALESCE/CASE 等继续使用既有组合规则 |
| 查询与推荐 | 具体返回类型进入普通/递归 CTE、派生表、标量子查询、CASE/COALESCE、LATERAL、集合分支及嵌套函数实参。列候选、文档、悬浮和外层签名排序共享这些类型；接受候选仍替换完整叶子并保留 Unicode/CRLF 范围。引号小写 `"sum"` 可按 PG 内置身份处理，大小写不同的 `"SUM"` 不猜测 |
| 跨 namespace 与刷新 | [Environment/Context](../vendor/sql-lsp/src/server/local_relations/query_output.rs) 明确携带原始查询来源和借用的 SchemaManager；通过 [ProjectionSources](../vendor/sql-lsp/src/server/local_relations/projection.rs) 传入嵌套/递归/标量及 [实参类型分析](../vendor/sql-lsp/src/server/local_relations/argument_types.rs)。当前 namespace 借用已有 schema，外部 namespace 沿既有“已知当前 catalog + 唯一匹配”查找；重复、跨 catalog 或删除时不借用同名本地函数。没有新增协议字段、序列化状态或只按 SQL 缓存的 metadata 类型 |
| 预算与修正 | 复用现有 AST，单调用至多 64 KiB/256 实参、具体返回类型至多 256 字节；表达式深度和查询分支预算继续生效，检查完整候选后再决定类型。1001 个合成候选验证末尾精确匹配不会被提前截掉，时间断言是 debug 粗退化门禁。修正 `VARIADIC(ARRAY...)` 的词边界及相邻 AST 起点比较，共享签名/标签视图也能保留数组模式 |

[UDF 库测试](../vendor/sql-lsp/src/server/tests/udf_outputs.rs) 新增 **9 组**，并新增 **3 个真实进程测试**；全量 **713 passed / 0 failed / 0 ignored**（557 库 + 156 集成、24 目标）。[原生协议测试](../vendor/sql-lsp/tests/integration_test_client/udf_outputs.rs) 共 **18 份文档**：16 个 PG/MySQL/SQL Server 形状场景，另 2 份原文不变、各六轮 metadata 刷新。字段链路实际 **22 次推荐、22 次悬浮、22 次无错误级诊断**，核对类型、nullable、完整编辑范围及实际替换；跨 namespace 更新/歧义/外部 catalog/删除/恢复均覆盖。外层签名链路另有 **6 次签名与 6 次诊断**，验证嵌套远端 UDF 返回 bigint/uuid/record/删除/int8/恢复时排序更新并保留备选。无空格 VARIADIC 另核对 **1 次内联标签的数组 tooltip**；包含 emoji/CRLF 和配置优先于 URI 后缀。

严格 all-targets Clippy、fmt、2751 文件大小及 parser/common/local-relation/protocol/MySQL/PostgreSQL 边界通过；parser/common 保持 30/227、7/83。grammar 未改，12 份指纹及固定上游补丁检查通过；本批没有重生 grammar。依赖锁与上一批源码包一致，全部 Cargo 命令使用 locked/offline。离线 Cargo 源码包验证编译通过：232 文件、194 份包内 Rust 源与当前 src 一致，SHA-256 `feaa0d6711ab2b4b2ebd1285d56896eec6b6f62fe31d4a691de8efea8cb9fa70`。集成测试按既有 exclude 单独留存，源码包后全部 **35 项真实进程测试**再次通过。证据和归档：`.impeccable/review/lsp-udf-outputs-*`，没有 publish；应用协议/驱动/前端未修改，未重复计入其历史测试。

规则依据：[PG 函数精确匹配、默认值和 VARIADIC 决议](https://www.postgresql.org/docs/current/typeconv-func.html)、[函数返回声明、OUT、伪类型与集合返回](https://www.postgresql.org/docs/current/sql-createfunction.html)。这些是编辑器静态声明类型和协议证据，不是 SQL 实际可执行或返回行数的证明；即使候选一致返回某类型，也未宣称已完成数据库的完整唯一重载决议。

剩余包括复合/行集 UDF 形状、多态返回与完整类型/隐式转换/search_path 决议、聚合/窗口例程约束、结构化连接身份、查询级 metadata 一致快照/取消、稳定来源/JOIN、其他产品命名绑定与 EXEC、完整参数片段/稳定 routineId/namespace 组件推荐，以及打包桌面和真实数据库验收。Environment 通过借用避免拷贝整个 manager，但不是原子查询快照，也不是全局内存上限或桌面 p95 证据。未替换捆绑 LSP/清单、提交、推送或运行远端 CI；G01–G13、E01–E07 完整目标继续进行。

最终第二十五批本地 debug LSP SHA-256：`09e34df62d7f22bca6275b4937659db3152773d6bd00b6d1052b1310eb5dc31e`，对应源码包核验后通过 35 项原生进程测试的文件；应用捆绑二进制未替换。

## 第二十六批：Windows 捆绑更新与真实 WebView / Monaco 链路

已把前述语义修复接入项目内的 Windows 捆绑产物。`src-tauri/binaries/sql-lsp.exe` 从旧 SHA-256 `616ef87abb142f927e0034a3742f68091d207356436a2cb8562b66f9361ad259` 更新为 **`2f6dcfa902f40d65da47d64227a326d559ca41ccaaf02d78960d06cd9c8ed310`**，10,937,344 字节，正常 release 构建。来源为 `vendor/sql-lsp@8c80923dc9e8e756e46eb21ce9f6e04d7a2f4735` 加当前未提交变更；manifest 如实标记 sourceDirty=true，没有伪造已提交版本。上一批 LSP 源码检查点的 21 份源文件仍一致，未在本批重复声称执行了上一批全部 713 项。

[构建准备脚本](../scripts/prepare-sql-lsp.mjs) 默认固定 Cargo.lock，支持显式 offline；本机使用 locked/offline。新增 [构建输入指纹](../scripts/lib/sql-lsp-build-inputs.mjs)，覆盖 Cargo.toml/Cargo.lock/build.rs、全部 src Rust 模块和当前编译所用 grammar/补丁/生成文件，包含新建且未进 Git index 的模块，排除 target 和外部测试产物。对相对路径及原始字节计算 SHA-256，当前 **208 文件 / `aa0276dd7746599cdb72e2a79e9dd276162be0b871fa2a63c5f5fa3f343ba1b8`**。编译前后指纹变化则在替换捆绑文件前拒绝；Git dirty 检查也纳入未跟踪文件。[捆绑校验](../scripts/verify-sql-lsp-bundle.mjs) 和显式跳过准备都会核对已有源码指纹，避免只凭一个旧二进制的自身摘要当作源码最新。

新增字段沿用 manifest schemaVersion=1，应用旧读取器可忽略未知字段。没有源码指纹的旧清单保留原字节完整性兼容；外部 override 不冒认为本地源码构建。这里是本地来源与字节校验，不是发布签名、所有平台更新或可重复字节构建证明。Linux/macOS 产物没有在本批重建或验收，Gitlink、远端提交和发布均未修改。

[真实桌面测试入口](../src-tauri/tests/desktop_lsp_ipc/main.rs) 与 [前端场景](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) 使用实际隐藏 WebView、生产 LspClient/补全转换器、真实 Monaco 模型和 snippet controller、生产 Tauri 命令与 LspServerManager，启动上述 release 二进制。没有 mock invoke、monaco Range 或进程响应。宿主使用独立标识和 Temp WebView 数据目录，不加载生产 Workbench/用户连接；普通 cargo test 只打印 opt-in 用法，不会自动启动窗口。[运行脚本](../scripts/test-desktop-lsp-ipc.mjs) 通过构建图核对生产前端模块、检查捆绑指纹、编译实际宿主并验证退出/receipt 和会话清理。

| 实际链路场景 | 验证结果 |
| --- | --- |
| 启动与来源 | check_lsp_binary 返回项目实际捆绑路径、预期摘要且 integrity_verified=true；两套真实 LSP 进程分别完成初始化 |
| UDF CTE 字段 | 实时返回 bigint 进入字段候选与 hover，实际完成延迟文档 resolve；同一行 emoji、CRLF 的零基 LSP 范围转换为真实 Monaco 一基 Range 并用于编辑 |
| 命名参数 | 接受名称推荐保留既有运算符、注释和值，活动声明参数为 1，不重复显示已命名标签 |
| 已有 CALL | 列表只含 procedure，替换名称保留已有 `(1,NULL)`；OUT 模式进入签名与两个实际内联标签 |
| 新 CALL 片段 | 未完成 `CALL ca;` 明确保留语法错误；实际 snippet controller 展开 `$0`，光标位于括号内，真实 Monaco type 操作写入 `1,NULL`，完成后要求无错误诊断 |
| 高级搜索 | PG tsvector/tsquery 全文搜索的计算结果在字段列表中为 boolean，并核对接受后的诊断 |
| 方言与隔离 | 同一个 `.mysql.sql` URI 在两个客户端/进程中使用 PG 与 MySQL 配置，后者得到自己的 decimal 字段；PG 配置覆盖 URI 后缀 |
| 即时刷新 | 不改变 SQL 或模型版本，更新 UDF 返回声明后候选改为 uuid；另一个同 URI 会话继续保留原 MySQL catalog |

最终 **8 场景 / 81 断言**通过。宿主 SHA-256 `d5c94bb3d64930dfeffdfc804fa74c7d935ba5a3d0e5800e24c31c5efd7021e0`，独立目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-6POZpU`；成功 receipt 已复制为 `.impeccable/review/lsp-desktop-webview-evidence.json`。第一次编译修正了测试命令宏的限定路径；首次运行对未完成 CALL 错误地要求无诊断，随后改成明确断言该阶段有错误、接受和填入实参后无错误，没有豁免最终 SQL。失败日志和各次隔离目录保留。

本批另外通过：构建指纹 **6 项 Node 测试**、前端相关 **6 文件 / 33 项**、根项目及场景 TypeScript、完整 `npm run build`（含 2751 文件与边界、bundle 检查）、应用 LSP 库 **25 项**、应用捆绑集成 **13 项**，均无失败或忽略；应用 lib 与桌面测试宿主严格 Clippy、Rust fmt 通过。Vite 保留既有较大 chunk 提示，未据此宣称完成启动性能优化。

桌面宿主验收后，已重新构建 `--no-default-features --bin oxide-agent` 开发 CLI，使用不存在的 PROTOC 路径验证该 headless 构建不依赖桌面 protobuf 生成；构建成功，实际执行版本为 `oxide-agent 0.1.18`。日志为 `.impeccable/review/lsp-desktop-headless-cli.log`。

`cargo test --release` 的 35 项协议测试通过，但其重建服务器摘要与正常准备脚本产物不同，没有把这次通过直接等同于捆绑文件验收。随后把**精确的捆绑字节**放到已编译测试客户端的固定产物路径，再执行相同 **35 项**，全部通过并核对实际摘要；结束后已恢复 Cargo 原测试产物。对应 `.impeccable/review/lsp-desktop-bundled-native-evidence.json`，正式捆绑路径保持上述摘要。其余日志及指纹证据为 `.impeccable/review/lsp-desktop-*`。

可在已配置本项目工具链的 Windows 环境手动复验：

```powershell
$env:OXIDE_SQL_LSP_OFFLINE="1"
node scripts/prepare-sql-lsp.mjs
npm run test:desktop-lsp-ipc
```

这次证明了项目内 Windows release LSP 的装载与真实 WebView/生产客户端/Monaco 模型链路；尚未重新构建或安装 NSIS，也未验证安装目录 resource_dir 分支、完整 React Workbench 生命周期、可见推荐弹窗的外观/交互、IME 或桌面 p95。场景毫秒记录仅是这次隐藏宿主的一次观测。语义上的复合/行集与多态、完整类型决议/search_path、连接身份/查询快照/取消、更多方言命名绑定和 EXEC 等继续推进。DBX 固定参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，本批未 fetch、提交、推送、签名发布或运行远端 CI；G01–G13、E01–E07 全目标继续进行。

## 第二十七批：T-SQL 静态 EXEC 的推荐、参数绑定与真实语法

原先共享调用扫描只识别括号调用，`EXEC app.calculate @second = @value OUTPUT, @first = 1` 无法进入过程签名/参数名推荐。新增独立的 [EXEC 上下文模块](../vendor/sql-lsp/src/server/execute_context.rs)，接入 [共享调用](../vendor/sql-lsp/src/server/routine_context.rs)、[过程目标](../vendor/sql-lsp/src/server/call_completion.rs)、[实参绑定](../vendor/sql-lsp/src/server/routine_arguments.rs)、[名称推荐](../vendor/sql-lsp/src/server/named_completion.rs) 与 [内联标签](../vendor/sql-lsp/src/server/routine_hints.rs)，避免另建一套签名/metadata 协议。

| 场景 | 本批实际行为与边界 |
| --- | --- |
| 目标和 namespace | SQL Server/mssql/tsql 的 EXEC/EXECUTE、可选 `@return_status =`、一至三段完整 namespace、方括号/引号名称；使用当前 catalog 的已知过程 metadata，不猜默认 schema、缺失 namespace、四段 linked server 或动态变量目标 |
| 接受目标推荐 | 只推荐已知 procedure；替换完整名称叶子，保留光标后的名称后缀、注释、原有无括号实参和 OUTPUT，不插入 `()`；SQL Server 标量函数 EXEC 的专门语义尚未实现 |
| 参数提示 | `@参数 = 值` 支持重排和位置/名称混用，命名之后的非命名值、重复/未知名称不伪造活动声明参数；使用同一 binding 生成签名、名称占用和标签。参数绑定按 metadata 原名精确匹配，尚未建模 SQL Server 数据库 collation 的大小写规则 |
| 接受名称推荐 | `@se` 可推荐 `@second = $0`；已有 `@second /*keep*/ = @v OUTPUT` 只换名称，保留运算符、注释、值与 OUTPUT。已占用的声明参数不再次推荐 |
| 语法与错误 | 新 grammar 保留真实 execute_statement / execute_argument 节点，支持常量、变量、DEFAULT、OUT/OUTPUT 和 WITH RECOMPILE；其他 profile 报 UNSUPPORTED_DIALECT_SYNTAX。常量 OUTPUT、非 @ 参数名/返回变量、缺失值、一般表达式实参保持错误诊断，未屏蔽 parser ERROR |
| 编辑器触发 | [生产 provider](../src/features/query-editor/hooks/useLspCoreProviderCoordinator.ts) 按 [实际服务端方言](../src/features/query-editor/hooks/useEditorLanguageServices.ts) 对 T-SQL 启用空格/等号签名触发，不根据 `.mysql.sql` URI 后缀判断；其他方言保留原触发集合。LSP 能力同时声明 @ 补全和空格/等号签名触发 |
| 批处理和隔离 | 字符串、Unicode、CRLF、注释、动态 EXEC 负例有测试；过程提示在后续 SELECT 等语句前截止，行首静态 EXEC 可在无分号批处理中定位。此上下文识别不代表 DECLARE/GO/BEGIN 等完整批处理语法或动态 SQL 已通过 parser/引擎验收 |
| 工作量 | 单次实参扫描至多 64 KiB、256 槽，候选与标签沿用既有上限。内联标签逐条生成，普通调用先确认 live metadata 再提取实参，括号调用与 EXEC 复用该次请求的掩码；完整文档掩码仍有线性成本，尚无统一快照、取消或桌面 p95 结论 |

依据 [Microsoft EXECUTE 文档](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/execute-transact-sql?view=sql-server-ver17) 的无括号实参、命名后续规则、输出变量和可选返回状态定义静态契约。本批没有连接 SQL Server 执行过程，也不将语法无错误解释为变量已声明、权限正确或过程可执行。动态字符串、linked server、`;number`、WITH RESULT SETS、完整控制流和标量函数 EXEC 继续列为未完成。

[库测试](../vendor/sql-lsp/src/server/tests/execute_calls.rs) 新增 **9 组**；[真实进程测试](../vendor/sql-lsp/tests/integration_test_client/execute_calls.rs) 新增 **3 项**，包含 6 份接受编辑并复查签名/标签/无错误诊断的文档，1 份原文不变的 6 轮 metadata 切换文档，以及 8 份语法/方言与 6 份噪声/未知过程负例文档。全量 **725 passed / 0 failed / 0 ignored**（566 库 + 159 集成，24 目标），严格 all-target Clippy、fmt 通过。前端相关 **7 文件 / 43 项**及根项目/场景 TypeScript 通过。补批处理边界时，原生测试发现同一 EXEC 被行首和分号边界重复识别，导致标签翻倍；已按实际起始位置去重并加入两条 EXEC 共四个标签的回归，未删除失败断言。失败日志保留在 `.impeccable/review/lsp-execute-boundary-regression.log`。

最终语义复核还真实复现 `EXEC SUM 1,` / `CALL sum(1,` 错借内置 SUM 签名。已在 [签名协议处理](../vendor/sql-lsp/src/server/protocol.rs) 将过程调用排除出内置函数回退，保留普通 `SELECT SUM(...)` 的内置提示；库、原生协议负例和修复前后独立进程探针均覆盖。`.impeccable/review/lsp-execute-builtin-before.json` 保留错误签名，`lsp-execute-builtin-after.json` 两份结果均为 null；修复前中间捆绑 `73cf3f5c…` 单独备份，不作为最终产物。

固定 tree-sitter-cli 0.26.3 / ABI 14 重新生成后，两次生成的 **6 份文件逐字节一致**，累计补丁与 **12 份文本指纹**通过。离线源码包 **234 文件 / 1,344,814 字节**，SHA-256 `173ac0b084f422d831a6f1116ea9f749109cb39e85101233a9bf7d3d64f699ad`；全部 **196 份 Rust 源文件**及 grammar/build 输入与工作树匹配。Cargo 打包将 CRLF Cargo.lock 写成 LF，已分别保存摘要并核对规范化文本和 TOML 内容一致，未把两份 lock 声称为原始字节相同。使用 `cargo package --no-verify`，该检查不等于独立构建解包后的 crate；外部 integration tests 沿用原 package 排除规则，测试源码另以工作树摘要保存。

Windows 捆绑已正常 locked/offline release 更新为 **10,951,168 字节 / `2145726621befbeabc5028b868ab6e2bf07ff41248e4a02a9a268875d4a0cee2`**，sourceDirty=true；输入指纹 **210 文件 / `4a79d8632463182a0585e7ce20900e2ad5197707bf487ec68127aa634529493d`**。精确捆绑字节通过全部 **38 项**真实协议测试，并已恢复原 Cargo debug 产物；上一批捆绑文件与 manifest 已独立备份。

[真实桌面场景](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) 增至 **10 场景 / 112 断言**并全部通过：继续保留前述 PG/MySQL 8 场景，新增 SQL Server 模式下实际 Monaco 接受 EXEC 目标与命名参数编辑，核对没有插入括号、实参/注释/OUTPUT 保留、活动参数为 1、OUT 签名及两个位置参数标签，另核对未知 EXEC SUM/CALL sum 不返回内置函数签名。最终运行目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-DHXqEF`，宿主摘要 `e01f96778616f465fb0d2ec7787344643f71c8523c452d740954461b8b61c7b2`；receipt 复制为 `.impeccable/review/lsp-execute-webview-evidence.json`。完整 `npm run build` 通过（2753 文件、全部边界及 bundle 检查），保留既有大 chunk 提示；最终后台回退修复未再改生产前端，最终捆绑另已复验。此宿主仍不等于完整 React Workbench 或可见推荐弹窗；T-SQL 自动签名触发集合由生产 provider 的单元测试核对，未宣称验证了实际可见签名组件的自动弹出。

最终捆绑另外通过应用侧 `lsp_integration` **13 项 / 0 failed / 0 ignored**。桌面测试结束后，使用不存在的 PROTOC 路径成功恢复 `--no-default-features --bin oxide-agent` 开发 CLI，实际版本 `oxide-agent 0.1.18`。上述日志与最终来源、语法、测试、文档链接检查归档为 `.impeccable/review/lsp-execute-*`，最终索引为 `lsp-execute-evidence.json`；所有相关编译/测试进程已等待实际退出，未因观察超时重复启动。

DBX 静态对照仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`：[语义上下文](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 将 CALL/EXEC/EXECUTE 识别为 routine，[候选构建](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 对 exec 过滤 procedure，并保留 routineId/签名去重。本批补上对应静态过程入口与共享参数提示，不声称与 DBX 运行中的推荐弹窗效果相同；稳定 routineId、完整参数片段配置、统一语义快照、更多厂商规则和真实数据库/完整 Workbench/安装包/跨平台/p95 验收仍需继续。未 fetch、提交、推送、发布或运行远端 CI，G01–G13、E01–E07 全目标保持。

## 第二十八批：EXEC 参数值语义、局部变量与截断重查

真实进程探针确认，原先 `EXEC ... @first = ` 等值位置仍进入通用补全，在带 schema 的夹具中返回 SELECT/FROM/JOIN 等 53 项候选。新增 [参数值所有者](../vendor/sql-lsp/src/server/execute_completion.rs)，在 [运行时](../vendor/sql-lsp/src/server/runtime.rs) 的通用 schema 投影/方言补全之前处理静态 EXEC 实参；共享既有 [调用窗口](../vendor/sql-lsp/src/server/execute_context.rs) 与 [名称绑定](../vendor/sql-lsp/src/server/named_completion.rs)，保留过程名、参数名和参数值各自的编辑边界。

| 核对项 | 本批行为 |
| --- | --- |
| 值与名称 | 值位置仅返回匹配前缀的局部变量、NULL、适用的 DEFAULT 或 OUTPUT，阻止通用关键字/表/字段/函数混入。首个未命名实参仍可同时推荐参数名与变量；出现命名实参后，后续未命名槽只推荐尚可绑定的参数名 |
| DEFAULT / OUTPUT | DEFAULT 要求全部匹配过程 metadata 的当前绑定槽均有默认值；OUTPUT 要求变量操作数且槽均为 OUT/INOUT。未知参数、非法/歧义绑定和相互冲突的 metadata 不猜默认值或输出模式；配置刷新无需修改 SQL |
| 局部变量 | [独立扫描模块](../vendor/sql-lsp/src/server/tsql_variables.rs) 读取当前游标之前的 DECLARE，处理多变量、AS、类型尺寸与表达式初始化中的逗号/括号/字符串。只读声明，不从任意 @引用伪造变量；排除 @@ 全局项、未来声明、注释/字符串中的伪声明，重复原名不猜类型；行级 GO/GO count（含注释）重置当前批次 |
| 语义排序和编辑 | 保留声明原名和类型，精确名称优先，其次优先已知相同类型，再保留其他可能转换的变量；未建立隐式转换图。TextEdit 替换完整叶子，保留 @、光标后缀、CRLF/emoji、注释与 OUTPUT。空值后跟注释也能插入 NULL，不消耗注释；既有关键字大小写偏好继续生效 |
| 真实声明语法 | grammar 新增 tsql_declare_statement / tsql_declaration / tsql_max_type，覆盖标量类型、AS、逗号声明、表达式初始化以及 VARCHAR/NVARCHAR/VARBINARY(MAX)。SQL Server 外的 profile 报方言错误，缺失类型/值、不带 @ 的声明、text/ntext/image、数组声明和不适用的 MAX 形式不被静默接受；PG 函数 DECLARE 保持原节点并有回归 |
| 上限与重查 | 先排序再截断至 100 项；参数值、过程目标和命名参数在确实存在第 101 个唯一候选时传递 isIncomplete=true，未截断集合保留原 Array 响应。合成 1002 变量/过程/参数的测试核对晚出现的精确项，以及继续输入后重新查询；恰好 100 项不误报未完成 |
| 工作量 | 复用该次 EXEC 的两份掩码，参数事实和名称推荐复用同一份当前 schema。没有 CALL/EXEC 字节的普通输入提前返回，参数值不再经过通用投影/候选生成。声明扫描至多当前批次前缀 512 KiB、2048 个名字，保留的单个名字/类型各限 256 字节；实参仍限 64 KiB/256 槽。长文档掩码仍是线性工作，未实现全局语义快照和取消 |

规则参考：[SQL Server 过程实参](https://learn.microsoft.com/en-us/sql/relational-databases/stored-procedures/specify-parameters?view=sql-server-ver17)、[EXECUTE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/execute-transact-sql?view=sql-server-ver17)、[DECLARE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/declare-local-variable-transact-sql?view=sql-server-ver17)、[GO 批次边界](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/sql-server-utilities-statements-go?view=sql-server-ver17)。批次扫描边界不等于 parser/执行器支持 GO；变量候选不证明变量的完整声明、赋值、类型转换或运行权限已验证。

[库回归](../vendor/sql-lsp/src/server/tests/execute_values.rs) 新增 **10 组**，最初 7 组在旧逻辑上全部失败，记录在 `.impeccable/review/lsp-execute-values-red.log`；补充类型排序/1002 名字、预算、歧义 metadata 和 PG 声明回归后通过。[原生协议](../vendor/sql-lsp/tests/integration_test_client/execute_values.rs) 新增 **3 项**，覆盖 6 份接受编辑与最终无错误诊断的文档、2 份不改 SQL 的 14 轮 metadata 更新、6 份作用域/非法位置文档、1 份 1002 变量文档及两轮继续输入后的重查。全量 **738 passed / 0 failed / 0 ignored**（576 库 + 162 集成、24 目标），严格 all-target Clippy、fmt 通过；相关前端 **7 文件 / 43 项**和完整 `npm run build` 通过（2756 文件与边界/bundle 检查），保留既有大 chunk 提示。

源码包 **237 文件 / 1,358,753 字节**，SHA-256 `bec1d7bf5237d40356504555f56369a5c59ab03085feb19fbae146b197c09e86`；全部 **199 份 Rust 源文件**和 grammar/build 输入已逐字节核对。Cargo.lock 仍仅换行规范化，TOML 内容相同，未声称原始 lock 字节或独立 crate 构建一致。固定 CLI 0.26.3 / ABI 14 的两次成功生成 **6 份产物逐字节一致**，累计补丁与 **12 份文本指纹**通过。Windows locked/offline release 捆绑为 **11,079,680 字节 / `5c42fe2a8a81e78e62ce36f2b9d30ea7782c2accb11ffd4fbb93b0d883d84e2b`**，sourceDirty=true；源码输入指纹 **213 文件 / `ee2df74f8f4654f4b823086a526008831afa7295656ab8ff182e1ed50577e702`**。精确捆绑字节通过 **41 项**协议测试，原 Cargo debug 产物已恢复，上批捆绑/清单独立备份。

本机 stdio 请求基准使用上批实际 release 捆绑与本批捆绑，对相同 **16,420 字节**输入各预热 8 次、测量 50 次，期间没有并行启动本任务的编译或前端构建。结果为一次顺序运行的热请求观测：

| 请求 | p50 前 → 后（ms） | p95 前 → 后（ms） | 结果核对 |
| --- | --- | --- | --- |
| 限定字段 SELECT | 6.59 → 6.33 | 7.21 → 6.70 | 两边完整响应 JSON 一致，均 1 项 |
| EXEC 必填参数值 | 12.86 → 0.53 | 13.52 → 0.66 | 本基准的旧通用集合 52 项改为正确的 NULL 1 项，工作输出不同 |

原始样本与二进制摘要在 `.impeccable/review/lsp-execute-values-performance.json`；未交错/随机化多次运行，也未测冷启动、内存或桌面输入/可见弹窗 p95，不能把这组结果当作所有查询的性能保证。基准工具首次给 shutdown 发送 null params 被拒，修正为省略 params 后完整重跑成功，未忽略 JSON-RPC 错误。

DBX 固定静态对照仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`。其 [SQL Server 变量收集](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 已覆盖 DECLARE、例程形参、批次及按小写去重；本批补齐了局部声明候选、类型显示/排序、过程模式门控与截断重查。仍需例程形参/完整控制流作用域、cursor/table 声明的完整 grammar/类型形状、特殊/Unicode 变量名的完整 parser 支持、collation/UDT/隐式转换、变量 hover/导航及统一语义图；其他函数目录的截断策略也需继续核对。未执行真实 SQL Server 过程，未验收 DBX 运行中的弹窗、完整 Workbench、安装包或跨平台产物。G01–G13、E01–E07 全目标继续；未 fetch、提交、推送、发布或运行远端 CI。

最终 [真实桌面场景](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) **13 场景 / 155 断言**通过。保留之前 10 场景，新增声明变量的真实 Monaco 编辑、DEFAULT/OUTPUT 接受后无错误诊断，以及 1002 个变量的 isIncomplete 标记、实际 type 操作后显式调用生产客户端重查并恢复此前未返回的候选；没有把这一步当作可见 suggest widget 自动重查的证明。宿主摘要 `d4cc74924a1a83e16295de4b0f51a6c513ecf54035ce458c3abb270da53263e8`，目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-kpQj0u`，receipt 为 `.impeccable/review/lsp-execute-values-webview-evidence.json`。首次场景 TypeScript 检查指出数组下标可能不存在，补上实际候选断言后才编译/运行；失败记录及 Temp 目录保留，未关闭严格检查。

应用侧最终捆绑集成 **13 项 / 0 failed / 0 ignored**通过，随后以不存在的 PROTOC 路径恢复无 Desktop 特性的开发 CLI，实际版本 `oxide-agent 0.1.18`；已等待相关进程真实退出。最终来源、测试、性能原始数据、grammar、文档及差距索引见 `.impeccable/review/lsp-execute-values-evidence.json`。这次桌面范围仍是隐藏 WebView/生产客户端/真实 Monaco 模型及生产原生命令，没有安装包 resource_dir、完整 React Workbench、可见弹窗或桌面 p95 结论。

## 第二十九批：T-SQL Unicode 名称、语义候选与真实编辑

本批从五组回归开始：旧逻辑 **1 passed / 4 failed**。问题包括中文变量在推荐中出现但 parser 报错、合法的 128 字符中文名超过旧 256 字节收集上限、名称中的 `$#`/内部 `@` 被截断，以及 SQL Server 字符串反斜杠和 PostgreSQL dollar quote 的隔离规则混用。新增共享 [名称模块](../vendor/sql-lsp/src/tsql_identifier.rs)，供 [占位符归一化](../vendor/sql-lsp/src/placeholder.rs)、[参数名称读取](../vendor/sql-lsp/src/server/routine_identity.rs)、[命名推荐](../vendor/sql-lsp/src/server/named_completion.rs) 和 [局部变量收集](../vendor/sql-lsp/src/server/tsql_variables.rs) 使用；没有增加 Cargo 依赖。

| 核对项 | 本批行为与边界 |
| --- | --- |
| 名称集合 | SQL Server/mssql/tsql 的局部变量和 metadata 参数，以 `@` 开头；实现 Unicode 3.2 BMP 的 L*/Nd 加 `_@$#`，支持 `@金额`、`@计数$#`、`@a@b`、`@#临时`、`@1`、`@Δ٥`。`@@` 全局变量不作为局部声明/参数候选；不把当前 Unicode 的广义 alphanumeric 当作该规则 |
| 长度和输入态 | 完整名称最多 128 UTF-16 单元，变量名称字节上限改为 384；类型上限仍 256 字节。单独 `@` 可作为编辑前缀，不能作为完整声明/metadata 名称；过长完整名称不截成合法前缀。supplementary 字符、½ 和 Unicode 3.2 后新增 BMP 字母保持拒绝 |
| parser 和位置 | 归一化只替换完整合法名称，保持原 SQL 的 UTF-8 字节长度，原文仍用于名称、范围和诊断；保留真实 DECLARE/EXEC 节点。非法名称报告诊断，过长声明不重复报告同一名称错误，未屏蔽 tree-sitter ERROR |
| 噪声边界 | SQL Server 的反斜杠不转义字符串结束引号，`N'C:'` 后仍可识别变量；仅该 profile 停用 PostgreSQL dollar-quote 跳过。字符串、注释、方括号/引号标识符仍不归一化；PG/MySQL 原有策略保持 |
| 语义推荐和接受 | 变量保留完整 Unicode/sigil 名称及声明类型；命名参数复用原实参绑定、活动签名槽和候选过滤。snippet 对参数名中的 `$` 转义，Monaco 接受后保留字面名称；已有值/OUTPUT 的参数编辑保留原 SQL |
| 工作量 | 名称读取最多检查 129 单元即拒绝过长，ASCII 快路径与 287 段排序区间二分查找；表离线生成并签入源码，构建/运行不依赖 Python 或网络。沿用 512 KiB 前缀、2048 变量及 100 候选预算；本批没有新的耗时、RSS 或桌面 p95 测量 |

规则来源为 [Microsoft 标识符文档](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers?view=sql-server-ver17)。[生成工具](../scripts/generate-tsql-identifier-table.py) 使用 Python 固定 `ucd_3_2_0`，并与 [Unicode 3.2 原始数据](https://www.unicode.org/Public/3.2-Update/UnicodeData-3.2.0.txt) 独立比较全部 **65,536** 个 BMP 码位，得到 **45,838** 个 L*/Nd 码位、**287** 段范围；Rust 测试另核对二分查找和非 BMP 拒绝。原始数据 SHA-256 `5e444028b6e76d96f9dc509609c5e3222bf609056f35e5fcde7e6fb8a58cd446`，生成表 `b15c19a9c1c6639b4457a53eac8d5677184b12010d379c87fd2cc3b2fa4e1eb5`。这是该明确字符集合的穷举核对，**不等于 SQL Server 引擎、所有兼容级别、标识符类别或 collation 的全量一致性验收**。

Unicode 许可随 [源码](../vendor/sql-lsp/UNICODE-LICENSE.txt) 保存，crate 声明 `MIT AND Unicode-3.0`；[Tauri 资源](../src-tauri/tauri.conf.json) 映射为 `sql-lsp.UNICODE-LICENSE.txt`，源码包已逐字节核对包含该文件。许可依据 [SPDX Unicode-3.0](https://spdx.org/licenses/Unicode-3.0.html)，SHA-256 `e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96`。没有声明安装包实际资源目录已经验收。

[库回归](../vendor/sql-lsp/src/server/tests/execute_values.rs) 新增五组，名称模块新增一组 BMP 查找验证，共 **6 组新库测试**；[原生协议](../vendor/sql-lsp/tests/integration_test_client/execute_values.rs) 新增 **2 项 / 16 文档**，覆盖三种 SQL Server 别名、带误导 `.mysql.sql` URI 的方言配置、emoji/CRLF 独立 UTF-16 编辑范围、7 个实际接受的变量编辑和最终无错误诊断、Unicode 命名参数/签名以及 8 个隔离和非法名称文档。全量 **746 passed / 0 failed / 0 ignored**（582 库 + 164 集成，24 目标）；精确 Windows 捆绑字节另通过 **43 项**协议测试，临时替换的 Cargo debug 产物已恢复。严格 all-target Clippy/fmt 通过，相关前端 **7 文件 / 31 项**、完整 `npm run build` 和 **2758 文件**模块/边界/bundle 检查通过；这次前端选择集合不同于上批 43 项集合，未把未重跑的项算入本批。

源码包 **240 文件 / 1,363,643 字节**，SHA-256 `5a46a87eceff81cd8c133b44aef780c48f6128b307542ce08dfd1c51820bfc43`；全部 **201 份 Rust 源文件**及含 Unicode 许可在内的 14 项附加输入逐字节匹配。Cargo.lock 仅换行规范化后文本/TOML 相同，未声称原始字节一致或独立解包构建成功（`--no-verify`）。本批没有修改 grammar；既有累计补丁、ABI 14 与 **12 份文本指纹**重新通过核对，不重复声称本批做了 grammar 生成。

Windows locked/offline release 捆绑 **11,071,488 字节 / `2066498fb17dcf3407cf2b03fbb9a1fd4c429d59d1a155903be9abac089beb87`**，sourceDirty=true；源码输入指纹 **215 文件 / `4160c8bea1d16d99cff8f7140fc8656e795972a091726f39ec4d9409c0268ecb`**。上批 `5c42fe2a8a81e78e62ce36f2b9d30ea7782c2accb11ffd4fbb93b0d883d84e2b` 和清单已独立保留。真实 [桌面场景](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) **15 场景 / 192 断言**通过，新增中文/sigil/128 字符名称的 Monaco 完整替换，以及含 `$#` 的真实 snippet、实际 type 输入、诊断和签名；宿主 SHA-256 `b59d72d1054cea5c3fd030c7a4b7fe371b9da63f6de5ff4eff03a96daaceba96`，目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-Yn1N6B`，回执 `.impeccable/review/lsp-tsql-identifiers-webview-evidence.json`。这仍是隐藏 WebView、生产 LspClient/Monaco 适配和生产 Tauri 命令，未验收可见 suggest widget 自动弹出/重查或完整 React Workbench。

应用侧捆绑集成 **13 项**通过；无 Desktop 特性的开发 CLI 已以不存在的 PROTOC 路径恢复，实际 `oxide-agent 0.1.18`，相关进程已退出。最终 WebView 与应用集成运行复用本批已编译并核对摘要的宿主，对最终捆绑重新执行，保留首轮回执和最终运行日志。Clippy 首次指出新测试不需要 vec、桌面场景首次因 ES2020 不支持 replaceAll 而未编译，均修正后重新通过，失败日志与 Temp 保留，未放宽检查。最终索引 `.impeccable/review/lsp-tsql-identifiers-evidence.json`。

DBX 仍固定静态参考 `b160d130560f71c5c429be15cec6147f677a4b3a`，工作树干净；其 [变量收集](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 的名称正则为 ASCII 范围，本批补了我们自己的 Unicode/sigil 名称一致性。DBX 同时已有例程形参收集，我们仍缺少例程形参变量、完整控制流/作用域、cursor/table 声明、collation/UDT/隐式转换、变量 hover/导航和统一语义图；**本批不能代表已追平 DBX 的运行效果**。真实 SQL Server 执行、安装包 resource_dir、跨平台捆绑、桌面 p95 和远端 CI 仍未验收。G01–G13、E01–E07 保持进行中；本批未 fetch、提交、推送或发布。

## 第三十批：T-SQL 模块形参、批次语法与表达式推荐

本批补齐 DBX 已有的例程形参收集，并验证真实模块 SQL 的 parser、候选和接受编辑。最初七组回归在旧实现上 **1 passed / 6 failed**，记录 `.impeccable/review/lsp-tsql-modules-red.log`。新增 [模块头读取](../vendor/sql-lsp/src/server/tsql_module_parameters.rs)、[标量变量表达式推荐](../vendor/sql-lsp/src/server/tsql_variable_completion.rs)、[parser 约束](../vendor/sql-lsp/src/parser/sql/tsql_modules.rs) 和 [共享常量规则](../vendor/sql-lsp/src/tsql_literal.rs)，与 [DECLARE 收集](../vendor/sql-lsp/src/server/tsql_variables.rs)、[EXEC 值推荐](../vendor/sql-lsp/src/server/execute_completion.rs) 共享类型与名称结果；没有增加依赖或改变前端生产协议。

| 场景 | 本批结果与具体边界 |
| --- | --- |
| 模块头 | CREATE / CREATE OR ALTER / ALTER PROC、PROCEDURE、FUNCTION；原始 Unicode/sigil 名称、schema/引号名称、标量类型、precision/MAX、函数参数 AS、默认常量、OUT/OUTPUT 与已建模选项。形参只从当前批次首个模块头读取，完整头和主体起点明确后才可见 |
| 主体语法 | 保留真实 procedure/function/parameter/body 节点；嵌套 BEGIN/END、DECLARE、SELECT/CTE/DML、已建模表 DDL、RETURN、SET 赋值/NOCOUNT、IF/ELSE、WHILE；标量函数返回表达式与内联表函数 RETURN 查询。过程体的归属延续至 GO／文件结尾，END 后同批次语句保持在过程体内；函数按独立批次处理 |
| 推荐语义 | 过程 EXEC 值位与 SELECT、谓词、CASE、函数参数、RETURN、CTE 查询等 @前缀位置保留形参/局部变量的声明类型和完整 TextEdit；排除声明名、表/限定字段目标及别名位置。READONLY 形参与已知 TABLE/CURSOR 声明不冒充标量值，尚未实现这些关系类型的专门推荐 |
| 作用域 | 当前 GO / GO 正数批次（允许注释）隔离；未来 DECLARE、字符串/注释里的假定义不进入集合；形参和局部声明共用名称空间，重复原名隐藏。BEGIN/END 不另建变量名称空间；仍未建统一作用域图、赋值流或 collation，Unicode/ASCII 大小写匹配不冒充数据库排序规则 |
| 默认值/负例 | header 收集与诊断共用 T-SQL 字符串、数值、NULL 边界；E 字符串、dollar quote、DATE 字面量、TRUE/FALSE、非字面默认表达式等保持错误；SQL Server 不借用 generic PostgreSQL CREATE FUNCTION 的字符串/dollar body。低层识别器含 0x 边界测试，通用 grammar 的 0x 默认值尚未补齐，未计为语法支持 |
| 上限和重查 | 覆盖 SQL Server 的 2,100 形参，2,101 报错且不提供该非法头的变量。保留变量名预算从 2048 改为 4096，以容纳合法大模块；512 KiB 前缀、128 UTF-16 单元名称/384 字节、256 字节类型和 100 项菜单继续有界，实际截断保留 isIncomplete，末尾精确名字可经重查获得 |
| 模块和扫描 | EXEC 独立关键字可在同一行 BEGIN/IF 后定位，避开 EXECUTE AS / GRANT EXECUTE ON 等非调用位，并在 END/ELSE 等边界截止。普通无 @ 请求走快速退出；变量集合返回模块体起点，表达式位置分析复用该起点，DECLARE 扫描跳过整段已掩码空白，减少重复头部/注释工作 |

依据 [CREATE PROCEDURE](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-procedure-transact-sql?view=sql-server-ver17)、[CREATE FUNCTION](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-function-transact-sql?view=sql-server-ver17) 与 [变量范围](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/variables-transact-sql?view=sql-server-ver17) 建立上述语法/批次契约；本批没有连接 SQL Server 执行模块。语法无错误不证明函数体副作用、对象解析、权限、隐式转换或执行规则已由引擎验证。CLR/native compilation、多语句表函数、完整异常/事务/控制流、所有空语句/批次形式仍需扩展。

[库场景](../vendor/sql-lsp/src/server/tests/tsql_modules.rs) 与共享常量模块共新增 **13 组**；[真实进程测试](../vendor/sql-lsp/tests/integration_test_client/tsql_modules.rs) 新增 **3 项 / 15 文档**，包含 6 次接受参数编辑和最终零错误诊断、2,100 形参的两轮继续输入查询、4 轮 metadata/方言切换、GO/noise/READONLY/非法模块隔离。最终全量 **762 passed / 0 failed / 0 ignored**（595 库 + 167 集成，24 目标），严格 all-target Clippy 和 fmt 通过。相关前端 **7 文件 / 31 项**与完整 `npm run build` 通过；前端构建时为 2762 文件，新增共享常量模块后独立重跑模块检查为 **2763 文件**，parser 边界为 **31 模块 / 227 方法**。保留现有大 chunk 提示。

优化中回归捕获了未完成/非法头的索引边界及过程体提前归属问题，修正后保留相应测试，没有绕过 parser ERROR 或删减多语句过程。过程体规则共享后，生成 parser.c 从 **41,245,267** 降至 **37,457,131 字节 / 28,431 状态**；最终六份生成产物由固定 CLI 0.26.3 / ABI 14 连续生成逐字节相同，累计补丁与 12 份文本指纹通过。Windows release 从本批优化前 **19,359,232** 降至 **17,895,424 字节**，但仍大于上批 11,071,488 字节；新增 grammar 的静态表成本未被当作已解决，尚未测 RSS 或冷启动。

源码包 **245 文件 / 2,639,022 字节**，SHA-256 `4a9d95a872fd7b4c027fd52bdd77ff00070fc152ba46670fbb24bb40222ee99d`；全部 **206 份 Rust 源文件**及含 grammar 说明、Unicode 许可在内的 15 项附加输入逐字节一致。Cargo.lock 仅换行规范化后文本/TOML 相同；打包用了 `--no-verify`，没有独立解包构建结论。最终 Windows locked/offline release SHA-256 **`324efe718cabe162e442888b023d9c86fe4bf6eb711cd52a04e8ac0c71f22a0d`**，sourceDirty=true，输入指纹 **220 文件 / `4f05ae6feb980360882a19229bb6c90b5846c8c0cd7c8dd629573c9936d4b456`**；上批与本批优化前二进制/清单均保留。精确最终捆绑字节通过 **46 项**协议测试，Cargo debug 测试产物已恢复。

真实 [WebView/Monaco 场景](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) **18 场景 / 255 断言**通过；新增过程参数的 EXEC/CASE 编辑、标量/内联表函数编辑、2,100 形参实际 type 后显式重查、GO 隔离。最终运行复用本批已编译并核对摘要的原生宿主，再对最终捆绑执行；宿主 `c5a68a4627f881ece9897fd6cfa148d4c2cadf43ce24002b76686bfe7adf8571`，目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-M7siag`，证据 `.impeccable/review/lsp-tsql-modules-webview-evidence.json`。它仍是隐藏 WebView、生产 LspClient/Monaco 适配及生产 Tauri 命令，不包含可见 suggest widget 自动弹出/重查或完整 React Workbench。应用侧捆绑集成 **13 项**通过，开发 CLI 已恢复为无 Desktop 特性并以不存在的 PROTOC 路径构建，实际 `oxide-agent 0.1.18`；相关进程已退出。

最终热 stdio 基准在本任务无并行编译/前端构建/桌面验收时执行，每种工作负载各预热 8 次、每侧测量 50 次，逐请求交替旧/新顺序；两项既有请求的完整 JSON 响应逐字相同，2,100 形参场景从旧版 0 项变为正确 1 项。原始样本 `.impeccable/review/lsp-tsql-modules-performance.json`：

| 请求 | p50 上批 → 本批（ms） | p95 上批 → 本批（ms） | 返回数 |
| --- | --- | --- | --- |
| 限定字段 SELECT | 6.24 → 6.14 | 6.60 → 6.50 | 1 → 1 |
| EXEC 必填参数空值 | 0.56 → 0.46 | 0.66 → 0.61 | 1 → 1 |
| 2,100 形参的精确变量前缀 | 32.15 → 1.99 | 33.25 → 2.16 | 0 → 1 |

另以本批优化前/最终 release 对同一三种请求交替测量，全部三种完整响应 JSON 相同；2,100 形参场景 p50 **4.56 → 1.88 ms**、p95 **4.92 → 2.08 ms**，原始样本 `.impeccable/review/lsp-tsql-modules-optimization-performance.json`。这是两次本机热 stdio 观测，不是随机化多轮实验，也不证明所有 SQL、冷启动、内存或桌面输入/弹窗 p95；上批到本批的功能场景输出不同，不能拿该比值作同等工作量的全面加速结论。

DBX 固定静态参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，工作树干净。其 [形参收集](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 已支持 CREATE/ALTER 头；本批补上我们自己的声明类型、表达式/EXEC 推荐、批次 AST 和完整编辑验证，没有运行 DBX 弹窗进行体验对比。剩余包括：完整变量/控制流/关系类型语义图，声明类型进入 CTE/派生表输出推断，collation/UDT/隐式转换，table/cursor/多语句 TVF 和更多字面量/控制流，安装包资源目录、真实数据库、跨平台捆绑、可见 Workbench 及远端 CI。原始 G01–G13、E01–E07 保持进行中；本批未 fetch、提交、推送或发布。最终索引 `.impeccable/review/lsp-tsql-modules-evidence.json`。

## 第三十一批：声明类型进入复杂查询与智能推荐

本批将前一批收集的 T-SQL 标量声明用于实际表达式推断。首轮六组场景在旧实现上 **0 passed / 6 failed**，日志 `.impeccable/review/lsp-tsql-variable-types-red.log`。新增独立 [声明快照与来源验证](../vendor/sql-lsp/src/server/local_relations/variables.rs) 和 [T-SQL 标量类型校验](../vendor/sql-lsp/src/server/tsql_types.rs)，由投影及函数实参推断共同使用；未增加依赖或前端生产协议。

| 场景 | 已验证结果与边界 |
| --- | --- |
| DECLARE / 模块形参 → 查询输出 | 显式 bigint、decimal(18,2)、nvarchar(max)、datetime2(3)、uniqueidentifier 等声明，经多层 CTE、派生表、标量子查询及已建模 UNION 输出传到真实列推荐和 hover；支持 sqlserver/mssql/tsql 配置、Unicode 名称、emoji/CRLF 与误导 `.mysql.sql` URI |
| 复杂表达式 | 变量参与已建模算术、TRY_CAST、CASE、COALESCE；同一已知标量类型及 bit/tinyint/smallint/int/bigint 固定整数优先级可合并；不同 decimal precision/scale、隐式字符串转换、collation 和 UDT 不作统一猜测 |
| 函数签名 / 实时 UDF | 原始声明类型进入实参类型，合成 schema 配置中的两个不同参数类型候选签名按确切匹配排序；选中重载的返回类型继续进入 CTE；仅改返回 metadata、修改声明 int→bigint 或切换方言后重新推断，无旧声明缓存 |
| 作用域 / 不确定性 | 原始 byte offset、借用切片身份、真实 AST 类型和当前 GO 批次共同约束；未来声明、同拼写重复声明、预算截断、READONLY 表值参数、未知 UDT 不提供已知标量类型；变量即使有常量初值仍保守 nullable，不伪造赋值或分支流分析 |
| 方括号列名 | `[@missing]` 保持普通列含义，未声明的 `@missing` 不按同名 catalog 列补类型；适配改用等字节的普通 identifier 代理，原文和 UTF-16 范围仍权威。空 `[]` 不适配，保留非法数组声明的诊断 |
| datetime2 精度 | grammar 现在保留完整 datetime2(p) 类型节点；避免把已收集的 datetime2(3) 与被截断的 AST datetime2 误认为同一声明 |

类型规则核对 [Microsoft 类型优先级](https://learn.microsoft.com/en-us/sql/t-sql/data-types/data-type-precedence-transact-sql?view=sql-server-ver17)、[CASE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/case-transact-sql?view=sql-server-ver17)、[COALESCE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/coalesce-transact-sql?view=sql-server-ver17) 和 [datetime2](https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetime2-transact-sql?view=sql-server-ver17)。此处只实现表中列明的子集，不是完整引擎类型系统。

DBX 仍固定为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`。其 [局部变量收集及候选](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 目前收集名称并显示 `local variable`；[投影与行来源模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 保存表达式、跨度、来源及父 scope。未从这两条路径得到“已将 DECLARE 类型推导到全部复杂投影及函数重载”的证据，也没有运行 DBX 桌面判断整体效果高低。统一版本化来源图、共同夹具的效果比较仍待完成。

[库场景](../vendor/sql-lsp/src/server/tests/complex_semantics/variables.rs) 与快照模块共新增 **12 组**；[原生协议](../vendor/sql-lsp/tests/integration_test_client/variable_types.rs) 新增 **3 项 / 13 文档**，含 6 次真实 UTF-16 TextEdit 接受后零错误诊断、签名排序、3 次声明/查询 didChange、3 轮不改 SQL 的 metadata/方言更新、未知类型隔离及 2,100 形参的末位变量投影。最终全量 **777 passed / 0 failed / 0 ignored**（607 库 + 170 集成，24 目标）。严格 all-target Clippy、fmt 通过；前端本次选择 **7 文件 / 26 项**通过（选择集合不同于上批 31 项，不累加未重跑项）。完整 `npm run build`、**2766 文件**模块和全部边界/bundle 检查通过；parser 为 31 模块 / 227 方法，保留既有大 chunk 提示。

正常离线 prepare 生成 Windows release 捆绑并更新清单：**17,989,120 B**，SHA-256 **`6e91426a0b19d359a4e614739153697a9e080aea83cae3696813b8179a65b841`**；运行时来源 **223 文件 / `e472f30a6f327b777b93f2645929e25488fc9c5c106cecb80ce3e8b487d49636`**。精确捆绑字节另通过 **49 项**真实协议测试，临时替换的 Cargo debug 产物已恢复。应用捆绑集成 **13 passed / 0 failed / 0 ignored**；全部 Desktop 检查后恢复无 Desktop CLI，确认 `oxide-agent 0.1.18`。

源码包经 `cargo package --locked --offline --allow-dirty --no-verify` 生成，**248 文件 / 209 份 Rust 源码 / 15 项额外构建输入逐字节一致**，**2,643,834 B / SHA-256 `de80cb8273b89041b1a7e2c427a56ff7fb5103d3f3ea86e58dfa68975a57fe40`**。Cargo.lock 的 CRLF/LF 原始字节不同，规范化文本与 TOML 均一致；未独立解包构建。固定 CLI 0.26.3 / ABI 14 的连续再生成中，六份产物的原始 SHA 相同，12 项规范化文本指纹及可逆上游 patch 通过。

真实 Wry/WebView、生产 LspClient/Monaco adapter/Tauri commands 本批重新构建并执行 **21 场景 / 351 断言**。新增三场景实际接受列编辑、核对完整 token 和 Unicode/CRLF 范围、列 hover、声明驱动的签名排序、不改 SQL 的返回类型刷新、Monaco 修改声明后的 int→bigint 更新、GO 隔离及 2,100 形参投影。证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-Apumfe`，宿主 SHA-256 `b7ae6556c1e2fd1382a25cf2ab39de80eb87b48e0a822577f9b172dddea7fe8d`；scenario 原文与实际 bundle 摘要已记录。首轮目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-DCf9n4` 因测试直接读取尚未 resolve 的文档失败，原 `success=false` 保留在 `lsp-tsql-variable-types-webview-first-evidence.json`；改走生产 resolve 接口并额外核对详情类型后，重新生成场景 bundle、重新运行同一正常验收脚本通过。优化后复用本批已编译且摘要不变的原生宿主与应用集成 exe，重新执行最终捆绑；scenario、bundle、生产前端模块摘要均匹配，未复用旧测试回执。此宿主并非完整 React Workbench、安装包或可见推荐弹窗自动重查验收。

每次推断使用一个惰性声明快照：只有真正读取未加引号的 @variable 才建立声明索引，并仅校验被引用的声明；同一声明的类型也惰性复用。新增 2100 声明快照测试证明仅两个引用触发两份类型校验，并复用同一原始树；同一次推断的 CTE/派生/标量子查询共享该快照，函数实参路径复用原始已解析树，不建立跨请求全局声明缓存。保留 512 KiB 输入、4096 名字、2100 形参、256 字节类型及现有 32 层/64 分支查询预算。全部编译和原生验收退出后，以旧/新 release 每请求交替 50 轮、8 轮预热，得到一次本机 warm stdio 观测（ms）：

| 请求 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- |
| 限定字段 SELECT | 6.54 → 6.59 | 10.03 → 9.52 |
| EXEC 必填参数空值 | 0.64 → 0.63 | 0.81 → 0.83 |
| 2,100 形参的 CTE 投影 | 27.48 → 34.87 | 32.59 → 44.55 |

前两项完整 JSON 相同；第三项从 unknown 增加为已知 int，工作语义不同，不能当成同工作性能提升。原始逐请求样本为 `.impeccable/review/lsp-tsql-variable-types-performance.json`。最初实现对全部声明逐个校验，首轮类型增强观测为 p95 61.73→86.57 ms；该次原始结果保留在 `lsp-tsql-variable-types-before-optimization-performance.json`。随后改为按实际引用惰性校验；以优化前同样具有类型推断的 release 与最终 release 再做每请求交替 50 轮、8 轮预热，三个请求的完整 JSON 均相同，2,100 形参投影 p50 **48.72→43.19 ms**、p95 **62.21→49.40 ms**。优化前二进制 SHA 为 `209cea5c7ba287b81bfc0021ef58fc8c4a9f5fc9e0ad13d4ce42ffd0739c3840`，逐请求样本保留在 `lsp-tsql-variable-types-optimization-performance.json`；这不是桌面端 p95、冷启动、RSS 或跨平台性能结论。

仍待完成：完整隐式转换/precision/collation/UDT 图、SQL Server 新增版本类型及表值/游标声明、函数主体边界/完整变量作用域专项核对、赋值和控制流分析、跨功能共享版本化语义图、搜索字符串子语言、更多厂商复杂语法及引擎执行、完整 Workbench/安装包/可见弹窗、resource_dir、macOS/Linux 捆绑和远端 CI。未 fetch、提交、推送或发布，**G01–G13、E01–E07 全目标继续进行中**。

## 第三十二批：函数主体作用域与按需诊断范围

本批从前批列出的函数边界缺口继续复现：首轮六组为 **2 passed / 4 failed**，原日志 `.impeccable/review/lsp-tsql-variable-scopes-red.log`。函数已经结束时，参数和局部声明仍进入变量列表及 CTE 类型；非法的非批次首个模块还继承外层批次变量。新增独立 [模块词法轮廓](../vendor/sql-lsp/src/server/tsql_module_scope.rs)，由 [模块头读取](../vendor/sql-lsp/src/server/tsql_module_parameters.rs) 和 [声明收集](../vendor/sql-lsp/src/server/tsql_variables.rs) 共用，保留现有 AST 对声明类型的校验。

| 场景 | 当前已验证行为 |
| --- | --- |
| 标量函数 | 按 BEGIN/CASE 与 END 配对识别主体终点，主体结束后同时移除形参和局部声明；嵌套块 END、CASE END 不提前关闭函数 |
| 内联 TVF | 对 RETURN 后的括号查询配对，或对无括号查询读取顶层分号；结束后不向尾部 SELECT/EXEC/CTE/hover 输出函数参数和类型 |
| 编辑态 | 删除 END 后，未完成函数主体重新提供参数；插回 END 立即撤回。函数后另写声明时仅使用尾部自身的声明，原有非法批次诊断仍保留；并不认证这些尾部语句是有效的引擎批次 |
| 过程及普通块 | 过程主体仍延续到 GO/EOF，外层 END 后的语句仍属于过程；普通 BEGIN/END、IF 内 DECLARE 不创建新的变量词法作用域，后续投影保留已知类型及保守 nullable |
| 非法模块位置及预算 | 在 4096 保留名预算前先识别当前模块边界；非批次首个模块既不继承外部变量，也不提供其自身参数，保持既有保护和错误诊断。4097 个外层声明也不能绕过这条规则 |
| 不透明文本 | 字符串、注释、引号/方括号标识符中的 CREATE/ALTER/BEGIN/END 不改变边界；Unicode/emoji/CRLF 的原始字节及 UTF-16 编辑范围保持一致 |

规则核对 [Microsoft 变量作用域](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/variables-transact-sql?view=sql-server-ver17)、[函数局部参数](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-function-transact-sql?view=sql-server-ver17)、[BEGIN/END 不创建词法作用域](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/begin-end-transact-sql?view=sql-server-ver17) 和 [GO](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/sql-server-utilities-statements-go?view=sql-server-ver17)。此实现是有界词法轮廓与现有 AST 校验的组合，尚非统一的版本化作用域/控制流图。无分号、无括号且不完整的内联函数边界仍需更完整的语义绑定；未宣称认证全部无效输入的意图。

全量首轮额外发现两处问题，原 `all-targets-first.log` 保留：错误地给非首个模块提供了参数，违反旧原生保护测试；4097 声明文档发布诊断超过既有 10 秒协议期限。前者改为命名空间整体抑制。后者单独分段复现：语法树 **49.44 ms**、语法诊断 **103.26 ms**，附加 inspections **21.773883 s**，见 `lsp-tsql-variable-scopes-diagnostics-red.log`。原因是 [附加诊断](../vendor/sql-lsp/src/server/diagnostics.rs) 对每条语句无条件计算范围，重复从全文开头扫描到当前 UTF-16 位置。

现在只在真正产生 OXIDE001 诊断时计算该范围，其他检查仍保留原有范围计算。相同 debug 夹具最终独立复验的 inspections 为 **194.5959ms**；新增 5 秒粗门禁及 emoji/CRLF/抑制标记范围测试，未放宽原生协议期限，也未缩减 4097 声明输入。此数字是单次 debug 分段观测，不是 release 或桌面 p95。后续完整协议又发现配置刷新会让旧 T-SQL 文档切回 MySQL，从而产生 4097 条真实语法错误；parser 的范围转换同样反复扫描长行。新增 [有界坐标索引](../vendor/sql-lsp/src/position.rs)，存储行起点及非 ASCII 的累计 UTF-8/UTF-16 差，node_range 复用；每个 parser 限 512 KiB 输入、32768 索引项，随原文替换，超限回退原实现。逐字节坐标对照、emoji/组合字符/CRLF、编辑失效及预算测试通过；MySQL 下至少 4097 条错误全部保留，debug 解析为 **107.0153ms**，原生期限仍为 10 秒。索引首轮暴露的跨行累计差减法下溢已由逐字节测试发现并修复。附加检查各分支仍未完全共用此索引，不声明所有诊断成本已变为线性。

新增 [作用域及性能场景](../vendor/sql-lsp/src/server/tests/complex_semantics/variable_scopes.rs)、模块轮廓与 [范围回归](../vendor/sql-lsp/src/server/tests/diagnostics.rs)，合计 **17 组库测试**；[原生协议](../vendor/sql-lsp/tests/integration_test_client/variable_scopes.rs) 新增 **3 项 / 13 文档**，包括 3 次真实变量 TextEdit 接受后零错误诊断、非法尾部仍有诊断、同文档 3 次查询/函数/GO 更新、2 轮方言切换、2,100 形参函数及 4097 声明预算。全量最终 **797 passed / 0 failed / 0 ignored**（624 库 + 173 集成，24 目标），严格 all-target Clippy 和 fmt 通过。生产前端未改；本批未重复计入前端单元测试，新增场景严格 TypeScript、完整 `npm run build`、**2768 文件**模块和全部边界/bundle 检查通过，保留已有 Vite 大 chunk/第三方 PURE 注释提示。

Windows release 捆绑已通过正常离线 prepare 更新：**17,978,880 B / SHA-256 `1d5af6daf3b798cd1dfb81ee803af7766500bbe07a26e00665b6dacbb2204ef6`**，运行时来源 **225 文件 / `60f9f53488561cba51accd743ecfb2962d6811bb53c12938f69e56aa9a538286`**。精确捆绑字节另通过 **52 项**协议测试，Cargo debug 产物已恢复；应用捆绑集成 **13 passed / 0 failed / 0 ignored**。全部 Desktop 验收后恢复无 Desktop CLI，确认 `oxide-agent 0.1.18`。

源码包 **250 文件 / 211 份 Rust 源码 / 15 项额外输入逐字节匹配**，**2,647,765 B / SHA-256 `fd44eb7f50fb6b3158eb6c6e7888d3e55607d649f89ee09501ca85dddca6207d`**。使用 `cargo package --locked --offline --allow-dirty --no-verify`；锁文件 CRLF/LF 原始字节不同，规范化文本及 TOML 一致，未独立解包构建。本批未修改或重新生成 grammar，复验前批六份产物原始摘要及当前 12 项文本指纹、上游 patch、ABI 14 均一致。

正常脚本重新生成场景 bundle 并运行真实 Wry/WebView、生产 LspClient/Monaco adapter/Tauri commands，**24 场景 / 427 断言**通过。新增场景实际检查函数到期时的空列表、错误诊断保留、尾部自身变量接受编辑、unknown 列详情及 hover、嵌套函数/过程投影、同一 Monaco 模型删除/恢复 END 后的候选更新及新 GO 批次。证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-yFKU0O`，宿主 SHA-256 `d33d0974fc1257bf3533529bbffa44e943fad74a569e4287591bc384e0473c5c`；当前 scenario/bundle、三个生产前端模块和捆绑摘要均记录。仍不是完整 React Workbench、安装包、可见弹窗自动触发或 resource_dir 验收。

全部编译与原生进程退出后，旧/新 release 每请求交替 50 轮、8 轮预热的一次 warm stdio 观测（ms）：

| 请求 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- |
| 限定字段 SELECT | 6.28 → 6.28 | 6.60 → 6.65 |
| EXEC 必填参数空值 | 0.50 → 0.48 | 0.56 → 0.55 |
| 2,100 形参的 CTE 投影 | 33.22 → 32.27 | 34.33 → 33.32 |
| 已结束函数后的 CTE 投影 | 0.51 → 0.43 | 0.57 → 0.51 |

前三项完整 JSON 一致；最后一项从错误继承 bigint 改为 unknown，工作语义不同，不把时延变化称作同工作加速。逐请求样本在 `.impeccable/review/lsp-tsql-variable-scopes-performance.json`；没有测量桌面 p95、冷启动、RSS 或其他平台性能。

DBX 固定干净参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`。[局部变量路径](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 按当前批次收集名称，所读路径未看到函数主体终点的清理；其 [语义模型](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 仍是统一来源/父 scope 组织的参考。这里仅作源码核对，未运行 DBX 相同夹具，不据此断言其桌面表现。

仍待完成：完整变量/控制流/UDT/collation/隐式转换图、表值/游标及更多模块和方言语法、搜索字符串子语言、统一版本化语义快照、附加检查共享坐标索引及更多超预算输入优化、引擎执行验证、完整 Workbench/安装包/可见弹窗、resource_dir、跨平台捆绑和远端 CI。未 fetch、提交、推送或发布；**G01–G13、E01–E07 全目标保持进行中**。

## 第三十三批：方言检查边界、真实抑制标记与共享坐标

本轮先用 8 组失败测试复现，保留 `lsp-inspection-regions-red.log`（0 passed / 8 failed）。原附加检查按原始分号拆分，再对每段做通用 masking；字符串、美元引号正文、嵌套注释中的分号会制造不存在的 UPDATE/DELETE/JOIN，或截断真正的 WHERE。字符串中的 `NOINSPECTION OXIDE001` 也会意外关闭警告。

[检查上下文](../vendor/sql-lsp/src/server/diagnostics/inspection_context.rs) 现在通过 [原有方言 lexer](../vendor/sql-lsp/src/parser/sql/masking.rs) 一次读取不透明区域及真正的注释，按可见分号定位原始语句。仅真实注释中的指令可以抑制所属语句，支持 tab、多个代码及重复标记，不向下一语句泄漏。OXIDE001–005 的范围路径共用前批有界 UTF-16 索引，保留 emoji/CRLF 原始范围；超出 512 KiB / 32768 项预算仍回退原转换。[JOIN 快速修复](../vendor/sql-lsp/src/server/join_actions.rs) 共享同一语句边界，避免把 `'a;b'` 中的分号当作当前语句起点。

| 输入 | 本轮验证 |
| --- | --- |
| PostgreSQL dollar body、MySQL/Hive 反斜杠字符串、SQL Server 嵌套注释、ClickHouse // 注释及 dollar body | 不生成隐藏文本里的伪变更警告；未闭合字符串不产生伪语句，独立真实语法错误仍保留 |
| UPDATE 跨行、隐藏 WHERE、字符串分号及真实 WHERE | 保留真实风险，排除注释/字符串中的假 WHERE，范围覆盖原语句 |
| `ilike_count`、NATURAL LEFT OUTER JOIN、CROSS 换行 JOIN | 不把标识符子串或合法无 ON 结构误报 |
| ClickHouse ILIKE / ::、SQL Server hierarchyid::GetRoot() | 不再统一误称 PostgreSQL 专属语法；MySQL 真实不兼容操作仍告警，SQL Server `1::integer` 仍告警 |
| 字面量内 NOINSPECTION 与真实注释指令 | 前者不能关闭警告，后者只影响所属语句；同一文档编辑和配置切换重新计算 |
| 含 `'a;b'` 的外键 JOIN | 原生协议及生产 LspClient 返回唯一首选外键修复，实际应用 UTF-16/Monaco 编辑后保留字面量、正确插入 ON，警告及语法错误清除 |

方言核对使用 [ClickHouse 运算符](https://clickhouse.com/docs/reference/operators)、[ClickHouse 类型转换示例](https://presentations.clickhouse.com/2021-meetup55/new_features/) 及 [Microsoft GetRoot](https://learn.microsoft.com/en-us/sql/t-sql/data-types/getroot-database-engine?view=sql-server-ver17)。静态调用这里只做保守词法识别，未声明完整 hierarchyid 类型及成员推断。歧义列的 token 和点限定改用当前方言 mask，但仍不是统一 AST 作用域绑定。

新增 [11 组检查测试](../vendor/sql-lsp/src/server/tests/inspections.rs) 与上下文 2 组测试，共 **13 库测试**；[真实 stdio](../vendor/sql-lsp/tests/integration_test_client/inspection_regions.rs) 新增 **3 项**，包含 4097 条真实警告、同一 URI 版本和方言刷新及实际接受 quickfix。原生首轮暴露了夹具缺失 required `functions` / `nullable` 字段，以及未闭合尾部按原编辑态策略抑制 EOF 错误；修正元数据并用独立真实无效表达式验证，未修改生产配置协议或放宽错误预期。全量最终 **813 passed / 0 failed / 0 ignored**（637 库 + 176 集成，24 目标）；严格 Clippy、fmt、场景 TypeScript、完整 `npm run build`、**2770 文件**与 parser **31 模块 / 228 方法**边界检查通过。本批生产前端未改，未重复计入前端单元测试。

单独 debug 4097 警告夹具从失败日志约 **7.69 s**，变为 focused 日志 **20.7984 ms**；这是一次分段观测，保留全部警告和 5 秒粗门禁。前批仅优化无警告语句的按需范围，本批也消除大量真实警告重复扫描全文前缀。所有原生协议请求期限保持 **10 秒**。全部编译及原生进程退出后，旧/新 release 逐请求交替的一次 warm stdio 观测如下（ms）：

| 请求 | 轮数 / 预热 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.38 → 0.40 | 0.51 → 0.50 |
| 4097 条真实警告及范围 | 10 / 2 | 352.77 → 139.05 | 421.97 → 188.46 |
| 字符串分号与真实 WHERE（语义已修复） | 50 / 8 | 0.19 → 0.16 | 0.41 → 0.26 |

前两项完整 JSON 相同，4097 条警告及完整范围全部保留；最后一项旧版误报 1 条、新版 0 条，工作语义改变，不作为同工作加速。样本在 `lsp-inspection-regions-performance.json`；未测冷启动、RSS 或桌面 p95。

Windows release 捆绑已正常离线 prepare，**18,006,528 B / SHA-256 `b40becae66d483c65158b7f47c5574abefcb8ac3be825463ea1eac8319ca57e7`**，运行时来源 **227 文件 / `5aadb9b6375ffab47db908899042fda91369dc30c992cc4ac7b6e93234f969d1`**。精确捆绑字节通过 **55 项**协议测试，Cargo debug 产物恢复；应用捆绑集成 **13 passed**。桌面检查后恢复无 Desktop CLI，确认 `oxide-agent 0.1.18`。

源码包 **252 文件 / 213 份 Rust 源码 / 15 项额外输入匹配**，**2,651,048 B / SHA-256 `972dd22a8f476c05c47f9125ec5159325c5ba7edd6426aab814126ccb305fe0b`**。使用 locked/offline package --no-verify，锁文件原始 CRLF/LF 不同、规范化文本及 TOML 相同，未独立解包构建。本轮 grammar 未修改/重新生成；复验六份原始生成产物摘要及现有 12 项指纹、上游 patch 和 ABI 14。

正常脚本重建场景 bundle 并运行真实 Wry/WebView、Monaco、生产 LspClient 和 Tauri commands，**27 场景 / 477 断言**通过。新增 3 场景覆盖分号/指令/范围、真实外键 quickfix 编辑、方言和文档重算。证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-1PxRxX`，宿主摘要 `4e0aac293930e46998621e7daeb327af577ffd3abbb09ebd96bf67a08e667795`；scenario/bundle、三个生产模块及实际捆绑均记录。尚未验收完整 React Workbench、安装包、resource_dir、可见推荐弹窗自动触发。

DBX 固定干净参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`；其 [semantic types](../sources/dbx/apps/desktop/src/lib/sql/semantic/types.ts) 明确组织 token、row source、parent scope，其 [completion](../sources/dbx/apps/desktop/src/lib/sql/sqlCompletion.ts) 使用语义 token，继续作为统一语义模型的参考。其 [diagnostics](../sources/dbx/apps/desktop/src/lib/sql/semantic/diagnostics.ts) 还按 viewport 选择语句范围，并为 SQL Server GO 批次与例程定义保留专门规则；我们的检查目前仍按全文请求执行，后续应在不丢失诊断的前提下增加 revision/statement 缓存及调度。本轮仅核对源码，未运行 DBX 相同夹具，不宣称实际桌面效果相同。

仍待完成：检查改为真正 AST/作用域绑定（CTE 变更、内层 WHERE 不应替代外层条件、JOIN 嵌套 ON/USING、引号右关系插入、完整歧义列来源）；完整版本化语义图、变量/控制流/UDT/collation/隐式转换、更多方言版本及 session 模式、搜索字符串子语言、所有超预算输入性能、真实数据库执行、完整 Workbench/安装版/可见弹窗、跨平台及远端 CI。未 fetch、提交、推送或发布；**G01–G13、E01–E07 全目标继续进行中**。

## 第三十四批：语法树变更归属与逐 JOIN 条件范围

上一轮列出的嵌套 WHERE、JOIN 边界和引号插入缺口已建立回归。首轮 **2 passed / 4 failed**，保留 `lsp-inspection-scopes-red.log`：内层 WHERE 掩盖外层无条件 UPDATE，CTE 内 DELETE 漏报，多个缺条件 JOIN 只报一个，以及换行 WHERE 使 quickfix 插到整句末尾。新增 [statement_structure](../vendor/sql-lsp/src/server/diagnostics/statement_structure.rs)，由 [检查上下文](../vendor/sql-lsp/src/server/diagnostics/inspection_context.rs)、[诊断](../vendor/sql-lsp/src/server/diagnostics.rs) 和 [JOIN actions](../vendor/sql-lsp/src/server/join_actions.rs) 共用。

| 场景 | 当前证据 |
| --- | --- |
| UPDATE 的赋值子查询、CASE/EXISTS、FROM 派生表含 WHERE | 通过语法树的 update/delete 所属 statement 及自身 where/from.where 判断；内层条件不能替代外层过滤，真正外层 WHERE 清除警告 |
| WITH 前缀、CTE 内 DELETE、SQL Server 过程主体 | 遍历每个实际变更节点；CTE 内与外层、过程中的语句分别告警，嵌套范围按原文 UTF-16 定位，保留简单语句已有整句范围 |
| 抑制标记 | mutation/JOIN 使用 statement/subquery/CTE 的嵌套区域索引，内层注释不能关闭外层告警；前置指令仍按所属词法语句生效。其他检查尚未全部迁移此归属规则 |
| EXPLAIN | 已测试传统 EXPLAIN 与 EXPLAIN ANALYZE 对 UPDATE/DELETE 及 CTE 变更的区别；执行模式沿 statement 祖先传递，普通计划不误报实际执行风险 |
| 多个 JOIN、嵌套 SELECT 与 ON/USING | 对每个语法 keyword_join 独立计算同层条件、子句终点和括号配对；内部 ON 不为外部提供条件，多个缺失条件各有独立诊断/编辑；CROSS/NATURAL 仅免除自身 JOIN |
| 换行、tab、引号表名/别名、派生关系 | 使用语法叶节点原始范围保留不透明标识符，插入点位于右关系/别名后、下个子句前；匹配目标诊断而非只修复第一个 JOIN |
| 推荐列表 | 真实协议及 Monaco 中，UPDATE 赋值子查询仍提供当前来源的 id 与正确类型；接受推荐后外层风险仍保留，实际补上外层 WHERE 才清除 |

语法树的 ERROR 恢复节点同样标记为 extra，首轮实现曾跳过其中真实 JOIN；已改为遍历恢复节点并保留实际注释屏蔽。未把整个错误片段当作正确 SQL；原语法错误保持发布，接受完整修复后才要求清除。JOIN 条件分析是语法叶节点加括号/子句结构，尚非统一的完整查询绑定图。FK 推断改用所属 query 的前缀和已有 at-position 来源/别名读取；缺少可证明元数据时仍提供非首选 safety guard，不伪造关联关系。

补充交叉核对发现 parser 的 at-position API 接受字节列，调用处误传 UTF-16 列会在含 64 个 emoji 的标量子查询投影中绑定到错误 query。单独 `coordinate-red.log` 已复现 0 passed / 1 failed；改为 byte_position_at_end，并验证外层唯一 FK 动作和精确谓词恢复。

规则核对 [PostgreSQL 数据修改 CTE](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING) 与 [EXPLAIN / ANALYZE](https://www.postgresql.org/docs/current/sql-explain.html)。这里只覆盖当前 grammar 能建立归属的结构及传统 EXPLAIN 形式，没有认证全部厂商的 EXPLAIN 选项、自然连接语法、过程控制流或引擎执行。

[专项库测试](../vendor/sql-lsp/src/server/tests/inspection_scopes.rs) 新增 **13 组**；[真实 stdio](../vendor/sql-lsp/tests/integration_test_client/inspection_scopes.rs) 新增 **2 项 / 9 文档**，包含 1 次真实字段 TextEdit、2 次逐 JOIN guard 和三方言引号关系共 3 次 guard 编辑、SQL/方言刷新、CTE/过程及语法诊断。全量 **828 passed / 0 failed / 0 ignored**（650 库 + 178 集成，24 目标）；原 4097 条警告与 10 秒协议请求期限保留，严格 Clippy/fmt、完整 npm build、**2772 文件**、parser **31 模块 / 228 方法**检查通过。生产前端未改，本批未重复计入前端单元测试。

结构分析在请求内按需创建一次，只在可见 UPDATE/DELETE/JOIN 存在时解析；没有 JOIN 时不收集叶 token，没有指令时不建指令区域索引。范围查找用排序索引，嵌套括号直接跳到配对终点；没有新增跨版本缓存或运行时依赖。旧/新 release 在编译及原生进程退出后逐请求交替的一次 warm stdio 观测（ms）：

| 请求 | 轮数 / 预热 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.19 → 0.20 | 0.34 → 0.33 |
| 4097 条真实警告 | 10 / 2 | 123.48 → 157.12 | 166.94 → 202.48 |
| 字符串分号与外层 WHERE | 50 / 8 | 0.17 → 0.19 | 0.30 → 0.31 |
| 内层 WHERE / 外层无条件 UPDATE（语义变化） | 50 / 8 | 0.20 → 0.23 | 0.27 → 0.30 |
| 普通 JOIN codeAction | 50 / 8 | 0.25 → 0.31 | 0.36 → 0.41 |

本组相同 JSON 的大诊断 p50 约 123.49 → 157.12ms，p95 166.94 → 202.48ms（约增加 21%）；普通 JOIN codeAction p95 0.37 → 0.41ms。新增归属分析目前额外建立请求内语法树，尚未复用 dialect 已解析的树，这是下一轮优先消除的成本；不能把本批称作性能优化完成。字段补全的微小差异只作观测，不据此宣称加速。

第 1、2、3、5 项完整 JSON 相同；第 4 项旧版漏报、新版补 1 条风险，语义改变，不作为同工作加速。10 轮大诊断 p95 是此组样本最大值，其他 50 轮；不推断桌面 p95、冷启动、RSS 或跨平台结论，原样本见 `lsp-inspection-scopes-performance.json`。

Windows release 捆绑正常离线 prepare，**18,015,744 B / SHA-256 `f054fbc6f7f62e10ac99707cfe4bf2b8c357c8782c6ec7be2a7add9dfc2cdc19`**；来源 **229 文件 / `8042c1b92781870e2f955c503437f450f80a1966e7751bb507d29f85647ef77d`**。精确捆绑字节 **57 项**协议测试通过，Cargo debug 产物恢复；应用捆绑集成 **13 passed**，随后恢复无 Desktop CLI `oxide-agent 0.1.18`。

源码包 **254 文件 / 215 份 Rust 源码 / 15 项额外输入匹配**，**2,655,463 B / SHA-256 `d4d7486451a37c60ccfd377a651a7ab789ea407899bc7f5338acb119f0cdd5ae`**；locked/offline package --no-verify，锁文件 CRLF/LF 原始不同、规范化文本及 TOML 相同，没有独立解包构建。grammar 本批未修改或再生成，前批六份产物摘要、当前 12 项指纹、上游 patch 和 ABI 14 复验一致。

正常脚本重建场景 bundle，真实 Wry/WebView、Monaco、生产 LspClient/Tauri commands 共 **29 场景 / 522 断言**通过；新增 2 场景实际接受子查询字段推荐、修改外层 WHERE、检查 CTE/嵌套指令，以及分两次修复两个引号 JOIN。证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-JCANq2`，宿主 SHA-256 `6db9125bbe1f3225570ece13dac40146a3cadf05371411ad01a22ced512d5d99`；仍非完整 React Workbench、可见弹窗自动触发、安装版或 resource_dir 验收。

DBX 干净固定参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`。其 [model](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 区分 mutation_target、row source、scope，其 [diagnostics](../sources/dbx/apps/desktop/src/lib/sql/semantic/diagnostics.ts) 分离可见区域语句调度；继续作为共享语义图与调度的对照。本轮是源码核对，没有运行 DBX 相同夹具，不能断言桌面效果等同。

仍待：完整版本化语义图/缓存、歧义列与所有检查的统一作用域及指令归属、复杂 JOIN 方言/分组连接/USING 来源绑定、完整变量控制流/UDT/collation/隐式转换、更多方言和搜索子语言、所有超预算输入性能、真实数据库执行、完整 Workbench/安装版/可见弹窗、Linux/macOS 捆绑及远端 CI。未 fetch、提交、推送或发布；**G01–G13、E01–E07 全目标继续进行中**。

## 第三十五批：诊断复用请求内方言语法树

本批直接处理前批记录的重复解析成本。[Dialect](../vendor/sql-lsp/src/dialect.rs) 新增带默认实现的 parse_with_syntax，返回原有 ParseResult；PostgreSQL、MySQL、ClickHouse、Hive 实现一次加锁解析并返回完整结果，SQL Server 复用其既有独立 profile 的 PostgreSQL 实现。旧 parse 接口继续返回同一诊断结果，旧方言实现可使用默认回退，无需全部修改。

[document_diagnostics](../vendor/sql-lsp/src/server/diagnostics.rs) 从同一次调用取得语法诊断与树，检查原始 source 与当前 text 逐字节相等，再将树借给 [检查上下文](../vendor/sql-lsp/src/server/diagnostics/inspection_context.rs) 和 [结构分析](../vendor/sql-lsp/src/server/diagnostics/statement_structure.rs)。不匹配时放弃该快照及其诊断，使用原 parse 接口；缺少 tree 时保留方言诊断并回退独立结构解析。非 SQL provider 继续走原路径。

| 验收点 | 当前证据 |
| --- | --- |
| 去掉重复解析 | 初轮 10 组 **4 passed / 6 failed**，`lsp-shared-syntax-red.log` 保留。测试专用线程计数证明共享路径的检查器后备解析次数为 **0**；缺 tree 和错误 source 分别使用 **1** 次后备，不只依赖时间阈值 |
| 大树与缓存预算 | 输入同时超过 **256 KiB / 32768 节点**，仍可在当前请求借用完整返回树；4097 条真实警告全部保留，完整诊断与独立路径逐项相同，既有缓存预算未提高 |
| 请求所有权 | tree/原始 source 由此次 ParseResult 持有；解析另一个文档不会改变已取得的树，同 provider 并发文档结果各自保持，未将诊断结果缓存在语法树里 |
| 方言与语法错误 | 五个 profile 均提供原始 Unicode/emoji/CRLF 文本与完整树；引号、方括号、CTE、过程、错误表达式及缺 JOIN 的全部诊断与旧路径相同，原语法错误不被性能优化吞掉 |
| 兼容回退 | trait 默认实现保留既有 parse；自定义诊断保留，无树可回退，错误 source 不进入坐标分析；非 SQL provider 不调用 SQL 快照路径 |
| 实际推荐与编辑 | 大型 PostgreSQL 文档与 SQL Server DECLARE/CTE 文档交替查询，bigint 候选接受 TextEdit 后保留类型，大文档完整报告不变；修改、关闭后拉取和重新打开均不使用旧结果 |

快照只在当前请求内借用，provider 的 parser 锁在返回前释放；大树不因此进入持久缓存。原 parser 仍遵守 256 KiB / 32768 节点的树缓存规则，范围索引预算不变，没有增加全局缓存、Cargo 依赖或运行时 Python。这是诊断语法树复用，尚非统一版本化语义/类型图，也未让每个 JOIN action、每条歧义检查及所有编辑器功能共享同一个图。

新增 [9 组共享语法测试](../vendor/sql-lsp/src/server/tests/shared_syntax.rs) 及 trait 默认兼容测试，共 **10 库测试**；[原生协议](../vendor/sql-lsp/tests/integration_test_client/shared_syntax.rs) 新增 **1 项 / 2 URI / 3 次打开**，包含414,241 B 输入、4097 警告、2 个实际方言、1 次真实推荐 TextEdit、真实错误保留、关闭后空 pull report 与重新打开。原生首轮夹具错误地等待服务器未承诺的 didClose 清空推送，触发旧 10 秒期限；`native-first.log` 保留。核对当前协议后改为主动拉取验证清理，不放宽期限，不删减大输入。

全量 **839 passed / 0 failed / 0 ignored**（660 库 + 179 集成，24 目标），严格 Clippy/fmt、完整 npm build、**2773 文件**和 parser **31 模块 / 228 方法**检查通过。纯独立检查包装函数现仅供测试，按 cfg(test) 编译；生产走共享入口，独立 Context 仍供 codeAction 等回退。生产前端未改，未重复计入前端单元测试。

编译及原生进程退出后，旧/新 release 每请求交替的一次 warm stdio 观测（ms）：

| 请求 | 轮数 / 预热 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.20 → 0.20 | 0.34 → 0.28 |
| 4097 条真实警告 | 10 / 2 | 145.56 → 121.73 | 151.76 → 127.24 |
| 字符串分号与外层 WHERE | 50 / 8 | 0.16 → 0.18 | 0.27 → 0.24 |
| 内层 WHERE / 外层无条件 UPDATE | 50 / 8 | 0.16 → 0.16 | 0.26 → 0.25 |
| 普通 JOIN codeAction | 50 / 8 | 0.29 → 0.28 | 0.38 → 0.35 |

五项完整 JSON 均相同，4097 条诊断的消息、代码、数量和 UTF-16 范围保留；本组大诊断 p95 变化为 **16.2% 降低**。10 轮大输入的 p95 是样本最大值，其他工作负载 50 轮，预热 2/8 轮；本次样本支持诊断路径消除重复解析的观测，不证明冷启动、桌面 p95、RSS 或跨平台性能。codeAction 仍可能独立解析，不能把小幅抖动称作该路径已优化。数据在 `lsp-shared-syntax-performance.json`。

Windows release 正常离线 prepare，**18,022,912 B / SHA-256 `de8cb0c3496cea57051f9752535b5c9ff506ba4e34f8e856a6ec4046e07f24e8`**，来源 **230 文件 / `3e92ed89a5d1f8d40d33e0ba437df80d4617591821f9a650e3d765d56e1a10b0`**。精确捆绑字节 **58 项**协议通过，Cargo debug 产物恢复；应用捆绑集成 **13 passed**，随后恢复无 Desktop CLI `oxide-agent 0.1.18`。

源码包 **255 文件 / 216 份 Rust 源码 / 15 项额外输入匹配**，**2,658,401 B / SHA-256 `b4c592ee2f600855541607471d2e5c1a503d7110043f6a73cdcc682324ddf85d`**。locked/offline package --no-verify，锁文件原始 CRLF/LF 不同、规范化文本及 TOML 相同，未独立解包构建。grammar 本批未修改/再生成；六份原始产物摘要、12 项指纹、上游 patch 和 ABI 14 复验一致。

正常脚本重新生成 bundle 并运行真实 Wry/WebView、Monaco、生产 LspClient/Tauri commands，现有完整 **29 场景 / 522 断言**在新捆绑上通过，包括复杂字段推荐、元数据/方言刷新、模块作用域、独立 JOIN 修复、真实编辑及诊断保留。scenario 源码本轮未改，证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-D2ZW6f`，宿主 SHA-256 `667dbc379062931998e742dcd90e5b17b5c115ff301fd97421ed3100bf73dc77`。仍不是完整 React Workbench、安装版、resource_dir 或可见推荐弹窗自动触发验收。

DBX 干净固定参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`。继续以其 [semantic model](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 与 [diagnostics](../sources/dbx/apps/desktop/src/lib/sql/semantic/diagnostics.ts) 的来源/作用域及调度分离作为对照；本轮没有运行 DBX 相同夹具或重新 fetch，不宣称桌面效果一致。

仍待：统一版本化语义/类型/控制流图、诊断与推荐/导航的完整复用、歧义检查的逐语句重复成本、更多方言和搜索子语言、所有超预算输入、真实引擎执行、完整 Workbench/安装版/可见弹窗、Linux/macOS 捆绑和远端 CI。未提交、推送或发布；**G01–G13、E01–E07 全目标保持进行中**。

## 第三十六批：查询块字段歧义与限定名快速修复

首轮 [15 组场景的初始 12 组](../vendor/sql-lsp/src/server/tests/ambiguity_scopes.rs) 全部复现失败，`lsp-ambiguity-scopes-red.log` 为 **0 passed / 12 failed**。原 OXIDE004 逐词法语句重新创建 parser，汇总全部引用表后扫描所有 token：把别名当字段、把子查询的表混到外层，漏掉同表不同别名的自连接，也不认识 USING 的合并输出。

新增 [查询块字段模型](../vendor/sql-lsp/src/server/diagnostics/ambiguity.rs)，读取同一请求的语法树，按 SELECT/set 分支及变更查询块分配字段、行来源和父层。仅字段读取参与检查；表名、AS 名称、CTE 名称、函数名、简单赋值目标和限定字段不按裸列计算。普通字段、方言允许的独立引号标识符保留原始 UTF-16 范围；MySQL/Hive 的双引号字符串不按该适配当字段。

[ColumnScopes](../vendor/sql-lsp/src/dialects/common/scope_columns.rs) 增加按有序行来源组绑定的入口，复用补全现有的 catalog/local-overlay 匹配和行身份；同一物理表的不同别名保留多个出现位置。CTE/派生关系使用原 [局部关系推断](../vendor/sql-lsp/src/server/local_relations.rs)，有需要才创建局部 schema；未装载来源会阻止盲目回退外层。已知局部关系因 512 KiB 等预算没有形状时显式保持未知，不能错误绑定同名物理表。关闭的兄弟 CTE 不会遮蔽外层真实表。

| 场景 | 当前已验证行为 |
| --- | --- |
| 别名、函数名与限定字段 | 只报告真正的裸字段读取，不把 SELECT o.id AS id 的输出别名误报；带空白/注释的 o . id 不误报 |
| 子查询、CTE、派生表、UNION | 兄弟块隔离，各集合分支独立；局部列按当前输出解析，CTE 与同名 app.orders 物理表分别绑定；子层唯一匹配优先于父层，未装载来源不凭 catalog 猜测 |
| 自连接 | 同表 u/v 两次出现能产生真实歧义；补全仍提供 u.id/v.id、hover 保持不任选来源，诊断与这些结果一致 |
| USING | 按每个连接计算可证明的列合并；A JOIN B USING(id) 的 id 不误报，后续 JOIN C ON 保留 AB 与 C 的歧义，再 USING(id) 才继续合并，不全局豁免同名列 |
| ORDER BY 与 GROUP BY | 简单 ORDER BY 使用唯一已知输出名称；GROUP BY 仍检查输入歧义。未把星号或重复输出名称猜成唯一别名 |
| 嵌套抑制与原始位置 | 内层 NOINSPECTION 不关闭外层字段检查；注释、emoji/CRLF、引号字段的完整编辑范围保持 |
| 修复列表 | [协议](../vendor/sql-lsp/src/server/protocol.rs) 为 OXIDE004 提供可用限定名 quickfix，复用已有资格限定动作；不自动首选、不重复显示同编辑的 refactor/quickfix，接受 q.id 后诊断消失，候选与 hover 仍为 bigint |

规则核对 [PostgreSQL JOIN/USING](https://www.postgresql.org/docs/current/queries-table-expressions.html) 与 [ORDER BY/GROUP BY 名称优先级](https://www.postgresql.org/docs/current/sql-select.html)。这里复用的是行绑定与已有局部输出推断，不是完整统一的版本化语义图；所有 NATURAL/分组连接、关联边界、连接结果类型/可空性、collation 和会话模式仍需继续扩充。

上下文现在按需持有唯一后备语法树，结构检查和字段模型共用；生产优先借用上批方言快照。OXIDE004 不再为每条词法语句重新解析；错误恢复时可用原作用域读取补全丢在 ERROR 中的关系，此路径不重新解析。局部输出推断仍可能有自身解析成本，未宣称所有复杂推导都已单次完成。

新增 **15 库测试** 与 [2 项原生测试 / 10 URI](../vendor/sql-lsp/tests/integration_test_client/ambiguity_scopes.rs)，覆盖五个 profile、元数据字段删除/恢复的两轮刷新、2 次真实限定名 TextEdit 及补全/hover 一致性。首轮原生修复动作为空，原因是选择器需要词末光标；改为诊断 end 的零宽度位置，`native-first.log` 保留。随后加入 64 个 emoji 的标量子查询回归，`coordinate-red.log` 复现 0 passed / 1 failed：旧限定名作用域调用把 UTF-16 列当字节列，生成了已被别名隐藏的物理表限定名。改为统一转换后再读取别名，原生与 Monaco 实际编辑均验证 o.id，保留原始字节及 UTF-16 各自边界。全量首轮还发现旧可见性测试要求自连接 SELECT id 无任何诊断；保留原类型/候选断言，并将该分支改为精确检查 1 条 OXIDE004 warning（SQLite 原检查路径未扩展），`all-targets-first.log` 保留。未放宽语法错误或协议期限。

最终 **856 passed / 0 failed / 0 ignored**（675 库 + 181 集成，24 目标）；严格 Clippy/fmt、场景 TypeScript、完整 npm build、**2775 文件**、parser **31 模块 / 228 方法**及共享方言 **7 模块 / 83 函数**边界通过。生产前端未改，未重复计入前端单元测试。

编译及原生进程退出后，旧/新 release 逐请求交替的一次 warm stdio 观测（ms）：

| 请求 | 轮数 / 预热 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.19 → 0.17 | 0.30 → 0.25 |
| 4097 条真实警告 | 10 / 2 | 129.52 → 98.35 | 139.55 → 112.10 |
| 字符串分号与外层 WHERE | 50 / 8 | 0.16 → 0.15 | 0.28 → 0.23 |
| 内层 WHERE / 外层无条件 UPDATE | 50 / 8 | 0.22 → 0.19 | 0.34 → 0.23 |
| 普通 JOIN codeAction | 50 / 8 | 0.24 → 0.27 | 0.34 → 0.36 |
| 自连接歧义（语义变化） | 50 / 8 | 0.18 → 0.16 | 0.25 → 0.22 |

前五项完整 JSON 相同，4097 条警告的数量、代码、消息、范围保留；本组大诊断 p95 变化约 **19.7% 降低**。最后一项旧版漏报、新版补 1 条自连接歧义，语义不同，不作为同工作加速。大输入为 10 轮/2 预热（p95 为该组最大值），其他为 50 轮/8 预热；样本在 `lsp-ambiguity-scopes-performance.json`，不推断桌面 p95、冷启动、RSS 或其他平台性能。

Windows release 正常离线 prepare，**18,106,880 B / SHA-256 `3aaf46151fcea2bf97b0b289d2b5e6d25bf8695f60701c2533d72aaf8516ac72`**，来源 **232 文件 / `23a8578d237b9f599bb9460aa48a600e595e50d5003d67fc7c08d838772aa673`**。精确捆绑字节 **60 项**协议通过，Cargo debug 产物恢复；应用捆绑集成 **13 passed**，随后恢复无 Desktop CLI `oxide-agent 0.1.18`。

源码包 **257 文件 / 218 份 Rust 源码 / 15 项额外输入匹配**，**2,664,270 B / SHA-256 `3a3f4474254b70bf501b485ec6c58dd0e7c9d6e1afa256f22e59621a2f029968`**。locked/offline package --no-verify，锁文件原始 CRLF/LF 不同、规范化文本及 TOML 相同，未独立解包构建。grammar 未修改/再生成，六份原始产物摘要、12 项指纹、上游 patch 和 ABI 14 复验一致；没有新增依赖或持久缓存。

正常脚本重新生成 bundle 并运行真实 Wry/WebView、Monaco、生产 LspClient/Tauri commands，共 **30 场景 / 555 断言**在当前捆绑通过。新增场景验证子查询无误报、CTE 真实歧义的两个选择、Monaco 接受 q.id、正确 bigint 候选/hover 与 USING 无误报。证据目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-DDdbiD`，宿主 SHA-256 `617c41c843e08bcbf3005fc2f9286343dd52cf7a113d2f13a273563f41296d54`；仍非完整 React Workbench、安装版、resource_dir 或可见推荐弹窗自动触发验收。

DBX 干净固定参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`；其 [diagnostics](../sources/dbx/apps/desktop/src/lib/sql/semantic/diagnostics.ts) 使用 column.scope_id 和父 scope 选择可见表，其 [model](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 区分行来源与 mutation_target，继续作为对照。本轮仅核对源码，没有运行 DBX 同夹具或 fetch，不声称桌面效果等同。

仍待：完整共享语义/类型/控制流图、关联边界及更深作用域的一致预算、分组连接/NATURAL 与完整 USING 类型/可空性、更多表值函数、collation/会话模式、所有超预算输入、SQLite 等其余检查方言、真实引擎执行、完整 Workbench/安装版/可见弹窗、Linux/macOS 捆绑及远端 CI。未提交、推送或发布；**G01–G13、E01–E07 全目标继续进行中**。

## 第三十七批：JOIN ON 输入边界与 SQLite 方言推荐

新增场景的首轮为 **1 passed / 8 failed**，复现 ON 从后续 JOIN 或逗号兄弟输入读取字段、hover 错误失去唯一类型、修复动作提供尚不可见别名；另一次 **9 passed / 2 failed** 揭示独立的别名推荐路径仍引入 later。未完成 ON 的 AST 恢复另有 **0 passed / 1 failed** 记录。日志统一为 `lsp-join-operands-*`，没有提高原 10 秒协议期限。

[连接输入模型](../vendor/sql-lsp/src/parser/sql/join_scope.rs) 读取当前树的 ON 和关系节点，确定本次连接的左/右输入。ANSI 平铺连接保留已经累积的左侧 JOIN，排除后续来源，且逗号优先级较低；SELECT/WHERE 仍能读取完整当前查询输入。相关标量查询跟随父边时应用父 ON 边界，CTE/派生关系继续使用原局部推断。原始关系/引号别名和字节范围保留；未完成 ON 接受 ON 末尾到恢复谓词间的输入位置，不伪装语法错误已消失。读取到当前窗口末尾就停止，不遍历后续谓词子树。

[RelationScope](../vendor/sql-lsp/src/parser/sql/types.rs) 保留 AST 确知的有序行出现位置，区分 orders 与 orders p 的混合自连接；没有 AST 出现信息时保留既有文本恢复。补全/hover 的 [行绑定](../vendor/sql-lsp/src/dialects/common/scope_columns.rs)、[引用适配](../vendor/sql-lsp/src/dialects/common/references.rs)、[限定名动作](../vendor/sql-lsp/src/server/code_actions.rs) 和 [字段歧义](../vendor/sql-lsp/src/server/diagnostics/ambiguity.rs) 使用该边界。ON 内只重建已知输入的字段候选；重复行提供各自限定名，唯一输入保留字段类型。不同 ON 的字段按窗口分组，共用一次局部 schema 推断，未逐字段重新解析。

[CompletionSnapshot](../vendor/sql-lsp/src/dialect.rs) 在原方言补全函数内携带同一次树得到的可见别名，限定成员按当前查询到外层的合法边与本地遮蔽，仅导入明确请求的外层别名；发布版额外探针曾复现 ON 标量子查询外层成员列表为空，补上该路径后保留全部授权表字段（Monaco 按前缀过滤），并验证 later 仍不可见。运行时不再把 later 从独立全文扫描加入 ON 推荐；默认实现保留旧 completion_with_context 路径。PostgreSQL（含 SQL Server profile）、MySQL、Hive、ClickHouse 和 SQLite 适配已接入；没有增加持久缓存或依赖。上下文识别也认识真实 ON 谓词，保留限定成员及表达式优先规则。另将 MySQL/PostgreSQL facade 检查从禁止类型名称改为禁止 CompletionContext 枚举分派，避免新协议参数类型误报；上下文分派仍在 completion 模块，未放宽模块大小预算。

| 已验证输入 | 当前行为 |
| --- | --- |
| ANSI 后续 JOIN 与逗号兄弟 | 当前 ON 的裸字段、限定成员、别名列表与修复选择均排除不可见来源 |
| 多次已完成 JOIN | 后一个 ON 保留前面累积输入，不只保留最后两张物理表 |
| 多层标量相关查询 | 各层自己的来源独立，回到外层时仍受外层 ON 限制 |
| CTE / 派生关系 | ON 的 amount 推荐和 hover 继承 decimal，后续无关来源不覆盖 |
| 混合自连接 | orders 与 orders p 是两个输入，提供 orders.id / p.id，裸 id 不任选类型；真实修复后消除歧义 |
| Unicode / 未完成 ON | 引号/中文别名与 64 emoji、CRLF 保留原始坐标，ON 后空白仍能识别当前输入；语法错误继续保留 |
| SQLite / SQLite3 / D1 / Turso | 逗号输入累积到左侧；INNER ON 保留可合法读取的后续输入，OUTER ON 排除后续输入；重复 total 仍提供两个限定候选并保持裸字段 hover 未知 |
| DuckDB 兼容适配 | 独立使用 ANSI 连接优先级，不因与 SQLite 共享补全代码而继承 SQLite 的逗号行为 |

规则参照 [PostgreSQL 连接优先级](https://www.postgresql.org/docs/current/queries-table-expressions.html) 和 [SQLite SELECT 的偏离规则](https://www.sqlite.org/lang_select.html#precedence_of_comma_joins_and_cross_join)。初版把 SQLite 也纳入统一排除矩阵，官方核对及真实执行证明此假设不成立，因此明确拆分 parser 的连接策略。不是用错误的跨方言一致性作为验收。

本机 Python 标准库 **SQLite 3.45.3** 内存库独立执行 4 条 SQL：逗号左侧来源和 INNER ON 后续来源均返回 `[[1]]`；同样后续来源用于 LEFT ON 时返回 `ON clause references tables to its right`；两个 orders 输入的裸 total 返回 `ambiguous column name: total`。完整 SQL 和结果在 `lsp-join-operands-sqlite-engine.json`。仅证明该版本这四条实际查询，没有连接其他厂商引擎或验证所有 SQLite 版本。

新增 **20 库测试**（含默认补全快照兼容）及 [2 项原生测试](../vendor/sql-lsp/tests/integration_test_client/join_operands.rs)，在 **37 URI** 验证六个配置、一次真实限定名 TextEdit、两轮元数据类型刷新。最终 **878 passed / 0 failed / 0 ignored**（695 库 + 183 集成，24 目标）；严格 Clippy/fmt、场景 TypeScript、完整 npm build、**2777 文件**检查、parser **32 模块 / 232 方法**和共享方言 **7 模块 / 83 函数**边界通过。未修改生产前端，未重复计入前端单元测试。

编译与自有原生进程退出后，旧/新 release 交替逐请求的一次 warm stdio 观测（ms）：

| 请求 | 轮数 / 预热 | p50 旧 → 新 | p95 旧 → 新 |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.20 → 0.20 | 0.35 → 0.33 |
| 4097 条真实警告 | 10 / 2 | 137.88 → 138.89 | 148.98 → 163.89 |
| 字符串分号与外层 WHERE | 50 / 8 | 0.16 → 0.19 | 0.30 → 0.38 |
| 内层 WHERE / 外层 UPDATE | 50 / 8 | 0.34 → 0.35 | 0.75 → 0.60 |
| 普通 JOIN codeAction | 50 / 8 | 0.51 → 0.53 | 0.62 → 0.72 |
| 自连接诊断 | 50 / 8 | 0.19 → 0.23 | 0.31 → 0.34 |
| ON 限定名修复（候选变化） | 50 / 8 | 0.44 → 0.42 | 0.56 → 0.53 |

前六项完整 JSON 相同，4097 条警告的数量和原始范围保留。该组大诊断 p95 为 **148.98 → 163.89 ms（约上升 10%）**，p50 为 137.88 → 138.89 ms；这次观测没有证明整体提速，仍需分段剖析与更稳定的样本，不能把波动直接归因于某条代码。最后一项从 3 个限定名选择改为 2 个当前输入，排除 later.id，属于语义变化，不能称为同工作量加速。大输入为 10 轮/2 预热，其余 50 轮/8 预热；原始样本 `lsp-join-operands-performance.json`，不推断桌面 p95、RSS、冷启动或其他机器性能。

正常 locked/offline Windows release prepare，捆绑 **18,197,504 B / SHA-256 `05a42701a1798107c73c76cb751e732f0cf59739a05b65ecb61c0280f3012622`**；来源 **234 文件 / `1e0d8a80bff015b00cfb01670fd8ad69a7646423bc644b696fff7a4952cd5cfc`**，基于未提交的 `8c80923dc9e8e756e46eb21ce9f6e04d7a2f4735` 工作树。精确捆绑字节 **62 项**协议通过，debug 产物已恢复；应用集成 **13 passed**，之后恢复无 Desktop CLI `oxide-agent 0.1.18`。

源码包 **259 文件 / 220 Rust 源码 / 15 项额外输入匹配**，**2,671,942 B / SHA-256 `8788ef53dd06476112e08f2ad0adbf6355822169b79f3d0dcf9c3e38bfe25829`**。保留 Cargo 对 tests 目录的既有排除，原生协议测试在工作树执行；package --no-verify，未声称独立解包构建。锁文件原始 CRLF/LF 不同、规范化文本/TOML 相同。grammar 没有修改/再生成，六份原产物摘要、12 指纹、上游 patch 和 ABI 14 复验一致。

正常 runner 重新构建场景 bundle 和真实 Wry/WebView 宿主，经 Monaco、生产 LspClient 及 Tauri 命令共 **31 场景 / 621 断言**通过。新增场景实际验证 PG 字段/别名排除、接受 total 推荐、混合自连接的两个选择和 Unicode 真实修复，以及 SQLite INNER/OUTER/逗号差异。证据 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-MGcGgb`，宿主 SHA-256 `cbc8932d3f2425c28b22f83016b5c59263b3e52d36b8f9b54c4d46bbb415f748`；仍非完整 React Workbench、安装版或可见推荐弹窗自动触发验收。

DBX 仍为干净固定参考 `b160d130560f71c5c429be15cec6147f677a4b3a`。核对 [model](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts)、[completion](../sources/dbx/apps/desktop/src/lib/sql/semantic/completion.ts) 的 row-source / join_condition 模型，以及 [diagnostics](../sources/dbx/apps/desktop/src/lib/sql/semantic/diagnostics.ts) 的 scope_id/父作用域可见表。这里是对照源码并修复已复现差距，没有运行 DBX 同夹具，未 fetch，不声称两个桌面效果相同或超过 DBX。

仍待：分组连接/NATURAL 的完整语法与连接树、完整 USING 输出类型/可空性、所有恢复形状、LATERAL/APPLY 各关联边界统一、完整版本化类型/控制流图、collation/会话模式、更多表值函数及超预算输入；完整 Workbench/安装版/可见弹窗、其他真实引擎和版本、Linux/macOS 捆绑及远端 CI。未提交、推送或发布，**G01–G13、E01–E07 全目标保持进行中**。

## 第三十八批：大诊断分段剖析与单遍查询归属模型

上一轮单次大诊断 p95 为 148.98→163.89ms。本轮先保留 B36 `3aaf46151fcea2bf97b0b289d2b5e6d25bf8695f60701c2533d72aaf8516ac72` 与 B37 `05a42701a1798107c73c76cb751e732f0cf59739a05b65ecb61c0280f3012622`，在无自有编译进程时，每轮重新启动两个真实进程，逐请求交替采样，三轮各 **40 请求 / 8 预热**，每个版本共 120 个观测。完整响应逐次相同，4097 条警告与范围全部保留。

| 复测轮次 | p50 B36 → B37，ms | p95 B36 → B37，ms |
| --- | --- | --- |
| 1 | 93.46 → 94.37 | 120.16 → 113.02 |
| 2 | 91.15 → 90.86 | 96.00 → 97.86 |
| 3 | 89.96 → 90.06 | 92.08 → 94.86 |

这组三轮 p50 差不到 1ms，p95 有升有降，没有重现一致的 10% 回退；不能把上一单组差异归因于 B37 修改，也不能据此断言所有负载性能相同。原始样本为 `lsp-diagnostic-profile-baseline-repeat.json`，保留上一批记录。

在 [专项库测试](../vendor/sql-lsp/src/server/diagnostics/ambiguity_tests.rs) 分开测量解析、检查上下文、变更结构、歧义模型、完整附加检查和 JSON 编码；以下是相同 4097 UPDATE 输入的各五次中位数，**debug 测试构建且含测试计数**，不是 release 请求延迟，各段独立调用、不相加：

| 调用阶段 | 修改前，ms | 修改后，ms |
| --- | --- | --- |
| 解析与原语法诊断 | 130.49 | 125.66 |
| 检查上下文/噪声与坐标 | 14.66 | 14.41 |
| 变更结构与枚举 | 85.07 | 84.39 |
| 字段歧义模型 | 149.51 | 122.27 |
| 完整附加检查 | 254.65 | 226.32 |
| 诊断数组 JSON 编码 | 17.90 | 17.80 |

旧 [ambiguity 图构建](../vendor/sql-lsp/src/server/diagnostics/ambiguity.rs) 先走完整棵树收集查询并排序、建立父层，再走完整棵树为每节点二分查找 owner。访问计数真实复现 **106526 > 53263**，首轮 **3 passed / 1 failed**。改为依据 Tree cursor 源序前序遍历维护查询区间栈，一次绑定字段/行来源，区间关闭即弹栈，包含 UNION 的分支终点；删除查询排序和逐节点二分 owner。标点不携带查询/字段角色，留待下个有角色的命名节点处理关闭边界，仍保留 ERROR 恢复节点。

新增 **4 库测试**：4097 独立变更的单次外层 walk 上界、CTE/标量/集合分支的字段归属、嵌套变更及语句间的父层隔离，以及完整 4097 条警告/900375 B 诊断数组的分段与内容验证。测试计数仅存在于 cfg(test)，没有生产计数开销；耗时不作为易波动的单元测试门槛。原有错误恢复、CTE 可见性、字节/UTF-16、引用和方言预算不变，没有新增跨请求缓存或解析。这里仅是歧义模型的单次外层走访，**不代表整个诊断管线只遍历一次**，结构检查与其他语法消费仍有各自成本。

优化前 B37 与新 release 的另一组三轮交替采样，仍为每轮新进程、**40 请求 / 8 预热**，完整响应逐次相同，响应摘要还与前一组三轮一致：

| 优化对照轮次 | p50 前 → 后，ms | p95 前 → 后，ms |
| --- | --- | --- |
| 1 | 99.28 → 92.89 | 122.98 → 113.91 |
| 2 | 108.42 → 103.59 | 145.88 → 142.61 |
| 3 | 90.46 → 85.79 | 111.03 → 96.36 |

另外一次 warm stdio 七类请求观测，**七项完整 JSON 全部相同**，没有拿删减诊断、改变结果或减少候选来计算收益：

| 请求 | 轮数 / 预热 | p50 前 → 后，ms | p95 前 → 后，ms |
| --- | --- | --- | --- |
| 限定字段补全 | 50 / 8 | 0.17 → 0.18 | 0.27 → 0.32 |
| 4097 条诊断 | 10 / 2 | 99.96 → 89.75 | 118.57 → 108.23 |
| 字符串分号与外层 WHERE | 50 / 8 | 0.20 → 0.19 | 0.36 → 0.33 |
| 内层 WHERE / 外层 UPDATE | 50 / 8 | 0.25 → 0.24 | 0.37 → 0.40 |
| 普通 JOIN 动作 | 50 / 8 | 0.42 → 0.42 | 0.78 → 0.75 |
| 自连接歧义 | 50 / 8 | 0.19 → 0.17 | 0.25 → 0.23 |
| ON 限定名选择 | 50 / 8 | 0.33 → 0.33 | 0.41 → 0.40 |

原始数据为 `lsp-diagnostic-profile-optimization-repeat.json` 和 `lsp-diagnostic-profile-performance.json`。均是本机 warm stdio 的小范围比较，不代表桌面 p95、冷启动、RSS 或其他平台；更多负载、语法解析和结构检查的成本仍需后续处理。

最终 **882 passed / 0 failed / 0 ignored**（699 库 + 183 集成，24 目标），既有 **62 项原生协议**继续通过；新增 4 库测试，没有重复增加原生测试数。严格 Clippy/fmt、完整 npm build、**2778 文件**检查、parser **32 模块 / 232 方法**及共享方言 **7 模块 / 83 函数**边界通过。没有修改生产前端或重复计入前端单元测试。

Windows locked/offline release 正常 prepare，**18,188,800 B / SHA-256 `9d8c99590071b07a83290929e29ddba9ccb2ff9e3932c73ed8e12b2a10c32492`**，来源 **235 文件 / `405bd6e1cf2fb31653590d56bcc7d454b1e95d649b8adecb9c5e50ea4121b1c9`**，基于未提交工作树 `8c80923dc9e8e756e46eb21ce9f6e04d7a2f4735`。精确捆绑字节 **62 项**协议通过，debug 产物恢复；应用集成 **13 passed**，随后恢复无 Desktop CLI `oxide-agent 0.1.18`。

源码包 **260 文件 / 221 Rust 源码 / 15 项额外输入匹配**，**2,673,618 B / SHA-256 `2a48845357ad2155557487a996a95df96f1089f1e8dbe0c87960d11a53068d0b`**。既有 tests 目录排除不变，协议测试在工作树执行；package --no-verify，未独立解包构建。锁文件原始 CRLF/LF 不同、规范化文本/TOML 相同。grammar 未改/再生成；六份原产物摘要、12 指纹、上游 patch 和 ABI 14 复验一致；没有新依赖。

正常 runner 再生成场景 bundle 并编译真实 Wry/WebView 宿主，经 Monaco、生产 LspClient/Tauri 命令，共 **32 场景 / 637 断言**通过。新场景接收 **4097** 条真实警告，最后一条 UTF-16 结束范围匹配完整模型；实际插入一个 WHERE 后为 **4096** 条，移除该 WHERE 恢复 **4097** 条，两次真实 Monaco 编辑均校验末尾范围与更新版本。证据 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-nAqzcW`，宿主 SHA-256 `a2ae93593c471989cd8bf6c90297f2c97a9c5ddaf272953302eb4328cd37811a`；这是大载荷和编辑正确性验收，未测桌面延迟，也不是完整 React Workbench、安装版或可见推荐弹窗验收。

DBX 干净固定参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch/运行同夹具；[model](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) / [completion](../sources/dbx/apps/desktop/src/lib/sql/semantic/completion.ts) 对照结论延续上一批，没有宣称两个桌面性能或效果相同。

仍待：分组 JOIN/NATURAL 的完整语法及连接树、USING 完整输出类型/可空性、统一语义/类型/控制流图、所有 LATERAL/APPLY 与恢复/预算/collation/会话边界；完整 Workbench/安装版/可见弹窗、更多引擎/版本、Linux/macOS 捆绑、远端 CI，以及更广的性能观测。未提交、推送、发布，**G01–G13、E01–E07 全目标继续进行中**。

## 第三十九批：分组连接输出模型与复杂语义推荐

本批落实推荐列表的复杂语义，而不只识别关键词。初始九项测试 **2 passed / 7 failed**；第一轮语法修复后仍有六项失败，保留 `lsp-joined-tables-red.log` 与 `lsp-joined-tables-after-grammar.log`。已修复的输入包括：

| 场景 | 原问题 | 本批行为与验证 |
| --- | --- | --- |
| 括号/嵌套连接输入及连接后逗号来源 | 连接输入未形成可绑定的节点 | 真实 parenthesized_join 节点，有序 JoinExpr 布局；推荐与 hover 绑定所在输入 |
| `SELECT g.total FROM (users u JOIN orders o USING(id)) g` | 分组别名缺少输出类型 | 输出保留字段顺序与类型；PostgreSQL 外部隐藏内部别名，自己的 ON 不提前看到组别名 |
| `NATURAL LEFT JOIN`、`USING(id)` | 合并键重复候选、星号输出不一致 | 单个合并键，已知 PostgreSQL 数值类型提升、连接侧的可空性；CTE 和限定星号复用相同结果 |
| 嵌套组中的 USING 与外部逗号来源 | 不能用全局去重表达连接输出 | 只合并当前连接的键；不相关输入的同名列仍产生歧义 |
| CTE、标量子查询、CASE、窗口及 UNION 分支 | 组输出不能向复杂投影传递，来源可能串分支 | 星号/字段传入现有表达式推断；每个集合分支选择自己的 FROM |
| 尚未写完的 `g. FROM (...)` | 被错误恢复成 `g.FROM(...)` 调用，列表为空 | 仅补全请求隐藏悬空点，字节位置不变；一次请求解析，不污染原 SQL 的诊断和规范树缓存 |
| Unicode、同文档元数据刷新 | 推荐、hover 与接受编辑必须一致 | 中文组别名、64 个 emoji/CRLF 的真实 textEdit、无 SQL 编辑的类型刷新均验证 |
| 未知局部输入、缺失/重复 USING 键、重复组字段、超预算 | 不应猜测同名物理表或部分星号 | 未知输出保守降级；不提供有歧义的组限定字段类型；深层预算不回落目录 |

新增 **25 库测试 + 2 原生协议测试**；最终 **909 passed / 0 failed / 0 ignored**，其中 724 库、185 集成，共 24 个目标。64 项原生协议包含在集成数中，不另加到 909。新专项库覆盖输出顺序、类型、空值、目录不被修改、别名列名单/错误宽度、隐藏列、未知局部来源、实际补全/hover/刷新/复杂投影；不是把语法解析成功等同于数据库执行正确。

实现分为 [parser join_model](../vendor/sql-lsp/src/parser/sql/join_model.rs)、[共享 joined 行绑定](../vendor/sql-lsp/src/dialects/common/joined.rs)、[ColumnScopes](../vendor/sql-lsp/src/dialects/common/scope_columns.rs) 和 [投影输入](../vendor/sql-lsp/src/server/local_relations/projection.rs)。物理表通过 Cow 借用，分组及空值扩展才拥有行；请求内复用已解析的作用域绑定，hover 只复制表名和目标列。语义布局共用当前树；只有上述输入中间态使用补全专用的保长恢复树，验证仍用原文。没有新增数据库依赖或跨请求候选缓存。

布局构造限制为 **256 个输入/组、32 个构造层级、4096 个输出列**；未知宽度不发布部分星号。补全的悬空点恢复限制后缀 **64 KiB**，并检查原文位置属于代码，字符串/注释不会进入恢复。以上是具体路径的预算，不是所有 LSP 工作量的统一上限。

SQLite 3.45.3 的内存数据库另执行 **13 条 SQL** 核对准备阶段的字段可见性，包括分组别名仍可访问内部别名、内部 INNER ON 的后续输入、分组别名屏障、OUTER 限制及非法 NATURAL/USING。源与结果为 `lsp-joined-tables-sqlite-engine.py` / `lsp-joined-tables-sqlite-engine-evidence.json`；不据此认证其他引擎或所有类型。SQL Server/Hive 拒绝 USING，SQL Server/Hive/ClickHouse 拒绝 NATURAL，原始方言错误保持可见。依据 [PostgreSQL 表表达式](https://www.postgresql.org/docs/current/queries-table-expressions.html)、[MySQL JOIN](https://dev.mysql.com/doc/refman/8.4/en/join.html)、[SQL Server FROM](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql?view=sql-server-ver17)、[Hive JOIN](https://hive.apache.org/docs/latest/language/languagemanual-joins/) 和 [ClickHouse JOIN](https://clickhouse.com/docs/reference/statements/select/join) 区分规则；共享容错语法仍不能代表所有厂商接受该语句。

固定 DBX 源码的 [model.ts](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 将 NATURAL 列为连接修饰词，[completion.spec.ts](../sources/dbx/apps/desktop/src/lib/__tests__/sql/semantic/completion.spec.ts) 有连接后逗号来源与自连接候选测试。本批据此核对输入/候选目标，并补自己的反例与类型测试；没有用静态源码识别宣称 DBX 已有或没有全部合并键推断，也**没有完成同夹具 DBX/Oxide 运行效果比较**。

Windows 实际捆绑 release `11d46dd4d222300ffb3c5855cefe8c78985a87ff3cbc06e325bd00c3fe5d9c79` 通过 **64 项精确字节协议**、应用侧 **13 项**和真实 WebView/Monaco **33 场景 / 691 断言**。新增桌面场景实际取推荐、在 Monaco 中接受普通/未完成组成员和合并键、检查原文错误消失、检查组别名隔离与 CTE 星号，并在 SQL 不变时刷新候选/hover 类型。原有 4097 条诊断编辑场景继续通过。验收目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-eETcyG`；仍是测试宿主，未验证可见建议弹窗、完整 React Workbench、安装版和其他平台。

严格 Clippy、fmt、完整 npm build、前端生产导入图与 parser **33 模块 / 237 方法**、共享方言 **8 模块 / 90 函数**边界通过。语法仍来自固定发布源补丁，tree-sitter-cli 0.26.3 / ABI 14；独立目录重新生成的六文件逐字节一致，12 项文本指纹与补丁校验通过。本次真实修改生成表，不再沿用上批“生成文件未变”的证据。

源码指纹 **240 文件 / `d59c470a74ff7a639aad529e6ac7ab1671fcc2449060247289e95486b8d8f60c`**。源码包 **265 文件 / 226 Rust src / 2,701,278 B**，SHA-256 `863b99fd02be10db7d8e53eb444a4ba7eeb2fe66bfeac6afe1418200d0aa741f`；全部 src 和 15 项其他输入逐字节匹配，打包与本地锁的规范化文本/TOML 一致，原始锁因 CRLF/LF 不同。顶层 tests 仍由既定 package exclude 排除；没有另做解包后的独立构建。Desktop 验收后恢复无 Desktop CLI，`oxide-agent 0.1.18` 通过。

在没有自有编译/验收进程时，对上一 release `9d8c99590071b07a83290929e29ddba9ccb2ff9e3932c73ed8e12b2a10c32492` 与本批逐请求交替采样；普通项 50 请求/8 预热，大诊断 10/2。七个未改语义的控制项完整 JSON 相同；三个新语义项要求新的实际候选，响应有意不同，不能把原来空列表的较低开销当作可比功能性能：

| 请求 | 内容口径 | p50 前 → 后，ms | p95 前 → 后，ms |
| --- | --- | --- | --- |
| group-alias-recommendation | 修复候选，响应改变 | 0.34 → 0.33 | 0.52 → 0.49 |
| unfinished-group-recommendation | 修复候选，响应改变 | 0.34 → 0.40 | 0.68 → 0.55 |
| natural-key-recommendation | 修复候选，响应改变 | 0.55 → 0.52 | 0.69 → 0.64 |
| qualified-select | 相同完整响应 | 0.25 → 0.27 | 0.37 → 0.42 |
| 4097-real-warning-ranges | 相同完整响应 | 122.28 → 121.38 | 155.27 → 154.77 |
| literal-semicolon-real-where | 相同完整响应 | 0.17 → 0.15 | 0.22 → 0.19 |
| nested-where-outer-mutation | 相同完整响应 | 0.20 → 0.19 | 0.31 → 0.27 |
| plain-join-code-action | 相同完整响应 | 0.41 → 0.42 | 0.54 → 0.58 |
| self-join-column-ambiguity | 相同完整响应 | 0.21 → 0.22 | 0.28 → 0.28 |
| on-current-operands-qualification | 相同完整响应 | 0.38 → 0.40 | 0.46 → 0.49 |

本批语法生成 C 表 **37,640,556 → 37,808,187 B**，release 二进制 **18,188,800 → 18,475,008 B**；覆盖增加有真实体积成本，未测 RSS/冷启动，不据此推断内存或加载性能。

原始观测为 `lsp-joined-tables-performance.json`。这是单组本机 warm stdio 数据，不证明整体提速或回退，也未测桌面 p95、冷启动、RSS、连续编辑与所有厂商负载。增加语义覆盖的成本及更大的多表/宽列工作量仍需要进一步观测。

**仍需补齐：**分组与 LATERAL/APPLY 的完整关联边、所有错误恢复/预算组合；完整 PostgreSQL 隐式类型、MySQL/SQLite/ClickHouse 不同类型键和会话/collation 规则；更多引擎合法语法及组别名/名单限制、ClickHouse 特有连接和 join_use_nulls；组重复限定列诊断、计算输出的定义导航；可见弹窗/完整 Workbench/安装版、同夹具 DBX 运行比较、跨平台与真实厂商验证。兼容别名仍非独立方言认证。本批未 fetch、改变 DBX 引用、提交、推送或发布，**G01–G13、E01–E07 全目标保持进行中**。

## 第四十批：分组 LATERAL/APPLY 关联输入与输出类型

本轮日期 **2026-10-24**，承接第 39 批。最初八项专项 **4 passed / 4 failed**：已闭合连接组位于 LATERAL/APPLY 左侧后，截断文本丢失分组来源与别名，限定字段列表为空，推入 CTE 的输出类型变成 unknown。改为从当前原文树的 JoinExpr 定位 LATERAL/APPLY 的来源，沿祖先连接收集合法的已出现左输入，保持前序来源顺序和连接输出，不另做解析、不构造伪造 SQL 或目录表。

| 已补齐场景 | 推荐和类型结果 |
| --- | --- |
| `(users JOIN orders USING(id)) g CROSS JOIN LATERAL(SELECT g.total)` | 已闭合组别名提供 decimal 字段与 hover；内部别名仍被隐藏 |
| 未取别名的左连接组 + PostgreSQL/MySQL LATERAL、SQL Server CROSS/OUTER APPLY | 原物理输入及先前派生输入保留类型，未来来源及自身组别名不泄漏 |
| 组内 LATERAL 引用合法的祖先连接左来源/先前 FROM 项 | 前序可见来源来自结构，未把 ON 的逗号规则错误套到 LATERAL |
| `d.*`、CTE、后续 LATERAL 依赖前一派生结果 | 复用同一关联行绑定，decimal 等类型不再丢失 |
| 未取别名的 LATERAL 子查询、组列别名、中文/emoji 别名 | 匿名局部来源与真实空输入分开；不查找空目录名；有效前序来源继续可见 |
| 外层 USING 合并键 | 推荐一个合并键及其共同类型，不重复提供两侧原始字段代替合并输出 |
| 括号组中的派生输出、CROSS/OUTER APPLY 的字面量输出 | 发现来源只隔离真实查询括号；OUTER APPLY 的原文 token 补足空值扩展 |
| 无 SQL 修改的 schema 刷新与 Unicode 实际编辑 | 每次请求重绑类型，原目录表未被查询局部对象污染；64 emoji/CRLF 编辑范围实测 |

扩展测试还复现合并键重复和组内 APPLY 输出不可见。共享来源可见性修改的首轮全量 **736 passed / 2 failed**，原有 CTE 隔离测试发现：扫描点位于 WITH 自身之前，尚未将括号认成查询。改为将该完整查询 token 纳入分类；保留原有测试，新增查询开头、组括号与外层边界断言，再完整重跑通过。`lsp-lateral-groups-red.log`、`expanded-red.log` 和 `all-targets-red.log` 均保留。

新增 **14 库测试 + 2 原生协议测试**，最终 **925 passed / 0 failed / 0 ignored**，24 个目标，738 库 + 187 集成。66 项协议包含在集成数中；另把实际捆绑 release 的精确字节放到同一协议入口独立复验 **66 passed**，随后恢复原 Cargo debug 产物。应用集成 **13 项**、真实 WebView/Monaco **34 场景 / 743 断言**通过。新增桌面场景实际接受组字段、CTE 输出和外层合并键，检查隐藏别名、CROSS/OUTER 的空值 hover 和同 SQL 类型刷新。验收目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-rtzn1Z`；仍非安装版、可见建议弹窗或完整 React Workbench 认证。

实现集中于 [correlation](../vendor/sql-lsp/src/parser/sql/correlation.rs)、[join_model](../vendor/sql-lsp/src/parser/sql/join_model.rs)、[query_scopes](../vendor/sql-lsp/src/parser/sql/query_scopes.rs) 和共享行绑定/候选生成；[专项测试](../vendor/sql-lsp/src/server/tests/complex_semantics/lateral_groups.rs) 走完整 LanguageServer，另有 [原生协议](../vendor/sql-lsp/tests/integration_test_client/lateral_groups.rs)。Empty 表达合法的零个前序输入，Unknown 保持预算失败的保守屏障；既有 32 层关联/构造与 256 来源布局预算继续使用。CROSS/OUTER APPLY 的保长适配保留原文，判断 OUTER 时读取完整 APPLY 范围，避免把四字节 JOIN token 当作五字节 APPLY。

规则参考 [PostgreSQL LATERAL](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL)、[MySQL lateral derived tables](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html)、[SQL Server APPLY](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql?view=sql-server-ver17)。本批使用合成 schema 验证 LSP；**没有新增真实 PostgreSQL/MySQL/SQL Server 引擎执行认证**。DBX 固定 [model.ts](../sources/dbx/apps/desktop/src/lib/sql/semantic/model.ts) 含 APPLY 来源与 LATERAL 修饰词识别；这只证明对照源码的相关路径存在，不证明同夹具下的推荐/类型效果。仍未完成 DBX 与 Oxide 的同夹具运行比较。

Windows release SHA-256 `ef856916a9a0d5d5e9b1354f81a9bc6d4cdec11dfa1a7b20a0edaa653b6e19f0`；源码指纹 **241 文件 / `c5eb44e78e10cdfefee1d2ff830722aee718ee0dec234de4a19a03a91fee68b8`**。源码包 **266 文件 / 227 Rust src / 2,703,604 B**，SHA-256 `7c513292930c3468c59ac3dcc1722ff21ff143166913476329cac11948e6cdd6`。全部 src 与 15 项其他输入匹配，锁的规范化文本/TOML 一致，原始锁仍仅 CRLF/LF 不同；顶层 tests 沿用 package exclude，未另做解包独立构建。严格 Clippy/fmt、完整前端 build、parser **33 模块 / 239 方法**和共享方言 **8 模块 / 90 函数**边界通过；语法与六份生成文件未改，逐项核对第 39 批的确定性重生成摘要及现有 12 指纹/上游补丁。没有新增依赖。Desktop 复验后恢复 `oxide-agent 0.1.18` 无 Desktop CLI。

在自有编译/验收进程均结束后，前一 release 与当前 release 逐请求交替测量 warm stdio，普通项 50 请求/8 预热，大诊断 10/2。七项控制的完整 JSON 相同；三项关联功能要求修复后的字段/类型，响应改变，不能把空/错误候选更便宜当作可比功能收益：

| 请求 | 返回内容口径 | p50 前 → 后，ms | p95 前 → 后，ms |
| --- | --- | --- | --- |
| grouped-lateral-member | 修复语义，响应改变 | 0.33 → 0.37 | 0.41 → 0.46 |
| grouped-lateral-cte-output | 修复语义，响应改变 | 0.60 → 0.63 | 0.73 → 0.72 |
| grouped-lateral-merged-key | 修复语义，响应改变 | 0.38 → 0.49 | 0.48 → 0.59 |
| qualified-select | 完整 JSON 相同 | 0.17 → 0.16 | 0.31 → 0.28 |
| 4097-real-warning-ranges | 完整 JSON 相同 | 90.41 → 87.00 | 97.13 → 94.99 |
| literal-semicolon-real-where | 完整 JSON 相同 | 0.08 → 0.08 | 0.13 → 0.12 |
| nested-where-outer-mutation | 完整 JSON 相同 | 0.15 → 0.16 | 0.23 → 0.23 |
| plain-join-code-action | 完整 JSON 相同 | 0.31 → 0.32 | 0.43 → 0.41 |
| self-join-column-ambiguity | 完整 JSON 相同 | 0.16 → 0.16 | 0.22 → 0.23 |
| on-current-operands-qualification | 完整 JSON 相同 | 0.32 → 0.32 | 0.41 → 0.38 |

原始样本为 `lsp-lateral-groups-performance.json`，是单组本机 warm stdio，不是桌面延迟、冷启动、RSS、连续编辑或所有负载结论。

**剩余差距：**完整的多层关联图和错误恢复/预算组合、FROM/逗号 LATERAL 及厂商特有方向/版本规则、隐式横向表值函数；完整类型强制转换/会话/collation、组名单与标识符限制；计算输出的定义导航与重复限定字段诊断；可见弹窗/完整 Workbench/安装包、同夹具 DBX 实测、跨平台和厂商引擎/性能验收。第 39 批列出的其他限制继续有效。未 fetch、修改 DBX 引用、提交、推送或发布，**G01–G13、E01–E07 全目标保持进行中**。

## 第四十一批：DBX 同夹具推荐算法运行比较

日期：2026-10-24。完成前批待办中的同夹具推荐算法比较。入口为 [compare-dbx-completion.mjs](../scripts/compare-dbx-completion.mjs)，独立阶段在 [sql-comparison](../scripts/sql-comparison/)；完整逐项结果见 [专项报告](dbx-sql-completion-comparison-2026-10-24.md)。本批只增加比较脚本和证据文档，未修改 Rust 实现、DBX 工作树或捆绑程序。

### 输入、入口与依赖证据

共 **53 组 SQL/schema/UTF-16 光标夹具**，四张合成表，每组调用当前捆绑 stdio LSP、DBX 字符串和真实 CodeMirror EditorState 两条路径，共 159 次推荐计算。覆盖 PostgreSQL、MySQL、SQL Server、SQLite、Hive、ClickHouse、Manticore Search 场景，包括 CTE/递归、全文/JSON、表值函数、窗口/CASE/标量表达式、分组/关联连接、隐式合并键、作用域反例、引号/Unicode、未闭合语句、注释/字符串抑制及元数据搜索。它是定向矩阵，不是方言支持率抽样。

使用实际 `analyzeSqlCompletion`、生产抑制条件、语义模型和候选构造函数；查询局部列元数据沿用 DBX 现有语义测试的映射方式，物理列的类型/空值/注释来自同一份数据。没有伪造解析器或替换参考源模块。EditorState 使用真实 DBX CodeMirror SQL 方言工厂，53 组均有光标处语法树；六个基础字段控制在三条路径均符合预期。记录全部候选、上下文、行来源、诊断和编辑事务，并确认元数据未被修改、没有后端 fetch。

参考源码固定 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a` 且干净。运行依赖隔离在 `.impeccable/review/dbx-runtime-comparison/`，从 DBX pnpm 锁约束版本和逐父包依赖边；npm peer 自动解析冲突后关闭该解析，再审计实际打包依赖。最终 **44 包 / 104 条依赖边 / 332 份输入**的版本、路径和完整性摘要符合参考锁，无当前项目其他 node_modules 的运行依赖回落。首次关闭协议参数错误、补充真实生产抑制前的试验及后续通过结果分别保留。

### 结果与待修复项

| 检查维度 | Oxide | DBX EditorState 入口 |
| --- | --- | --- |
| 正向字段/变量候选存在 | 42/46 | 35/46 |
| 预期类型可见 | 42/44 | 18/44 |
| 来源隔离与字符串/注释抑制 | 7/7 | 3/7 |

名称、类型和隔离独立计数，不合并为产品总分。许多 DBX CTE/递归/变量候选名称存在，但本次入口未携带预期类型；该入口对局部列的 `dataType: undefined` 路径与此一致，不外推为完整应用都不能推断。当前 Oxide 的四处失败保留为明确待办：

| 优先级 | 夹具 | 缺口 | 同入口 DBX 结果 |
| --- | --- | --- | --- |
| P0 | clickhouse-qualify | QUALIFY 中不可推荐 SELECT 窗口别名 rn | 亦缺 rn |
| P0 | hive-lateral-view | 不可推荐 explode 的声明输出 item | 亦缺 item |
| P1 | metadata-pinyin | zj 不匹配“租金总额” | 可推荐 |
| P1 | metadata-comment | rev 不匹配注释含 Revenue 的 amount | 可推荐 |

还用真实编辑帮助函数和无 DOM EditorState 事务检查接受结果，观察到 DBX 前缀范围保留部分光标后缀的情形。实际弹窗的 from/to、过滤和接受链未运行，不能把这个辅助入口结果视为完整产品错误；两个 Oxide ASCII 可选引号被去掉的样例也单独记录，不将文本风格变化等同于候选失败。原始耗时的 Node 进程内/stdio IPC 口径不同，本轮不作横向性能结论。

### 复跑与验收边界

首次执行 `node scripts/compare-dbx-completion.mjs --install`；已有隔离依赖时执行 `node scripts/compare-dbx-completion.mjs`。需要现有项目 Node 依赖、固定参考源码和已验证的捆绑 LSP；参考适配器使用独立 `.mts` 入口由 esbuild 构建，不将 DBX 的 Vue 依赖并入应用 TypeScript 图。安装及不安装路径都已运行；最后重跑保持同一 53 组结果。证据包括 `fixtures.json`、`results.json`、`summary.json`、`dependency-evidence.json`、`metafile.json` 和 `evidence.json`。

捆绑 SHA-256 仍为 `ef856916a9a0d5d5e9b1354f81a9bc6d4cdec11dfa1a7b20a0edaa653b6e19f0`，运行输入指纹仍为 `c5eb44e78e10cdfefee1d2ff830722aee718ee0dec234de4a19a03a91fee68b8`；前批 925 项 LSP、66 协议、13 应用及 34 场景/743 桌面断言未重跑，本轮没有新增 Rust 单元测试。新脚本语法、完整前端构建/模块边界和捆绑摘要核验结果见本批证据。

下一步先补 QUALIFY、LATERAL VIEW 的语法/绑定/类型正反矩阵，再补拼音与注释匹配的排序、来源隔离、刷新和预算。完整类型/会话/定义模型、所有方言/版本和错误恢复、异步元数据/缓存、可见弹窗/完整 Workbench/安装包、跨平台、真实数据库执行以及冷启动/RSS/桌面性能仍待验收。未 fetch、提交、推送或发布；**G01–G13、E01–E07 全目标保持进行中**。

## 第四十二批：ClickHouse QUALIFY 输出别名与窗口类型

日期：2026-10-24。本批修复第 41 批实际运行比较中复现的 QUALIFY 缺口，覆盖字段候选、类型、作用域、编辑范围和生产客户端链路。参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。全部 G01–G13、E01–E07 目标保持进行中。

### 语法、绑定与模块

[共享语法](../vendor/sql-lsp/grammars/sql/grammar.js) 增加 WINDOW 后、ORDER BY 前的 `qualify` 谓词节点。[查询范围模块](../vendor/sql-lsp/src/parser/sql/qualify.rs) 复用既有查询/噪声掩码，定位光标所属的 SELECT 和集合分支，保留原始 UTF-8 范围；缺少谓词、未闭合括号和后缀中间光标仍能恢复。支持 QUALI 前缀入口及已完成条件后的 AND/OR/ORDER BY/LIMIT，修正 WHERE/QUALIFY 中 `AND (` 被当作已完成谓词的情况。没有给所有 SQL provider 增加一个通用的 QUALIFY 语义枚举。

[输出绑定](../vendor/sql-lsp/src/server/local_relations/qualify.rs) 验证语法树中的真实关键字，复用现有投影/CTE/派生查询与例程推断，仅把当前 SELECT 输出作为 QUALIFY 表达式候选。它不向同步 schema 或任何物理表安装别名，不让 `o.rn` 变成表列，也不从其他查询块、集合分支或语句导入输出别名。重复输出名不发布猜测绑定；输入列和输出别名重名且类型不同，在未知 `prefer_column_name_to_alias` 设置时保留 unknown。

[窗口类型推断](../vendor/sql-lsp/src/server/local_relations/expression_types.rs) 对 ClickHouse 的 row_number/rank/dense_rank/denseRank 和零/单参数 count 返回 UInt64，保持 PostgreSQL 的 bigint 路径。denseRank 别名按文档区分大小写；错误大小写、命名空间限定、错误参数数量和未知函数不借用这些内置返回类型，live UDF 身份仍先按原规则解析。类型可穿过 CTE、推荐及已有 CTE 字段 hover；QUALIFY 内直接别名的 hover/定义尚未接入同一绑定。

[文档诊断](../vendor/sql-lsp/src/server/diagnostics/qualify.rs) 在实际配置 profile 下验证：非支持 profile 报 UNSUPPORTED_DIALECT_SYNTAX；ClickHouse 在同一 SELECT 的输出或 QUALIFY 中都没有窗口函数时报告 QUALIFY_REQUIRES_WINDOW。子查询/CTE 内的窗口不满足外层要求，只有 QUALIFY 中额外窗口的查询仍合法。这个规则位于 LSP 文档诊断链，原始共享 SqlParser 仍是语法超集，不宣称直接 Dialect API 或所有厂商语义已完整验证。

规则核对 [ClickHouse QUALIFY](https://clickhouse.com/docs/reference/statements/select/qualify)、[row_number](https://clickhouse.com/docs/reference/functions/window-functions/row_number)、[rank](https://clickhouse.com/docs/reference/functions/window-functions/rank)、[dense_rank](https://clickhouse.com/docs/reference/functions/window-functions/dense_rank)、[count 源码注册](https://github.com/ClickHouse/ClickHouse/blob/master/src/AggregateFunctions/AggregateFunctionCount.cpp) 和 [标识符/别名](https://clickhouse.com/docs/reference/syntax)。没有把文档核对等同于真实 ClickHouse 版本执行。

### 复杂语句、反例与实际链路

新增 **16 个库测试 + 2 个原生进程测试**。库覆盖窗口排名/count/denseRank、CTE + JOIN + 命名 WINDOW、独立内层/外层与 UNION/分号隔离、限定成员反例、引号中的点/中文、字符串/注释抑制、无 catalog、原文不变 schema 刷新、重复/同名输出、未知/错误函数、关键字入口和完整字段替换，以及语法错误与预算。源码见 [推荐回归](../vendor/sql-lsp/src/server/tests/complex_semantics/qualify.rs)、[解析器回归](../vendor/sql-lsp/src/parser/sql/tests/qualify.rs) 和 [原生协议](../vendor/sql-lsp/tests/integration_test_client/qualify.rs)。

首次 6 个推荐测试有 5 项失败，保存在 `lsp-qualify-red.log`。后续一项未闭合 AND 括号失败促成谓词上下文修复。全量初跑还核对两条预期：旧的 ClickHouse COUNT(*) unknown 断言按已实现 UInt64 更新，其他未知方言/UDF 反例保留；未完成 `rn=` 的测试改为检查原始树含错误，沿用已有尾部编辑诊断抑制策略，未改变生产过滤规则。原生测试另纠正未加引号的中文声明别名：ClickHouse 非引号标识符要求 ASCII，改用合法反引号声明并维持 UInt64 和范围断言，没有放宽语法去接纳无效夹具。失败日志与修正后全量日志分别保留。

两个新原生测试实际打开 **15 份文档**：8 份窗口/CTE/命名窗口/引号/内层作用域查询逐项接受完整 TextEdit 并 didChange，验证发布诊断；另 1 份保持 SQL 不变，按 decimal/UInt32/String 刷新类型；6 份负例核对 profile、同层窗口条件和原始 UTF-16 诊断范围。带 emoji/中文/CRLF，并用 postgres.sql URI 验证配置的 ClickHouse 优先。最终全量 **943 passed / 0 failed / 0 ignored**，为 **754 库 + 189 集成 / 24 目标**；Clippy `--all-targets -- -D warnings` 和 fmt check 通过。

最终 release 的精确捆绑字节通过 **68 项原生协议测试**，临时替换的 Cargo 调试工件已恢复；应用 `lsp_integration` **13 项**通过。[真实 WebView](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) 扩展为 **36 场景 / 836 断言**，实际使用生产 LspClient、Monaco 转换器与 Tauri 命令，接受窗口别名/中文字段，验证 CTE 类型/hover、同 SQL 元数据刷新、切换 PostgreSQL 后拒绝/移除绑定及切回恢复。最终证据在 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-8hyhQs/`。这是隐藏 WebView 的真实客户端链路，未运行可见建议控件、完整 Workbench 或安装包。

### 性能、预算与来源

QUALIFY 路径限 **512 KiB 输入 / 32768 子句 token**，复用既有查询深度和分支预算。按名称集中收集已有类型和合并候选，避免每列都扫描/删除已有列表；每次最多发出 **256 个匹配输出候选**，更多匹配通过 CompletionList.isIncomplete 告知客户端重查。301 个输出的实际 LanguageServer 测试验证空/公共前缀截断、末尾精确名称优先，以及更长前缀能取回单一字段并取消 incomplete。未增加持久候选缓存；这不是整个 LSP、物理元数据或全局 RSS 的统一预算。

对前批捆绑程序和最终程序作交替 warm stdio 观测，普通项各 50 次，大诊断各 10 次；以下为同一次本机样本的 p50/p95（ms）。前三项语义发生变化，前版没有相同的可用 QUALIFY 输出，不能视为等价负载加速证明；其余七种场景的末次完整响应 JSON 一致。

| 场景 | p50 前 → 后 | p95 前 → 后 |
| --- | --- | --- |
| QUALIFY 窗口输出 | 0.37 → 0.37 | 0.48 → 0.48 |
| QUALIFY CTE 复杂投影 | 0.81 → 0.68 | 0.96 → 0.81 |
| QUALIFY 128 KiB 注释 | 71.25 → 56.81 | 75.58 → 60.26 |
| 普通限定字段 | 0.15 → 0.16 | 0.24 → 0.25 |
| 4097 个真实警告范围 | 84.82 → 85.55 | 90.26 → 88.99 |
| 字符串分号 + 真实 WHERE | 0.08 → 0.08 | 0.14 → 0.14 |
| 嵌套 WHERE 与外层修改 | 0.09 → 0.10 | 0.12 → 0.11 |
| JOIN codeAction | 0.22 → 0.22 | 0.29 → 0.27 |
| 自连接重复列诊断 | 0.11 → 0.11 | 0.16 → 0.20 |
| ON 输入限定修复 | 0.20 → 0.22 | 0.32 → 0.31 |

原始样本在 `lsp-qualify-performance.json`，不证明冷启动、RSS、连续编辑、远程数据库或完整桌面延迟。完整前端 build/模块边界通过（2789 文件；parser 34 模块/241 方法，common 8 模块/90 函数）。固定 tree-sitter-cli 0.26.3、ABI 14，独立再生成的六份输出原始字节一致，累计上游 patch 和 12 项源码摘要已核验。

最终捆绑 SHA-256 **`7918622a628e79099c9a141e05e308c297f1f0309c93508dbe094523a7baa39f`**；运行输入 **246 文件 / `c56e3b3cb2bf62010ce1d6092165375feed154478c8fcaba328e36e3a2bfea8e`**。源码包 `lsp-qualify-source-package.crate` 为 **271 文件 / 232 Rust 源码 / 2,747,783 B**，摘要 **`8cb6942248ac6e110a08f0ab1acac34c9370fbc9c1d65df4d04f4b123102666e`**；全部 src 和 15 项附加输入匹配。锁文件仅原始 CRLF/LF 字节不同，规范化文本/TOML 相同；未做独立解包构建，顶层协议测试仍按既有发布规则排除。与前批源码包比较只新增五个预期模块，未删除文件。Desktop 验收后以禁止执行的 PROTOC 完成无默认 feature 的 CLI 重建，`oxide-agent --version` 已恢复为 0.1.18。

### DBX 复测与剩余范围

53 组 SQL/schema/UTF-16 输入摘要仍为 `454d25fb80a1679ea3b33079cf7ef0c1f0f44375ec022130c4f7faaeb7bf6dd6`，DBX 运行 bundle 未变。实际原矩阵重跑后，Oxide 字段/变量候选 **43/46**、原有类型维度 **42/44**、隔离/抑制 **7/7**；DBX EditorState 仍为 **35/46、18/44、3/7**。QUALIFY 的原断言没有类型条件，本轮另加 UInt64 独立断言，不混入原 44 项类型分母。六个基本控制均通过，DBX 依赖审计仍为 44 包/104 边/332 输入。详见 [更新后的比较报告](dbx-sql-completion-comparison-2026-10-24.md)，不将这些定向计数外推为产品总分。

下一优先项仍是 **Hive LATERAL VIEW 输出/类型与 OUTER/多视图**，再处理 **拼音首字母和注释匹配**。QUALIFY 直接别名 hover/定义、完整窗口表达式/类型和名称设置、其他 QUALIFY 方言、全局请求/元数据预算、版本/会话/collation、所有错误恢复、可见建议控件/Workbench/安装包、跨平台/真实厂商引擎和完整性能仍待补齐。未提交、推送、发布或执行远端 CI，**G01–G13、E01–E07 全目标保持进行中**。

## 第四十三批：Hive LATERAL VIEW 行来源与复杂元素类型

日期：2026-10-24。本批修复固定对照矩阵里的 Hive LATERAL VIEW 缺口，同时补齐输入子句时的推荐入口。参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，未重新 fetch；本地参考与远端最新提交的关系没有在本批重新核对。全部 G01–G13、E01–E07 目标继续进行。

### 实际推荐行为

| 输入/场景 | 当前返回与约束 |
| --- | --- |
| FROM 之后输入 LAT / LATERAL V | Hive 提供 LATERAL VIEW / VIEW 关键字 |
| LATERAL VIEW / LATERAL VIEW OUTER 后输入函数前缀 | 提供 explode、posexplode、inline、json_tuple、parse_url_tuple、stack；前一个入口还提供 OUTER |
| explode(o.tags)，tags 为 array<string> | 显式输出 item 或默认 col 的类型为 string |
| explode(map<string,array<bigint>>) | key 为 string、value 为 array<bigint> |
| posexplode(array<T>) | pos 为 int、val 为 T；显式 AS 名称按顺序绑定 |
| inline(array<struct<code:string,amount:decimal(18,2)>>) | 按 Struct 字段顺序提供 code / amount 及其类型 |
| json_tuple / parse_url_tuple | 保留多个 string 输出及显式名称；不执行函数求值 |
| stack 的正整数字面量行数 | 按行数拆分 col0… 的结构和同类型结果；不兼容/未知值保持 unknown |
| OUTER | 新生成字段均可空，包括 posexplode 的位置列 |
| 多个 LATERAL VIEW | 后一视图仅能使用前面的输入，不能反向引用或引用自己 |
| CTE/派生表/限定与非限定星号 | 将同一绑定结构传到外层补全与 hover |
| 自定义、带命名空间或带引号的未知 UDTF | 不借用同名内置函数的返回类型；显式 AS 字段保留 unknown |

例如，元数据 `orders.grid` 为 `array<array<decimal(18,2)>>` 时，以下 `b.` 推荐 `amount / decimal(18,2)`，其来源经过两次展开；`a.` 仍是 `nested_col / array<decimal(18,2)>`：

```sql
SELECT b.
FROM orders o
LATERAL VIEW explode(o.grid) a AS nested_col
LATERAL VIEW explode(a.nested_col) b AS amount;
```

规则根据 [Hive LATERAL VIEW 官方语义](https://hive.apache.org/docs/latest/language/languagemanual-lateralview/) 与 [内置 UDTF 说明](https://hive.apache.org/docs/latest/language/languagemanual-udf/) 核对；没有连接真实 Hive 引擎执行这些 SQL，也没有宣称覆盖所有 Hive 版本。

### 模块、作用域与预算

[语法](../vendor/sql-lsp/grammars/sql/grammar.js) 将视图附着到真实 relation，可连续出现并属于相应 JOIN 输入。[AST 提取](../vendor/sql-lsp/src/parser/sql/lateral_views.rs) 只提取完整节点及原始范围；[查询/连接模型](../vendor/sql-lsp/src/parser/sql/join_model.rs) 将它们按源顺序加入已有行来源，参数光标只能看到前置输入。FROM/集合分支、嵌套查询与后续语句不共享视图输出。文本物理表提取排除 LATERAL VIEW 的 VIEW 词，避免把函数名当作 catalog 表。

[绑定模块](../vendor/sql-lsp/src/server/local_relations/lateral_views.rs) 复用既有 ProjectionSources、表达式/元数据例程推断和本地表安装；[复杂类型解析](../vendor/sql-lsp/src/server/local_relations/hive_types.rs) 单独处理 Array/Map/Struct、decimal 逗号及有界嵌套。[构造器](../vendor/sql-lsp/src/server/local_relations/expression_types/hive.rs) 支持 array/map/struct/named_struct；未知子值保留已知容器/字段结构，元素类型保持 unknown。相同类型和 NULL 分支、CASE/CAST 与同类型集合投影能继续传播；没有增加全套隐式转换规则。[入口推荐](../vendor/sql-lsp/src/dialects/hive/lateral_views.rs) 独立于行推断，仅处理尚未进入参数的子句片段，遇到引号/注释/成员访问等情况保守退出。

输入扫描最多 **512 KiB**；AST 遍历最多 **32768 节点 / 64 个视图**，预算用尽不返回部分视图绑定。类型输入最多 **16 KiB / 32 层 / 256 个 Struct 字段**，每个调用最多 256 参数；沿用表达式递归界限。入口识别另限 64 层括号。不存在相关视图时先返回，避免复制 schema/构造掩码。通过 request-local ParsedOrigin 复用精确原文的语法树，避免为每个视图重复解析全文；成员补全恢复树不覆盖 canonical 验证缓存。没有引入长期绑定缓存或声称全局内存预算已经统一。

[profile 诊断](../vendor/sql-lsp/src/server/diagnostics/lateral_views.rs) 在 PostgreSQL/MySQL/SQL Server/SQLite/ClickHouse 文档配置中拒绝 Hive 子句；共享原始语法树仍是超集，不表示所有 Dialect API 具有同一套编译器诊断。新语法会把缺少 ON 的 JOIN 尾部恢复为相邻 ERROR；歧义分析只在同一词法语句内接纳这段恢复范围，保留旧 OXIDE004 断言，并增加跨分号/后续 SELECT 的隔离回归。

### 测试与最终程序

本批新增 **23 项库测试和 2 项原生协议测试**。测试检查真实 LanguageServer 返回的候选、类型、hover 和来源，包含 Array/Map/Struct、默认/显式/重复名称、OUTER、链式依赖、CASE+元数据 UDF、构造器未知值、CTE/派生表/星号/集合分支、右 JOIN、空元数据、刷新、带引号 Unicode 及非 Hive profile。入口测试检查关键词/函数类型，并验证参数位置仍返回真实字段。源码见 [复杂语义回归](../vendor/sql-lsp/src/server/tests/complex_semantics/hive_lateral_views.rs)、[解析器回归](../vendor/sql-lsp/src/parser/sql/tests/lateral_views.rs) 和 [原生协议回归](../vendor/sql-lsp/tests/integration_test_client/hive_lateral_views.rs)。

原生新增测试打开 **16 份文档**：11 份正例接受完整 TextEdit 并 didChange/验证发布诊断；另 1 份保持 SQL 不变刷新三种元素类型，并切换五种非 Hive profile 后恢复；2 份 OUTER 与 2 份前向/自引用负例验证可空性和隔离。初始 8 个推荐失败保存在 `lsp-hive-views-red.log`；编译重导出、生成器窄自冲突、CASE guard、旧缺 ON 诊断恢复、测试元数据 nullable 和严格 Clippy 的修正记录也保留，没有删除旧断言。

最终 **968 passed / 0 failed / 0 ignored**，即 **777 库 + 191 集成 / 24 目标**。严格 Clippy `--all-targets -- -D warnings`、fmt、完整前端 build 与模块门禁通过（2797 文件；parser 35 模块/243 方法，common 8 模块/90 函数）。最终 release 精确字节另通过 **70 项原生协议测试**，Cargo 调试工件已恢复；应用 `lsp_integration` **13 项**通过。

[真实 WebView](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) 的 **38 场景 / 990 断言**通过，使用生产 LspClient、Monaco 转换器与 Tauri 命令，验证字段接受、复杂类型/CTE hover、OUTER、作用域和同 SQL 元数据/方言刷新。最终证据位于 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-Fj8VMC/`；这是隐藏 WebView，未认证可见推荐控件、完整 React Workbench 或安装版。Desktop 后已用禁止执行的 PROTOC 完成无默认 feature 的 CLI 重建，`oxide-agent --version` 恢复为 **0.1.18**。

### 性能、来源和同输入对照

对第 42 批和本批最终捆绑程序交替采集 warm stdio 样本：普通项各 50 次、4097 警告项各 10 次。前三项旧版没有对应字段，语义已变化；其余七种场景核对末次完整响应 JSON 相同。下表为同一次本机样本 p50/p95（ms），不是桌面延迟或整体加速结论。

| 场景 | p50 前 → 后 | p95 前 → 后 |
| --- | --- | --- |
| Hive 单视图成员 | 0.507 → 0.420 | 0.587 → 0.496 |
| Hive CTE 星号 | 1.025 → 0.641 | 1.154 → 0.770 |
| Hive 16 级视图 | 3.026 → 4.178 | 3.281 → 4.594 |
| 普通限定字段 | 0.163 → 0.158 | 0.237 → 0.234 |
| 4097 个真实警告范围 | 91.712 → 88.428 | 95.443 → 93.611 |
| 字符串分号 + 真实 WHERE | 0.131 → 0.130 | 0.173 → 0.167 |
| 嵌套 WHERE 与外层修改 | 0.118 → 0.134 | 0.192 → 0.214 |
| JOIN codeAction | 0.253 → 0.406 | 0.329 → 0.486 |
| 自连接重复列诊断 | 0.176 → 0.174 | 0.224 → 0.222 |
| ON 输入限定修复 | 0.300 → 0.309 | 0.406 → 0.375 |

16 级展开和 JOIN action 的耗时上升保留在报告中；原始样本为 `lsp-hive-views-performance.json`。尚无冷启动、RSS、连续编辑或完整桌面 p95 认证。固定生成器 **tree-sitter-cli 0.26.3 / ABI 14**，独立再生成六文件原始字节一致，上游累计 patch 与 12 项摘要通过。

最终捆绑 SHA-256 **`1300a74a74e562e7f4d96d33b73ca6c2035123b780a58c2edbb1ad21df408971`**；运行输入 **254 文件 / `d4659481c0eac1be5cb1fbde0c49af44c616ee3b387cadaa7fecb49f7cd16895`**。源码包 `lsp-hive-views-source-package.crate` 为 **279 文件 / 240 Rust 源码 / 2,778,742 B**，摘要 **`c848b6aab7e77a7391025dd0a9e09912b121764d8c21b464c60346ff684f20bf`**；全部 src 与 15 项附加输入匹配。相对前批只新增八个预期 Rust 模块，无删除；锁文件原始 CRLF/LF 有差异，规范化文本/TOML 一致。未做独立解包构建；顶层原生测试按既有发布规则排除。汇总证据在 `.impeccable/review/lsp-hive-views-evidence.json`。

原 **53 组 / 159 次推荐计算**复跑，六个控制通过；SQL/schema/UTF-16 输入 SHA 仍为 `454d25fb80a1679ea3b33079cf7ef0c1f0f44375ec022130c4f7faaeb7bf6dd6`，DBX bundle 摘要不变。Oxide 原维度为 **44/46 候选、42/44 类型、7/7 隔离**；DBX EditorState 为 **35/46、18/44、3/7**。原 Hive 夹具的元数据为 text[]，独立新增 item / text 断言；真正 Hive array<string> 另由原生用例验证，没有改动原类型分母。DBX 运行输入仍为 44 包 / 104 边 / 332 文件；详情见 [专项报告](dbx-sql-completion-comparison-2026-10-24.md)。这些是定向用例计数，不是产品总分或完整桌面比较。

下一优先项是 **拼音首字母与列注释搜索** 的候选、排序、来源隔离、刷新和有界性能。自定义 UDTF 元数据、完整转换/构造器转义/签名/定义、Hive 版本/会话与 LATERAL TABLE、QUALIFY 直接别名 hover/定义、全局请求与元数据预算、可见弹窗/Workbench/安装包、跨平台/真实厂商与完整性能继续实施。本批未提交、推送或发布，**G01–G13、E01–E07 全目标保持进行中**。

## 第四十四批：拼音与列注释搜索的绑定和排序

日期：2026-10-24。本批继续修复第 41 批实际比较留下的拼音首字母与列注释两处缺口。固定参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch，不宣称已核对远端最新提交。G01–G13、E01–E07 原目标保持完整并继续实施。

### 字段搜索与复杂语句

| 场景 | 当前行为及边界 |
| --- | --- |
| zj → 租金总额；zj → 总租金 | 支持默认拼音首字母前缀和有序跳字匹配，不提供全拼/词组多音展开 |
| zwvipje2 → 中文VIP_金额2 | 保留 ASCII 字母/数字，忽略分隔符；不改数据库对象的名称 |
| rev / 营业 / yysr / rva → amount | 真实注释“营业收入 Revenue amount”参与英文、中文、拼音和有序匹配 |
| 精确字段 rev、名称前缀 rev_exact、注释匹配 amount | 服务端默认先遵守语义组/来源层级，组内名称优先于注释；同分保留来源顺序。前端开启使用偏好后的最终排序须另行验收 |
| l.zj 后还有 suffix | 使用真实列名和方言引号，TextEdit 替换整个成员；不插入拼音或注释 |
| WITH q AS(SELECT amount AS net…) / q(net) / 派生表 | 唯一直接字段投影和显式重命名继承注释，外层 rev 推荐 net 和实际类型 |
| amount+1 AS net、未知/歧义表达式 | 不把原表注释附到计算结果；不按输出名向整个 catalog 借用注释 |
| QUALIFY 与相关外层输入 | 在已有 SELECT 输出/前置输入绑定中匹配，未新增不相关来源 |
| 同 SQL 更新注释/类型、移除 schema、不同生产会话 | 读取当前 schema 快照；无持久 catalog 搜索缓存，不保留旧注释索引 |
| 字符串、注释、后续语句、集合分支、同名内层别名 | 沿用原有抑制与来源隔离；其他表注释命中不能越过 SQL 绑定 |

例如元数据中 ledger.amount 的注释含 Revenue：

```sql
WITH q(net) AS (SELECT amount FROM ledger)
SELECT q.rev -- 推荐 q 的 net，保留 amount 的类型和真实注释
FROM q;
```

[共享匹配模块](../vendor/sql-lsp/src/identifier_search.rs) 处理字符首字母、注释预算、辅助 filterText、分组排序和候选上限。现有 schema/作用域流程先选择可见行，再做匹配；没有新建一个全 catalog 的补全回退。Hive/ClickHouse 的独立字段构造器统一复用 [共享候选](../vendor/sql-lsp/src/dialects/common/items.rs)，避免限定成员路径漏带搜索信息。[直接投影来源](../vendor/sql-lsp/src/server/local_relations/projection.rs) 只继承唯一字段的注释；[输出装配](../vendor/sql-lsp/src/server/local_relations/query_output.rs) 保留该元数据。生成列的内部来源说明不再冒充数据库列注释，重命名也不覆盖真实注释。

普通、无辅助搜索元数据的限定成员 API 仍可返回整组可见字段供客户端过滤，保留原有排序和 filterText 契约。含中文名称或注释的非空检索路径才进行额外过滤/排序。候选规范名称保留在 data.oxide.column；延迟 resolve 后恢复原始 data，实际 Monaco 过滤文本可以包含输入和辅助匹配信息，插入内容始终来自列名。普通 ASCII 表仍保持原 data/延迟解析契约。

### 字典、预算与模块

复用前端已锁定的 **pinyin-pro 3.28.2** 的逐字符默认读音，通过 [离线生成器](../scripts/generate-lsp-pinyin-initials.mjs) 生成 [Rust 常量页](../vendor/sql-lsp/src/identifier_search/pinyin_data.rs)。共 **21,133 条读音 / 163 页 / 41,728 B 字母页**，页索引和其他运行时/二进制成本另计；按页二分查找，无运行时 Node、网络或新 Cargo 依赖。生成器核对版本和 dist 摘要，`--check` 验证原始表内容；Rust 单元测试实际验证全部 21,133 条读音可达。该穷举发现并修复了基本汉字区之外的 **U+3005（々）** 被漏过的问题。未知读音保持不透明，不编造发音；不宣称覆盖所有汉字和多音词组。

[MIT 授权副本](../vendor/sql-lsp/PINYIN-LICENSE.txt) 随源码包保留，并在 [Tauri 资源声明](../src-tauri/tauri.conf.json) 中加入安装资源；本批未独立验收安装器。字母表 SHA-256 为 `86603bbbad8edb7191c1fb78dfa7e410888f399dcb9459ffe688c5366328cd54`，与生成器和前端实际依赖的映射一致；DBX 隔离运行的 3.29.5 依赖保持不变，未向参考源码写回文件。

辅助名称转换和注释检索最多取 **2048 UTF-8 字节**，在字符边界截断；辅助查询最多 **128 字节**。普通名称匹配和实际标识符不被该预算截断，完整注释仍可按既有文档/resolve 策略展示。非空辅助检索路径最多返回 **256 个元数据候选**，其他关键字/函数不计入该数；超限返回 CompletionList.isIncomplete，客户端输入更长前缀后重查。先扫描当前绑定候选再截断，晚声明的精确名称不会被前面的注释命中挤掉。空前缀和普通名称路径沿用原有行为，这不是整个 LSP 响应、所有 catalog CPU 或 RSS 的统一上限，也没有完整大 catalog 索引的性能证明。

### 测试、桌面与失败证据

新增 **12 项库测试 + 2 项原生协议测试**。六个实测 profile 为 PostgreSQL、MySQL、SQL Server、SQLite、Hive、ClickHouse；覆盖字段/注释、混合输入、规范名称与类型、CRLF/emoji/UTF-16 中间光标、完整后缀替换、CTE/派生表/显式列名、相关输入/QUALIFY、集合分支、别名遮蔽、噪声抑制、同 SQL 刷新/删除、300 个注释命中与末尾精确名称和前缀重查。源码见 [语义测试](../vendor/sql-lsp/src/server/tests/complex_semantics/metadata_search.rs) 与 [真实 stdio 协议](../vendor/sql-lsp/tests/integration_test_client/metadata_search.rs)。未知/预算外读音和长注释另有正反例，字典结构与全部读音可达性有验证。

原生新增测试打开 **20 份文档**：六方言各两份完整编辑/hover 正例、三份跨层投影，一份原文不变的注释/类型刷新，以及四份隔离/噪声负例。最终 **982 passed / 0 failed / 0 ignored**，即 **789 库 + 193 集成 / 24 目标**；最终 release 的精确捆绑字节另通过 **72 项**原生协议，调试工件已恢复。应用 `lsp_integration` **13 项**通过，严格 Clippy/fmt、前端 build 和边界门禁通过（2800 文件，parser 35 模块/243 方法，common 8 模块/90 函数）。

初次七个语义测试有五项失败，日志为 `lsp-metadata-search-red.log`。后续完整回归发现普通名称字段集合/顺序、filterText 身份误用和文档延迟 resolve 兼容问题，保留旧断言并修复生产路径；新负例改为核对计算列未继承注释，不把既有未过滤限定行 API 当作错误绑定。新增 native helper 的路径/停止接口、hover 响应读取和桌面场景计数也已修正，失败日志保留。字典全量校验发现 U+3005 后，重新运行全量和最终程序验收；没有用旧程序的成功记录替代最终字节。

[真实 WebView](../src-tauri/tests/desktop_lsp_ipc/scenario.ts) 为 **40 场景 / 1108 断言**，使用生产 LspClient、Monaco 转换和 Tauri 命令，实际接受拼音/注释字段、跨层别名和完整后缀；核对 lazy resolve 的规范名称、同 SQL 刷新、两个生产会话独立元数据，以及 256 候选截断/精确名称/重查。最终路径为 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-RT2DpA/`。验收仍是隐藏 WebView，不认证可见推荐控件、完整 React Workbench 或安装包。Desktop 后用禁止执行的 PROTOC 完成无默认 feature 的 CLI 重建，版本恢复为 **oxide-agent 0.1.18**。

### 性能、同输入矩阵与来源

本机交替 warm stdio 观测：普通项各 50 次、4097 警告项各 10 次。前三项增加了搜索语义，旧版缺少对应字段，不能作等价负载加速证明；普通限定字段的 label/type/edit 等相同但 opaque data 增补，比较时明确排除 data。其他六项诊断/codeAction 的末次完整响应 JSON 一致。以下 p50/p95 单位为 ms，保留成本变化，不外推冷启动/RSS、连续编辑或桌面 p95。

| 场景 | p50 前 → 后 | p95 前 → 后 |
| --- | --- | --- |
| 拼音首字母字段 | 0.271 → 0.292 | 0.378 → 0.404 |
| 列注释字段 | 0.295 → 0.320 | 0.440 → 0.422 |
| 300 个注释字段 | 0.658 → 3.382 | 0.858 → 3.643 |
| 普通限定字段（仅 data 增补） | 0.188 → 0.207 | 0.255 → 0.273 |
| 4097 个真实警告范围 | 86.057 → 86.529 | 89.343 → 91.050 |
| 字符串分号 + 真实 WHERE | 0.084 → 0.082 | 0.147 → 0.153 |
| 嵌套 WHERE 与外层修改 | 0.102 → 0.101 | 0.191 → 0.192 |
| JOIN codeAction | 0.374 → 0.354 | 0.455 → 0.534 |
| 自连接重复列诊断 | 0.108 → 0.108 | 0.166 → 0.165 |
| ON 输入限定修复 | 0.257 → 0.258 | 0.322 → 0.359 |

原始样本在 `lsp-metadata-search-performance.json`。原 **53 组 / 159 次计算**复跑后，Oxide 为 **46/46 名称、44/44 原类型、7/7 隔离**；DBX EditorState 仍为 **35/46、18/44、3/7**，全部六个控制通过。原 SQL/schema/UTF-16 光标摘要仍为 `454d25fb80a1679ea3b33079cf7ef0c1f0f44375ec022130c4f7faaeb7bf6dd6`，DBX bundle 未变；依赖仍为 44 包 / 104 边 / 332 输入。此为定向矩阵，非产品总分；[专项报告](dbx-sql-completion-comparison-2026-10-24.md) 保留两个入口和完整逐项结果。

最终捆绑 SHA-256 **`8a96f8d6a340f38d5e5ab72563335b1304cf1254980de5763d6fbeeaad1e1568`**；运行输入 **257 文件 / `db80a6e26f002d5a536626fe4c537403ecee2846001bb6a8cdb71eb606403062`**。源码包为 **283 文件 / 243 Rust 源码 / 2,800,107 B**，SHA **`b08ca5ac7e84e7fad8f9548cfde77b9e1f5fb5206b9d8bece1c6476738916e0c`**。全部 src 与 16 项附加输入一致；相对第 43 批新增三个 Rust 模块及授权文本，无删除。Cargo 锁文件原始 CRLF/LF 不同，规范化文本/TOML 相同；无新依赖、未做独立解包构建，顶层 native 测试按既有规则排除。语法未改，核验 12 项摘要，并复核第 43 批独立再生成的六文件原始字节一致；没有把复用证据写成此次重新生成。汇总为 `.impeccable/review/lsp-metadata-search-evidence.json`。

另外，已核到 [前端缓存回退](../src/features/query-editor/model/cachedSqlCompletion.ts) 的物理字段路径仍只用 column.name 匹配，虽展示 comment，但没有按注释过滤。它用于 LSP 不可用/回退等路径，不属于本次 stdio 矩阵和上述直接 LspClient 链路；需要下一批独立修复和 provider 回归。

原矩阵内四处缺口均已修复；**缓存回退注释检索、QUALIFY 直接别名 hover/定义、统一类型/来源模型、任意 UDTF/完整转换、方言/版本/会话、搜索偏好/多音词组/预算外长注释、大 catalog 连续编辑/RSS、可见推荐/完整 Workbench/安装版、跨平台及真实厂商执行**仍待补齐。继续以这些缺口推进原目标，不将 53 组全通过视为全部完成；未 fetch、提交、推送或发布。

## 第四十五批：缓存推荐的语义隔离与长 SQL 性能

日期：2026-10-24。继续处理上一批发现的前端字段缓存只匹配名称的问题。检查生产 provider 后确认：该路径也会与健康 LSP 的响应合并，因此影响范围包含正常编辑。参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`；本批未 fetch，也不宣称远端最新。

### 搜索、作用域与编辑

[实际缓存请求](../src/features/query-editor/model/cachedSqlCompletion.ts) 复用 [元数据匹配](../src/features/query-editor/model/cached-completion/metadataSearch.ts)，支持名称、注释、中文首字母、混合输入及已有模糊匹配。名称命中先于注释命中，同分保留元数据顺序。filterText 保留辅助查询，使 Monaco 不会因真实字段名不含搜索词而丢弃候选；插入值始终来自规范字段名，并保留类型和受预算限制的真实注释。

| 输入/场景 | 核验结果及边界 |
| --- | --- |
| ledger.amount 注释为 Revenue，输入 l.rev | 推荐 amount，实际接受后消耗整个旧后缀，保留点号与后续标点 |
| 中文列名、中文注释、拼音首字母 | 使用已有按需 pinyin-pro 支持；空输入不触发字典加载，不新增网络依赖 |
| Unicode、emoji/CRLF、双引号/反引号/方括号、名称中含点或保留字 | 按 UTF-16 计算编辑范围，识别转义与已有定界符，通过驱动规则引用真实名称 |
| 内层关闭的同名别名、集合查询的另一个分支 | 不向当前字段推荐泄漏；公开关系发现 API 仍保留全部分支，字段绑定独立筛选 |
| 相关标量子查询、显式 LATERAL/APPLY | 可见合法外层来源；普通派生表的关联屏障不让其引用外层别名 |
| 普通派生表内部的相关 EXISTS | 可引用该派生表自身的输入；屏障不错误穿透到合法内部相关子查询 |
| 重复别名、含伪关键字的引用名、字符串/注释、超出分析预算 | 不猜测唯一来源，不发起不相关字段请求 |
| 同 SQL 元数据刷新及旧请求晚返回 | revision 参与缓存键，旧快照不能污染新 revision；不同项目/连接/库/schema/驱动隔离 |
| LSP 已就绪但返回空字段列表 | 通过真实 native LSP 与生产 provider 验证缓存注释候选仍进入推荐 |

[查询所有权模块](../src/features/query-editor/model/cached-completion/queryScopes.ts) 区分当前查询、兄弟分支、相关父查询与 CTE 声明可见性，使用 UTF-16 偏移，不将通用括号直接视为新查询。[标识符编辑](../src/features/query-editor/model/cached-completion/identifierEdits.ts)、[线性后缀读取](../src/features/query-editor/model/cached-completion/identifierFragments.ts) 与 [缓存预算](../src/features/query-editor/model/cached-completion/fieldCache.ts) 各自独立。请求内共享字段/JOIN 加载 promise；已经取消的请求不做元数据 I/O。[生产 provider](../src/features/query-editor/model/createQueryCompletionProvider.ts) 将缓存截断传播为 incomplete，支持更长前缀重查。

### 预算与性能

字段最多返回 **256 项**，关系最多 **512 项**，先匹配/排序后截断；晚声明的精确字段仍能保留。注释检索查询最多 128 UTF-8 字节，注释搜索最多 2048 字节，展示注释最多 8192 字节，均在字符边界处理。完整字段名匹配及已有名称拼音转换不由该注释预算统一截断。物理字段缓存最多 128 条/估算 8 MiB，按 FIFO 淘汰；估算按 UTF-16 内容与每列开销计，不代表实际 RSS。过大结果可供本次请求使用但不留存。作用域输入最多 512×1024 个 UTF-16 代码单元、128 层括号、1024 查询、32768 token 起点，预算耗尽时不猜字段。它们不是整个应用、所有 LSP 响应或元数据传输的统一内存限制。

真实桌面长 SQL 验收曾在 watchdog 到期后失败，保留 `oxide-desktop-lsp-ipc-IFTZLN` 的无 receipt 记录。定位发现标识符前缀、限定来源、SQL 上下文与语法回退中的贪婪后缀正则会在长注释词上重复尝试起点；替换为末尾 token 扫描，并补充 128 KiB 注释回归。另一次初始桌面运行因测试 bundle 缺少 Vite import.meta.env 定义而失败，保留 `oxide-desktop-lsp-ipc-s2KrFP`；测试 bundle 使用明确生产环境定义，未替换生产匹配实现。

Node 小样本独立函数测量在 4096 字符时，标识符读取约 6.27 ms 降至 0.006–0.012 ms，关系读取约 6.75–8.85 ms 降至 0.29–0.62 ms；这不是完整 UI 的加速比例。最终真实 WebView 中，预置缓存、warm 生产 provider 单次运行的数据如下，单位 ms：

| 负载 | 预热/采样 | p50 | p95 | 返回字段 |
| --- | --- | --- | --- | --- |
| 3 列 | 5 / 30 | 0.100 | 0.200 | 1 |
| 300 列注释命中 | 5 / 30 | 0.600 | 0.700 | 256，incomplete |
| 10000 列注释命中 | 3 / 20 | 3.500 | 4.700 | 256，incomplete |
| 3 列 + 128 KiB 注释 SQL | 2 / 10 | 18.800 | 20.400 | 1 |

原始样本全部保留，包括 10000 列首个实测 10.5 ms。首轮完整成功记录另保留在 `oxide-desktop-lsp-ipc-yBIQFK`；修正源码文件末尾空行后，最终复核采用下述 JqF7uk 记录。没有冷启动、远程加载、连续编辑、RSS 或完整 Workbench 性能结论，也未与 DBX 做横向速度排名。

### 验收范围与未完成项

新增 [缓存 provider 回归](../src/features/query-editor/model/cachedSqlMetadataCompletion.test.ts) **39 项**及 [后缀/上下文回归](../src/features/query-editor/model/cached-completion/identifierFragments.test.ts) **8 项**。前者运行生产请求/provider，仅替换元数据 I/O 边界，覆盖六种 SQL profile、来源正反例、刷新、256/512 上限、128 条淘汰、超大结果不留存、UTF-8 截断和取消/并发共享；后者验证长 SQL、引用关键字、转义 qualifier、Unicode 与多行引用边界。全量前端 **2210 passed / 413 文件 / 0 failed / 0 skipped**。

[真实桌面缓存场景](../src-tauri/tests/desktop_lsp_ipc/cachedScenario.ts) 接入生产 provider/coordinator 与实际 Monaco，预置元数据通过生产缓存键/保留函数写入，核对零缓存 miss。保留原 40 场景，新增三场景后为 **43 场景 / 1202 断言**。实际触发推荐控件、检查渲染与 amount 候选，并通过 acceptSelectedSuggestion 验证插入结果；还用真实 native 空 schema 响应验证缓存合并。最终证据目录为 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-JqF7uk/`。窗口仍隐藏，**不认证用户可见的操作系统窗口、完整 React Workbench、真实远程元数据加载或安装器**。

后端实现、grammar、字典和捆绑 binary 未修改：SHA-256 仍为 `8a96f8d6a340f38d5e5ab72563335b1304cf1254980de5763d6fbeeaad1e1568`，运行输入仍为 257 文件 / `db80a6e26f002d5a536626fe4c537403ecee2846001bb6a8cdb71eb606403062`。**982 项 Rust LSP、72 项精确捆绑协议、源码包及固定 53 组 DBX 对比复用第四十四批证据**；本批重新运行桌面程序与应用集成，不将复用写成再次运行全量 Rust、重新生成 grammar 或新建源码包。固定矩阵和 DBX 算法的结论保持上一批范围。

前端 build、模块/边界门禁与 bundle 检查通过（2807 文件），应用 `lsp_integration` **13 项**重新通过。最终 Desktop 结束后，使用禁止执行的 PROTOC 完成 `--no-default-features --bin oxide-agent --locked --offline` 重建，CLI 恢复为 **oxide-agent 0.1.18**。UTF-8、冲突标记、空白和 460 个本地文档链接核验通过；源码/桌面/二进制摘要和复用边界汇总于 `.impeccable/review/lsp-cached-search-evidence.json`。

仍需：缓存路径光标后 FROM 的完整文档绑定、复杂 CTE/派生投影的类型/真实注释传递、完整方言词法与版本、QUALIFY 直接别名 hover/定义、统一类型/来源模型、任意 UDTF、搜索偏好/多音词组、全局预算与大 catalog 连续编辑/RSS、可见桌面/完整 Workbench/安装版、跨平台和真实厂商执行。缓存模块仍是受限回退，不是第二套完整 SQL 解析器。**G01–G13、E01–E07 全目标继续进行**；未 fetch、提交、推送或发布。

## 第四十六批：光标后的 FROM 与完整文档查询绑定

日期：2026-10-24。上一轮为已验证进展，本轮继续修复其明确留下的完整文档绑定缺口。参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，没有 fetch，也不将固定参考称为远端最新。

### 推荐效果与来源隔离

例如 ledger.amount 的注释包含 Revenue，输入下面的 SQL 时，缓存 provider 现在能从后方 FROM 找到 ledger，推荐并实际插入 amount，保留类型和完整后续 SQL：

```sql
SELECT l.rev|suffix FROM ledger l;
-- 接受 amount 后：SELECT l.amount FROM ledger l;
```

这条路径复用生产 provider、搜索/引用/编辑逻辑，正常 LSP 响应和离线回退均沿用原有合并契约。本轮补齐的不是另一份脱离产品的推荐示例。

| 场景 | 当前行为及实测范围 |
| --- | --- |
| SELECT 成员在 FROM 前，emoji/CRLF 与完整旧后缀 | PostgreSQL、MySQL、SQLite、SQL Server、Hive、ClickHouse 六 profile 验证物理字段、decimal 类型与规范编辑 |
| SELECT 中相关标量子查询，外层 FROM 也在光标后 | 保留合法相关来源；普通派生表和 CTE 主体不能借用外层物理输入 |
| UNION/INTERSECT/EXCEPT/MINUS | 按光标所属分支绑定，不能从前后兄弟分支补字段；MINUS 专项使用 Oracle profile |
| 窗口表达式与后续子句 | OVER 内字段可以使用后方输入；WINDOW、QUALIFY 等子句词不会冒充未声明别名，QUALIFY 专项使用 ClickHouse profile |
| 逗号连接输入 | 物理表、闭合派生表及表函数纳入当前输入集合；多个来源时不猜 unqualified 字段归属 |
| 表函数或物理表别名后的显式列名列表 | 使用声明的输出名称；未知函数输出仍参与歧义检查，不被误当成物理表加载 |
| 显式 CTE、派生投影别名，以及带引号的关键字别名 | 在 FROM 前提供已声明名称；不把不存在的 CTE 引用或已被改名的基名当成有效输入 |
| 非递归前向 CTE / WITH RECURSIVE 前向声明 | 前者不猜列、不发起同名物理表查询；后者在显式列名可用时提供名称。未证明完整递归类型或循环合法性 |
| ON 中后续 JOIN、LATERAL/APPLY 后方输入 | 拒绝；SELECT 能读取后方 FROM，并不意味着连接条件或关联输入也能看见所有后续来源 |
| 后续分号/空行语句、WITH/INSERT/EXPLAIN 包装、引号中的括号/分号 | 当前语句边界独立定位，后续语句的同名别名不能泄漏；保留 prefix-only 兼容 API 的返回形状 |
| 查询尚未开始、已取消请求、超大/不一致模型 | 不借用未来查询的字段；已有取消检查保留，完整模型预算耗尽时不给不确定的字段建议 |

非递归/递归 WITH 的声明次序规则核对了 [PostgreSQL 18 SELECT 文档](https://www.postgresql.org/docs/18/sql-select.html)；别名替代基名、LATERAL 与前置 FROM 输入的关系核对了 [Table Expressions](https://www.postgresql.org/docs/18/queries-table-expressions.html)。这些来源用于指定 profile 的绑定规则，不替代其他厂商、会话设置或实际数据库执行验证。

### 模块与预算

[完整模型入口](../src/features/query-editor/model/cached-completion/documentContext.ts) 在 metadata 请求中读取一次当前模型，并用 [词法/语句模块](../src/features/query-editor/model/cached-completion/lexical.ts) 返回当前语句、噪声掩码与相对光标偏移。真实 Monaco 支持 getValueLength，超过 **512×1024 个 UTF-16 代码单元**时先拒绝，避免复制整个超限模型；不在丢失上文的截断窗口里推断字段。最小模型适配器继续支持既有 prefix 接口。该限制针对完整缓存语义输入，不是整个编辑器、模型或 native LSP 的统一大小限制。

[查询作用域模块](../src/features/query-editor/model/cached-completion/queryScopes.ts) 改为按光标位置读取查询/分支/子句快照，保存进入子查询时的父上下文。这样后续扫描遇到 UNION 或另一个查询时不会改变光标先前所在分支；ON 和关联输入另按可见位置限制。CTE 声明可见性与物理 FROM 关联屏障分别计算。[关系装配](../src/features/query-editor/model/cached-completion/relations.ts) 按实际源码顺序组合物理表、逗号输入、派生表和表函数，避免新增提取路径改变 JOIN 来源顺序。

字段请求复用已定位语句的前缀掩码处理 qualifier 和关系名上下文，减少重复扫描。沿用字段 256/关系 512、缓存 128 条/估算 8 MiB、注释搜索/展示与作用域层数/token 等上限。此处只补齐名称与安全来源；**复杂投影的 SQL 类型/真实注释不会因本轮而被虚构**，显式本地输出仍显示 CTE/Derived table 信息。

### 单元、桌面与性能证据

新增 **70 项前端测试**：现有 [生产 provider 测试](../src/features/query-editor/model/cachedSqlMetadataCompletion.test.ts) 从 39 增至 **97 项**，另有 [完整文档/边界测试](../src/features/query-editor/model/cached-completion/documentContext.test.ts) **12 项**。最初 28 项新 provider 用例中有 16 项失败，日志 `lsp-full-document-red.log` 保留；修复后保留正反例并扩大到逗号、显式输出、声明次序、引用边界、包装语句和预算。全量 **2280 passed / 414 文件 / 0 failed / 0 skipped**；前端 build、2809 文件模块门禁、边界与 bundle 检查通过。

[真实桌面缓存场景](../src-tauri/tests/desktop_lsp_ipc/cachedScenario.ts) 保留原 43 场景，新增完整文档场景后共 **44 场景 / 1288 断言**。六 profile 的 SELECT 成员候选接受后核验完整 SQL；另验证相关输入、集合分支、逗号输入、窗口、局部显式输出及负例。实际触发 Monaco 推荐控件并接受 SELECT 中的 amount，保留原 WHERE 控件验收与真实空 LSP 响应合并。生产缓存键/保留函数预置元数据，**缓存 miss 为 0**；没有替换 production provider/coordinator/匹配算法。最终目录为 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ZYXsYf/`。

窗口仍隐藏，元数据仍为预置夹具；这不是可见 OS 窗口、完整 React Workbench、远程加载、安装器或真实数据库执行验收。部分用例是未写完的编辑位置或通用子句识别，也不作为所有 profile 语法合法性的证明。

同样四种预置缓存 warm 负载，以下为两次独立运行的观测值，单位 ms。不是交替控制实验，不作因果加速比例或 DBX 横向速度排名：

| 负载 | 预热/采样 | 上批 p50/p95 | 本批 p50/p95 |
| --- | --- | --- | --- |
| 3 列 | 5 / 30 | 0.1 / 0.2 | 0.1 / 0.2 |
| 300 列注释命中 | 5 / 30 | 0.6 / 0.7 | 0.3 / 0.5 |
| 10000 列注释命中 | 3 / 20 | 3.5 / 4.7 | 3.6 / 4.3 |
| 3 列 + 128 KiB 注释 SQL | 2 / 10 | 18.8 / 20.4 | 20.0 / 27.1 |

长 SQL 的 p95 增加保留在报告中，完整文档/结构扫描的成本需要继续优化。样本数和原始时长均在 receipt/evidence 中；不证明冷启动、连续编辑、RSS、远程加载或完整 Workbench p95。

应用 `lsp_integration` **13 项**重新通过；Desktop 后使用禁止执行的 PROTOC 完成 `--no-default-features --bin oxide-agent --locked --offline` 重建，CLI 恢复 **oxide-agent 0.1.18**。后端 LSP 源码、字典、grammar、捆绑字节和源码包没有修改：binary SHA 仍为 `8a96f8d6a340f38d5e5ab72563335b1304cf1254980de5763d6fbeeaad1e1568`，运行输入仍为 257 文件 / `db80a6e26f002d5a536626fe4c537403ecee2846001bb6a8cdb71eb606403062`。

**982 项 Rust LSP、72 项精确捆绑协议、283 文件源码包和固定 53 组 DBX 同输入比较继续复用第四十四批证据**，没有在本批重复运行或重新生成；53 组算法比较不包含本批新增 frontend provider 夹具。汇总为 `.impeccable/review/lsp-full-document-evidence.json`，保留运行摘要、当前源码摘要、性能原样本、复用范围与差距。

下一步继续补齐复杂 CTE/派生输出的类型和真实注释、完整连接树/隐式函数/方言词法/会话与版本规则、QUALIFY 直接别名 hover/定义、统一来源模型、任意 UDTF、全局元数据预算及长 SQL/大 catalog 连续编辑性能。可见桌面/完整 Workbench/安装版、远程元数据、跨平台与真实厂商执行仍未完成。**G01–G13、E01–E07 全目标完整保留并继续进行**；未 fetch、提交、推送或发布。

## 第四十七批：局部直接投影的类型、注释与声明识别

日期：2026-10-24。继续处理上一批明确留下的局部输出元数据缺口。参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`；未 fetch，未声称远端最新。

### 类型、注释与推荐效果

例如 ledger.amount 在真实元数据夹具中为 decimal，注释含“营业收入 Revenue”，现在可沿直接投影传递到 q.net，并用拼音/注释找到正确输出名：

```sql
WITH q(net) AS MATERIALIZED (
  SELECT l.amount FROM ledger l
)
SELECT q.yysr|suffix FROM q;
-- 推荐 net / decimal / 真实源注释；接受后为 SELECT q.net FROM q;
```

这里的类型来自绑定物理字段的当前缓存快照；不把任意计算表达式称为已完成类型推断。普通 LSP 与缓存仍按原优先级合并，缓存不覆盖同名的权威语义候选。

| 场景 | 当前行为与核验 |
| --- | --- |
| CTE/派生表直接字段、AS 重命名、显式列名列表 | 继承唯一源字段的类型与真实注释；注释/拼音匹配后插入输出名，消耗完整旧后缀 |
| 多层 CTE、CTE 的 FROM 列名重命名、派生表列名列表 | 保留列序对应关系，不能把局部别名当成同名物理表加载 |
| 限定 *、单输入 *、局部投影中的多个相同来源 | 复用源快照与请求内任务；限定通配符只取自身输入，不读取 JOIN 的无关表 |
| MATERIALIZED / NOT MATERIALIZED、引用名含 ) 或 ; | 平衡括号与转义引用识别，避免旧的 `[^)]*` 截断及 CTE 漏识别 |
| 单纯加括号、字段旁注释、DISTINCT、SQL Server 数字 TOP | 保留直接字段身份；TOP 为专项 profile 用例，不作任意 TOP 表达式验证 |
| 计算表达式、错误 qualifier、被别名隐藏的基名、歧义 unqualified 列 | 保留能确认的输出名称，但没有真实来源时不借用类型/注释，也不扫描全 catalog 猜列 |
| UNION 等集合结果、递归/循环定义、重复输出名 | 不以某一分支或任意同名列冒充结果元数据；重复输出名不任取一个来源，递归未知结果保持未知 |
| 物理 schema.q 与局部 CTE q 同名 | schema/catalog 限定的输入仍按物理来源读取，不被 CTE 仅按末尾名称截获 |
| 同 SQL 的类型/注释刷新及源缓存复用 | 使用当前 revision 的物理快照；局部名称重命名不会改写缓存中的真实字段名 |
| PostgreSQL/Oracle 引用与非引用列名 | 增加基本 ASCII 大小写正反例，必要时引用输出名；复杂 Unicode/数据库字符集/会话规则仍待验证 |

普通直接投影的注释/拼音与完整编辑在 PostgreSQL、MySQL、SQLite、SQL Server、Hive、ClickHouse 六 profile 验证；Oracle 大小写为独立单元夹具，不宣称 Oracle 真实桌面或服务器已验收。[PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html) 用于核对 WITH 的 MATERIALIZED 和输出声明，[PostgreSQL 词法](https://www.postgresql.org/docs/18/sql-syntax-lexical.html) 与 [Oracle 19c 名称规则](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Database-Object-Names-and-Qualifiers.html) 用于核对基本大小写/引用约定。这不是所有产品版本、字符集或 SQL 合法性的证明。

### 模块、来源与预算

[局部声明](../src/features/query-editor/model/cached-completion/localDeclarations.ts) 读取 CTE 和平衡的列名列表；[结构原语](../src/features/query-editor/model/cached-completion/structure.ts) 统一处理引用名、括号和顶层词。WITH 声明位置与普通 SELECT 逗号分开识别，SQL Server WITH(NOLOCK) 不会把后续 FROM 逗号误判为局部声明。字符串/注释仍按掩码隐藏，引用名内的分号保留真实名称并由结构扫描控制边界。

[关系模块](../src/features/query-editor/model/cached-completion/relations.ts) 在内部携带同一完整语句中的输出范围和列序重命名信息；既有 prefix-only 公开 API 会去掉这些内部信息，保留原有返回形状。[局部元数据模块](../src/features/query-editor/model/cached-completion/localMetadata.ts) 每个查询体复用一次绑定视图，每个局部定义/物理来源复用请求内任务，按唯一直接身份继承元数据；没有全 catalog 同名回退，没有持久局部类型缓存。源字段缓存与局部输出分别保存，避免污染物理列名。

沿用完整文档 512×1024 UTF-16 代码单元、作用域/字段/关系/注释和估算 8 MiB 物理缓存预算；新增局部解析 **32 层、64 查询体、32768 输出项**预算，耗尽时保留可确认名称、不给虚构类型并传播 incomplete。40 层链、循环、自取消与未完成元数据读取的取消有回归。此预算不是全局请求、远程传输或 RSS 上限，也不承诺仅改变前缀就能突破深度限制。计算、集合/递归类型和未知 UDTF 仍交由 native LSP 的更完整语义模型处理。

### 测试与真实桌面

新增 **48 项前端测试**：生产 [provider 测试](../src/features/query-editor/model/cachedSqlMetadataCompletion.test.ts) 从 97 增至 **137 项**，另有 [局部元数据测试](../src/features/query-editor/model/cached-completion/localMetadata.test.ts) **8 项**。最初九项类型/注释正例全部失败，保留 `lsp-local-metadata-red.log`。新增正反例包括六 profile、混合搜索、原文位置、跨层与通配符来源、声明边界、大小写、同 SQL 刷新、源缓存不变、歧义/计算/集合/循环、美元字符串内逗号、重复输出、深度与取消。

首次完整回归另外发现两处旧公开 API 返回形状变化，修复生产 wrapper 后保留原测试通过。五项旧测试的“局部列无需物理读取”断言，随直接元数据继承改为严格核验只读取声明中的 ledger；未知函数/常量、错误来源和歧义负例仍断言无 I/O，没有把局部别名查询成物理表来获取通过结果。最终 **2328 passed / 415 文件 / 0 failed / 0 skipped**，前端 build、2813 文件模块/边界门禁及 bundle 检查通过。

[真实隐藏 WebView](../src-tauri/tests/desktop_lsp_ipc/cachedScenario.ts) 为 **45 场景 / 1397 断言**，保留原 44 场景并增加局部类型/注释场景。六 profile 实际接受拼音匹配的 net；PG 声明/跨层/引用边界和未知结果有正反核验。实际 Monaco 推荐控件接受 Net 后插入 `q."Net"`；实际 native LSP 配置为缺少列元数据时，进一步验证局部 * 结果经生产 provider 合并正确的缓存字段/类型/注释。

最终目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-2q5cyP/`，预置缓存经生产 key/保留函数写入，**缓存 miss 为 0**。生产 provider/coordinator/匹配算法均实际参与；窗口隐藏、远程元数据加载未测，仍不是可见 OS 窗口、完整 React Workbench、安装器或真实数据库执行验收。

### 性能与复用证据

新增预置缓存、warm 生产 provider 的局部输出观测，单位 ms；单次运行，保留原始时长，无冷启动、RSS 或端到端远程延迟结论：

| 局部负载 | 预热/采样 | p50 | p95 | 返回字段 |
| --- | --- | --- | --- | --- |
| 一层直接 CTE / 3 列源表 | 5 / 30 | 0.1 | 0.2 | 1 |
| 16 层直接 CTE / 3 列源表 | 3 / 20 | 1.3 | 1.6 | 1 |
| 一层 * / 10000 列源表 | 3 / 20 | 4.0 | 4.2 | 256，incomplete |

既有四种 warm 负载本次 p50/p95 分别为 **0.1/0.2、0.2/0.3、3.3/3.4、20.4/24.4 ms**（3、300、10000 列及 128 KiB 注释 SQL）。长 SQL 上轮为 20.0/27.1 ms；两次为独立运行，不作因果加速比例或 DBX 横向速度排名，长文档与连续编辑性能仍需优化。

应用 `lsp_integration` **13 项**重新通过；Desktop 后使用禁止执行的 PROTOC 完成 `--no-default-features --bin oxide-agent --locked --offline` 重建，CLI 恢复 **oxide-agent 0.1.18**。后端 LSP 源码、grammar、字典、捆绑字节及源码包未改；binary SHA 仍为 `8a96f8d6a340f38d5e5ab72563335b1304cf1254980de5763d6fbeeaad1e1568`，运行输入仍为 257 文件 / `db80a6e26f002d5a536626fe4c537403ecee2846001bb6a8cdb71eb606403062`。

**982 项 Rust LSP、72 项精确捆绑协议、283 文件源码包及固定 53 组 DBX 比较继续复用第四十四批证据**；本批未重复运行/重新生成，53 组矩阵不包含这 48 项 frontend 新测试。汇总、源码/运行摘要和全部性能样本在 `.impeccable/review/lsp-local-metadata-evidence.json`。

剩余：完整表达式/CAST/聚合、集合/递归类型、唯一列在多输入中的推断、四段限定名/linked-server 的完整身份核对、完整连接树与厂商词法/字符集/会话/版本、QUALIFY 直接别名 hover/定义、统一来源模型及 UDTF、全局元数据预算、连续编辑/RSS/冷启动、可见桌面/完整 Workbench/安装版、实际远程元数据、跨平台及真实厂商执行。**G01–G13、E01–E07 全目标继续进行**；未 fetch、提交、推送或发布。

## 第四十八批：来源身份、唯一字段证明与跨服务器类型

2026-10-24，继续用户要求的复杂语义推荐、DBX 对照、单元测试、性能和模块边界。G01–G13 / E01–E07 保持进行中；本批没有 fetch、提交、推送或发布。

### 修复与可验证行为

| 问题 | 本批行为 | 验证边界 |
| --- | --- | --- |
| `remote.db.app.ledger` 曾匹配本地 `db.app.ledger` | Rust Schema 可选 `server`，完整匹配服务器/catalog/schema/table；服务器单独变化使前端配置签名及原生候选刷新 | 明确配置的元数据；尚未增加远程读取通道 |
| 本地文档中的远程 CTE/派生表输出成为 unknown | 逐输入匹配明确的三/四段来源；本地 decimal 与远程 nvarchar 不按注册顺序混淆 | 直接投影、显式别名、混合 JOIN 有正反例；不代表所有跨服务器表达式 |
| 多输入里唯一的未限定字段缺少类型/注释 | 完整枚举当前层输入并检查字段集合；局部声明、CTE 链和派生表继承真实元数据 | 同名字段冲突、读取失败、未知表函数/服务器/不完整输入不会证明唯一 |
| 远程或省略 schema 的路径撞中本地缓存 | 在读取缓存前保留并验证来源身份；未知服务器、省略 schema、超过四段的路径不走本地字段加载器 | 前端保守拒绝；原生省略 schema 仍见下方剩余问题 |
| JOIN 被当作无别名表的别名，LATERAL 看到自身或未来输入 | 别名排除 SQL 关键字；查询所有权记录真实输入位置与可见截止位置 | 加入 EXTRACT 的 FROM、相关外层回退、内层遮蔽和未完成 LATERAL 反例 |
| 类型证明引入无界元数据读取 | 唯一字段证明最多 16 个可见输入；单请求最多 16 个物理快照，包含缓存命中；耗尽标记 incomplete | 17 输入不猜类型；17 个限定投影最多取 16 快照，桌面零缓存漏读 |

Rust 的未知 CTE 可以保留 SQL 自己声明的输出名 `net`，类型为 unknown，不能附上本地列的注释。没有要求把这类已知名称全部隐藏，也没有把声明名称视为类型推断成功。

### 测试、分层验证与构建

- 初始前端失败证据：`lsp-source-identity-red.log` 10 失败；旧捆绑 stdio 的错误来源证据：`lsp-source-identity-native-before.json`。更新后同夹具保存在 `lsp-source-identity-native-after.json`，远程未知来源不再返回本地 amount；CTE 只保留未知 net。所有日志位于 `.impeccable/review/`，失败证据保留。
- 前端全量 **2388 / 0 失败 / 0 跳过，417 文件**；新增 60 项，其中 provider 增加 28 项，namespace 19 项、uniqueColumn 12 项、配置签名 1 项。原 localMetadata 8 项继续通过。
- Rust **990 / 0 失败 / 0 忽略，24 目标**：795 库 + 195 集成；新增 6 库、2 真进程协议。严格 Clippy、fmt、前端 build 及模块/边界门禁通过（2819 文件；parser 35 模块 / 244 方法，共享方言 8 模块 / 91 函数）。
- 新捆绑 release 的实际字节通过 **74 项协议测试**；测试期间临时替换 Cargo debug 服务端，finally 恢复并核验原摘要。真实 Tauri 应用 LSP 集成 **13 项**通过；Desktop 验收后以禁止调用 protoc 的脚本恢复无默认特性 CLI，版本 `oxide-agent 0.1.18`。
- 真实隐藏 WebView **47 场景 / 1473 断言**：生产 LSP 客户端、缓存 provider、coordinator、Monaco 模型/实际推荐控件，不是候选算法 mock。新增服务器来源类型与接受场景、缓存来源隔离/唯一输入/快照上限场景。字段替换完整后缀，插入真实标识符；同 SQL 改服务器立即刷新。缓存漏读 0。

Desktop 回执目录：`C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-4rHUsF`。本验收不是可见主窗口、完整 Workbench、安装包，也没有远程数据库执行或元数据 I/O。完整机器证据：`.impeccable/review/lsp-source-identity-evidence.json`。

### 性能记录

单机、单轮、隐藏 renderer、预加载元数据、生产 provider 的 warm 样本；数字不用于 DBX 横向性能结论，不代表网络、冷启动或全工作台时延。

| 工作量 | 计时轮数 / 预热 | p50 ms | p95 ms | 结果 |
| --- | --- | --- | --- | --- |
| 唯一字段，2 输入 | 20 / 3 | 0.10 | 0.10 | 1 字段 |
| 唯一字段，8 输入 | 20 / 3 | 0.10 | 0.30 | 1 字段 |
| 唯一字段，16 输入 | 20 / 3 | 0.20 | 0.20 | 1 字段 |
| 局部投影，3 列 / 1 层 | 30 / 5 | 0.10 | 0.20 | 1 字段 |
| 局部投影，3 列 / 16 层 | 20 / 3 | 1.50 | 1.90 | 1 字段 |
| 局部投影，10000 列 / 1 层 | 20 / 3 | 4.10 | 4.70 | 256 字段 |
| 单列 128 KiB 注释 | 10 / 2 | 23.30 | 28.20 | 1 字段 |

长注释的规范化仍明显更贵，需要继续优化重复截断、分词与拼音计算。此表不宣称本批全面降低了性能开销，也没有测跨服务器大 catalog 扫描/快照复制成本。

### 来源、可复现包与 DBX 对照

捆绑 SHA-256：`21c021e287ce01a21cd9f4f3e8da65b2fa6b89e83bded78a3b32a90677238ea5`；运行时输入指纹 **258 文件**：`d34b4426207888420f283508a3f5f4a1f65ba27c46426f0bca9ac06a23c6c47b`。源码包 **284 文件 / 244 Rust**，SHA-256 `5f74a13c007426a1cc7e39688283731488bf56cea8d4db573adb90e068fa07f3`；逐字节核对全部 Rust 和 16 个额外输入，锁文件换行规范化及 TOML 一致，未做解包后独立构建。相对第四十四批保留包新增 1 文件、修改 24 文件、无删除。语法文件未变化：12 指纹核验；6 个生成文件的独立再生成证明沿用第四十三批，不宣称本批再次生成。

固定 DBX `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，工作树干净，未 fetch。新 release 重跑原 **53 夹具 / 159 计算**，原始夹具和 DBX bundle 摘要不变：Oxide 名称 **46/46**、类型 **44/44**、隔离 **7/7**；DBX EditorState **35/46、18/44、3/7**。新服务器身份用例在独立 Rust/前端/桌面测试中，不算进固定 53 组矩阵。这些计数不能外推整体产品领先、全部方言支持或 DBX 全桌面效果。见 [同夹具对照报告](dbx-sql-completion-comparison-2026-10-24.md)。

### 下一优先项与已知差距

1. **原生 SQL Server 默认 schema**：`db..ledger` 的 parser 仍把内部空段归一化为 dbo。本批 after probe 仍能在无会话 default-schema 元数据时返回 dbo.amount；这不是已修复。需要明确当前用户/会话 schema、dbo 回退和服务器上下文，补完整协议/桌面正反例。前端缓存已保守拒绝省略 schema。
2. **元数据通道和跨来源完整表达式**：应用缓存加载器尚未接入 linked server；显式已配置远程 Schema 的原生推断不等于产品可自动加载远程对象。继续覆盖完整限定列路径、跨 catalog 混合输入、表达式/递归/集合分支、类型转换及厂商会话规则。
3. **性能**：长注释重复规范化/拼音、远程大 catalog 匹配及复制、无缓存真实异步读取与取消，需分别设有界预算并在实际场景量测；本批只测预加载缓存。
4. **完整用户流程与总目标**：可见原生主窗口/完整 Workbench、安装包、各数据库实际执行、远端 CI 仍待验收；G01–G13、E01–E07 全部原范围保留，文件查询双入口保留。

## 第四十九批：省略 schema 的显式解析与完整性证明

2026-10-24。前一轮为进展：修复服务器身份与多输入来源证明，并获得真实协议、桌面及 DBX 同夹具证据。本轮继续推进其已记录的省略 schema 缺口；G01–G13 / E01–E07 全范围保持进行中。

### 已改变的行为

SQL Server 对省略 schema 的对象存在默认 schema 与 dbo 的查找顺序，不能直接改写成 dbo。依据 [Microsoft 的用户/schema 分离规则](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/ownership-and-user-schema-separation?view=sql-server-ver17) 及其 [跨数据库名称解析说明](https://techcommunity.microsoft.com/blog/sqlserver/name-resolution-default-schema-implicit-schema-part-iii/383054)，本轮让元数据显式证明当前查找上下文。该依据说明普通对象查找规则，不把模块、动态 SQL、权限变化及远程用户映射视为已经完成。

| 场景 | 本轮实际结果 |
| --- | --- |
| `[db]..[ledger]` 的解析、关系扫描、项目索引 | 保留内部空段，规范名 `db..ledger`；解析、扫描与索引中的旧 dbo 注入一并移除 |
| 默认 sales 和 dbo 都有 ledger | sales 的 uuid 优先，dbo 的 decimal 不混入 |
| sales 完整表快照明确没有 ledger，dbo 有表 | 允许 decimal；CTE 与派生表直接输出保留这个来源类型 |
| sales 表列表尚未加载完，或缺少默认 schema 快照 | 没有证明缺表，不回退 dbo |
| 默认 schema 不明、上下文冲突、缺失 catalog 或不匹配 server | 不借用活动 schema / 本地同名表；已声明 CTE 输出名可以保留 unknown |
| 显式 `db.dbo.ledger` | 继续按显式路径完成，不依赖默认 schema 配置 |
| 同 SQL 的 default_schema、tables_complete 或对象元数据变化 | 推荐立即刷新；前端配置签名包含默认 schema 与完整性状态 |

`Schema.namespace` 是可选的有效查找元数据：`default_schema` 为真实上下文提供的 schema 名，`tables_complete` 默认为 false，表示这一 schema 的表列表已完整枚举。它不是资源管理器选择值。只有默认 schema 的表已知存在，或其快照能证明缺表，才生成请求内的解析证明；内部 `resolved_references` 不反序列化、不序列化，不能通过客户端 JSON 注入。新 owner 为 `src/schema/namespace.rs`；服务器选择和局部投影复用它，保留服务器/catalog 边界。

**产品接入边界：** 当前应用同步尚未自动从真实 SQL Server 连接采集有效默认 schema 与完整表枚举证明，因此普通连接在缺少这些元数据时会保守返回未知。原生能力已用真实生产协议验证，但不能据此宣称应用中的所有省略 schema 查询已经自动支持。缓存推荐继续拒绝未知省略路径，也没有增加 linked-server 读取通道。

### 验证与反例

- 初始定向日志 `lsp-default-schema-focused.log` 为 6 失败 / 3 通过，揭示 scanner 的另两处 dbo 注入；修复后 9 个相关测试通过（8 新测试及原路径测试）。全量还揭示索引、catalog 及 INSERT hints 中旧默认 dbo 预期，修正为保留省略位置/要求明确解析证明；正向行为与未知反例均保留。
- Rust 全量 **1000 passed / 0 failed / 0 ignored，24 目标**，803 库 + 197 集成。新增 8 库、2 真进程协议；后者覆盖直接字段、CTE、派生表、默认优先/已证明回退、完整后缀替换、lazy resolve、接受后 hover、同 SQL 默认 schema/完整性/字段刷新。
- 前端 **2389 passed / 0 failed / 0 skipped，417 文件**；新增有效 schema/完整性签名测试，null 与省略、未指定完整性与 false 的规范化一致。build、严格 Clippy、fmt 及边界门禁通过（2821 文件；parser 35 模块 / 244 方法，共享方言 8 模块 / 91 函数）。
- 新捆绑 release 实字节 **76 项协议测试**；替换测试 debug 二进制后在 finally 恢复并验证原字节。原应用捆绑集成 **13 项**通过；Desktop 之后以禁止执行 protoc 的脚本恢复无默认 feature CLI，`oxide-agent 0.1.18`。
- 真实隐藏 WebView **48 场景 / 1583 断言**；新增默认 schema 优先/缺表证明/刷新/CTE 接受+hover 场景，生产 LspClient、Tauri 命令、Monaco 模型及转换器，不使用候选算法替身；原缓存实际控件验收继续通过。目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-NM6EY8`。
- 旧 release 的 `db..ledger` 未提供 namespace 时仍返回 dbo.amount；`lsp-default-schema-native-after.json` 以新 release 复跑同探针，该字段已不再返回。这里证明的是消除错误回退，已知上下文的正向支持另由上述真实协议和桌面用例证明。

所有原始日志和机器证据位于 `.impeccable/review/lsp-default-schema-*`，总证据为 `lsp-default-schema-evidence.json`。隐藏 WebView 不是可见原生主窗口/完整 Workbench/安装包；未执行真实数据库语句、远程元数据读取或远端 CI。

### 大 catalog 作用域观测

生产 LspClient → Tauri → 捆绑 release → 返回候选的单机 warm 样本，预加载 schema，20 轮 / 3 次预热。每个无关 catalog 带同名 ledger 和 100 列，当前 catalog 仍仅返回 sales.amount(uuid)。配置/首次加载成本不计入计时，也不是 DBX 横向性能或真实网络 I/O 结论。

| 无关 catalog 数 | 无关列数 | p50 ms | p95 ms | 字段数 |
| --- | --- | --- | --- | --- |
| 0 | 0 | 2.00 | 2.50 | 1 |
| 64 | 6400 | 1.70 | 2.00 | 1 |
| 256 | 25600 | 1.70 | 1.90 | 1 |

### 来源、源码包与 DBX

捆绑 SHA-256 `a063e1be4f8d03109df28b4ce9824f9283c405f3efcfe221050fff3bd952c02b`；**260 输入文件**指纹 `7382957faf1ee418211d5f5bbba88b9b661ad8fc0236491964f673f4fea9a7cc`。源码包 **286 文件 / 246 Rust / 2804536 字节**，SHA-256 `04de1cd73de43df3b7a3b19b9434d0b552e7c49751aab1f6f52bdfc6edb5293c`；所有 Rust 和 16 个额外输入逐字节一致，锁文件换行规范化和 TOML 一致；未做解包后独立构建。相对第四十八批包新增 2、修改 26、无删除，语法文件未变化；12 指纹验证，6 文件再生成字节证据明确沿用第四十三批。

DBX 仍固定 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，工作树干净，未 fetch。原夹具及 DBX bundle 摘要不变，当前捆绑重跑 **53 夹具 / 159 计算**：Oxide 名称 46/46、类型 44/44、隔离 7/7；DBX EditorState 35/46、18/44、3/7。省略 schema 新用例属于独立单元/协议/桌面矩阵，未加入固定 53 组，不能从该矩阵推断所有 SQL 或产品总体差距均已消失。见 [同夹具报告](dbx-sql-completion-comparison-2026-10-24.md)。

### 仍需继续实现的优先项

1. **真实连接元数据闭环**：在签名驱动/元数据同步契约中采集有效默认 schema、当前数据库/远程用户上下文与完整表列表证明；按连接、数据库、权限/会话变化刷新或失效。禁止以 UI 当前 schema 或部分 LSP 表快照冒充完整性。
2. **方法间一致性**：当前新解析接入位置相关候选和局部输出推断；文档范围 INSERT inlay hints、检查/诊断与索引导航仍存在只取活动 schema 的路径，需要逐语句/逐来源解析，并以真正的协议测试证明同一文档多个 schema 的行为。旧纯 hints 正例使用请求内证明，不代表生产文档级 hints 已全部接入。
3. **扩大语义范围**：模块所属 schema/执行上下文、动态 SQL、系统对象/临时表与例程的省略路径、远程默认数据库，以及完整限定列的投影来源、混合输入、递归/集合/复杂表达式类型仍需扩大覆盖。
4. **性能与总体验收**：继续优化长注释重复规范化、跨来源快照复制、真实异步元数据读取与取消，并验证可见主窗口、完整 Workbench、安装版和各厂商实际执行。全部 G01–G13、E01–E07 原目标保留；文件查询双入口保留，未提交/推送/发布。

## 第五十批：跨来源的文档提示与歧义诊断

2026-10-24。上一轮是进展：省略 schema 不再猜 dbo，并验证显式默认上下文的候选/类型。本轮核对发现文档级方法仍只拿活动 schema，继续修复这些真实路径；全部 G01–G13 / E01–E07 目标保持进行中。

### 行为与模块

| 场景 | 新行为及验证 |
| --- | --- |
| 同文档向 db.app、other.app、db.sales、remote.db.app 的同名表 INSERT | 按每条 INSERT 的真实目标返回各自列名，覆盖 VALUES 与 INSERT SELECT；实际协议和 Monaco 渲染核对四个来源 |
| `sales.ledger` 两段路径 | 使用活动连接的 server/catalog 上下文，不能跨未知 catalog 猜同名表 |
| SQL Server 省略 schema 与裸 INSERT 目标 | 有显式 namespace 上下文时复用默认 schema/已证明 dbo 回退；未知、部分和冲突上下文不借活动表名称 |
| 无元数据的显式 `INSERT missing(a,b)` | 可从 SQL 自己给出的列名生成提示；不再被生产 handler 的活动 schema 缺失提前拦截 |
| 跨 catalog/schema JOIN 或逗号输入的同名字段 | OXIDE004 能看到多个实际来源；限定字段、未知来源、局部 CTE 遮蔽和可见性反例保留 |
| didOpen/didChange、配置刷新、拉取诊断和 inline 验证 | 七处生产诊断调用传入元数据 manager；同 SQL 的列名/冲突变化刷新实际协议结果 |
| SQLite | 纳入同一歧义检查；旧协议测试的 SQLite 豁免移除，改为同样断言歧义警告 |

新 owner `src/relation_bindings/lookup.rs` 供局部投影、连接行、诊断和 INSERT 提示复用。物理查找严格检查明确的命名空间；有局部声明时继续遵守遮蔽。`SchemaManager::find_unique_table` 先在借用的快照中验证唯一性，只复制选中的表，不复制整份 catalog。

INSERT 请求创建 `RelationLookup`，正命中与未命中都记忆，最多 **64 个不同引用**；耗尽后既有命中仍可用，显式列名不消耗物理查找预算。它不跨请求保留，因此新请求能读到新元数据；测试验证同一引用在一次请求缓存内保持已有结果，下一请求刷新。这里没有证明所有引用在并发配置变更时属于同一原子元数据版本，后续仍需版本一致性审计。既有请求扫描窗口、64 KiB 范围和 500 提示上限保留。

### 真实失败、回归与桌面证据

旧第四十九批捆绑的同一探针只返回 `local_value:`，跨 catalog 的其他两条 INSERT 没有提示，并漏报 OXIDE004。`lsp-document-bindings-native-before.json` 保留原字节摘要和完整返回；新 `native-after.json` 对同一 SQL 返回 `local_value:`、`other_value:`、`sales_value:`，并有 1 条实际歧义警告。这是旧/新捆绑 stdio 的直接比较，不是替换算法的 mock。

- 本轮 Rust **1012 passed / 0 failed / 0 ignored，24 目标**，813 库 + 199 集成；新增 8 个服务行为测试、2 个 lookup 缓存/身份测试、2 个真实进程协议测试。新库用例涵盖多语句、默认/省略路径、显式列名无元数据、刷新、64 目标上限、未知/缺失活动元数据、局部投影和六种 SQL profile。
- 真实协议同时验证 pushed、pulled 与 inline 诊断、字段限定消除歧义、同 SQL 元数据更新和 INSERT 提示。新 release 的实际字节另跑 **78 协议测试**；测试替换的 debug 服务端已在 finally 恢复并核验。
- 严格 Clippy、fmt、本轮前端 build、模块与边界门禁通过（2823 文件；parser 35 模块 / 244 方法，共享方言 8 模块 / 91 函数）。前端生产 TS 未变；**2389 单测 / 417 文件沿用第四十九批结果，未在本批重新运行**，保存原 JSON 并核对既有记录的生产输入哈希；不把复用写成新执行。
- 应用捆绑集成 **13 项**通过；全部 Desktop Cargo 后用禁止执行的 PROTOC 构建并恢复 headless CLI，`oxide-agent 0.1.18`。
- 真实隐藏 WebView **50 场景 / 1700 断言**；新的独立 `documentBindingsScenario.ts` 运行生产 `registerLspCoreProviders`、LspClient 和真正的 Monaco inlay controller，DOM 必须出现 SQL 文本里不存在的四个来源列名。随后独立核对同 SQL 的协议 inlay、pushed 和 inline 诊断刷新；原推荐控件接受测试继续通过。
- 第一次桌面运行在实际控件已正确渲染后暴露测试宿主未注册 `lsp_validate_inline_completion`；已把应用已有的真实生产命令加入宿主注册，再沿同一客户端路径复测通过。原失败回执保留，没有把空响应或未运行当作成功。

Desktop 目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-BOyrN7`。机器证据 `.impeccable/review/lsp-document-bindings-evidence.json`，包含源码、二进制、前端实际输入和原始性能样本。窗口仍是隐藏 WebView，不等于可见完整 Workbench、安装包、实际数据库执行或远端元数据 I/O。

### 有界查找的性能观测

以下为生产 LspClient → Tauri → 捆绑 release 的单机 warm 请求：10 轮 / 2 次预热，预加载 metadata，不包括配置传输、首次加载、网络或完整 UI 绘制。每个目标一列，所有场景均返回 256 个正确提示；65 个不同目标中的第 65 个被预算挡住，其余引用仍在每次请求内重用。

| 不同目标数 | 每目标重复次数 | 返回提示 | p50 ms | p95 ms |
| --- | --- | --- | --- | --- |
| 1 | 256 | 256 | 8.30 | 9.50 |
| 64 | 4 | 256 | 9.80 | 10.70 |
| 65 | 4 | 256 | 10.70 | 11.50 |

样本用于记录这个实现的范围和成本，不证明整体性能提升或 DBX 横向领先。超宽表/超长注释、跨默认 namespace 的快照复制、并发更新和实际异步读取仍需进一步量测。

### 二进制、源码包与 DBX

捆绑 SHA-256 `4adee83deb013dca8ca31b37b5af794a3ef96ed93e0508a455484e27a53d8685`；**262 文件**运行时输入指纹 `14906b16d5036f7b8f21085d7bac33fcbb5ee6738dff32846de72be6a64868af`。源码包 **288 文件 / 248 Rust / 2807744 字节**，SHA-256 `a4f640c8f7e7399771f951e63b5e8481d20ef023ef8cc48bd0bd1db56e04d3d1`；逐字节匹配全部 Rust 和 16 个额外输入，锁文件换行规范化与 TOML 一致；未做解包后独立构建。相对第四十九批包新增 2、修改 10、无删除；语法未改，12 指纹核对通过，6 个生成文件的独立再生成字节证明明确沿用第四十三批。

DBX 工作树仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`，本批未 fetch。原始 SQL/schema/光标夹具及 DBX bundle 不改，用新 release 重跑 **53 夹具 / 159 计算**：Oxide 名称 46/46、类型 44/44、隔离 7/7；DBX EditorState 35/46、18/44、3/7。文档提示与诊断新用例不算入固定 53 组，矩阵通过不代表所有功能/方言已经对齐。见 [固定夹具报告](dbx-sql-completion-comparison-2026-10-24.md)。

### 仍需完成的工作

1. **屏幕缓存和并发一致性**：本批实际渲染验证初始正确标签，元数据刷新验证实际协议与诊断；不声称 Monaco 已显示的旧行内提示在没有 SQL 编辑时会重绘。核心 provider 的刷新事件/失效机制及多来源请求的元数据版本一致性需接入并测试。
2. **全部方法的来源一致性**：继续核对位置相关字段推荐、裸名字默认上下文、完全限定列投影、导航/引用/重命名/quick fix，以及其他检查规则；不能把 OXIDE004 接入外推为所有检查都完成。INSERT CTE 目标、更多复杂 INSERT 结构、模块/例程/临时表和远程默认数据库也需补足。
3. **真实连接元数据闭环**：签名驱动应采集有效默认 schema、数据库/权限会话上下文和完整表枚举证明并正确刷新；现在应用尚未自动提供 namespace 元数据，缓存路径也没有 linked-server 传输。不要把 UI schema 或部分表快照当作完整证明。
4. **原总目标**：继续长注释/超宽表/真实 I/O 性能、可见主窗口、完整 Workbench、安装版、厂商实际执行与远端 CI；G01–G13 / E01–E07、文件查询双入口全部保留，未提交/推送/发布。

## 第五十一批：元数据变化后的真实行内提示刷新

2026-10-24。本批继续完成第五十批留下的屏幕缓存刷新。所有 G01–G13 / E01–E07 保持进行中；文件查询的侧栏与打开文件双入口保留。

### 行为与模块

| 场景 | 当前行为与验证 |
| --- | --- |
| SQL 和 Monaco model version 均未变化，服务器元数据更新 | 接收生产诊断发布作为分析完成边界，使 inlay 与 semantic-token provider 失效；同 SQL 可连续刷新 |
| 其他连接、URI、方法或畸形版本通知 | 精确 sessionKey、URI 和方法校验；拒绝负数、小数和不安全整数版本 |
| LSP 影子版本 7，Monaco 版本 42 | 比较实际 LSP 文档版本；两个独立计数不能相互代替 |
| SQL 已修改但尚未同步、文档已销毁或影子状态缺失 | 不接受这次发布；测试覆盖文本比对和未同步边界 |
| 旧异步请求在新发布之后完成 | 本地 generation 立即递增并清除缓存；丢弃旧代返回值，取消或销毁后也不能恢复旧提示 |
| 同一 SQL 版本重复发布 | 不按 SQL 版本去重；元数据可能已经更新。仅合并同一微任务中的渲染事件 |
| 关闭编辑器、迟到的异步监听注册 | 幂等清理和迟到 unlisten，保持核心 provider 稳定注册；无需重建全部 provider |

`src/services/lsp/documentAnalysisEvents.ts` 负责生产 Tauri 事件的身份与载荷过滤；`src/features/query-editor/model/lspProviderRefresh.ts` 负责 generation、事件合并与释放。核心 coordinator 只接入协议请求和 Monaco 事件，查询编辑器与文件查询传入已有的 LSP 文档影子引用，避免再维护一套版本状态。此处的取消是前端跳过/丢弃结果，不证明服务器计算已经取消。

### 真实失败与 Monaco 安装修复

旧核心 provider 的真实隐藏 WebView 在“元数据变化且无 SQL 编辑”场景失败，原始回执为 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-BKBjCt`。后端原始协议当时已经返回新列名，屏幕仍显示旧标签。

加入 provider 刷新事件后，真实验收仍然失败，回执为 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-8nSkgj`。定位到已安装 Monaco **0.55.1**：`watchedProviders` 贯穿模型会话，但 `onDidChangeInlayHints` 订阅放在每次请求会重置的 store，下一次请求将监听器释放，却不再重新订阅。补丁将该订阅归属改为会话级 `_sessionDisposables`，会话结束时仍正常释放。

`scripts/patch-monaco-inlay-hints.mjs` 只接受已审阅的原始字节或已修复字节，版本/摘要不符会拒绝改写；重复安装不重写。根依赖显式固定 `monaco-editor: 0.55.1`，保留原 React 包补丁并串入同一 postinstall。锁文件未升级任何包版本。

- 原控制器 SHA-256：`f3343cae3778782f91afff55a1e92b32b8397ac3a900261a66204192ffdae1d8`。
- 修复后 SHA-256：`fbb97d01300b69a11f64fbe2c58fb6b6b348b837d774e3b7053632bfdc180be1`。
- 新增安装测试 **5 项**：应用、幂等、版本拒绝、未知字节拒绝、根依赖/安装链；连同原 React 补丁测试共 **8 项通过**。

原失败、仅前端事件修复时的失败和最终成功均保留。中间失败与最终通过的生产前端模块哈希相同，最终验收另记录实际 Monaco 控制器摘要，避免把只修改工作树而未进入运行 bundle 的补丁当作成功。

### 本批新执行的验证

- 前端 **2413 passed / 0 failed / 0 skipped，419 文件**，新增 24 项（事件服务 8、generation owner 8、核心 provider 8）；覆盖缓存、乱序返回、取消/释放、会话/文档/影子版本、未同步文本及重复发布。
- 安装补丁 Node 测试 **8 passed / 0 failed**；严格 TypeScript 和前端 build 通过，模块边界检查 **2827 文件**。
- 真实隐藏 WebView **51 场景 / 1718 断言**，使用生产 LspClient、Tauri 通知、核心 provider 与真实 Monaco controller。对四个来源的 INSERT 提示实际检查 DOM；固定 SQL/模型版本连续更新三次元数据，旧标签消失、新标签出现，其余来源标签保留。
- 三次元数据提交至实际提示可见的本机观测为 **77.2, 82.1, 78.6 ms**。只有这三个预加载样本，不是 p95、DBX 横向性能或真实网络/冷启动结论。
- 原缓存语义推荐的真实 suggestion widget 接受、完整文档与局部元数据、命名空间隔离验收继续通过；本批新增范围主要是提示刷新，不据此扩大 SQL 类型推断支持声明。
- 应用捆绑集成 **13 项**通过；全部 Desktop Cargo 完成后以禁止执行 PROTOC 的脚本恢复无默认 feature CLI，`oxide-agent 0.1.18`。

最终 Desktop 目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-iBDqeM`；机器证据 `.impeccable/review/lsp-provider-refresh-evidence.json`，完整日志位于同前缀文件。验收窗口为隐藏 WebView，未验证可见主窗口、完整 Workbench 或安装包。

### 未变化的后端与 DBX 对照

Rust LSP 源码、262 个运行输入指纹与捆绑 release SHA-256 `4adee83deb013dca8ca31b37b5af794a3ef96ed93e0508a455484e27a53d8685` 均与第五十批相同。因此 **1012 Rust / 24 目标、78 项捆绑实字节协议测试与 DBX 53 夹具结果均明确复用第五十批，未在本批重跑**。原源码包 288 文件 / 248 Rust / 2807744 字节，本批重新逐字节核对 Rust 和 16 个额外输入、锁文件 TOML；没有另做解包后独立构建。语法 12 指纹重新核对，6 生成文件的再生成证明仍沿用第四十三批。

DBX 参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，本批未 fetch，不能称为已确认的远端最新。固定矩阵中的 Oxide 名称 46/46、类型 44/44、隔离 7/7；DBX EditorState 35/46、18/44、3/7。它是固定源码/夹具比较，不是 DBX 完整桌面产品的总体胜负；见 [固定夹具报告](dbx-sql-completion-comparison-2026-10-24.md)。

### 仍需继续的差距

1. **服务端并发版本一致性**：本地 generation 隔离旧响应不等于服务器多个来源来自同一原子 metadata snapshot。诊断发布可能交错、请求内多次查找与配置更新的版本一致性仍需审计与协议测试。
2. **真实连接上下文**：自动采集有效默认 schema、数据库/权限/会话与完整表枚举证明，并在变化时正确失效；不以 UI 当前 schema 或部分表快照代替。远程 linked-server 元数据读取仍未接通。
3. **复杂语义与各方法一致性**：继续核对复杂表达式/集合/递归类型、裸名默认绑定、完全限定列投影、导航/引用/重命名/quick fix、INSERT CTE 目标、模块/例程/临时表和远程默认数据库。
4. **完整产品与性能**：长注释/超宽表、大 catalog 连续编辑、真实异步 I/O 与取消、厂商版本执行、可见 Workbench/安装版、多平台和远端 CI。全部 G/E 目标保留；未提交、推送或发布。

## 第五十二批：配置事务与诊断快照的一致性

2026-10-24。第五十一批完成屏幕刷新后，本轮继续修复服务器多来源分析的并发窗口。旧实现把 schemas、schema/dialect 路由和偏好分步替换；异步方言分析返回之后，还可能继续读取更新后的 manager，从而让一个请求跨越两份配置。

### 行为与模块

| 场景 | 当前行为与验证 |
| --- | --- |
| 推荐分析暂停时配置更新 | 配置等待已有分析结束；旧请求使用旧配置，提交后新请求使用新配置 |
| 多个读取请求与排队的配置写入 | 读取可并发；排队的写入不会被后来的读取越过；取消旧请求会释放读取许可 |
| 同 SQL 连续更新三个不同 catalog 的表 | 原生协议连续 24 次更新，三个 INSERT 标签必须来自同一个 epoch，最终屏障检查 epoch 24 |
| 诊断算完后等待发送，此间提交新 metadata | 发送前再次核对配置 revision；已过期的计算直接丢弃 |
| 解析诊断期间编辑文档 | 保留计算时文本/版本/内部 revision，不会把旧 SQL 标成新 LSP 版本 |
| 文档关闭后以相同 URI、相同 SQL、相同 version 重开 | 内部 revision 独立递增，拒绝旧会话的诊断计算，避免 ABA |
| 一次 didChange 包含多次增量编辑 | 依次应用 UTF-16 范围，只提交最终文本和版本并分析一次，不发布中间文本 |
| 日志或诊断发送遇到客户端背压 | 配置锁在客户端 I/O 前已释放；配置提交仍能进行 |

`src/server/analysis_state.rs` 集中管理配置提交及读写协调；原 JSON 应用逻辑从 protocol 移入该 owner。默认方言、表/例程元数据、文件路由及偏好在一个写入区间提交，生产 transport 分析入口持有对应读取许可，内部 helper 不再次获取许可，避免公平写队列下的递归读取死锁。覆盖普通 completion、hover、导航/引用/重命名、signature、code action、formatting、文档结构、semantic tokens、inlay、workspace symbol、拉取诊断，以及两个 inline 自定义入口。

`src/server/analysis_publication.rs` 统一 didOpen、didChange 和配置刷新发布路径：分析期间固定配置，计算结束后释放读取许可；串行发送前再校验配置和文档 revision。发送顺序与分析并行度分开管理，客户端 bounded queue 的等待不占用配置锁。`DocumentManager` 将过去三个 DashMap 的文本、wire version 和 revision 合为同一个文档项；snapshot 一次读取完整状态，全局递增 revision 不在关闭时复用。

这是**读写事务隔离**，没有改为 copy-on-write 的不可变 catalog。每次分析不新增全 catalog 复制，但配置提交需等待已有分析完成；不宣称高并发下配置写入的延迟已经优化到最终目标。已开始进入客户端发送队列的通知不能撤回，配置提交和网络投递也没有组成原子事务；串行发送确保新的发布不会被更旧的计算随后越过，前端仍使用版本/文本和本地 generation 隔离。

### 真实失败与测试

- `lsp-analysis-consistency-red.log` 保留旧实现的实际失败：暂停真正的 PostgreSQL completion 后，配置已把 `old_value` 改成 `new_value`，分析尚未结束。本轮用真实 provider 外包一层可控 Notify 暂停来安排交错，解析与候选仍由生产 PostgreSQL provider 执行；不依赖 sleep 猜时序。
- 新增 **7 个服务调度/发布测试 + 2 个 DocumentManager 测试**。覆盖分析隔离、读取并行/写入公平/取消释放、排队诊断的 metadata 失效、旧文本与版本、同版本重开、真实客户端背压和 Unicode 多编辑；文档测试并发核对 5000 次文本/版本快照。背压用公开 LspService initialize 建立实际已初始化客户端，避免把初始化前被抑制的通知当成发送成功；为此新增已锁定的 tower 0.4.13 测试依赖，关闭默认 features，未升级依赖版本。
- 新增 **2 个真正 stdio 进程测试**：24 次配置/三来源请求突发及最终版本确认；UTF-16 多编辑后最终诊断与 INSERT 标签。最初协议检查把编辑前合法排队的 version 1 也要求等于 2，已修正为允许旧版本先到，同时禁止 version 2 后倒退；原失败日志保留。
- 全量 **1023 passed / 0 failed / 0 ignored，24 目标**：822 库 + 201 集成；新的捆绑 release 实际字节另跑 **80 项协议测试**通过。调试测试二进制替换后在 finally 恢复并核对摘要。
- 严格 Clippy、fmt、前端 build 和边界门禁通过，模块文件数 **2830**；parser 35 模块 / 244 方法、共享方言 8 模块 / 91 函数。前端生产与安装补丁输入哈希均未变，**2413 前端单测 / 419 文件明确复用第五十一批结果，本批未重跑 Vitest**。
- 真实隐藏 WebView **51 场景 / 1718 断言**重新通过，包括实际 suggestion widget 接受语义候选、完整文档/局部元数据隔离、跨来源 Monaco 行内提示及三次无 SQL 编辑刷新。应用捆绑集成 **13 项**通过；全部 Desktop Cargo 结束后以禁止执行 PROTOC 的脚本恢复无默认 feature CLI，`oxide-agent 0.1.18`。

最终桌面目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-3UQBXv`；机器证据 `.impeccable/review/lsp-analysis-consistency-evidence.json`，原失败与全部新执行日志使用同前缀。隐藏 WebView 不证明可见主窗口、完整 Workbench、安装版或真实数据库执行。

### 本机观测与来源

无 SQL 编辑的三次实际 Monaco 刷新观测为 **76.9, 79.5, 81.3 ms**。原 INSERT 有界查找性能场景也以新二进制重跑，预加载 metadata、10 轮 / 2 次预热，不计网络、首次加载或完整 UI；每个场景返回 256 个正确提示。

| 不同目标数 | 每目标重复 | p50 ms | p95 ms |
| --- | --- | --- | --- |
| 1 | 256 | 11.50 | 13.90 |
| 64 | 4 | 14.30 | 16.10 |
| 65 | 4 | 14.00 | 15.60 |

这些数值只记录当前实现的成本，不证明 DBX 横向性能领先，也不能代替并发配置写入等待、超宽表/长注释、冷启动/RSS 或真实异步 I/O 量测。

新捆绑 SHA-256 `eccdad18d6e4ecd7cf39298ec62d7565253730e196fbb20d940a9dd1fc1a48f2`；**265 文件**运行输入指纹 `4af1b20825603e877e05b5749c71fa416027bf0ff20f416d04f1cc1676ce017e`。源码包 **291 文件 / 251 Rust / 2810848 字节**，SHA-256 `6449d7b251571aafd838fad1dc81ae4df05688df3c084b258d1b240dcab90e94`；全部 Rust、16 个额外输入逐字节核对，锁文件换行规范化和 TOML 一致，未做解包后独立构建。相对第五十一批新增 3、修改 8、无删除，语法未变化；12 指纹重新核对，6 生成文件的独立再生成字节证明仍沿用第四十三批。

DBX 保持干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，本批未 fetch，不称远端最新。原夹具和 DBX bundle 摘要不改，新 release 重跑 **53 夹具 / 159 计算**：Oxide 名称 46/46、类型 44/44、隔离 7/7；DBX EditorState 35/46、18/44、3/7。新并发/文档版本测试属于独立协议矩阵，不增加固定 53 的分母。见 [同夹具报告](dbx-sql-completion-comparison-2026-10-24.md)。

### 仍需完成的差距

1. **真实连接上下文闭环**：从签名驱动会话采集有效默认 schema、数据库/权限/执行上下文和表枚举完整性，并正确刷新；应用目前尚未自动提供这些 namespace 证明，linked-server 元数据通道也未接通。
2. **复杂类型与方法一致性**：继续完善集合/递归/复杂表达式类型、裸名默认上下文、完全限定列投影、导航/引用/重命名/quick fix，以及 INSERT CTE 目标、模块/例程/临时表/远程默认数据库。
3. **并发和性能扩展**：量测公平写队列等待、大 catalog 更新、连续编辑/RSS/长注释与实际 I/O；需要时改为共享不可变配置快照。当前事务保证针对服务器配置入口，不能代表驱动已提供原子数据库快照，也不证明传输投递与提交原子化。
4. **完整产品验收**：更多厂商版本实际执行、多平台/远端 CI、可见主窗口/完整 Workbench/安装版。G01–G13 / E01–E07 和文件查询双入口全部保留，未提交、推送或发布。

## 第五十三批：驱动确认的默认上下文与实际推荐链路

2026-10-24。本轮补齐真实元数据输入契约。此前 `Schema.namespace` 只在单元/协议/桌面夹具中显式提供；应用没有驱动接口读取有效默认 schema，不能把资源管理器当前选择当成默认上下文。本轮接通可选的驱动上下文链路，同时保留未知与权限边界，不改变 G01–G13 / E01–E07 的完整目标。

### 从驱动到推荐

| 环节 | 行为与边界 |
| --- | --- |
| 驱动协议 | 可选 `sqlLookupContext` runtime capability，旧包省略为 false；`metadata` 的 `sqlLookupContext` 请求带可选 database，返回 database/defaultSchema 或 null |
| JDBC SQL Server Agent | 在既有串行连接执行器中应用并回读数据库上下文，再执行固定 `SELECT DB_NAME(), SCHEMA_NAME()`；成功/失败均走原 QueryContext 的恢复逻辑，不设置侧栏 schema，也不插值数据库名称到 SQL |
| Host | DatabaseDriver 默认返回 None；ExternalDriver 只有 runtime 明确支持才请求 metadata，验证名称与请求数据库，拒绝错数据库/畸形上下文。Host 不为外部包生成探测 SQL |
| Tauri | 新只读 `get_sql_lookup_context` 经 ConnectionManager 获取实际 driver；其他驱动保持未知，不套用 SQL Server 的单默认 schema 规则 |
| 同步 resolver | 每轮按数据库去重查询，拒绝互相冲突的默认值；将未知的当前 catalog 绑定到驱动确认的 database，重建一致的文件映射并保留首选表，缺少默认 schema 时将它加入元数据加载 |
| 生产同步任务 | 复用原分批 table loader、来源 URI、配置签名和实际 LspClient；新 namespace 会进入配置签名。过期 generation 不再加载表或发布新配置，失败会报告 limited |
| 完整性 | 此契约没有证明目录能发现所有对象，`tables_complete` 固定 false。默认 schema 中已知存在的表可用于绑定；缺表时不凭空回退 dbo |

默认 schema 来自调用者在目标数据库中的实际上下文：[SCHEMA_NAME](https://learn.microsoft.com/en-us/sql/t-sql/functions/schema-name-transact-sql?view=sql-server-ver17)；无参数数据库名称来自 [DB_NAME](https://learn.microsoft.com/en-us/sql/t-sql/functions/db-name-transact-sql?view=sql-server-ver17)。元数据可见性受权限约束，目录空结果可能不足以证明对象不存在，参见 [Metadata Visibility Configuration](https://learn.microsoft.com/en-us/sql/relational-databases/security/metadata-visibility-configuration?view=sql-server-ver16)。因此本轮没有把“完整读取了可见列表”冒充缺表证明。

主要新 owner 为 `src/features/lsp-sync/runtime/loadSqlLookupContexts.ts` 和 `src-tauri/src/drivers/external/lookup_context.rs`。原 `createLspSyncJob` 负责装配，现有 table loader 继续负责字段、索引、约束及缓存；没有复制一套候选算法。协议只传上下文名称，不传连接字符串、用户凭据或可执行 SQL。

### 真实失败与验证

1. **Windows UTF-8 失败**：新的 JVM 协议测试在中文数据库名上实际出现替换字符，日志 `lsp-live-namespace-jdbc-test.log` 保留失败。JDBC Agent 的 stdin reader 与 stdout writer 均改为明确 UTF-8；同测试随后通过，中文、带标点/引号的数据库名保持完整。
2. **JVM 边界**：真正运行编译后的 DriverMain 与 JDBC ProxyDriver 夹具，核对握手、请求数据库、引擎默认 schema、成功/SQL 错误/多行/错数据库/忽略 setCatalog 后的恢复、缺省值和非 SQL Server 的 null。固定 SQL 也由夹具校验，禁止名称插值。这里是实际 JVM 协议/驱动边界测试，不是实际 SQL Server。
3. **14 个前端测试**：9 个 resolver、4 个生产 sync job、1 个 Tauri service。覆盖按数据库去重、未知 catalog 重绑定、不同数据库隔离、旧驱动 null、失败/畸形/冲突、其他方言隔离、刷新后新默认值及过期异步结果；生产 job 验证实际发送的 namespace、字段、文件 schema ID 和 limited 状态。
4. **Host 与协议**：新增 2 个 validator 测试与 2 个协议测试；原最小 driver 默认契约测试扩大到 None。协议 crate **14 passed / 0 failed / 0 ignored**；Host headless 库 **405 passed / 0 failed / 4 ignored**，Desktop 库 **1060 passed / 0 failed / 12 ignored**，应用捆绑集成 **13 passed**。跳过项为已有真实 MySQL/PostgreSQL、外部 DuckDB 文件场景和显式大文件/进程故障专项，未当成通过。
5. **前端与其他 runtimes**：本轮最终源码新跑 **2427 passed / 0 failed / 0 skipped，422 文件**；build、严格 TypeScript 与模块门禁 **2836 文件**通过。DuckDB/ClickHouse/rqlite 的可选请求分支编译检查均通过；这三类 runtime 不声明此能力，返回 null。
6. **真实 WebView**：**52 场景 / 1730 断言**。新宿主管理 ConnectionManager 的元数据 fixture driver，注册应用真实 metadata commands；生产 schema identity、sync job、table loader、LspClient 和 Tauri 实际调用将 `selected` 与驱动确认的 `sales` 两个 schema 送入捆绑 release。`db..ledger` 的 CTE 输出 net 取得 sales 的 bigint，实际 Monaco 完整替换 `netSuffix`，接受后 hover 保留类型。原建议控件、复杂查询及无编辑行内提示刷新继续通过。

初次新增桌面场景在文件绑定处失败：测试宿主硬编码 sqlserver 文档后缀，而应用使用通用 sql 文档并单独配置 SQL Server 方言。已改为使用应用同一语言选择函数，原失败回执 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-YTVOS3` 保留；没有更改生产路由来迁就夹具。最终回执目录 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-pgVuyZ`，`liveSqlServer=false`、`driverFixture=true`、`namespaceAbsenceProven=false` 均在机器证据中明确保留。

严格 Host Clippy 通过；Desktop 工作结束后以禁止执行 PROTOC 的脚本恢复无默认 feature CLI，`oxide-agent 0.1.18`。本轮没有发起真实 SQL Server 查询、更新安装中的签名驱动包或执行完整可见 Workbench/安装版验收。

### 复用的 LSP 与 DBX 基线

LSP 运行源码、265 文件输入指纹、捆绑 SHA-256 `eccdad18d6e4ecd7cf39298ec62d7565253730e196fbb20d940a9dd1fc1a48f2` 与第五十二批相同。源码包 SHA `6449d7b251571aafd838fad1dc81ae4df05688df3c084b258d1b240dcab90e94` 保持原 291 文件 / 251 Rust。**1023 LSP Rust、80 捆绑协议及 DBX 固定 53 夹具结果均沿用第五十二批，本批未伪称重跑**；本批新增的真实桌面链路重新运行了当前 LSP 和新生产元数据装配。固定 DBX 算法矩阵没有包含新驱动契约，不据此推断 DBX 完整产品已对齐。

DBX 仍为干净的 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch，不称远端最新。机器总证据 `.impeccable/review/lsp-live-namespace-evidence.json` 包含当前源码哈希、前端运行输入和实际跳过数；原始日志同前缀。

### 下一步与部署边界

- **签名驱动与真实引擎**：本轮修改并测试的是 JDBC Agent 源码。已安装旧包省略能力时仍返回未知，需后续重打包、签名、精确版本绑定和真实 SQL Server 验收，不能称旧安装已自动支持。未提交、推送或发布。
- **权限与上下文完整性**：补充驱动能够证明的对象存在/缺失契约、默认 schema 不存在与 dbo 回退、权限/角色/用户、连接替换和会话变化的失效闭环。每轮重新采集不等于已经证明所有 USE、EXECUTE AS、事务或模块执行上下文。
- **方言与语义**：SQL Server 的单默认值不外推为 PostgreSQL search_path；继续复杂类型、全限定投影、裸名、导航/引用/重命名/quick fix、模块/临时对象与远程来源的一致性。
- **性能与完整产品**：当前按数据库去重及分批 enrichment 保留，尚未证明真实网络下上下文采集、超大默认 schema、并发更新/取消的成本。可见 Workbench、安装版、真实厂商版本和多平台/远端 CI 仍待继续；全部 G01–G13 / E01–E07 和文件查询双入口保留。

## 第五十四批：驱动发布门禁与真实引擎候选

2026-10-24。本轮处理上一批元数据链路的发布与实际驱动验证条件。它决定复杂推荐所依据的默认 schema 是否可信，不新增一套补全算法，也不把包握手或容器控制流单元测试当成真实 SQL Server 验收。

### 必须验证的上下文与包文件

Conformance runner 升级为 **1.3.0**。runtime 声明 `sqlLookupContext=true` 时，fixture 必须给出当前 database/defaultSchema、1–8 个不同的目标数据库和独立的当前上下文查询；反向亦要求 runtime 明确支持 lookup 与 metadata。检查先于连接凭据传递。每次目标数据库 lookup 后，同时核对恢复后的 metadata 和独立查询，防止只在返回值中伪装已恢复。独立查询必须只读，且不能通过 QueryContext 重新选择 database/schema 后再声称观察到了恢复。

报告仅添加四个 metadata 检查标识，不写上下文名称、SQL、凭据或结果值。该证明仍不意味着目录完整、缺表可见或所有角色/会话切换均已覆盖。代码按包文件校验、上下文证明、实际引擎生命周期拆成独立 owner；共享 runner 只负责装配。

新增路径反例先实际得到 **3 failed / 1 passed**：Windows 使用 PATH 分隔符判断父路径，导致越界文件可通过；Java classpath 在 launch override 下未校验；目录 junction 可指向包外。现统一校验 entrypoint 和全部 Java classpath 的相对路径、逐层文件类型和 SHA-256，即使测试覆盖启动命令也不跳过。此检查不宣称消除恶意并发文件替换，也不代表整个包根目录的原子快照。

| 本批新跑 | 结果 | 证明范围 |
| --- | --- | --- |
| 原有 conformance | 5 passed | 保持已有协议/报告行为 |
| 包路径 | 8 passed | 越界、Windows/POSIX 绝对路径、junction、目录和摘要反例，合法嵌套路径 |
| lookup 证明 | 11 passed | 缺少声明/fixture、错库/错 schema/null、metadata 与独立查询泄漏、伪重置反例 |
| 容器控制流 | 8 passed | 未接受许可不调用 Docker、固定镜像、loopback/资源、错误恢复及所有权检查；使用假 Docker 回调 |
| JDBC 回归 | 3 passed / 0 skipped | 实际 H2 2.3.232 引擎、实际 JVM lookup ProxyDriver、打包依赖摘要；不是真实 SQL Server |

原失败保留在 `.impeccable/review/lsp-release-gates-path-red.log`；最终 32 项与 JDBC 回归日志同前缀。没有为未运行的真实引擎生成 conformance 通过回执。

### 可审阅候选与待确认的真实测试

已使用 Java 21 编译当前 Agent，打包实际 Microsoft JDBC **13.4.0.jre11**。这是固定审阅版本，不宣称最新；其 Java 21 支持见 [Microsoft JDBC release notes](https://learn.microsoft.com/en-us/sql/connect/jdbc/release-notes-for-the-jdbc-driver?view=sql-server-ver17)。Maven 发布方 SHA-256 已核对，候选的 entrypoint/classpath 摘要再次通过相同包校验。实际启动打包后的 JVM，握手确认 `sqlLookupContext=true` 和精确候选版本，随后关闭；没有建立数据库连接。

- 本地候选：`.impeccable/review/lsp-release-gates-artifacts/sqlserver-0.1.1-lookup-preview.54/manifest.json`，`oxide.jdbc.sqlserver@0.1.1-lookup-preview.54`。
- Manifest SHA-256：`f101f19ee1c93d5191958b264de9f05af7ff59cbe3ea27ecc24a67cc9c83fc33`。
- Agent SHA-256：`0f80b069dd8907be3826389aa2c53ee1e7bb009940aa8a856cdec5f134ac6548`。
- Vendor JAR SHA-256：`e36f5237c1267983e5b88dc2169f6b9d7e50eceec6dc1ca31018e3877e14af66`。

本地发布流程使用的 `DRIVER_MINISIGN_SECRET_KEY_B64` / `DRIVER_MINISIGN_PUBLIC_KEY_B64` 均未配置，仅记录存在性，不读取或输出值。候选未签名、安装或发布；旧安装不因此自动升级。

`scripts/test-sqlserver-lookup.mjs` 已准备固定 MCR digest 的 Developer 临时容器，限制 3 GiB/2 CPU，仅本机随机端口，无持久卷。只有新建且带随机所有权标签的容器会创建两个测试数据库和低权限用户；结束时核对标签及完整 id 后清理，成功且清理完成才落盘证据。密码经内存/子进程环境/stdin 传递，不进入 argv 或报告。用独立默认 schema 和同名 dbo 表验证实际绑定，并通过参数化 CTE/窗口查询、跨库执行、metadata、错误分类和 lookup 恢复检查。

启动必须明确设置 `ACCEPT_EULA=Y`，要求来自 [微软 SQL Server 容器快速入门](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver16)。已向用户提交具体候选和资源/清理计划，许可确认仍待回复；无 `--accept-eula` 的拒绝路径已实测，未启动或拉取该 SQL Server 容器。计划见 `.impeccable/review/lsp-release-gates-artifacts/REVIEW.md`。容器启动、真实 SQL Server、发布签名与安装验收均保持未完成。

### 基线复用和后续差距

机器证据 `.impeccable/review/lsp-release-gates-evidence.json` 重新核对第五十三批记录的应用、JDBC、桌面场景源码哈希，以及 LSP 输入指纹、捆绑摘要和源码包摘要。生产输入没有变化；**2427 前端 / 422 文件、Host Desktop 1060 / 12 ignored、headless 405 / 4 ignored、协议 14、应用集成 13、隐藏 WebView 52 场景 / 1730 断言均沿用第五十三批，本批未重跑**。**1023 LSP Rust、80 捆绑协议和固定 DBX 53 夹具原始执行仍为第五十二批**；此轮未重跑或声称新增 Native/真实推荐验收。DBX 保持干净的固定 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch，不称远端最新。

下一步仍包括真实 SQL Server 与签名安装、权限/缺表证明和上下文失效、PostgreSQL search_path、复杂类型与各 LSP 方法一致性、真实网络性能/取消及可见完整 Workbench/多平台验收。全部 G01–G13 / E01–E07 与文件查询双入口保留；未提交、推送或发布。

## 第五十五批：重连上下文与持久元数据刷新

2026-10-24。上一轮是发布门禁的实际进展。本轮继续应用侧上下文失效，发现同一个 connection ID 在后端重建后，LSP 能力 hook 的依赖没有变化，可能继续使用旧 serverVersion/包能力；同步任务也可能命中旧内存或持久表定义。此问题不需要等待 SQL Server 许可即可用生产 React/store/同步任务复现。

### 修复与模块边界

- `LspConnectionSyncer` 订阅活动连接的运行状态对象，并传给能力解析与元数据同步。按不可变状态对象区分两次会话，即使 `updatedAt` 相同也会失效，不把毫秒时间当成唯一身份。
- `useLspCapabilityContext` 将返回值绑定到运行状态、连接 ID、driver、精确包版本与 catalog 状态；替换后的首个 render 不暴露前值。connecting/idle/error 不发 introspection；旧请求完成或 fallback 返回时不得覆盖新上下文。没有运行描述符的既有调用保持兼容。
- `useLspSchemaSync` 在同 ID 的运行状态替换时发送空 schemas/file mappings，等待确认后才装配新元数据；清空失败报告 error，不声称新上下文已同步。运行状态或 metadataVersion 变化清掉本地表定义、关系索引和配置去重缓存，已取消的异步任务不得发布。
- `createLspTableLoader` 新增可选 `forceMetadata`。新会话，以及一次完整同步之后的 metadataVersion 变化，将通过已有共享加载器强制取回字段/索引/约束，避免清内存后立即读回持久旧数据。稳定会话仍使用本地 TTL/cache 和现有分批并发；没有引入每次按键全库扫描。
- 新独立 owner `configurationQueue.ts` 按同一生产客户端 bridge 串行发送配置。旧传输、空配置、替换元数据依次提交；单次失败不使后续队列永久失败，不同客户端互不阻塞。开始实际发送前再次检查进程是否初始化；这不是不同客户端/外部发送者间的全局队列。

### 真实反例与本轮验证

能力 hook 的原始测试 **6 failed / 2 passed**：同 ID/同时间的新会话未读取、不可用状态仍读取、旧响应覆盖了新版本。接入运行状态后，React 同步集成又得到 **2 failed / 19 passed**，证明持久旧字段重用与旧表请求迟到发布；失败日志同前缀 `lsp-session-refresh-` 保留。没有删掉负例以得到绿灯。

新增 **8 能力 hook、5 React/store 同步集成、5 配置传输顺序测试**。集成使用生产组件、Zustand store、同步计划、table loader 和实际持久缓存编解码，Tauri/数据库调用为 mock。覆盖相同 timestamp、无效状态、未完成重连、旧响应、旧持久记录、metadataVersion 刷新、清空等待/失败及无关 store 更新不重复扫描。配置测试覆盖延迟、失败恢复、客户端隔离、停机和回收。

本轮新跑全量 **2445 passed / 0 failed / 0 skipped，424 文件**。严格 TypeScript、生产 build、全部既有模块门禁 **2839 文件**通过。没有通过增加模块预算容纳改动；当前同步 render 测试文件 927 行，仍在 1000 行预算内。

真实隐藏 WebView **53 场景 / 1735 断言**通过，回执 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-c9R58L`。新增场景用实际 Tauri → 捆绑 LSP → Monaco 模型：清空来源后，省略 schema 的 CTE `net` 不再借用旧 bigint；在生产客户端入口并发调用三次配置，最终恢复 `net` 的 bigint、实际 completion edit 与物理字段 hover。原 52 场景重新运行。此场景验证配置与类型刷新，连接重建本身由前述 React/store 测试验证；没有把它描述成真实 SQL Server 重连或完整可见 Workbench。

Desktop 验证结束后，以禁止执行 PROTOC 的脚本重新构建无默认 feature CLI，版本仍为 `oxide-agent 0.1.18`。本轮 Rust 生产源码、JDBC Agent、协议及 vendor LSP 均未改；Host 数字沿用第五十三批，LSP 1023/捆绑协议 80/固定 DBX 53 原始执行沿用第五十二批。LSP 输入指纹、捆绑字节和源码包摘要保持原值，不宣称本轮重跑这些套件。

### 剩余边界

1. 本轮保证的是观察到的运行状态替换、元数据版本通知和服务端来源重采集。任意 SQL 内的 USE、SET ROLE、EXECUTE AS、动态 SQL/存储过程、事务中途失败或独立后台调用仍可能改变上下文，需要驱动/查询生命周期的权威失效信号；不能仅凭首关键字覆盖全部场景。
2. 编辑器已显示的推荐及缓存降级候选，还需同步绑定运行状态和元数据代次，并丢弃跨上下文的延迟结果。当前清空服务端来源和重新读取元数据，不等于已证明所有前端缓存列表即时撤回；清空失败时也不能保证旧列表已消失。
3. 元数据可见性/缺表证明、PostgreSQL search_path、复杂类型与导航/引用/重命名等方法一致性、真实网络成本/取消、可见 Workbench/安装版、多平台/远端 CI 均保持原范围。强制读取增加的是会话替换/显式元数据刷新时的 I/O，本轮没有实际网络性能数字。
4. 第五十四批真实 SQL Server Developer 测试的微软许可问题仍待回复，候选仍未签名或安装；未启动 SQL Server 容器。DBX 固定工作树保持干净，未 fetch，不称远端最新。

本批机器证据 `.impeccable/review/lsp-session-refresh-evidence.json` 汇总新跑结果、源码哈希、Native 回执和明确复用/待完成项。全部 G01–G13 / E01–E07 与文件查询双入口保留；未提交、推送或发布。

## 第五十六批：推荐列表的上下文失效与真实控件恢复

2026-10-24。上一批重连与服务端来源刷新属于已验证进展，但编辑器的缓存降级路径仍可能展示或写回旧字段。本轮继续补齐实际候选列表的失效，不将服务端空 schemas 当成所有前端缓存已撤回的证明。

### 同一请求必须保有同一来源

新 `semanticContext.ts` 定义 renderer 内部来源身份和请求快照；连接配置仅转换为 WeakMap 中的不透明 token，不把 URL、密码、SQL 放进语义状态。`completionContextState.ts` 在异步前后直接读取生产 connection/schema/tab/project/semantic stores，比较运行状态对象、元数据版本、项目、文档目标与已发布来源代次；不等待 React 下一次 render 才判定过期。同 ID、同毫秒时间的替换也能隔离。

生产同步 hook 给状态附加来源证明。实际配置成功发布后才允许当前 LSP 来源；完整 enrichment 成功后才允许物理缓存降级。分批名称发布仍能先提供安全 LSP 候选；刷新失败或来源未知时不借用持久旧字段。相同来源上的普通输入/遥测更新不会重建来源身份，已有有效缓存不会因每个按键被清空。未提供 runtime/来源描述符的既有调用保留兼容，这不是对未知后端会话的新证明。

实际 completion provider 在请求、每条合并返回及 lazy resolve 前后检查同一快照。物理字段、表名、FK/JOIN 缓存只有当前来源已就绪才能读取；远端响应过期后不写回字段或外键 Map。同步期间保留语法以及文档中显式声明的 CTE/派生表输出，禁止给未知物理来源借用旧类型/注释。候选携带 renderer 内 Symbol 证明，JSON 不序列化；批量选列的打开与应用同样检查来源仍有效。

`useCachedSqlCompletionSource` 按会话/项目/数据库/schema/元数据版本创建独立 Map，而不是 effect 中清空仍被旧请求共享的 Map。稳定上下文继续复用缓存；上下文变化后旧请求最多持有它自己的旧容器，且写回还需通过快照检查。既有 128 项/8 MiB 字段缓存预算、16 个物理来源预算和分批加载策略保持原值。

### 已显示列表的生命周期

`completionContextRefresh.ts` 是独立的控件生命周期 owner，生产 hook 订阅实际 stores。当前编辑器显示旧列表时同步执行 Monaco `hideSuggestWidget`；在新来源可用后，只有同一模型、版本、光标和文本焦点仍有效才重新触发。原本隐藏的列表不会凭空打开；失焦、编辑、移光标、切换模型、Escape 或 dispose 会取消待恢复交互。多个相同状态通知不重复触发，也不会为了刷新改写 SQL。

此 owner 处理候选列表与批量选择，未改变现有 parser 或复制推荐算法。其他 hover/导航/签名/semantic tokens/inlay/inline 等请求仍须继续核对跨上下文的生命周期，不能由列表校验推断全部方法已经覆盖。

### 失败、测试与真实控件证据

新增 provider 反例最初得到 **8 failed / 165 passed**，原日志 `.impeccable/review/lsp-completion-context-provider-red.log` 保留。其中 3 项是实际物理缓存/LSP 就绪及 CTE 借用旧类型的断言失败；其余 5 项是测试在异步加载开始前调用回调的时序错误，不能作为产品语义缺陷证据。已改为等待真实加载开始后再替换上下文。

为核对修正后的负例确实有效，另用 `.impeccable/review/lsp-completion-context-control.config.mts` 执行测试专用负对照：只在该配置中将快照保护替换为始终允许，不改生产源码。**10 failed / 165 passed**，没有 TypeError，覆盖旧字段显示/写回、就绪边界、局部投影类型与两种 lazy resolve 失效。此结果是显式故障注入，不能冒充旧发布版本的真实执行；日志 `lsp-completion-context-control-red.log` 保留。正常实现最终全量通过，二者使用同一组修正后的源测试。

本轮新增 **10 provider、8 控件生命周期、7 生产 store 来源测试**，合计 **25 项**。覆盖连接/元数据/目标/项目/代次变化、late cache write、resolve 开始前和完成后失效、LSP 与物理缓存分别就绪、取消/隐藏/同状态通知和旧来源兼容。针对性 **206 项**通过；最终全量新跑 **2470 passed / 0 failed / 0 skipped，426 文件**。严格 TypeScript、生产 build、全部既有门禁 **2845 文件**通过，未增加模块预算。

真实隐藏 WebView **54 场景 / 1743 断言**通过，回执 `C:\Users\housh\AppData\Local\Temp\oxide-desktop-lsp-ipc-jggDMA`。新增场景运行生产 provider/coordinator/context owner 和实际 Monaco 控件：CTE 继承缓存的 old_revenue；模拟来源替换后，旧列表消失，模型 SQL/版本不变，待同步请求不返回旧字段；新来源就绪后，控件出现 new_revenue 且无旧字段，实际接受得到 `q.new_revenue` 并消耗词后缀。上下文通知和元数据在该场景中为明确的预加载夹具；生产 stores 的即刻失效由另 7 项测试验证。该证据不是真实数据库重连、可见 Workbench 或安装版验收。

原 53 场景重新运行，包括实际 Tauri metadata、捆绑 LSP/Monaco 的默认 schema/CTE 类型、配置清空与并发恢复、inlay 与语义着色刷新。Desktop 结束后已以禁止执行 PROTOC 的脚本恢复无默认 feature CLI，`oxide-agent 0.1.18`。Rust 生产输入、JDBC 和 vendor LSP 没有修改；Host 结果沿用第五十三批，LSP **1023 / 80 捆绑协议**和固定 DBX **53**夹具原始执行沿用第五十二批，不宣称本轮重跑。捆绑 SHA、265 输入指纹和源码包摘要保持不变。

### 尚需继续的完整目标

- 权威的 SQL 执行/角色/会话/事务/动态 SQL/模块上下文失效信号。当前仅消费已发生的运行状态和 metadataVersion，不能用首关键字检测证明所有语句都安全。
- 各 LSP 方法的上下文一致性、复杂类型、PostgreSQL search_path、元数据权限/缺表证明，以及多连接分屏的更细粒度 metadata revision。当前全局版本变化可以保守失效其他连接，未宣称所有非活动连接均能即时重同步。
- 真实网络 I/O/取消/RSS/连续编辑性能、完整可见 Workbench/安装版、多平台与远端 CI。本轮控件为本地隐藏 WebView，未声称实网延迟提升。
- 第五十四批真实 SQL Server Developer 测试仍等待微软许可回复，候选未签名/安装；没有启动 SQL Server 容器。DBX 保持干净的固定 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch，不称远端最新。

机器证据 `.impeccable/review/lsp-completion-context-evidence.json` 核对本轮前端输入、Native 回执及复用的 Host/LSP 字节。全部 G01–G13 / E01–E07 和文件查询双入口继续保留；未提交、推送或发布。

## 第五十七批：驱动操作代次与真实事务信号

2026-10-24。本轮补齐 SQL 执行引起的失效信号源；**尚未把新信号接入前端推荐失效消费者**。上一批的推荐校验仍消费已有运行状态/metadataVersion。本轮不能据此宣称 SET ROLE、EXECUTE AS、任意动态 SQL 或所有事务场景已自动刷新；完整目标继续保留。

### 同一驱动实例的操作记录

新增独立 core owner `semantic_context.rs`，不依赖 Desktop，也不扫描 SQL 关键字。共享 ConnectionManager 的 **24 个分发入口**覆盖普通/参数化/跨库查询、native page/cursor、执行批次、迁移、事务及 schema 选择；UI 和同一 manager 的后台调用走相同记录。受控的列/表/默认上下文等 metadata getter 保持只读观察，不递归生成失效事件。

获取 driver Arc 和会话 token 位于同一 connections 锁区间，避免旧 driver 被贴上替换会话的代次。替换注册后，schema 清理、遥测更新和旧 driver/tunnel 清理期间仍保有初始化操作；该过程返回后才减少活动数。旧会话的迟到 Drop/结果不覆盖同 ID 新会话。

每次开始与返回均推进代次，**返回 SQL 错误同样推进**。局部 DDL 成功再遇错误也不能忽略。任务/future 被丢弃没有驱动完成结果时设置 `uncertain`，后续普通成功不能清掉这一状态；重新创建 driver 会话才重置。不把 Drop 或 cancel 请求成功解释成数据库已经停止、事务已回滚或 principal 已恢复。

事务另记 `openTransactions`：两条语句之间即使 `activeOperations=0`，仍能表达未结束的手动事务。成功 commit/rollback 才删除对应事务；失败结束保留事务并标记未知。记录的是本进程 dispatch 与返回事实，不是引擎全局状态证明，也不观察独立进程、外部连接或绕过 manager 的直接 driver 调用。

### 传输与资源边界

状态仅有七个字段：connectionId、随机 session、revision、activeOperations、openTransactions、connected、uncertain；没有 SQL、参数、结果、用户名、凭据或错误文本。revision 不超过 JS safe integer，达到边界进入未知状态而不回绕。通知队列 256；保留最多 128 条已关闭记录，事务 ID 每连接最多 1024，超限不伪造确定状态。活跃连接仍随 manager 存活。

新只读命令 `get_connection_semantic_state` 返回当前状态或 null；应用 setup 安装 `connection-semantic-state` 转发。队列落后时重发当前快照，**消费者仍必须按代次拒绝旧事件，并在订阅后回读快照**，不能假设所有通知永不丢失/乱序。前端 transport owner 校验安全整数、字段类型、会话格式和请求连接作用域，只复制这七个字段；畸形事件不进入回调。该 transport 尚未新增 Zustand/UI 自动刷新消费者。

### 验证与真实失败

新增 **22 项 Rust 测试**：16 个 tracker、6 个 manager。覆盖并发计数、正常错误、取消/Drop 的未知状态、同 ID 替换、连接初始化未结束、事务开闭/失败、通知与快照、队列落后、保留预算、整数上限和字段隐私。manager 矩阵执行 13 条查询/参数/跨库/native 路由，SQL 为边界夹具而非真实 SQL Server。另有实际 SQLite：第一条 CREATE 成功、第二条 SELECT 报错，表仍存在且代次推进；手动事务写入后回滚，COUNT 实际为 0。metadata 读取不改变代次。

最终 Desktop 库 **1082 passed / 0 failed / 12 ignored**、headless 库 **427 / 0 / 4 ignored**、应用捆绑 LSP 集成 **13 passed**；严格 Host Clippy 通过。忽略项保持已有外部数据库/专项条件，未当成通过。新增 **12 项前端 wire 测试**，本轮全量 **2482 passed / 0 failed / 0 skipped，427 文件**；生产 build 与 **2851 文件**门禁通过。manager 仍分三 owner、104 方法，并检查 24 个观察入口和事务 fence 未被绕过。

真实隐藏 WebView **55 场景 / 1755 断言**通过，回执 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-RsvgIZ`。新增场景使用实际内存 SQLite、生产 query/transaction/schema commands、typed transport 和真实 Tauri events，验证局部成功后报错、开始/完成代次、事务在两条语句之间保持打开、rollback 后关闭及实际行数。它没有连接 SQL Server，也没有证明新事件已驱动 Monaco 自动失效；receipt 明确 `rendererInvalidationIntegrated=false`、`sqlServerRoleVerified=false`。原 54 个 LSP/Monaco 场景重新运行。

首个 Native 回执 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-IfBE5N` 失败于隔离宿主缺少生产 `get_tables` 命令注册。补齐测试宿主后重跑，未更改产品行为来迁就夹具；原失败保留，不能当成产品查询缺陷。初始化 fence 后新增三项测试重新验证了最终 Rust 行为。

全部 Desktop 工作结束后，用禁止执行 PROTOC 的脚本重新运行完整 headless 库并恢复 CLI，`oxide-agent 0.1.18`。未新增依赖或修改 driver 协议/JDBC Agent；LSP 捆绑字节、265 输入指纹和源码包摘要不变。**1023 vendor LSP / 80 捆绑协议与 DBX 固定 53 夹具原始执行沿用第五十二批**，不宣称本批重跑；协议 crate 的 14 项结果沿用第五十三批，相应源码摘要未变。固定 DBX 工作树干净，未 fetch，不称远端最新；其算法矩阵未覆盖本批生命周期契约。

### 后续集成保持原范围

1. 将权威 observation 接入前端 store、启动订阅/快照回读、推荐与其他 LSP 方法；在 metadata 装配前后比较代次，拒绝活动操作、开放事务和未知状态的过期来源。不能只增加 transport 就宣称自动失效已完成。
2. 按连接合并刷新，避免每条查询/事件触发全局全库扫描；量测通知突发、真实 I/O/取消、连续编辑和 RSS。当前只是有界记录与通知，没有性能提升数字。
3. 补事务会话内 metadata、引擎取消确认、真实 principal/role/数据库/search_path、权限与对象缺失证明；普通返回不等于数据库所有外部变化都已结束。
4. 继续复杂类型、各 LSP 方法一致性、完整可见 Workbench/安装版、多平台/远端 CI。第五十四批 SQL Server Developer 许可问题仍待回复，候选未签名/安装，未启动该容器。

机器证据 `.impeccable/review/lsp-driver-epoch-evidence.json` 保存新跑结果、实际 SQLite 范围、Native 失败/成功回执、源码哈希和明确复用项。G01–G13 / E01–E07 与文件查询双入口不变；未提交、推送或发布。

## 第五十八批：驱动事件接入推荐消费者与真实 SQL Server

### 实际改动

新增独立 semantic observation store、observer 与桌面订阅 hook。先完成监听注册，再读当前连接快照；按 revision 拒绝旧回放、按 owner 隔离卸载/晚到结果，相同有效快照保持对象身份。空值、读取失败、同代次矛盾事件与 transport 失败不授予物理字段可用性。已知关闭记录最多保留 128 条；不储存 SQL、参数、结果或凭据。

生产 invoke 在查询、事务、结构变更等调用进入 IPC 前建立本地操作 fence；后端七字段快照仍是实际驱动状态的权威，不靠 SQL 关键字猜测会话变化。completion provider、缓存候选、详情 resolve、批量选列和已显示列表沿用同一上下文令牌，直接读取 store，覆盖 React 尚未提交渲染的窗口。同 UI runtime 下 driver session nonce 改变也重读能力/版本。

元数据任务只在连接已知空闲、activeOperations=0、openTransactions=0、uncertain=false 时装配；初次实际 observation 或代次变化强制跳过持久旧字段。装配前、每次渐进/最终配置发布前后均实际回读后端代次。迟到发现变化时不授予 metadataReady，不写旧配置缓存；现有客户端队列负责清空/后续恢复。其他 LSP 方法尚未取得同样完整的消费者屏障，不能把推荐结果推广为所有方法。

按连接使用 500 ms 稳定窗口合并刷新。单测证明同一连接 40 次变化后只扫描一次，另一连接变化不扫描，且不提高全局 metadataVersion。该数字是受控调度测试，尚不是生产网络 I/O、RSS 或输入延迟基准；事件仍可能发送多次清空配置通知。

### 测试与真实编辑器

新增 **42 项前端测试**：状态 store 13、observer/readback 10、本地 invoke 8、completion context 5、同步发布 fence 3、实际同步组件 2、能力 nonce 1。最终全量 **2524 passed / 0 failed / 0 skipped，430 文件**；生产构建和 **2858 文件**/模块边界门禁通过。Native 场景 TypeScript 检查与 scoped diff 空白检查通过。

真实隐藏 WebView **56 场景 / 1767 断言**通过，目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-19ydcn`。新场景安装实际 observer、schema-sync、query-completion hooks，经生产 Tauri query/catalog 命令操作内存 SQLite。先显示 CTE 中继承的 epoch_old；实际 ALTER 将其改名 epoch_new，随后同批 SELECT 报错；文档 SQL/版本不变时旧列表撤回，新代次读回实际新字段，恢复列表不含旧字段，实际接受补全替换后缀为 q.epoch_new。未改变全局 metadataVersion。receipt 明确 rendererInvalidationIntegrated=true，但 persistentStoreTested=false、sqlServerRoleVerified=false；这不是可见完整 Workbench 或安装版验收。

### 用户授权后的真实 SQL Server

用户本轮明确接受微软许可并授权原定隔离测试。采用此前固定 MCR digest、3 GiB/2 CPU、127.0.0.1 随机端口、Developer、无持久卷和随机所有权标签；密码只经内存/环境/stdin 传递。实际引擎 **16.00.4305**，Microsoft JDBC 候选包 0.1.1-lookup-preview.54 经真实 JVM 执行。connect/query/databaseScope/metadata 四组全部 passed：低权限测试用户在 primary 的默认 schema 为 sales；存在同名 dbo.ledger 时，参数化 CTE + ROW_NUMBER 查询绑定到 sales；跨库 secondary 默认 schema 为 reporting；独立当前查询与 lookup metadata 均验证返回 primary/sales。

报告仅保存版本、包/夹具摘要和检查项，没有 URL、凭据、语句、结果值。容器清理前核对完整 id 和随机标签，最终 containerRemoved=true；本机按测试 label 查询无残留容器。首次 Docker 阶段超时未形成 SQL Server 结果，原日志 lsp-operation-consumer-sqlserver-initial-failure.log 保留。给 Docker 启动增加有界 120 秒预算及不含输入的阶段日志，重试成功；进度回调异常不能阻止清理，控制测试最终 **9 passed / 0 failed / 0 skipped**。

真实 SQL Server 本轮只证明驱动协议和该夹具中的默认 schema/跨库恢复；没有证明角色切换、权限缺失/对象不存在、事务会话、本地 temp 对象或生产 renderer 上的 SQL Server 补全链路。候选仍未签名、安装、发布。第五十四至五十七批关于许可待确认是各批当时状态，本轮已经明确授权并执行。

### 复用与待办

生产 Host Rust 642 份输入与第五十七批摘要一致，Desktop 1082/12 ignored、headless 427/4 ignored、应用 LSP 集成 13、strict Clippy 结果明确沿用该批；本轮新编译并执行实际 Native 宿主，不重记旧库测试为本轮执行。全部 Desktop Cargo 后，以禁止 PROTOC 的环境恢复无 Desktop CLI，确认 oxide-agent 0.1.18。

vendor LSP 的 265 输入指纹/捆绑 release 字节不变，1023 Rust、80 捆绑协议与固定 DBX 53 夹具明确沿用第五十二批；协议 crate 14 项沿用第五十三批。DBX 工作树仍干净、固定 b160d130560f71c5c429be15cec6147f677a4b3a，本轮没有 fetch，不称远端最新。机器证据 .impeccable/review/lsp-operation-consumer-evidence.json 记录本轮结果、源码摘要和明确复用范围。

继续：事务内 metadata 与引擎取消确认、实际 role/search_path/权限与缺失证明、其他 LSP 方法上下文一致性、更多复杂类型/方言、跨连接多窗格、真实网络/性能/RSS、可见 Workbench、签名安装与多平台 CI。G01–G13 / E01–E07、文件侧栏及“打开文件”双入口全部保留；未提交、推送或发布。

## 第五十九批：其他编辑器提示的上下文屏障与事务内文档语义

### 缺口与改动

原先多个 Monaco provider 只检查文本版本，数据库操作未编辑 SQL 时，旧查询的 hover、导航、签名或编辑仍可能迟到。另一个缺口是第五十八批将整个 completion request 标为不可用，开放事务会连不依赖数据库的文档显式声明一起挡住。本轮修复两处，仍保留对物理元数据的不确定状态限制。

新增纯模型 lspProviderContext，统一绑定 model 版本、dispose/cancellation 和 renderer 语义上下文；在异步结果返回和文档同步完成后重新核对。生产 useEditorLanguageServices 传入与 completion 相同的权威 reader/订阅，并在文本服务请求前使用已有文档同步 helper。12 个 core provider 共 13 个回调覆盖 definition、references、document/range formatting、signature、prepareRename/rename、codeAction、documentSymbol、folding、selection、semanticTokens、inlayHints。导航结果在进入 reveal 前再次核对，过期编辑不会交给 Monaco。

元数据相关请求要求已发布的 LSP source；文本类格式化、符号、折叠与选择范围仍可运行，结果也需通过上下文/版本校验。tokens 缓存同步失效；inlay/token renderer 收到合并通知，已显示签名关闭。hover 请求、元数据/DDL 预览及独立搜索 widget 均有开始/完成检查；来源改变立即隐藏可见旧 hover/widget，未授权时不读表结构。这里没有声称原子撤销已开始的外部导航副作用或跨文档编辑版本已全部处理。

completion reader 现在区分“当前文档作用域仍可用”和“物理来源可用”。操作繁忙、开放事务或 uncertain 时，当前连接的本地声明仍可完成；物理缓存和 LSP 来源没有因此获得授权。嵌套 CTE 的显式别名、INSERT 显式列提示可直接从文本推断。实际 connected=false 或文档/项目/连接作用域变化仍撤销旧请求。Redis 单独保持 metadata gate，读取前后比较上下文；本地 SQL 可用性不会放行 Redis 的旧 key/命令元数据。

### 单元与构建验证

新增 **42 项**：core provider 30、hover 4、DDL widget 3、completion 5（3 种实际 store 的 held 状态 + 2 个 Redis 边界）。覆盖异步旧结果、文档同步中代次变化、未授权不发请求、tokens 缓存失效/恢复、当前文档无物理 metadata 时的文本功能、显式列 inlay、DDL 可见内容立即撤回，以及不经 React 重渲染的状态变化。已有 completion-context 测试更新为本地与物理来源分离；旧请求仍必须失效。

最终全量 **2566 passed / 0 failed / 0 skipped，430 文件**；生产 build、**2859 文件**、模块依赖/大小门禁和 scoped diff 空白检查通过。42 是本批新增数，不与第五十八批的 42 重复计数。没有新增 npm/Cargo 依赖。

### 真实隐藏 WebView

回执 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-yrr6yw`：**58 场景 / 1784 断言**通过。原 56 个场景重跑；真实 SQLite 使用生产 query/transaction/catalog 命令，安装生产 observer、schema-sync、completion、core 和 hover hooks，而非用假数据替代推荐结果。

新增事务场景实际 beginTransaction，并确认 openTransactions=1。文档含 CAST + 两层 CTE：seed.declared_amount → q.declared_total；真实推荐列表显示 declared_total，接受补全实际消耗 Suffix。与此同时 Monaco 渲染文本中 explicit_field 的显式 INSERT 列提示，实际物理表没有该列；没有把它当作可执行数据库 schema。对真实 client 的计数确认 held 区间 **completion 和 inlay RPC 都为 0**。receipt 的 noHeldCompletionOrInlayRequests 只对应这两种请求，不能推广为所有 LSP/数据库 I/O 为 0。实际 rollback 后重新达到可信 idle publication。

新增物理提示场景先渲染实际 epoch_new 列的 inlay 和可见 hover；实际 ALTER 改名为 epoch_last，SQL 文本和 Monaco 版本不变。可见旧 hover 被关闭，旧物理 inlay 消失，新 inlay 按刷新后的真实 SQLite metadata 恢复。生产 core/hover hooks 和 Monaco hover contribution 的输入摘要均进入证据。

首次隔离宿主未加载 Monaco hover contribution，事务与本地推荐已通过，但 hover 显示等待失败；原回执 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-w55YvY` 保留。补齐测试宿主的实际控制器，并独立检查真实协议确实返回该列 hover 后重新运行；没有修改生产 provider 或放宽显示/撤回断言来迁就夹具。最终 receipt 仍明确 persistentStoreTested=false、sqlServerRoleVerified=false，不当作可见完整 Workbench/安装版证明。

### 复用证据及仍需完成

生产 Rust 642 份输入未变，Host Desktop 1082/12 ignored、headless 427/4 ignored、应用集成 13 与 strict Clippy 明确沿用第五十七批；本轮实际重新编译/执行 Native 宿主。所有 Desktop Cargo 后，用禁止 PROTOC 的环境恢复 headless CLI，确认 oxide-agent 0.1.18。前端 1860 份输入冻结在全量测试开始前，Native 输入/二进制另行校验。

真实 SQL Server 16.00.4305 的四组 conformance 结果及容器清理明确沿用第五十八批，本轮没有新建数据库容器；用户许可授权继续有效。JDBC/协议源码未变。vendor LSP 265 输入指纹、release 字节及固定 DBX 工作树不变，1023 Rust/80 捆绑协议/DBX 固定 53 夹具明确沿用第五十二批，协议 14 项沿用第五十三批。本轮未 fetch，不称 DBX 为远端最新。

未完成项：推送诊断与 inline/Console provider 的相同上下文隔离；真实事务会话内物理 metadata 与引擎取消确认；生产 renderer 的实际 role/search_path/权限缺失/临时对象；跨文档 rename/edit 版本及共享文档同步/关闭并发；签名安装、可见 Workbench、多窗格、多平台/网络/RSS/CI。当前是更多入口的一致性进展，不能称所有 LSP 方法、事务或方言场景已经闭环。

机器证据 .impeccable/review/lsp-provider-context-evidence.json 保存新跑/复用范围、Native 失败/成功、源码与输入摘要。G01–G13 / E01–E07 和文件侧栏/“打开文件”双入口原目标全部保留；未提交、推送或发布。

## 第六十批：诊断来源证明与 CTE 别名歧义修复

### 两个实际缺口

旧诊断消费者只核对 SQL 文本/文档版本；数据库字段或角色上下文变化不修改 SQL 时，相同版本不能证明诊断用了新 schema。此前全局会话监听还可能处理其他编辑器 URI。本轮给分析配置增加不含 SQL/凭据的 opaque token，并按单文档隔离消费。

新增真实场景首先失败。两次隐藏 WebView 回执保留，服务端原始通知的 token、文档版本和已同步文本均匹配，但 OXIDE004 诊断本身为空；独立捆绑字节探针和红灯单测确认是另一处真实算法缺口：CTE 形状保存在关系名 q 下，歧义检查却按行别名 a 寻找它，误判为未知行而跳过告警。修复改用 completion 已有的 row-reference / query-local resolver，不复制新的别名猜测规则，也没有把验收 SQL 换成简单表连接。

回归保留下面的复杂结构：

```sql
WITH q AS (SELECT l.* FROM epoch_ledger l)
SELECT epoch_last FROM q a JOIN epoch_ledger b ON 1 = 1;
```

当两个输入都含 epoch_last 时需要限定列名；实际字段重命名后，该歧义应消失。三项新 Rust 测试内部运行 **46 组输入**：20 个正例（星号、显式投影、两层 CTE、派生表 × PostgreSQL/MySQL/SQL Server/SQLite/Hive），20 个限定字段/未知形状/子查询隔离反例，以及支持方言上的 6 个 USING/NATURAL 合并键反例。没有声称 SQL Server/Hive 支持不属于其方言的 USING/NATURAL 语法。

### 生产链路

| 环节 | 本轮行为 |
| --- | --- |
| 配置发送 | 只在实际发送时创建新的 oxideAnalysisToken；配置去重 key 不含随机 token，重复发送跳过时保留原已确认 token；发送后发现过期则不授予该值 |
| 服务端分析 | token 限制为 1–128 个 ASCII 字母/数字/横线/下划线；缺少或畸形值清空。与 schema/路由在同一配置写锁提交，在分析快照读锁内取值，按原有配置/文档 revision fence 决定是否发送 |
| 协议 | publishDiagnostics 保留标准 uri/diagnostics/version，并附加实际分析 token；标准客户端可忽略扩展，未配置 token 时不伪造值。没有在通知接收时把旧诊断贴成当前来源 |
| 编辑器 | 只接收自己的精确 LSP session 和 document URI，核对当前配置 token、metadata readiness、已确认 shadow 版本/文本、model 生命周期。切换/执行/编辑/卸载立即撤回旧 sql-lsp markers 和问题列表 |
| 早到通知 | 每个文档最多缓冲 4 个配置的候选，拒绝同 token 下倒退的文档版本；配置确认或实际文档同步确认后重放。新增 WeakMap shadow 通知在 maps 提交之后触发，失败不通知；没有增加轮询或每次通知的拉取请求 |
| 其他提示 | core inlay/token refresh 同时比较通知 token，旧分析不触发当前缓存的无效刷新。Oracle/MySQL 本地语法 owner 独立保留 |

token 只关联分析来源；没有加入 SQL、参数、结果、数据库密码。配置前后实际 driver revision 核对沿用第五十八批。当前推送 LSP 诊断仍要求可信物理来源，**物理来源被 held 时的通用 parser 诊断尚未独立恢复**；本轮测试证明保留的是已有 Oracle/MySQL 本地语法诊断，不把它推广为所有方言的事务内解析。监听失败/初次通知丢失后的恢复与更多入口也仍需补齐。

### 真实 Native 与失败证据

最终目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-bGZt5S`，**59 场景 / 1792 断言**通过。安装生产 observer、schema-sync、completion、core、hover 和 diagnostic hooks，经过实际 Tauri 事件/查询/catalog/transaction 命令，使用实际 SQLite 元数据和新捆绑 LSP。新场景显示 CTE/物理来源的同名字段标记，实际 ALTER 将 epoch_last 改成 epoch_final 后撤回旧 marker/问题列表；恢复物理字段名后 marker 再出现，全程 SQL 文本与 Monaco 版本不变。这里含歧义的 SELECT 是编辑器分析输入，实际执行的结构变更是 ALTER；不将它描述成已成功执行的 SELECT。原 58 个补全、hover、inlay、事务等场景全部重跑。

失败目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-r3sje2`、`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-oeShWa` 均保留 success=false；第二份记录了正确的分析 token/shadow 和空诊断，证明不是单纯 UI 显示问题。红灯单测 cte-red.log 同样保留；修复后同一复杂 SQL 经新 release 通过，没有放宽 marker 断言。receipt 的 persistentStoreTested=false、sqlServerRoleVerified=false 仍明确保留，不当作完整可见 Workbench 或安装版验收。

最初两个新增协议测试误用会自动消费首个诊断的 open() 后再次等待该诊断而超时；改成直接发送 didOpen。前端新增测试夹具也曾因缺少 skippedOversizedDocument 和 code 字面量类型而未通过 tsc，失败构建日志单独保留；补齐后最终全量和 build 重新运行。最终 Rust、实字节协议及 Native 不是沿用失败前的二进制。

### 本轮最终验证

| 检查 | 结果 |
| --- | --- |
| 前端 | **2610 passed / 0 failed / 0 skipped，433 文件；新增 44** |
| 生产构建 | **2864 文件**模块大小/依赖门禁与最终 bundle 通过 |
| vendor Rust | **1032 passed / 24 目标 / 无失败与忽略**；库 829；新增 7 库 + 2 协议 |
| 新捆绑 release 实字节 | **82 协议测试通过**；运行后恢复 Cargo debug artifact |
| 应用捆绑集成 | 新字节 **13 passed** |
| 真实隐藏 WebView | **59 场景 / 1792 断言** |
| 格式与 lint | 修改路径 rustfmt、scoped diff；vendor all-targets strict Clippy 通过 |

44 项前端新增分布由机器证据列出，覆盖 26 个诊断 controller 案例、7 个实际 hook 案例、3 个 shadow 确认、配置 token/同步任务/通知解析和 core refresh。实际 listener 晚到/卸载、会话/URI 隔离、快慢确认、倒退版本、4-token 预算及本地语法保留都包含在断言中。没有新增依赖。

### DBX、字节与范围

固定 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的 **53 组同夹具算法/EditorState 对比已用最终 release 重新运行**，Oxide 53 组符合该矩阵；字段 46/46、类型 44/44、隔离 7/7，DBX state 分别 35/46、18/44、3/7。原第五十二批证据另存 baseline，当前比较报告已标记第六十批和新 manifest。它只覆盖该定向矩阵，不能外推整个产品/全部搜索用法/全方言，更不代表本轮拉取了远端最新；DBX 工作树干净，本轮未 fetch。见 [同夹具运行对比](dbx-sql-completion-comparison-2026-10-24.md)。CTE 歧义与 wire 生命周期另由本轮专项单测、协议和 Native 证明，不冒充原矩阵已有覆盖。

最终 release SHA-256 `cc695ef17fbc5f805673015e4185b7168b8bb9a1572e660fd5eb05aefafcec88`，266 个 runtime 输入指纹 `f4a4f6a0e079d1b8f27c88dd8784d1420b72817a81c8138bc3c5231b76a6f5fd`。源码包 **292 文件 / 252 份 src Rust / 16 个额外输入**逐字节核对，锁文件按 TOML/规范化换行匹配；源码包 SHA-256 `ff6f425a8098c7fc15b9e1521e68cdba1535503d2d153b080ce871342b7ed1d9`。package 使用 no-verify，没有声称独立编译了打包后的源码。

生产 Host Rust 642 份输入未变，Desktop 库 1082/12 ignored、headless 库 427/4 ignored 和 Host Clippy 明确沿用第五十七批；本轮应用 LSP 集成 13/Native 为新跑。真实 SQL Server 16.00.4305 的四组 conformance 和清理沿用第五十八批，本轮未启动新容器，原许可授权有效；driver 协议 crate 14 项沿用第五十三批，JDBC/协议源码未变。全部 Desktop Cargo 后，已用禁止 PROTOC 的环境恢复无 Desktop CLI oxide-agent 0.1.18。

继续补齐：通用 parser 在 physical-held 状态下的独立诊断、诊断 listener 初次丢失/失败恢复、inline/Console 来源一致性、真实事务内物理 metadata/引擎取消确认、生产 renderer 的实际 role/search_path/权限/临时对象、跨文档编辑与文档同步/关闭并发、更多方言/复杂类型、性能/RSS/网络、多窗格、签名安装和多平台/可见 Workbench/CI。原 G01–G13 / E01–E07 与文件侧栏/“打开文件”双入口范围不变；未提交、推送或发布。

机器证据：.impeccable/review/lsp-diagnostic-provenance-evidence.json，保留新跑/复用范围、真实失败、源码与输入摘要。


## 第六十一批：独立语法诊断与通知缺口恢复

### 补齐的两个缺口

第六十批为所有推送诊断要求可信物理配置，因此 open transaction / uncertain / busy 阶段连纯 SQL 解析反馈也被撤回；早到通知能缓冲，但初次通知遗漏或事件注册失败时，没有可靠读回。新实现继续严格保护物理诊断，另增加无物理依赖的诊断快照，并将订阅、来源确认和缺口补取分开。

新增受控扩展 `oxide/documentDiagnostics`：请求只含已打开文档 URI、版本、规范方言、模式，metadata 模式另含已确认的分析 token；不重复发送 SQL，也不将 token 当数据库权限。服务端返回实际文档版本、方言、模式和诊断。metadata 模式在原有配置读锁内核对 token / 文件方言并分析 schema，返回前释放锁；syntax 模式直接采用请求 profile，以 schema=None、manager=None 调用相同解析/SQL-only inspection 路径，不持有配置读锁、不返回 token、不输出物理字段歧义。文档 revision 或 profile 实例变化均拒绝过期结果。取消在途 metadata future 会释放读锁。

前端类型化客户端拒绝错误 URI、版本、方言、模式、token、负/非整数范围。controller 优先当前物理诊断，否则选同一 shadow/version/profile 的纯 SQL 快照；来源撤销即时清空旧标记与问题列表，文档编辑后等待实际 shadow 确认。纯 SQL 快照可跨执行 epoch 保留，但不能跨连接、项目、route、model、文档版本使用。Oracle/MySQL 本地语法 owner 仍独立保留。

### 请求成本和恢复边界

- 先订阅，再检查是否缺少当前快照；正常推送能取消待补取请求，不在每条通知后固定发 RPC。
- 120 ms 合并窗口、最多一个在途读回。40 次状态变化合为一次请求；在途旧 metadata 结果失效后只补取最后来源。
- 注册失败后仍做一次一致读回，并按 250 / 1000 / 4000 ms 有界重试注册。没有周期性诊断轮询；卸载清理计时器、晚到 listener 和结果。
- 同一来源的 RPC 失败不会自旋。后续文档/来源确认能重新产生需求；本实现没有 heartbeat 来证明任意已注册流是否死亡，不声称自动检测所有传输中断。

服务端 advertise experimental snapshot version=1。当前 Host initialize 对前端仍只返回会话字符串，前端依赖已核对的受控捆绑版本，尚未协商此 capability；旧/不支持该方法的服务端失败不会授予诊断来源，不将这称为通用第三方 LSP 协商。

### 测试与真实桌面

新增前端 38 项：typed client 14、snapshot capture 8、恢复协调 8、controller 5、实际 React hook 3；覆盖 listener 失败/晚到、首帧遗漏、及时 push 无读回、burst 合并、单 RPC、过期结果、方言和范围拒绝、held syntax 与 metadata 升级。新增 Rust 8 项：5 个服务单测、3 个配置写锁/文档变化/取消并发测试。新增进程协议 3 项包含 6 方言（PostgreSQL、MySQL、SQL Server、SQLite、Hive、ClickHouse）的多行 Unicode SQL 诊断请求，以及 metadata/syntax 隔离、旧 token/version 拒绝。这里是 LSP 解析分析，不声称六种数据库引擎都执行了这些 SQL。

新增测试最初把 `SELECT (1 + );` 的可恢复 SYNTAX_ERROR warning 误期望为 PARSE_ERROR / Error；`SELECT (` 作为未完成编辑也不会产生该错误。修正测试预期后重新跑最终全量、release、实字节和 Native；失败定向日志保留，不将这个测试预期错误写成产品解析缺陷。新增测试中的 Array.at 超出当前 TS target，已改用兼容索引，最终 tsc/build 通过。

首次真实隐藏 WebView 在事务内 syntax 场景失败，目录 C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-70yJs7 的失败回执保留。原因是前端/服务端虽已实现扩展，Host generic LSP 白名单仍拒绝该方法；现加入精确方法授权，并新增独立 Host 单测确认其余 oxide 方法、尾空格和路径后缀继续被拒绝。保留原复杂 SQL 和 marker 断言，修复后重新运行真实验收。

真实隐藏 WebView 目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-3rGVSa`，**61 场景 / 1803 断言**，原 59 场景全部重跑。新场景一实际调用 SQLite beginTransaction，在 physical authority held 时输入多行语法错误，生产 hook 经真实 snapshot IPC 显示 SYNTAX_ERROR，问题列表同步更新，未授予 metadata；实际 rollback 后恢复 idle。新场景二在订阅边界**人为丢弃诊断通知**，其余 production hook/client/Host/server 均真实，实际 metadata snapshot 用当前 token 恢复 CTE/物理来源 OXIDE004 与问题列表，SQL 版本不变。这个注入只证明受控通知缺口恢复，不冒充真实网络故障或完整可见 Workbench。含错误或歧义的 SQL 为编辑器分析输入，未当作成功查询执行。

| 最终检查 | 结果 |
| --- | --- |
| 前端 | **2648 passed / 436 文件 / 无失败与跳过**；新增 38 |
| 生产构建 | **2871 文件**大小、模块依赖和最终 bundle 门禁通过 |
| vendor Rust | **1043 passed / 24 目标 / 无失败与忽略**；库 837 |
| strict Clippy / fmt | all-targets 严格 lint 与格式通过 |
| 新 release 实字节 | **85 协议测试**；结束恢复原 Cargo debug artifact |
| 应用捆绑集成 | **13 passed**，使用新捆绑字节 |
| 实际隐藏 WebView | **61 场景 / 1803 断言** |

### DBX、源码与未完成范围

固定 DBX `b160d130560f71c5c429be15cec6147f677a4b3a` 的 **53 组同夹具算法/EditorState**用最终二进制重新运行，Oxide 字段 **46/46**、类型 **44/44**、隔离 **7/7**，DBX 被测 state 入口分别 **35/46**、**18/44**、**3/7**。未更换为更简单夹具；诊断恢复属于本批专项覆盖，没有冒充固定矩阵新加了诊断测试。第六十批矩阵 evidence/results/summary 另存 lsp-diagnostic-snapshot-dbx-baseline。参考树干净，本批未 fetch，不称远端最新；不能外推整款 DBX 或全部 SQL/搜索设置。见 [矩阵方法与明细](dbx-sql-completion-comparison-2026-10-24.md)。

捆绑 release SHA-256 `bd05d3f614dd9dddcd46c84d13ddac8e72c8d5e0715a97247b25bc96fe54b627`；267 个 runtime 输入指纹见 manifest / 机器证据。源码包 **293 文件 / 253 份 src Rust / 16 额外输入**核对，SHA-256 `c61d87cfd4dc18032f04f912cc2b70493a3e63c4a5206fcb6ceff3b698694fdb`；锁文件按 TOML 与规范化换行匹配。package 使用 --no-verify，未独立编译打包后的源码。

生产 Host Rust 共 642 份输入，只有 generic.rs 与其 tests.rs 两份较第六十批变化，其余 640 份哈希相同。Host 本批新跑 Desktop 库 **1083 passed / 12 ignored**、headless 库 **427 passed / 4 ignored** 与 strict all-targets Clippy；新增 1 项白名单边界测试。应用集成 13 与 Native 同为新跑。SQL Server 16.00.4305 conformance / 清理沿用第五十八批，本批没有启动新容器；用户已接受微软许可的隔离测试授权保留。协议 crate / JDBC 来源未变，原证据复用。全部 Desktop Cargo 后以禁止 PROTOC 的环境恢复无 Desktop CLI **oxide-agent 0.1.18**。

继续逐项处理 inline/Console/文件查询的来源屏障、事务内物理 metadata 和引擎取消确认、生产 renderer 真实 role/search_path/权限与临时对象、跨文档修改版本、共享同步/关闭并发、更多方言/复杂类型、大 catalog 连续编辑性能/RSS、签名安装、多平台/完整可见 Workbench/CI。全部 **G01–G13 / E01–E07** 和文件侧栏/“打开文件”双入口保持；未提交、推送或发布。

机器证据：.impeccable/review/lsp-diagnostic-snapshot-evidence.json，保存新跑/复用范围、输入摘要、受控缺口边界和未完成项。


## 第六十二批：行内推荐来源屏障与真实替换预览

### 实际修复

此前 inline provider 只检查 SQL 版本、取消和请求序号；连接、操作代次或分析配置变化但 SQL 不变时，旧语义/AI/项目上下文仍可能完成并写入缓存。现将主编辑器已有实时 context reader/subscription 接入 SQL 与 Elasticsearch Console 的 inline 路径：请求绑定连接、runtime、execution、项目、route、metadataVersion、generation、analysisToken、model/version/生命周期；在文档同步前后、语义返回后、AI/项目上下文/校验完成后核对。来源变化同步中止当前 AI signal、清空该 provider 缓存、递增序号、发出变化事件并隐藏当前行内提示，不等 React 重新渲染；新请求也会取消上一条 AI 工作。

文档范围可用与物理来源可用分开：held/offline 时不调用物理 LSP enrichment/validation，但仍允许纯文档工作。新增 documentInlineContext 复用下拉补全已有的有界 CTE/派生表 resolver，显式关闭 physical metadata，使用空 catalog 和独立空缓存；去掉 resolver 对 query-local 列不必要的 connectionId 前置要求，物理加载函数的连接/授权检查保留。嵌套显式投影能继续推荐，未知物理表不会凭空得到字段。LSP 运输失败返回空对象时也采用这一 fallback。AI 离线工作保留，不能把旧 schema 混入 prompt 或缓存。

另修正已知字段在光标中间的词尾替换。复用缓存推荐的 UTF-16 identifier range，仅对已知字段/变量/关系候选消费当前成员剩余字符，保留点号、注释和周边 SQL；AI 文本、关键字/片段不获得该范围。当前捆绑 Monaco 的普通 ghost-text 算法拒绝含删除的 diff，因此需要删除旧词尾的候选标记为公开 API `isInlineEdit`，由原生 inline edit 预览显示；纯插入继续走普通 ghost text。没有修改 node_modules 或伪造可见预览。

### 单测与真实桌面

新增 **55 项前端测试**：来源/model capture 与同步撤回 16、纯文档 resolver 9、生产 React hook 20、identifier/edit 10。覆盖八种上下文字段变化、同步中途失效、AI/项目片段/验证晚到、缓存同代复用与跨代重算、离线/开放事务的嵌套 CTE、未知物理字段隔离、Elasticsearch 语法/旧 mapping 候选隔离、取消与卸载、非 BMP 词尾和下拉选中范围兼容。六方言 query-local 样例为 PostgreSQL/MySQL/SQL Server/SQLite/Hive/ClickHouse，验证推荐分析，未声称六种数据库引擎都执行了样例。AI/项目响应在单测中可控模拟，没有向外部 AI 发送请求，也未证明引擎取消确认。

最终前端 **2703 passed / 439 文件 / 无失败与跳过**，构建 **2876 文件**模块大小、依赖与 bundle 门禁通过。真实隐藏 WebView **63 场景 / 1818 断言**，目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ccWCQe`，原 61 场景全部重跑。新增两场景均安装生产 inline hook、真实 Monaco controller 和实际客户端/Host/LSP：

1. `WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT q.ep<cursor>Suffix FROM q` 显示物理字段的行内替换预览。实际 SQLite ALTER 将 epoch_last 改为 epoch_inline 后，旧预览被撤回，SQL/版本不变；元数据 idle 后重新显式触发得到新字段，实际 commit 变为 `q.epoch_inline`，没有残留 Suffix。验证的是撤回和重新触发后的恢复，不声称自动重新打开了先前交互。
2. 实际 beginTransaction 后，`WITH first AS (SELECT 1 AS declared_total), second AS (SELECT a.* FROM first a) SELECT q.de<cursor>Suffix FROM second q` 仍显示并接受 declared_total，inline physical-context RPC 计数不增加，随后真实 rollback。文档内含光标/未完成字段的 SELECT 为分析输入，实际执行的是事务和 ALTER，不冒充已执行全部 SELECT。

两个初次 Native 失败目录保留：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-SSXDOf`、`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-urSjMl`。带 provider trace 的第二次证明上下文请求得到空对象；测试宿主漏注册 production 已有的 lsp_inline_completion_context，现仅补接该生产命令，不能把这一点写成应用 Host 也缺少命令。另根据实际 Monaco 源码修复删除型 inline 结果的呈现方式，保持原 SQL、实际显示/来源撤回和最终接受断言。后续两次目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ZpWw36`、`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-B01kyQ` 已得到正确候选和 inlineEdit 状态，但验收选择器遗漏 Monaco 的 word-replacement 节点；补上其实际可见节点检查后原 SQL 通过。这是观测夹具修正，不当作又一个产品 bug。Trace 只记录和转发生产 provider 结果，不替换算法。最终显示节点须实际有布局矩形，且 commit 必须产生完整正确 SQL。

### 复用与差距

本轮生产 Host **642**、vendor src/tests **305** 份输入与第六十一批逐份哈希相同，捆绑二进制及 **267** 项 runtime 指纹相同，SHA-256 `bd05d3f614dd9dddcd46c84d13ddac8e72c8d5e0715a97247b25bc96fe54b627`。因此明确复用第六十一批 vendor **1043**、实字节协议 **85**、Host Desktop **1083 / 12 ignored**、headless **427 / 4 ignored**、strict Clippy、应用捆绑集成 **13**、源码包 **293 文件 / 253 src Rust / 16 额外输入**。源码包先前仅核对，未独立编译。当前 Native Rust 宿主因新增命令注册重新编译；全部 Desktop Cargo 后，以禁止 PROTOC 环境重新构建无 Desktop CLI **oxide-agent 0.1.18**。

固定 DBX `b160d130560f71c5c429be15cec6147f677a4b3a` 的 53 项算法/EditorState 对照沿用第六十一批：相同 release、参考、夹具和被测 stdio 路径未变，工作树干净，未 fetch。本轮 inline frontend 不在该矩阵中，不把上述 Native 增量冒充为 53 项矩阵或完整 DBX UI 的新验收。真实 SQL Server conformance/清理沿用第五十八批，已接受许可的隔离测试授权保留，本批未新启容器。

文件查询入口已做代码核对，尚未修复：useFileQueryIntelligence 的 readyKey 只绑定 sessionKey，未绑定配置身份；core providers 未读取文件会话来源；补全文档同步后的 RPC 前仍缺少完整生命周期核对。下一批需增加活跃 tab/session/schema 与配置确认屏障，并验证旧同步、schema 替换和会话关闭。保留文件侧栏与“打开文件”双入口原需求。

仍需实际 Console mapping/版本变更的生产 renderer 验证、更多带引号标识符/方言与复杂类型、项目根/内容版本、AI 与数据库引擎取消确认、事务内物理 metadata、真实 role/search_path/权限/临时对象、跨文档编辑和共享同步/关闭并发、大 catalog/RSS/网络性能、签名安装及完整 Workbench/多平台/CI。全部 G01–G13 / E01–E07 保持进行中；未提交、推送或发布。

机器证据：.impeccable/review/lsp-inline-context-evidence.json，保存新跑/复用范围、失败目录、输入摘要和未完成项。



## 第六十三批：文件查询配置来源与文档生命周期

### 已修复的入口差距

文件查询原先只以 readyKey=sessionKey 表示配置可用。同一会话收到新 schema 时，旧 readyKey 可短暂继续允许请求；core providers 没有实时文件来源 reader，completion 在同步后直接发 RPC。文件 URI 使用 oxide-file-query，旧生命周期清理只识别 oxide://query，因此仍打开的文件文档可能被误关。本轮按文件来源拆开 configuration builder、analysis context 和进程 incarnation observation，再接回生产编辑器。

- fileQueryAnalysisContext 绑定实际 session 对象、schema/source 引用、driver/package/header、活跃项目、补全/格式偏好及客户端进程实例。配置发送完成回执和新 analysis token 只授予仍匹配的来源；旧回执、source ABA、关闭/重开、同 client 重启和 StrictMode 第一轮迟到发送不授予新上下文。SQL/results 的普通变化不重发 schema，40 次更新只有一次原配置发送。控制器只保留文件描述/schema，不捕获整个旧结果表。
- LspClient 公开 renderer-only 的稳定 runtime snapshot/subscription；实际 initialize、disconnect、restart、shutdown 产生新的 opaque generation，重复健康检查保持同一对象。文件 hook 在进程重启后重新配置、重新打开文档；这个 observer 尚未接入所有普通编辑器路径，也不声称在未观察到进程退出前瞬时发现退出。
- core/格式化只在文件配置 ready 后启用，completion 在同步前后、返回后均核对实时来源、model/version、取消和生命周期；来源改变立即撤回可见列表。文件诊断接入现有 token/version/shadow controller 和补取机制，通过显式 tab id 更新非普通 URI 的问题列表；旧文件关闭后标记和问题同步撤回。
- 生命周期记录明确的 owner tab id，识别文件 URI；提供同一 session+URI FIFO 的 syncDocument，文件的 provider 与延迟同步都使用它，旧 close/reset 排在新 open 前。延迟任务读取实际 Monaco model，避免把新文本改回旧 props；同 URI 的进程 generation 改变也重开。其他编辑器仍有直接调用 syncLspModelBeforeCompletion 的路径，未宣称所有多窗格/共享关闭竞争都闭环。
- 格式化命令调用实时 readiness getter；旧 formatting/current-statement 错误不会写进 replacement session。项目切换会同步撤回旧文件 session/running id/diagnostics 并保留 SQL，再异步 closeProject；重新打开、失效和取消也清除旧诊断。文件侧栏与“打开文件”双入口保留。

这里的配置回执来自现有发送队列完成；本轮没有新增通用的 server-applied configuration 握手。诊断另核对服务端实际分析 token，Native 又核对当前真实候选/类型。不能把传输发送完成外推为所有 provider 在任意调度下均已获得独立的配置就绪证明，这一项继续列为后续协议核对。

### 44 项新增测试与生产构建

新增 **44 项**：纯文件 analysis context 22、实际文件 intelligence hook 11、共享生命周期 4、真实 LspClient runtime 3、项目 session 撤回 1、格式化/当前语句命令 3。包括十种来源变化、已显示来源同步撤回、旧配置晚到、same-client restart、StrictMode、source ABA、SQL/results 更新不重配、同步中途关闭、旧补全/格式化结果、文件 URI owner、live model 与 deferred props、显式 file tab 的诊断、补全与格式化大小写分别遵循设置。

最终 **2747 passed / 441 文件 / 无失败与跳过**；生产 build **2881 文件**模块大小、边界、类型和 bundle 门禁通过。初次新生命周期测试的 Monaco stub 只有空对象，补齐 getValue/isDisposed；新 hook stub 也补齐实际 adapter 所需的 CompletionItemInsertTextRule。新增测试的可选数组索引类型问题已修正，最终全量和构建均重新运行。

### 真实驱动元数据与 Native

DuckDB driver 以 --locked --offline 重新构建至其实际 target/debug，SHA-256 `cd9f5d0f55e1d84feff3c3b474f23de3c764c08655b5136973e4aa07b8e63a10`。独立字节协议从两份实际 CSV 的零行查询取得 region/VARCHAR、revenue/BIGINT 与 region/VARCHAR、revenue_new/BIGINT；替换 LSP schema 后旧 revenue 消失。另验证完整字段 hover 保留 BIGINT、Unicode 和 9007199254740993 的格式化文本不变。

真实隐藏 WebView **66 场景 / 1840 断言**，目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-Cqm6Ir`，原 63 场景全部重跑。新三场景安装生产 useLspClient、文件 intelligence、文件 commands、core 和 diagnostics，经实际 Tauri LSP 命令和新 session 进程：

1. 两层星号 CTE 中 `q.reve<cursor>Suffix` 的实际推荐、resolved candidate BIGINT 与真实接受；编辑器实际应用格式化 edits，并保留 Unicode 与高精度整数 SQL。
2. 旧文件列表可见时替换 renderer session 和另一份 CSV 的实际字段，SQL/版本不变；旧列表撤回，新作用域配置后显式触发得到 revenue_new，旧 revenue 消失，真正接受会完整消费词尾。
3. 同一私有 data view 经 CTE 与 JOIN 形成的 OXIDE004 实际显示，文件 URI 的显式 tab 收到问题；关闭 renderer session 后撤回真实 marker/问题，并保留 SQL/version。

Native 字段来自真实 DuckDB 元数据，但 renderer session 是受控夹具，**realHostFileSession=false**。本轮未把原生 picker、项目侧栏、签名 Registry 文件会话或完整 Workbench 路径连成端到端，未将该范围写成已验收。实际执行的数据操作为独立 driver 的只读零行查询；光标未完成的 Native SQL 用于分析、格式化和接受，不冒充执行成功。

首次 Native 在 BIGINT 断言失败，目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-EjyeML` 保留。断言查询的是未完成/不存在名称 reveSuffix 的 hover；实际字节探针确认该 hover 为 null，完整 revenue_new 的 hover 为 BIGINT。本轮修正为核对光标处真实 resolved candidate 的类型，保留两层 CTE、原词尾和实际接受 SQL 断言；没有把错误的 hover 位置当成产品类型 bug。探针与失败日志分别保留。第二次 Native 目录 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ezHNBj` 在格式化阶段失败，测试宿主缺少生产已注册的 lsp_formatting；仅补接该生产命令后继续原断言。最终还要求 Monaco model 的文本实际发生格式化变更，不能只凭请求返回成功和输入中本来就有的数字/Unicode 判通过。

### 复用和继续推进的范围

生产 Host **642** 与 vendor src/tests **305** 份输入、捆绑 release 和 **267** 项 runtime 指纹均与第六十二批相同，release SHA-256 `bd05d3f614dd9dddcd46c84d13ddac8e72c8d5e0715a97247b25bc96fe54b627`。因此明确复用第六十一批的 vendor **1043**、实字节协议 **85**、Host Desktop **1083 / 12 ignored**、headless **427 / 4 ignored**、strict Clippy、应用集成 **13**、源码包核对；源码包未独立编译。本轮新跑前端、真实驱动构建/文件协议和 Native，全部 Desktop Cargo 后以禁止 PROTOC 环境恢复无 Desktop CLI **oxide-agent 0.1.18**。

固定 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的 53 项算法/EditorState 矩阵复用第六十一批：被测 stdio 字节、参考与夹具未变。文件 UI 增量不在该固定矩阵中，不能写成完整 DBX 桌面对比。参考树干净，未 fetch，不称远端最新。SQL Server 实测/清理沿用第五十八批，许可与既有隔离测试授权保留，本批未启动新容器。

后续仍需通用服务端配置就绪证明、普通编辑器重启/无连接 reader 核对、完整签名 Host 文件会话与双入口 UI、多窗格共享 session/marker/close ownership、实际 Console mapping/版本变化、更多带引号标识符/复杂类型/方言、真实事务 metadata 与引擎取消确认、role/search_path/权限/临时对象、跨文档 edits、性能/RSS/网络、签名安装、多平台与 CI。全部 G01–G13 / E01–E07 与文件双入口原目标保持进行中；未提交、推送或发布。

机器证据：.impeccable/review/lsp-file-context-evidence.json，保存真实输入摘要、新跑/复用范围、夹具限制和原始失败。



## 第六十四批：服务端配置生效确认

第六十三批已把配置发送与具体文件来源绑定，但 notification 写入成功不能单独证明服务端已提交配置。本批增加只读 `oxide/analysisConfiguration`，使用既有配置读锁等待 schemas、路由、设置与 provenance 的提交完成。它不打开文档、不上传或解析 SQL；只接受 1–128 字节 ASCII token，只有完全匹配才回显调用方 token，未匹配不泄露另一个上下文的 token。缺参/非法值返回 InvalidParams。

客户端通过 scoped Host generic transport 严格检查 applied/token，并在响应后核对同一个进程实例。生产 dispatcher 统一接入两个主编辑器 metadata 发布入口和文件查询配置入口：发送后确认，再授予 ready；晚到、失败或被覆盖的确认不能发布 token。重复配置会重新确认旧 token，缺少回执或已重启/被覆盖时发送新 token；没有无限轮询。增加一次轻量配置回读，不重复发送 SQL。Host 只新增这一条精确白名单授权及负控。

| 层 | 本批新增 | 全量结果 |
| --- | ---: | --- |
| 前端 | 30 | 2777 passed / 442 文件 |
| vendor 库 | 8 | 845 passed |
| stdio 协议 | 3 | 88 passed；捆绑 release 实字节也重新执行 |
| vendor 合计 | 11 | 1054 passed / 24 target / 无忽略 |
| Host | 1 | Desktop 1084 passed / 12 ignored；headless 427 passed / 4 ignored |
| 应用 LSP 集成 | 0 | 13 passed |
| 实际 Native WebView | 1 场景 | 67 场景 / 1847 断言 |

单元测试覆盖未初始化、非法/超长 token、错误/异上下文回执、请求中断线和同 client 重启、配置写锁等待/取消、重复旧回执、新 token 重发、来源失效后的迟到确认，以及文件/主编辑器在确认前不发布语义结果。最初三项新协议测试误把工具已解包的 result 再解包；修正测试后全量和捆绑字节协议均通过，原失败日志保留，未借此改生产逻辑。

Native 新场景使用生产 LspClient → 实际 Tauri generic command → release LSP，在完全不打开 SQL 文档的独立 session 验证首次未配置、配置 A 生效、B 覆盖撤销 A、停止和重启撤销旧 token，并关闭测试进程。既有生产 hooks/真实 Monaco 列表接受、格式化、诊断和文件关闭撤回全部重跑。证据根：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-hN3apj`。文件部分仍为实际 DuckDB 元数据的 renderer 会话夹具，`realHostFileSession=false`；没有证明签名 Registry、picker、侧栏和完整 Workbench 文件流程。

生产 build、vendor/Host Desktop/headless strict Clippy、fmt 与限定 diff 检查通过。release SHA-256：`07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`；runtime fingerprint 268 份输入。归档 **294 文件 / 254 Rust src / 16 额外输入**逐字节核对，锁文件规范化/TOML 一致；`cargo package --no-verify` 不等于独立归档重编译。全部 Desktop Cargo 后用禁止 PROTOC 的环境恢复 headless CLI **oxide-agent 0.1.18**。

固定 53 项 DBX 对比为本批新跑：Oxide 字段 46/46、类型 44/44、隔离 7/7；DBX EditorState 35/46、18/44、3/7。参考仍是 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。仅同夹具算法/EditorState，非完整 DBX 桌面或厂商引擎对比。SQL Server 16.00.4305 四组 conformance/清理证据沿用已获许可的第五十八批，协议/JDBC 来源哈希未变，本批没有新容器。

仍需继续：多窗格的格式化 provider 路由与 session/marker 所有权；主编辑器重启及无连接上下文；完整 Host 文件会话与双入口；Console 映射/版本与引用标识符；实际角色、权限、search_path 与事务物理元数据；引擎取消确认；跨文档编辑/关闭顺序；大目录/RSS/网络、安装、多平台/CI。本回读只证明指定 token 当前已提交，不证明全部配置值合法、数据库权限完整，也不独立解决并发配置所有者。G01–G13、E01–E07、文件侧栏与“打开文件”原范围保持进行中，未提交/推送/发布。

可机器核对证据：`.impeccable/review/lsp-configuration-receipt-evidence.json`。


## 第六十五批：多文档格式化路由与旧错误回执

真实双编辑器基线复现了一个单文档测试无法发现的问题：生产 core coordinator 为每个文档按相同语言注册 formatter，Monaco 先选择一个 formatter，再执行回调内的 URI 检查。第二个窗格注册后，第一个窗格的“格式化文档”未产生修改。基线已通过前 67 场景，新增双文档步骤在 `real Monaco document formatting selects URI owner 0` 失败；原 coordinator 来源哈希与第六十四批一致。失败回执保留在 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-vRRaKI`。

新 `lspFormattingRegistry` 为每个 Monaco languages 对象、语言和格式化种类共用一个注册，先按完整 URI 查找所有者，再调用生产回调。URI authority、path、query、fragment 均参与区分，路径中的 glob 字符不做模式匹配；按路径的 selector 无法保证不同 authority 的隔离。注册层不读取 SQL、连接或元数据，不新增 Tauri 权限。文档/选区格式化两个入口都已接入现有 coordinator，因此主编辑器和文件查询使用同一实现。

路由保留每个 URI 的最新注册所有者和代次。关闭一个文档不会释放兄弟文档仍使用的注册；最后一个所有者离开后释放 Monaco 注册。请求完成时再次检查路由对象、所有者代次和模型存活，拒绝替换、关闭及“临时新所有者出现后离开”的 ABA 迟到结果。同 URI 的旧注册可在新注册离开后恢复，但仍需通过原有生产来源/模型检查；这没有解决共享文档的关闭、marker 和配置写入所有权。

另有四项新增单元测试复现旧格式化错误回执泄漏：请求失败前关闭 provider、切换语义上下文、取消或编辑模型，旧失败仍会调用 `onDocumentFormatResult`。catch 分支现在使用与成功结果相同的来源/模型/取消检查。当前请求的真实失败仍正常报告。原始 4 failed / 51 passed 日志与修复后测试都保留。

| 验证 | 本批结果 | 范围 |
| --- | --- | --- |
| 新增前端测试 | 20 | 15 注册层 + 5 错误回执 |
| 全量前端 | 2797 passed / 443 文件 | 无失败、无 pending |
| 定向回归 | 84 passed / 3 文件 | 注册层、生产 core coordinator、文件查询 hook |
| 生产 build | 2886 文件 | 类型检查、边界和 bundle 验证通过 |
| 实际 Native WebView | 68 场景 / 1872 断言 | 生产 core provider + 实际 Monaco + Tauri + release LSP |

Native 新场景创建两个同语言、相同 fsPath、不同 authority 的模型，以及两个实际 LSP session。各 session 的配置回读生效后，通过 Monaco 内置动作分别格式化两个文档和两个选区；每次检查目标确实修改、兄弟文档文本和版本不变、来源文字保留。释放第二个 coordinator 后再次格式化第一个文档，并检查 Unicode 和大整数文本。共 5 次实际格式化。修复前后使用同一份场景源码，失败/通过来源哈希可核对。通过证据：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-oWWKuj`。原有真实文件元数据/生产 hook、可见推荐接受、格式化、诊断撤回与配置重启确认场景也全部重跑。

1024 个同语言文档的单元测试确认全局 formatter 只注册一次，发起一次请求只调用目标回调。实现通过 Map 按完整 URI 查找；这不是大目录/RSS 或网络性能基准，仍未证明完整大规模产品性能。测试还覆盖语言/Monaco 实例隔离、无所有者/已关闭模型、引用计数释放、同 URI 注册叠加、代次变化和错误处理。

本批前端冻结 1884 份输入；生产 Host **642 份**和 vendor src/tests **307 份**与第六十四批逐字节相同。release SHA-256 仍为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`。因此 vendor **1054 / 库 845 / 24 target / 捆绑实字节协议 88**、Host Desktop **1084 / 12 ignored**、headless **427 / 4 ignored**、strict Clippy、应用 LSP 集成 **13**、source package **294 文件**均明确复用第六十四批，未声称本批重新执行。DBX 固定 **53** 对比同样复用第六十四批同捆绑字节结果：字段 46/46、类型 44/44、隔离 7/7；参考 `b160d130560f71c5c429be15cec6147f677a4b3a` 未 fetch，不代表完整 DBX UI 或厂商引擎对齐。

本批重新查询实际 DuckDB CSV 元数据，但沿用第六十三批来源未变的独立驱动构建。文件 Native 仍为 renderer session 夹具，`realHostFileSession=false`，尚未覆盖签名 Registry、完整 Host 文件会话、picker/侧栏和可见 Workbench。SQL Server 16.00.4305 四组 conformance/清理沿用已获许可的第五十八批；JDBC/协议来源未变，本批没有新容器。全部 Desktop Cargo 后以禁止 PROTOC 的环境重新恢复 headless CLI **oxide-agent 0.1.18**。

下一步优先用多个真实模型核对其他 Monaco core provider 的选择/结果合并语义，例如 semantic tokens、signature、rename、symbol、folding、selection；本批没有证明这些路由已修复。其他未完成范围继续保留：同 URI 多窗格 session/marker/配置所有权；主编辑器重启及无连接上下文；完整 Host 文件双入口；Console 映射、版本和引用标识符；角色/权限/search_path、事务物理元数据；引擎取消确认；跨文档编辑与关闭；大目录/RSS/网络、安装、多平台/CI。G01–G13、E01–E07、文件侧栏与“打开文件”原范围仍进行中，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-format-routing-evidence.json`。



## 第六十六批：多模型语义 token 与 core 命令选择

在相同语言、相同路径、不同 authority 的两个真实模型中复现：LSP 本身返回非空 token，但 Monaco 命令 `_provideDocumentSemanticTokens` 没有保留第一个模型所属的数据。基线 coordinator 与第六十五批来源哈希一致，前 68 场景已完成；新增步骤在 `Monaco semantic command preserves the owning token data for model 0` 失败。原始回执：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-C3vTAM`。同时直接调用已安装 Monaco 的实际 `getDocumentSemanticTokens` 合并函数，13 项回归在原实现上为 **10 failed / 3 passed**。

Monaco 并发调用同级 provider，按顺序选择有 `data` 的结果；空 Uint32Array 也满足这个条件。原 coordinator 对其他 URI 返回空数组，会遮住正确所有者的非空 token，甚至遮住其真实错误。现在先按完整 URI 判断所有权：非所属模型返回 null；所属模型在取消、运行时不可用、上下文失效或没有 token 时仍返回明确的空结果，以撤回旧高亮。这保留了来源安全屏障，没有通过跳过空数组来保留旧物理字段。

新增 **13 项前端测试**使用真实 Monaco 合并函数和生产 coordinator，覆盖较早/较晚注册的两个模型、未拥有模型、明确清空、取消/运行时不可用、元数据刷新、配置 token 匹配发布、兄弟释放、迟到结果、128 个 provider 只请求目标 LSP、真实空数据，以及所属错误不能被其他 URI 掩盖。生产修复只有 coordinator 的所有权分支，没有新增运行时模块或泛化不同功能的选择规则。

| 验证 | 本批结果 |
| --- | --- |
| 定向回归 | 82 passed / 3 文件 |
| 全量前端 | 2810 passed / 444 文件，最终 4 worker |
| 生产 build | 2887 文件，类型/边界/bundle 检查通过 |
| 实际 Native WebView | 71 场景 / 1944 断言 |
| 新增 Native | 3 场景：token 合并、其他 core 命令、无 SQL 编辑的元数据刷新 |

Native 使用生产 LspClient、实际 Tauri/release LSP 和真实 Monaco 命令服务。两个模型各自配置不同的表、列和函数参数，SQL 包含多行 CTE、别名、函数调用及 Unicode 注释。token 命令结果逐项等于各自 LSP 的实际数组；未拥有的同语言模型不能借用其他文档数据。单独核对签名、prepare rename、rename、symbol、folding、selection 的实际选择/合并规则，而不是套用格式化或 token 的规则。每次命令检查实际调用所属 RPC、未调用兄弟文档 RPC；签名对应本模型的参数，CTE 重命名计划恰好包含同 URI 的声明/引用两处，符号、折叠、嵌套选择范围返回本模型的结果。

第三个场景先使所属元数据不可用，确认旧 token 清空且不派发物理 token 查询，再确认新配置提交。保持 SQL 文本和 Monaco 版本不变，实际 LSP token 随元数据替换变化，Monaco 命令重新获得新数组；释放兄弟 provider 后仍保留所属结果。通过根：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-rWNaUe`。本批验证的是实际命令/token/编辑计划管线，未覆盖高亮像素、签名弹层、重命名输入框或重命名编辑应用；同 URI 共享模型生命周期/marker 所有权仍未证明。

首次默认并行全量运行有一项现有设置页用例失败（约 7.58s）。该文件来源哈希未变，独立复查通过，4 worker 全量重新通过；失败 JSON、独立回执和最终全量 JSON 分别保留。首次修复后的 Native 已通过 token 步骤，随后测试断言误把 selection 命令直接返回的 Range 当成含 range 字段的对象；按 Monaco 实际返回结构修正后，全部 71 场景通过。原始失败回执保留，生产代码没有因该断言错误另做修改；token 关键输入/检查未变。

前端冻结 **1885 份输入**；Host **642 份**、vendor src/tests **307 份**与第六十五批逐字节一致。捆绑 release 仍为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`，runtime fingerprint 268 份输入。vendor **1054 / 库 845 / 24 target / 捆绑实字节协议 88**、Host Desktop **1084 / 12 ignored**、headless **427 / 4 ignored**、strict Clippy、应用集成 **13**及 source package **294 文件**明确复用第六十四批既有结果，未声称本批新跑。

DBX 固定 **53** 也复用第六十四批同捆绑字节/夹具：字段 46/46、类型 44/44、隔离 7/7；仅算法/EditorState 窄矩阵，非完整 DBX 桌面或厂商引擎对齐。参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。本批 Native 再次读取实际 DuckDB CSV 元数据，独立驱动构建沿用第六十三批；文件场景仍是 renderer session 夹具，`realHostFileSession=false`。SQL Server 16.00.4305 四组 conformance/清理沿用已获许可的第五十八批，JDBC/协议来源不变，本批无新容器。全部 Desktop Cargo 后已用禁止 PROTOC 的环境恢复 headless CLI **oxide-agent 0.1.18**。

继续推进：主编辑器实际 LSP 重启后的推荐列表和无连接文档内提示；元数据不可用时 documentSymbols 等“文档内”RPC 的真实读取范围；同 URI 多窗格配置/session/marker/关闭所有权；可见弹层和编辑应用；完整签名 Host 文件会话、picker/侧栏与双入口；Console 映射、版本和引用标识符；真实权限/角色/search_path/事务元数据；引擎取消确认；跨文档编辑；大目录/RSS/网络、安装、多平台/CI。G01–G13、E01–E07、文件侧栏与“打开文件”原范围继续进行中，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-core-routing-evidence.json`。



## 第六十七批：主编辑器进程代次与无连接文档提示

已用生产 useLspClient、LspConnectionSyncer、文档生命周期和 useQuerySqlCompletion 复现：实际关闭连接 LSP 后，主编辑器旧物理字段列表仍可见。原始来源与第六十六批一致，前 71 场景通过；新步骤在 `client disconnect withdraws visible main-editor suggestions synchronously` 失败。基线回执：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-mPjf5b`。

主路径现在订阅客户端的实时进程快照，已观测断开会同步撤回列表并触发保留会话恢复；每个 hook 合并自身重复恢复调用，多个消费者仍共享客户端初始化。就绪布尔值没来得及渲染为 false 的快速重启，也会推进进程代次。配置来源 identity 和完成上下文都绑定该代次；缺少进程匹配或已确认 token 时，不再通过旧 legacy 条件授予物理元数据。配置尚未确认、旧进程确认迟到，以及旧完成结果，都不能让新上下文 ready。启动失败后由外部修复进程，旧错误文字也会清除。

文档生命周期直接观察进程，重新打开未修改的主文档；同客户端的项目索引文档也会撤销旧记录并重新打开。主编辑器补全和 core provider 接入现有文档同步 FIFO，与关闭/重开共享次序；同步后再次检查来源，避免继续发出旧请求。LSP 重启只重取进程内配置与文档，保留同一数据库、同一操作代次的元数据缓存；单元测试确认不会因此重复读取列和能力。数据库连接/操作代次或元数据版本真正变化时，原有刷新规则保留。

无连接路径改为明确的文档内上下文：可以推断显式 CTE 投影，不能读取旧连接的物理字段或沿用分析 token。带连接的读取器同时核对实时 tab/global 有效连接，清除全局默认连接时，即使 tab 自身路由没变，也会同步撤回旧列表。显式绑定连接的 tab 则不受其他全局连接选择影响。

| 验证 | 本批结果 |
| --- | --- |
| 新增前端 | 37：运行时 hook 11、上下文 19、生命周期 3、同步器 4 |
| 全量前端 | 2847 passed / 445 文件，4 worker，无 pending |
| 生产 build | 2889 文件，类型/边界/bundle 检查通过 |
| 实际 Native WebView | 74 场景 / 1964 断言 |
| 主路径新场景 | 断开撤回/恢复、旧非空响应迟到、无连接 CTE 列表接受 |

Native 使用实际 Host SQLite fixture、真实 LSP、生产 hook 和 Monaco 列表。两层星号 CTE 的物理字段在断开时消失；恢复重新取得不同的服务端确认 token，在不修改 SQL/版本的情况下重新打开文档，直接向新 LSP 查询可得到该字段。两次恢复在第一次 15 秒健康轮询之前完成。另一次请求先取得实际含物理字段的旧 wire 响应，再延迟到重启后交还 renderer，生产 provider 返回空列表；新的实际列表可接受并消费完整后缀。最后清除全局连接，真实列表仍可接受显式 local_amount，且不调用旧连接 LSP。通过根：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-qsefSa`。

上述即时撤回基于客户端已观测到断开。静默的后台进程退出仍可能依赖 15 秒健康探测；本批未证明所有入口（例如 WhereCompletionInput）、同 URI 多窗格关闭/marker/配置所有权或项目索引与编辑器共同持有一个 URI 的次序已解决。Native 中连接描述/视图状态为 renderer 夹具，数据库和查询链为实际 Host fixture；未覆盖安装包或完整可见 Workbench。

本批第一次修复后 Native 在较早的缓存 Net 候选列表场景失败，停于 **47 场景 / 1636 断言**，尚未运行新增主路径。该场景使用缓存分支，尚未进入 live LSP 或连接上下文；其生产输入与后续通过运行一致。保留原断言，增加仅失败时输出候选/模型的诊断探针，未放宽通过条件。两个新进程分别完成 **74 / 1963**，补充旧 wire 非空正控后的第三个新进程完成 **74 / 1964**；首次列表未显示的原因仍未定位，不能据此声称该问题已修复。原始回执：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-wv1g7K`，探针和待查项保留。

前端冻结 **1887 份输入**，生产 Host **642** 和 vendor src/tests **307** 与第六十六批逐字节一致。release 仍为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`，268 runtime 输入。vendor **1054 / 库 845 / 24 target / 捆绑实字节协议 88**、Host Desktop **1084 / 12 ignored**、headless **427 / 4 ignored**、strict Clippy、应用集成 **13**及 294 文件 source package 明确复用第六十四批同来源证明，不声称本批重跑。

DBX 固定 **53** 也复用第六十四批同捆绑字节：字段 46/46、类型 44/44、隔离 7/7；仅算法/EditorState 窄矩阵，非完整 DBX UI/厂商引擎对齐。参考仍为 `b160d130560f71c5c429be15cec6147f677a4b3a`，未 fetch。文件元数据再次实际查询 DuckDB，构建沿用第六十三批；文件 Native 仍为 renderer session 夹具，realHostFileSession=false。SQL Server 16.00.4305 四组 conformance/清理沿用已获许可的第五十八批，JDBC/协议来源未变，本批无新容器。

归档阶段 C 盘剩余空间降为 0，CLI 构建以 101 失败，首次证据脚本写入也失败。自动审批拒绝递归删除测试浏览器缓存，该动作未执行。随后先以 cargo clean --dry-run 核对仓库内 src-tauri/target，再仅清理 oxide-studio 包的 dev 产物，释放约 **2.2 GiB / 1119 文件**；源码、依赖缓存、所有回执及浏览器资料保留。之后用禁止 PROTOC 的环境重新构建 headless CLI **oxide-agent 0.1.18** 成功。临时 Native Host 可执行构建产物可能被此次 package clean 删除，已记录的 receipt、来源哈希、JS bundle 和日志均保留；捆绑 release LSP 未变。

继续推进：缓存列表首次失败的可复现诊断；其他入口与静默进程退出；同 URI 共享所有权；元数据不可用时 documentSymbols 等文档 RPC 的实际读取范围；完整签名 Host 文件会话、picker/侧栏和双入口；Console 映射/版本、引用标识符；真实角色/权限/search_path/事务元数据；引擎取消确认；跨文档编辑；大目录/RSS/网络、安装、多平台/CI。G01–G13、E01–E07、文件侧栏与“打开文件”原范围继续进行中，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-main-runtime-evidence.json`；磁盘恢复记录：`.impeccable/review/lsp-main-runtime-disk-recovery.json`。



## 第六十八批：缓存复杂 CTE 的实际列表压力与有界诊断

本批针对第六十七批缓存分支的一次 Net 列表未显示，保留原通过条件和 10 秒截止时间，加入最多 256 项的诊断轨迹：实际 provider 开始/结束/取消、Monaco suggest 触发/结果/取消、模型切换、焦点变化。失败时记录原 SQL、目标标签、当前模型/版本、列表内容和直接候选；接受失败时还记录当前选中项和实际编辑文本。探针属于 Native 测试，未加入产品运行路径；观察者可能影响时序，不能据此证明竞态不存在。

新增缓存压力场景轮流切换 MySQL、PostgreSQL、SQLite、SQL Server、Hive、ClickHouse 模型，共 5 轮：普通 net 别名 30 次、带空格中文别名 Net 总额 30 次、原 PostgreSQL q("Net") 输出列清单 5 次。每次通过真实列表接受而非直接 executeEdits，校验规范引用符、保持限定名并消费 Revenue 后面的 suffix。输入为显式预加载物理字段/注释及驱动 capability 夹具；生产 provider/coordinator、真实 Monaco 和 WebView 保持使用。它验证 renderer 缓存补全语义，**不表示六种真实数据库引擎均执行过这些 SQL**。

第一版压力夹具未声明三个外部驱动的引用符，运行在接受文本断言失败，根为 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-8O3CWC`。六种方言单元矩阵在 SQL Server/Hive/ClickHouse 精确文本断言复现了 3 个失败；它们使用了通用默认引用符。修正方式是在该用例作用域注册明确 capability 并在 finally 恢复原值，保留原期望和断言，不修改产品引用符逻辑。第一份 Native 未捕获实际编辑文本，因此不能从该回执断言字节级原因，更不能将它当作原 Net 间歇问题的根因。原始失败与无效夹具测试 JSON 都保留。

| 验证 | 本批结果 |
| --- | --- |
| 新增单元矩阵 | 6 方言，带空格中文引用名、注释继承、decimal 类型、完整后缀、仅查询 ledger 元数据 |
| 相关测试文件 | 186 passed |
| 全量前端 | 2853 passed / 445 文件，4 worker，无 pending |
| 类型检查 | tsc --noEmit 与 Native harness tsc 均通过 |
| 实际 Native WebView | 75 场景 / 2291 断言，65 次压力接受；缓存元数据 miss=0 |
| CLI | headless oxide-agent 0.1.18，禁止 PROTOC 环境恢复成功 |

最终 Native 根：`C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-iz2V5k`。本轮 65 次全部通过，原 Net 未显示未复现；**未定位根因、未声明修复**。有界轨迹仅保留最近事件，单次运行也不构成长期稳定性证明。Native 为隐藏窗口，不覆盖安装包或完整可见 Workbench。文件元数据再次通过实际 DuckDB 查询准备，但文件会话仍为 renderer fixture，realHostFileSession=false。

逐字节核对上一批 1887 份前端输入，仅本批新增用例的 cachedSqlMetadataCompletion.test.ts 改变；生产前端、642 份 Host、307 份 vendor src/tests 未变。因此复用第六十七批生产 build（2889 文件），不声称本批重跑 build。release LSP 仍为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`。vendor 1054 / 库 845 / 24 target / 捆绑协议 88、Host Desktop 1084 / 12 ignored、headless 427 / 4 ignored、Clippy、DBX 53 为既有来源一致结果，本批未重跑。DBX 参考固定 b160d130560f71c5c429be15cec6147f677a4b3a，未 fetch，不能声称当前远程最新；53 项仅为算法/EditorState 窄矩阵。SQL Server 许可授权继续有效，四组真实 conformance 与清理复用第五十八批，本批无新容器。

磁盘方面，先仅清理核对过的 vendor sql-lsp dev 包产物，释放约 1.1 GiB。一次诊断 Native 在编译静态库时仍遇 os error 112，未生成运行回执，根为 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-hfsN6M`。随后 metadata 核对仓库 target、dry-run 核对后，仅 cargo clean oxide-studio dev 产物，释放约 1.9 GiB；最终 Native 完成后，再核对并清理同包约 1.7 GiB，为 headless CLI 恢复腾出空间。源码、依赖缓存、浏览器资料、receipt/JS bundle/日志及捆绑 release 均保留，临时 Native 可执行构建产物可能被 package clean 删除；没有重试上一批被拒绝的浏览器资料递归删除。

后续继续：原缓存列表间歇失败；静默进程退出与其他编辑器入口；同 URI 多消费者/项目索引共享所有权；元数据不可用时文档 RPC 范围；真实签名 Host 文件会话、picker/侧栏双入口；Console、角色/权限/search_path/事务、引擎取消确认、跨文档编辑、大目录/RSS/网络、安装及多平台/CI。G01–G13、E01–E07、文件双入口原范围仍在进行中。本批未提交、推送或发布。

机器证据：`.impeccable/review/lsp-widget-race-evidence.json`。


## 第六十九批：同 URI 编辑器与项目索引共享文档

先增加两个针对现状的回归：两个 lifecycle hook 持有同一 URI，以及项目索引与编辑器持有同一个保存文件 URI。修复前 **13 passed / 2 failed**，两项都明确收到两次 didOpen，而期望只有一次。回执 `.impeccable/review/lsp-document-ownership-baseline.json` 保留，原断言未删除。

新增无 React 依赖的 documentOwnership 服务，以实际 client、会话、进程代次、完整 URI 管理持有者和一条服务端文档队列。编辑器优先级高于索引快照；同级编辑器分享已提交的最新缓冲区，释放最近写入者不会倒退到另一个窗格的旧文本。索引记录自己的最新磁盘内容，最后一个编辑器退出后通过 didChange 恢复它；只有最后一个持有者退出才 didClose。跨进程的旧持有者不能重新写入，也不能关闭已被新进程接管的文档。失败的通知不提交虚假版本，失败队列仍可重试。

useLspDocumentLifecycle 与 createProjectDocumentSync 接入同一服务；所有存活编辑器的 opened/version/text shadow 在服务端通知成功后一起更新。旧的 syncLspModelBeforeCompletion 路径通过 shadow-map 绑定加入持有者队列，释放后的旧 provider 调用被拒绝，避免重新打开已关闭 URI。实际已验证的是 production completion provider 的旧同步分支；其他 hover/inline/Console 调用虽复用此 helper，尚不能据此宣称所有入口都完成了同 URI 的端到端验证。最终关闭时保留的生命周期 marker 清理按 Monaco scope 去重，避免项目索引长期持有文件时积累重复窗格清理回调。

| 验证 | 本批结果 |
| --- | --- |
| 新增服务单元测试 | 16：共享、优先级、版本、失败重试、进程切换、URI/会话隔离、回调去重与观察者异常 |
| 新增生命周期回归 | 2：双编辑器；索引与未保存编辑器 |
| 新增 shadow 回归 | 3：绑定同步、释放拒绝、旧解绑不覆盖新绑定/通知去重 |
| 新增项目同步回归 | 2：同 client 新进程、同名会话新 client |
| 全量前端 | 2876 passed / 446 文件，4 worker，无 pending |
| 生产 build | 类型、边界、2891 文件规模检查与 bundle 检查通过 |
| 实际 Native WebView | 79 场景 / 2319 断言；本批新增 4 场景、3 次实际列表接受 |

Native 根 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-PSyapo`。实际运行两个 Monaco 编辑器、生产 lifecycle hook、生产 project sync、production completion provider、真实 Host 与捆绑 LSP。在同一个 project URI 中，索引的 disk_value 与未保存的两层星号 CTE unsaved_value 为不同正控。实际 wire 完成列表必须包含 unsaved_value 且不含 disk_value，真实列表接受并消费 unsSuffix 后缀。关闭一个编辑器后保留文档与现存真实服务端诊断标记；索引刷新和关闭都不覆盖仍存活编辑器的内容。重新加入索引并释放最后一个编辑器后，实际服务端补全改为 disk_value 且不含 unsaved_value。完整 trace 为 **1 次 open、连续版本 1–10、1 次最终 close**，最终关闭清除保留的 Monaco marker。

诊断标记由实际 syntax snapshot RPC 获得，并通过生产 Monaco adapter 映射；本批 Native **没有挂载完整 useEditorDiagnostics hook**。该 hook 及局部 Oracle/MySQL/database-query marker 的多个发布者仍各自拥有 clear/dispose 路径，不能将“生命周期释放保留已有标记”扩展为全部诊断发布者共享所有权已解决。项目索引/编辑器共享文档的这一部分已从原 pending 中推进，完整诊断发布、额外原始 didOpen/didClose 调用方及完整 Workbench 继续保留。

第一次 Native 在诊断正控失败，根 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-U2USIA`，已完成 **76 场景 / 2299 断言**，其中第一个新增共享列表场景通过。其 SELECT ( 没有提供预期非空 parser diagnostic；当时未保存原始 snapshot，不能声称已定位它返回空的内部原因。仅修改测试输入为协议既有的含汉字/emoji及完整非法表达式 SELECT (1 + );，并加强为要求第二行 SYNTAX_ERROR。所有产品输入与最终运行逐字节相同；失败日志保留，未更改产品语法诊断来制造正控。

冻结 **1889** 份前端输入：上一批七个已有文件和新服务/测试文件为本批范围，其余保持一致。Host **642**、vendor src/tests **307** 未变，release 仍为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`，268 runtime 输入。vendor 1054 / 库 845 / 24 target / 捆绑协议 88，Host Desktop 1084 / 12 ignored、headless 427 / 4 ignored、Clippy、应用集成 13、DBX 53 等均复用既有来源结果，不声称本批重新执行。DBX 固定 b160d130560f71c5c429be15cec6147f677a4b3a，未 fetch、不是远程最新声明；53 项也不是完整 DBX UI/厂商引擎覆盖。SQL Server 继续沿用第五十八批的许可、四组 conformance 和清理记录，本批无新容器。

本轮还完整运行既有缓存六方言 65 次列表压力验证；原 Net 间歇失败仍未复现、未定位根因。文件准备再次执行实际 DuckDB 元数据查询，文件 Native 仍是 renderer session fixture（realHostFileSession=false），并非签名 Host/picker/侧栏完整双入口。Native 窗口隐藏，未覆盖安装包或完整可见 Workbench。

为磁盘空间，分别先核对 metadata target 和 cargo clean --dry-run，再仅清理当前 oxide-studio 包 dev 产物：首次约 662.5 MiB，诊断夹具重跑前约 1.7 GiB；未删除浏览器资料、依赖缓存、源码或证据。最终 Native 后剩余空间足够，未再次清理，直接在禁止 PROTOC 环境恢复 headless **oxide-agent 0.1.18**；最终 Native 可执行文件保留并重新核对 SHA。CLI 恢复后 Native receipt、bundle、日志及捆绑 release 也均保留。

接下来：完整诊断 hook 的共享 marker 发布；剩余文档调用者和静默退出/其他编辑入口；文档 RPC 的元数据读取范围；签名文件 Host 会话与侧栏/Open File 双入口；Console、真实角色/权限/search_path/事务、取消确认、跨文档编辑、大目录/RSS/网络、安装及多平台/CI。G01–G13、E01–E07 与文件双入口原范围继续，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-document-ownership-evidence.json`。


## 第七十批：共享诊断与方言标记隔离

本批从上一批明确未覆盖的完整 useEditorDiagnostics 入手。修复前两个共享窗格测试都失败：关闭一个窗格清除另一个窗格仍有效的 sql-lsp 标记；新窗格等待通知时也会清空已有结果（0 passed / 2 failed）。第一轮共享实现后，新增独立标签回归发现 Problems 只更新画面发布者，未更新同一项目文件的其他标签（13 passed / 1 failed）。随后跨方言检查发现后台 MySQL 的延迟分析、重新挂载 Oracle 的标记能进入聚焦 PostgreSQL 的同一模型视图（14 passed / 2 failed）。三份失败 JSON/日志均保留，原期望未放宽。

新增 sharedModelPublication、sharedDiagnosticMarkers、sharedEditorMarkers 三个小模块。共享注册按 Monaco editor 命名空间、实际 model 对象、标记层隔离；每个发布者独立释放，聚焦发布者决定画面的授权，其他发布者的结果必须通过它的 session、dialect、上下文、Monaco 版本、已确认 wire 版本与 SQL 文本检查。保留一个最新结果与存活发布者候选，包含“没有错误”的空结果，因此窗格退出不会恢复更旧的错误。当前上下文变更后，即使只有一个订阅回调先执行，其他过期候选也不能重新进入画面。

Problems 按 setter 和 tab id 选择接收者：同一标签的多个窗格共享一个更新位置，不同标签各自接收符合自己当前授权的结果。退出一个窗格不会发送清空更新到仍有持有者的同一标签；撤回上下文会同步撤回各标签的旧结果。SQL 层的通知、shadow、模型变化和焦点变化驱动选择，无新增轮询。生命周期最终关闭也先检查是否还有有效诊断发布者，避免其他 client 或窗格的 marker 被无条件清空。

database-query、oracle-syntax、mysql-routine-syntax 接入同一管理模块；本地结果携带模型版本与来源键。数据库错误按标签来源隔离，Oracle/MySQL 按方言来源隔离；背景分析完成和重挂载不能进入当前聚焦的其他方言窗格。模型编辑会在 deferred tab props 更新前撤回旧范围；MySQL 原有 180ms 分析节奏保留。注册以弱引用作用域组织，最终发布者退出删除该层；回调异常不会阻断其他标签。

| 验证 | 本批结果 |
| --- | --- |
| 新增共享发布单元测试 | 15：撤回/释放、最新空结果、授权、焦点、模型/层隔离、Problems 分组及回调异常 |
| 新增实际 hook 回归 | 16：双窗格、独立标签、wire/模型版本、授权撤回、语法恢复、session/profile、本地 Oracle/MySQL 与数据库错误 |
| 全量前端 | 2907 passed / 448 文件，4 worker，无 pending |
| 生产 build | 类型、模块边界、2896 文件规模检查与 bundle 检查通过 |
| 最终实际 Native WebView | 82 场景 / 2341 断言 |
| CLI | 禁止 PROTOC 环境恢复 headless oxide-agent 0.1.18 |

最终 Native 根 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ValO08`。本次共享 project URI 上运行两个真实 Monaco 编辑器、生产 lifecycle/project sync、completion provider、**两个完整 useEditorDiagnostics hook**、实际 Host/LSP 和生产 useTabStore.setLspDiagnostics。以不同 tab id 校验两份 Problems 状态；实际服务端含汉字/emoji与第二行非法表达式的诊断进入画面和两个标签。只调用第一个上下文观察者时，旧 marker 与两份 Problems 立即撤回，再恢复同一有效配置的 renderer 授权；SQL 与模型版本均未编辑。关闭聚焦窗格后，剩余窗格仍保留有效诊断；最后一个诊断发布者退出后清理其视图，索引仍可持有服务端文档。wire 继续为一次 open、连续版本 1–10、一次最终 close，三个真实补全接受及原六方言 65 次缓存压力也全部运行。

另两个 Native 场景直接挂载生产诊断 hook 的本地层，使用真实 Monaco 焦点事件和真实 MySQL routine/Oracle 规则：后台 MySQL 延迟分析不显示到 PostgreSQL，聚焦 MySQL 后显示自己的诊断，切回 PostgreSQL 后撤回；后台 Oracle 重挂载不越过 PostgreSQL，聚焦 Oracle 后显示 ORACLE001，退出后正确清理。这两个场景明确 lspServerExecuted=false，证明 renderer 的本地方言隔离，**不是实际 MySQL/Oracle 引擎执行证明**。共享服务端场景中的语义授权为 renderer context fixture，尚不等于实际角色/权限或事务变化的双窗格端到端验证；安装包与完整可见 Workbench 也未覆盖。

两次中间 Native 分别通过 **80 / 2330**（同标签与不同标签），来源与最终版本存在明确的 Problems 分组/本地方言修复差异，不能视作当前全部源码的三次稳定性复跑；最终 82 才是当前源码证据。中间通过回执及三个先失败后修复的单元控制均保留。原 Net 列表间歇失败本批仍未复现、未定位根因，不声称被这些修改解决。

冻结 **1894** 份前端输入：两个已有 hook 和五个新模块/测试为本批变化，Host **642** 与 vendor src/tests **307** 保持一致。捆绑 release 为 `07b2a54f02b566e4e85c5996118d25a46e1be5f02e6bf37ee782656b5ca04afa`，268 runtime 输入。vendor 1054 / 库 845 / 24 target / 实字节协议 88，Host Desktop 1084 / 12 ignored、headless 427 / 4 ignored、Clippy、应用集成 13、DBX 53 均为已核对来源的既有结果，本批未重新执行。DBX 固定 b160d130560f71c5c429be15cec6147f677a4b3a，未 fetch，不作远程最新声明；53 项不是完整 DBX UI/厂商引擎覆盖。SQL Server 继续沿用第五十八批许可、四组 conformance 与清理，无新容器。

每次 Native 准备仍实际查询 DuckDB 文件元数据；文件 session 仍为 renderer fixture（realHostFileSession=false），完整签名 Host/picker/侧栏/Open File 双入口尚待验收。磁盘方面只在 metadata 和 dry-run 核对后清理 oxide-studio 包 dev 构建产物，三次 Native 准备分别约 1.1、1.7、1.7 GiB；CLI 恢复前先将最终 Native Host 程序保存到 review 证据目录并核对 SHA，再清理同包约 1.7 GiB；源码、依赖缓存、浏览器资料与 proof receipt/bundle/log 保留。历史临时 Native exe 可由 package clean 移除，本批最终 Host 程序的保存方式与 CLI 恢复见机器证据 cleanup 字段；捆绑 release 未变。

继续推进：其他文档同步/关闭调用方；跨窗格并发配置写入、完整工作台与文件 session/profile 转换；文档 RPC 的元数据读取权限范围；签名文件 Host 双入口；Console、真实角色/search_path/权限/事务、取消确认、跨文档编辑、大目录/RSS/网络、安装与多平台 CI。G01–G13、E01–E07 与文件双入口原范围继续，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-marker-ownership-evidence.json`。


## 第七十一批：文档结构权限与实际大纲缓存

标准 textDocument/documentSymbol 会调用 get_schema_for_file，把物理表与函数签名加入结果；原 core coordinator 在没有元数据权限时仍把它作为纯文档调用。首先保留两个失败控制：要求改走 schema-free RPC、以及 physical available=false 但 syntaxAllowed=true 仍能取得本地大纲（旧实现 55 passed / 2 failed）。新增 oxide/documentStructure，三种 kind 为 symbols/folding/selection；请求只携带 textDocument、精确 wire version、显式 canonical dialect、kind 和 selection positions。Rust 只读当前文档不可变快照与注册方言，拒绝未注册/非 canonical profile、负版本、额外字段和不适用的 positions；计算后复查 revision 与 profile 对象。不会读取分析配置、schema、跨文档项目索引或其他文档。

服务端专门保留暖物理目录作对照：标准大纲能看到 ledger 与 private_fn(secret_arg)，scoped 大纲只保留当前 SQL 的 local_v/q。持有配置 write lock 时，三个 scoped 操作仍在测试期限内完成，说明不等待该全局配置锁；这不是发布版延迟基准。跨文档符号不进入结果，六方言与汉字/emoji范围通过。标准 folding 虽不读 schema 仍持有宽配置锁，selection 只读取配置/推断的 dialect；两者统一进入显式 profile RPC。formatDocument/rangeFormatting 经源码核对只使用文档、格式偏好和 dialect，不读取 schema，保留标准 RPC；没有把它们误记为物理元数据调用。

前端校验完整 uri/version/dialect/kind 回执、范围与 symbol/selection 父子包含关系，并拒绝非法/循环结构、意外分析 token、同一 client 快速重启后的迟到响应。provider 先检查语法授权，必要时同步文档，再验证已确认 wire 版本与 SQL text；只在当前 metadata grant 完整时调用标准结构 RPC，撤回或错误时不退回读取物理目录。独立小模块承担协议校验、文档权限 capture 与符号注册，其他 provider 继续原生命周期。

第一次真实 Native 已完成 82 场景 / 2344 断言，随后新增本地大纲检查失败。查阅本地 Monaco documentSymbols.js 与 outlineModel.js 确认：_executeDocumentSymbolProvider 的 OutlineModelService 缓存由 model id/version 及 provider 对象数组决定，不包含 renderer 语义授权；SQL 不变时甚至不重新调用 provider，因此只增加 scoped RPC 不足以撤回旧大纲。修复为语义上下文或有效分析 publication 变化时，释放并重新注册一个具有新对象身份的 symbol provider，使 Monaco 自身缓存失效。其余 11 个 provider 保持身份，原 SQL、模型版本、浏览器私有缓存均无需修改。新增 4 个回归校验仅替换 symbol、拒绝过期 publication、连续撤回恢复不残留注册、dispose 后不复活；没有新增轮询。

| 验证 | 本批结果 |
| --- | --- |
| 新增前端 | 31：client/transport 20，core 11；包含真实 LspClient 快速重启与 Monaco 注册身份 |
| 全量前端 | 2938 passed / 449 文件，4 worker，0 pending |
| vendor 全 target | 1064 passed / 0 failed / 0 ignored；库 851、真实协议 92、24 target |
| 新增 Rust | 6 库 + 4 真实进程协议 |
| vendor 与 Host Clippy | all-targets / -D warnings 通过 |
| Host Desktop 库 | 1084 passed / 12 ignored；精确新增 RPC 白名单及非法后缀/大小写等拒绝 |
| 实捆绑 release 协议 | 92 passed，测试前核对二进制 SHA、运行后恢复临时替换的 dev 字节 |
| 生产构建 | 类型、模块边界、2900 文件规模检查与 bundle 检查通过 |
| 实际 Native WebView | 85 场景 / 2369 断言 |
| DBX 固定参考 | 53 场景重跑；字段 46/46、类型 44/44、隔离 7/7 |
| CLI | 禁止 PROTOC 环境恢复 headless oxide-agent 0.1.18 |

最终 Native 根 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-296oJ9`。新增三场使用真实 named LspClient、Host/LSP、生产 core 注册、shared document lease/shadow 和实际 Monaco outline/folding/selection command。先展示真实物理表与函数签名，撤回物理授权但保留语法权限后仅显示当前本地声明；直接调用标准服务端大纲仍能看见物理目录，证明没有通过清空 schema 制造缺失。六显式方言的实际 scoped 请求、真实 document/range format action 和非空结果跨语法权限撤回均通过。格式化前后文档保持同步，恢复语法权限后重新读取当前本地大纲。原诊断共享、物理推荐撤回/恢复/接受和六方言 65 次缓存列表压力继续运行。这些 context 切换是 renderer fixture，不等于实际数据库角色/权限变更；安装包与完整可见 Workbench 大纲仍待验收。

协议测试早期另有一个 fixture 失败（3 passed / 1 failed）：错误地期待 didClose 发空 diagnostics acknowledgement，而当前服务端不发送该通知。源码核对后，改为有界等待真实 scoped RPC 返回 closed-source -32801；先通过 4 个聚焦协议测试，再通过全部 1064 及实捆绑 92。失败与修复日志均保留，不把观察超时当作通过。第一次 Native 缓存失败同样保留；最终来源验证与失败控制不同，不声称多次稳定性复跑，也不声称解决了原 Net 间歇列表根因。

捆绑 release 更新为 `715eb3d960d729916c6ec60b3ae7bac322c2d8005b8ffe24534db452a3992f25`，runtime fingerprint 269 输入；当前源码未提交。vendor 源码包 295 文件、255 个 src Rust 文件逐字节匹配当前源码，新结构模块已包含；包 SHA `391a7b6a950bb64a5c75ee8cb71507f67da35a82dcec977728873558fc3bdfb1`。打包使用 --no-verify，未独立编译源包；Cargo 规范化锁文件与本地锁文件原始字节不相同，SHA 对与第六十四批已核对的语义等价版本一致，不宣称 raw lock 相等。

冻结前端 1897、Host 642、vendor src/tests 309 份输入。DBX 算法与 headless EditorState 使用 b160d130560f71c5c429be15cec6147f677a4b3a，同一 fixture 下 DBX 字段 35/46、类型 18/44、隔离 3/7；53 项不证明完整 DBX UI 或全部厂商引擎覆盖。本批未 fetch，不作远程最新声明。比较报告取消硬编码旧 batch 号，只在显式提供 OXIDE_EVIDENCE_BATCH 时标注批次。

Host headless 427 / 4 ignored、应用集成 13、protocol crate 14、SQL Server 第五十八批许可/16.00.4305/四组 conformance/清理沿用既有证据，本批没有新容器。SQL Server 用户重复授权继续保留。每次 Native 准备仍实际查询 DuckDB 文件元数据；完整 signed Host file session 仍未覆盖，realHostFileSession=false，文件侧栏与 Open File 双入口待实际产品验收。

磁盘整理只在 metadata 绝对路径和 dry-run 核对后清理 Cargo 指定包的 dev/release 产物，最终 Native Host exe 先归档并校验 SHA。为运行最后 Native，另将 218 份未被已知 Native 构建引用的依赖 rlib 暂时 gzip 保存，逐文件 readback/SHA 和 journal 核对后移除原副本；验收后全部恢复或保留重新构建的副本，再恢复 CLI。没有删除浏览器资料、源码或 registry；压缩/恢复、构建日志和回执均保留。

下一步继续核对其他 metadata-sensitive RPC 在 lspAllowed=true、metadataAllowed=false 时的实际 schema 读取，及完整 Workbench 缓存、跨窗格配置写入、文件 Host 双入口、Console/WhereCompletionInput、真实角色/search_path/权限/事务、取消确认、跨文档编辑、大目录/RSS/网络、安装和多平台 CI。G01–G13、E01–E07 原范围继续，未提交、推送或发布。

机器证据：`.impeccable/review/lsp-document-structure-evidence.json`。


## 第七十二批：局部语义与 CTE 绑定

继续检查第七十一批未覆盖的语义调用。标准 hover、definition、references、signatureHelp、prepareRename/rename、codeAction、semanticTokens 与 inlayHint 会读取 schema 或跨文档索引；撤回服务端来源后，旧 provider 连当前文档能力也一起拒绝。新增 oxide/documentSemantics 保留仅依赖文档的能力，标准 LSP 授权仍有效时继续原路径。

本批中途纠正了一项契约解释：最初把 metadataAllowed=false 当作服务端物理数据也不可用，并据此写了 8 项失败控制（66 passed / 8 failed）。继续阅读 createLspSyncJob、useLspSchemaSync 与 completion context 后确认，sourcesReady/lspAllowed 表示已确认的服务端来源，metadataReady/metadataAllowed 表示前端回退缓存完整度；渐进同步允许前者先就绪。最初的 8 项只是错误假设的失败，**不作为产品回归修复证明**，相应日志保留并标注 rejectedCompletenessHypothesis。最终明确分离两种授权，增加 12 项正向控制：已确认的标准导航、签名、tokens、inlay、结构与 hover 在缓存不完整时继续工作，前端缓存/DDL 不越过自己的授权。纯文档 RPC 只在服务端来源未获授权、语法来源仍有效时使用；两类能力根据各自来源独立选择。

新 RPC 精确绑定 textDocument、wire version、canonical dialect 与 tagged operation，九种操作分别为 hover、definitions、references、signature、prepareRename、rename、codeActions、tokens、inlayHints。严格反序列化拒绝额外 metadata authority、未知 kind、缺少参数和非法位置类型。只有当前文档不可变快照、显式注册 profile 可参与：临时 schema 从空表/函数/版本开始，只安装当前 SQL 的可见 CTE、派生投影、声明列等本地形状，routines manager=None；不会读取分析配置、同步 schema manager、项目索引缓存或其他文档。计算后复查文档 revision 与 profile Arc。内置签名不猜服务器版本，非 shape 操作不提前计算本地 shape；各请求仍使用已有有界局部关系算法。

前端小模块分别负责 typed request/response、范围/字段/编辑校验；拒绝外部文件 location/edit、意外 command、不同回执 uri/version/profile/kind、无效 token data 与非法 signature 参数范围。实际 LspClient 在快速重启后拒绝旧响应。core 与 hover 都在同步前后、结果返回后检查语法来源、取消/销毁/模型版本及当前语义代次；scoped 请求另要求已确认 wire version 和完全相同 SQL，完成后再次检查 shadow。hover 的 serverDialect 从实际 capabilities 传入，不能把泛型编辑语言静默当作正确方言。前端字段缓存与 DDL preview 继续只在 metadataAllowed 有效时读取。

嵌套 CTE 控制暴露了旧按名字匹配引用的风险：`WITH q ... SELECT q.id FROM q WHERE EXISTS (WITH q ... SELECT q.id FROM q); SELECT q.id FROM ledger q`，初版局部重命名得到 **8** 处编辑，正确是外层绑定的 **3** 处，失败日志保留。新增 document_cte_locations：从 AST 的 WITH owner、声明可见性和行源绑定定位 CTE，区分关系使用、未显式取别名的 qualifier、显式 row alias、内层遮蔽和另一条 statement；SQL Server 允许隐式自引用，其他显式 recursive 结构按 AST 处理。PostgreSQL 引号大小写保持独立，Unicode 范围仍为 LSP UTF-16。

定义、引用、prepare/rename 的**标准路径也复用该绑定**，因此正常元数据已就绪时不会继续按名修改内层 CTE。删除旧“当前 identifier 与任意 CTE 名字相同就可重命名”的回退；选中同名输出列不会被当作 CTE 目标。已证明的当前 CTE rename 可在六 SQL profile 使用；其他本地 DDL/routine 和列/别名绑定仍有独立未完成边界。局部 AST 扫描保留 512 KiB 源码和 262144 named node 预算，按 query owner 分组行源，避免每个 qualifier 扫描整个文档的所有关系。这个预算外的安全重命名不能据此称全文件支持。

另一真实缺口是 CTE 的 SELECT * 动作：原函数使用为 schema 推断准备的 referenced tables，恰好会排除 CTE。改用光标所在查询块的 extract_row_sources_at_position 与 scoped aliases，使标准/局部动作都可从当前位置 schema 的本地投影展开星号，也避免拿别的查询块的 alias。现有动作算法仍保留 quote/布局/可见列规则，本批未引入数据库执行。

| 验证 | 当前最终结果 |
| --- | --- |
| 新增前端 | 81：client 36，core 38，hover 7 |
| 前端全量 | 3019 passed / 450 文件，4 worker，0 pending |
| 新增 Rust | 15 库 + 5 真进程协议 |
| vendor 全量 | 1084 passed / 0 failed / 0 ignored；库 866、协议 97、24 target |
| vendor / Host Clippy | all-targets / -D warnings 通过 |
| Host Desktop | 1084 passed / 12 ignored |
| 实捆绑字节协议 | 97 passed，运行前后核对 release SHA，临时 dev 字节已恢复 |
| 生产构建 | 类型、2907 文件规模、模块边界及 bundle 检查通过；新模块纳入 bridge/纯校验边界 |
| 最终 Native | 88 场景 / 2405 断言 |
| DBX / CLI | 固定参考 53 项重跑；禁止 PROTOC 环境恢复 oxide-agent 0.1.18 |

Native 根 `C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-Avf8tC`。新增三场使用独立 named client、真实 Host/LSP、shared document lease/shadow、生产 core/hover provider 和真实 Monaco command。先验证 private_fn(secret_arg) 签名与 implicit INSERT 的 secret_value 物理提示存在；只撤回前端缓存完整度时，已确认的服务端签名和 inlay 仍保留。再撤回 lspAllowed、保留 syntaxAllowed 时，物理提示撤回，本地 COALESCE 签名、CTE integer hover、显式 INSERT 提示和本地 tokens 继续有效。标准原始签名仍能读到 secret_arg，证明测试没有清空 catalog。Native runner 现在在编译 Rust Host 前自行完成生产前端构建，避免依赖操作者手工准备 dist，且不与 Desktop Cargo 同时修改嵌入资产。

随后 available=false 但 syntaxAllowed=true 时执行实际定义、引用、prepare rename 和 rename command，把三个返回 edit 通过真实 editor.executeEdits 应用到 CTE 声明、qualifier 和 relation；实际 code-action command 返回 CTE 星号展开并应用到同一模型。六显式 profile 的引用/rename RPC 均验证，真实非空定义响应跨语法授权撤回被丢弃、恢复后可重新查询；最后重新授予完整元数据权限，通过标准 rename command 检查嵌套 q 仍仅三处。原六方言 65 次缓存列表压力、实际建议接受、共享诊断、文件 metadata fixture 等既有场景继续运行。这里的上下文开关是 renderer fixture，不等于实际厂商角色/权限/事务；完整可见 Workbench 和安装包仍未验收。

验证期间的失败均保留：一次低磁盘令 vendor link 失败、前端 22 个 suite 无法写 transform cache（2893 项已执行通过，不能算全量通过）；清理仅限已核对绝对 target 与 dry-run 的 oxide-studio dev 包产物，再临时压缩未被已知 Native 构建引用的 218 个 rlib 与 899 个 rmeta，逐文件 readback/SHA/journal 检查，之后全部恢复或保留已重建副本。没有删除源码、registry 或浏览器资料。可用空间后来已足够，未继续扩大清理范围。

协议全量中曾出现 96 passed / 1 failed：增量批次测试假定 inlay 响应前已收到 diagnostics，但服务端提交文档后可先响应查询、再完成通知。改为在原有有界 frame timeout 下同时等待查询结果和 version 2 的诊断，保持一次批次只发布最终版本的计数断言，随后重跑完整 source/实字节协议。Host shell 控制也曾 1083 passed / 1 failed / 12 ignored，5 秒期限超时但 stdout 已捕获；原测试未放宽，单独复测 0.48 秒通过并重新运行全量 Host。其初始超时根因仍未证明，不能把资源压力猜测写成已修复。两类失败不从最终通过统计中隐藏。

最终捆绑 release `3196511884b27af0995dd5f194f3018e3b06afe73777799d102e96ced8fbf97b`，273 runtime 输入。源码包 299 文件、259 个 src Rust 逐字节匹配当前来源，包 SHA `c2a0b0b4f5f96a37e3695e837de50b531e7d9bdf90c6519142a43aa4932985c3`；使用 --no-verify，未独立构建源包。规范化包锁与本地锁原始字节不同，但 SHA 对与前批已核对版本一致，未声称 raw lock 相同。冻结前端 1900、Host 642、vendor src/tests 314 份输入。中间 400f6dad... 二进制及其协议/DBX 结果属于补齐标准路径之前的来源，已另存，不代替最终来源证据。

DBX 仍固定 b160d130560f71c5c429be15cec6147f677a4b3a，无新 fetch；同 fixture/headless EditorState 中 Oxide 字段 46/46、类型 44/44、隔离 7/7，DBX 为 35/46、18/44、3/7。53 项不证明完整 DBX UI 或全部方言引擎覆盖。Host headless 427 / 4 ignored、应用集成 13、protocol crate 14、第五十八批 SQL Server 许可/16.00.4305/四组 conformance 与清理沿用来源一致证据；本批未新建 SQL Server 容器。DuckDB metadata 查询仍实际执行，文件 Host session 仍为 fixture（realHostFileSession=false）。

下一步继续补其他 metadata-sensitive 消费者、列/别名与本地 DDL/routine 的完整绑定、跨文档授权编辑、完整 Workbench/Console/WhereCompletionInput、shared config writer、实际权限/search_path/事务、取消确认、签名文件 Host 的侧栏与 Open File 双入口、大目录/RSS/网络、安装与多平台 CI。原 Net 间歇列表根因仍未证明。G01–G13、E01–E07 与全部原范围保持进行中；未提交、推送或发布。

机器证据：`.impeccable/review/lsp-document-semantics-evidence.json`。


## 第七十三批：真实文件界面与签名 Host 会话

日期：2026-10-25。本批聚焦原清单 G11，没有缩减 LSP、多方言和其他原目标。

文件查询已通过生产侧栏、provider 对话框、FileQueryEditor、Monaco 和只读 grid 的真实 Tauri → 签名 DuckDB Host 链路：CSV/JSON/JSONL/Parquet、实际 CTE 字段推荐与采纳、格式化、SQL 报错后重试、关闭与重开共 **5 场景 / 98 断言**。修复一次会话状态 IPC 失败被误判为会话结束的问题，新增 **4 项单元测试**，全量前端 **3023 / 451 文件**、生产 build **2908 文件**和 Desktop all-targets 严格 Clippy 通过。正常 Desktop 签名配置和无 Desktop CLI 已恢复。原生选择器实际选取、签名安装 UI、完整 Workbench、跨平台及全部 G01–G13/E01–E07 继续，见 [第七十三批](#第七十三批真实文件界面与签名-host-会话)。

| 检查 | 本批实际结果 |
| --- | --- |
| 先失败后修复 | 原实现 **1 failed / 3 passed**：SQL 出错后 status IPC 拒绝会清空有效 snapshot 和诊断。修复后 **4/4**，包括原 SQL 错误保留、同会话成功重试、Host 明确 null 后清空、重开和关闭期间的迟到回复。日志在 `.impeccable/review/file-query-error-recovery-{red,green}.log`。 |
| 完整前端 | **3023 passed / 451 文件 / 0 failed**，maxWorkers=4；生产 build 和边界检查通过（2908 文件）。 |
| 真正文件 UI | 隐藏 Windows WebView，真实 MetaStore 项目根、生产侧栏 controller/view 与菜单、真实签名 provider 目录、FileQueryOpenDialog、FileQueryEditor、Monaco 及生产只读 grid。四格式逐个打开、获取实际 LIMIT 0 列描述和两行数据，9007199254740993 经 Host/IPC 保持精度。 |
| 实际推荐/执行 | 从 data 的 star CTE 得到 label，实际 widget 采纳替换 laSuffix，点击真实 Run 得到 Unicode 源值；实际格式化 provider 应用编辑。真实 Binder SQL 错误后，只对一次 renderer status 方法注入拒绝，查询/Host/源快照均为真实；随后真实 Run 在同一个存活会话成功。没有把这个受控故障称为天然网络故障。 |
| 生命周期/双入口 | 逐个关闭标签并通过实际 status 确认 Host 会话消失；重开保留标签、创建新会话、旧会话已关闭；独立 Open File 生产 action 打开真实 provider 对话框后取消。没有实际选择系统文件，也没有操作完整命令面板 widget。 |
| Native | 全新目录 **C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-iizNdL**，**5 场景 / 98 断言**；源文件 SHA 在 Rust 退出时保持，窗口所有会话关闭，测试进程退出 0。测试 exe SHA-256 **fa717eee407fdc7526c15bd8cff6bb3ac3139414b2c74b68ab205ddc06b80b14**；driver **706ec8915dc2c165852e37a476c551c444a30bea553be9915e611400209847b3**；实捆绑 release LSP **3196511884b27af0995dd5f194f3018e3b06afe73777799d102e96ced8fbf97b**，273 项源码指纹核对通过。 |
| 签名与清理 | 每次全新临时 Minisign key，生产 packager、Registry::new、摘要/签名校验与激活；私钥在启动前删除，公钥最终删除。没有使用发布私钥、全局安装或改用户项目。正常 Desktop library/application 构建信任已恢复，最后重建 headless oxide-agent 0.1.18（禁止 protoc 调用），所属残留进程 0。 |
| Rust 与复用 | 新 Native Rust 目标完成构建和真实执行，Desktop all-targets 严格 Clippy 新跑通过。生产 Host 642 项源码摘要和 vendor 314 项均未变；B72 Host 1084/12 ignored、vendor 1084、捆绑协议 97、DBX 固定参考 53、源码包与此前已授权 SQL Server conformance/清理为明确复用，未称本批重跑。前端来源变化一项 fileQuery.ts，因此 B72 Native 88/2405 保留为历史结果，不称当前来源复跑。 |

复验：`npm run test:desktop-file-query-ipc`（需本机已准备的当前 release LSP、Rust 离线依赖与可用 protoc）。该入口使用独立临时签名配置编译，完成后按本批 `.impeccable/review/file-query-desktop-restore.ps1` 重建正常 Desktop 与 headless CLI。本批证据 `.impeccable/review/file-query-desktop-evidence.json`，原生收据/日志/脚本/构建输入按 SHA 归档到 `.impeccable/review/file-query-desktop-native-proof/`，exe 另行归档。没有提交、推送或发布。

中间失败均保留：首次新夹具的 Tauri 宏路径/Option 字段导致编译失败；语言 Provider/界面提交等待、错误 cwd 的 binary 查找，以及精简 Monaco 缺 SQL language 注册使交互失败。修正夹具后调试复验成功；最终以上全新目录完整脚本（含受控 status 故障）为准。没有修改生产逻辑来放宽这些断言。Windows WebView 退出的 Chrome_WidgetWin_0 注销警告仍见日志，进程退出和收据校验均成功；不将其解释为全部 UI 问题已消除。

待完成仍包括系统选择器实际选取、完整安装与 Workbench、整个打包 Host 强杀/重启、Linux/macOS、编码与手动推断/更多类型、完整 DuckDB 语法及其他元数据敏感调用方。全部 G01–G13 / E01–E07 范围继续。

## 第七十四批：文件语义接入与兼容方言快照

日期：2026-10-25。此增量继续原始范围，没有把文件编辑器或某组测试等同于完整 DBX 对齐。

文件编辑器已接入实际列/表达式悬停，配置确认期间保留文档内类型、CTE 导航和大纲；格式化仍等待已确认的偏好。修复文档语义、结构与诊断 RPC 拒绝已登记兼容方言的问题，保留明确请求名称和实际适配器身份。DuckDB 以独立身份保留现有 ANSI 完成基线，新增 CAST/TRY_CAST 局部类型并保留 CTE 绑定、格式偏好及共享诊断。新增 **14 项前端、7 项 Rust 库、2 项协议测试**；全量前端 **3037 / 451 文件**、vendor **1093**、实捆绑协议 **99**、真实 LSP **88 场景 / 2405 断言**和签名文件 **6 场景 / 132 断言**通过。DBX 固定参考 53 项已重跑，正常 Desktop 与 headless CLI 已恢复。全部 G01–G13 / E01–E07 继续。

| 内容 | 本批证据与边界 |
| --- | --- |
| 前端先失败后修复 | 新增 6 项文件 hook 回归在原实现下全部失败（原有 14 项通过）：没有 hover，且配置确认阻断局部 core providers。修复后同组 20 项通过；另增 5 项格式偏好屏障、3 项 hover owner 同步/失败/迟到验证。全量 **3037/451**、生产 build **2908 文件**通过。 |
| 共享模块 | 复用 core/hover coordinator。文件 hover 使用文档持有者的同步队列，不以 URI 猜语言而重开文件；确认前仅走当前版本/显式 profile 的局部 RPC。canFormat 单独控制文档/范围格式化，在同步前后和应用前复核；配置未确认不会触发旧偏好格式化。不新增轮询。 |
| 方言快照契约 | registry 显式解析已登记的小写名称，最多 64 字符；未知、空白、大小写错误与非法名称仍拒绝。语义/结构/诊断回复保留请求中的名称，避免客户端因 alias 不同而拒收。metadata 诊断以真实 Arc 适配器身份、文档版本和配置 token 为准，兼容名称不授权其他适配器。 |
| DuckDB 推断 | 原 CAST hover 返回 unknown，独立 profile 加入 CAST/TRY_CAST 局部类型和 CTE rename/定义支持。四组源句含 INTEGER、TRY_CAST 非法文本、Unicode VARCHAR、9007199254740993 BIGINT；标准 SQLite adapter 保持独立。URI/language 在配置到达前也保留 duckdb。仍是现有 ANSI 完成基线，不声称完整 DuckDB 专用语法。 |
| Rust / wire | **873 库 + 99 stdio 协议**，24 个目标合计 **1093 passed / 0 ignored**，严格 all-targets Clippy 通过。覆盖 duckdb、mariadb、postgresql、mssql、argo、turso、tidb、cockroachdb 的明确身份及局部绑定；实捆绑 release 字节 **99/99**，调试二进制已恢复。 |
| 真实文件链路 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-tBuOgC；**6 场景 / 132 断言**。生产 Sidebar/Dialog/FileQueryEditor/Grid、实际 MetaStore、临时签名 Registry 和四格式 Host。真实 hover widget 显示源 VARCHAR；只延迟 renderer 对实际已提交配置的确认，在暖目录仍保留时验证 local INTEGER hover、q 大纲、CTE 定义。实际 DuckDB 执行同一 CAST 查询得到 INTEGER/1。格式化确认前无 RPC/编辑，确认后真实格式化恢复。 |
| 完整 LSP 复验 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-zDUo2V；**88 场景 / 2405 断言**新跑通过，含文件歧义诊断。共享 core/hover 与三个快照 RPC 的改动未用文件单场景替代全量验收。两个 Native 入口均使用当前捆绑 release。 |
| DBX 对比 | sources/dbx 仍固定 b160d130560f71c5c429be15cec6147f677a4b3a，本批未 fetch。相同 fixture/headless CodeMirror 状态对当前捆绑 LSP 重跑 **53 项**，Oxide 全部通过；该比较不证明完整 DBX UI、全部方言引擎或新 CAST 变体都经过 DBX 比较。 |
| 交付和复用 | release SHA-256 **70a1d43b4e1a5fc544bac91a7135bc71fb4b12206d97cdb09ebbcfb209068293**；273 runtime 输入。源码包 **299 文件 / 259 src Rust**逐字节核对，SHA **9217dd0d0f36a92f87506cac13a22a8503cad9f42d3149c5a05bc9d013d02130**；--no-verify，未独立构建源包，包锁与本地锁原始字节不同。Host 642 份生产来源未变，B72 **1084/12 ignored**为明确复用；Root all-targets Clippy 新跑。SQL Server 第 58 批许可/四组 conformance/清理明确复用，无新容器。 |
| 清理 | 临时签名私钥启动前删除，公钥最终删除；正常 Desktop library/application 信任与最终 headless oxide-agent 0.1.18 已恢复（forbidden protoc），测试所属进程 0。没有全局安装、提交、推送或发布。 |

中间失败保留：夹具第二次打开未等待 LSP 就绪；旧 release 拒绝 duckdb 快照；静态 CAST 类型 unknown；注册 alias 原先被负向契约拒绝（现有正向 alias 与负向 uppercase 分别覆盖）；新增 rename 夹具误计 2 次，实际为声明、成员引用、FROM 共 3 次。另一次完整 Native 捕获新 DuckDB 身份遗漏共享诊断，文件 OXIDE004 缺失；已补正向 Rust 回归，最终上述 88 场景在当前来源重新通过。没有删掉诊断断言或把中间失败计作通过。

范围继续：文件补全候选目前仍等待物理配置确认，本批保留的是局部 hover/导航/结构能力；不声称确认期间全部候选列表可用。系统选择器实际选取、安装 UI、完整 Workbench、打包 Host 强杀/重启、其他平台、完整 DuckDB 语法与更广类型/表达式、其他元数据敏感消费者和所有原目标仍需完成。

复验入口：npm run test:desktop-lsp-ipc；npm run test:desktop-file-query-ipc；cargo test --manifest-path vendor/sql-lsp/Cargo.toml --locked --offline --all-targets -- --test-threads=4。文件 Native 使用独立临时签名构建，最后按本批 .impeccable/review/file-query-language-restore.ps1 恢复正常 Desktop/CLI。机器证据 .impeccable/review/file-query-language-evidence.json；两个原生收据、运行脚本、输入及日志和 exe 均按 SHA 归档。

## 第七十五批：配置确认期间的文档补全与表变量推断

日期：2026-10-25。此增量接续第七十四批，不把文件编辑器的一次闭环等同完整 DBX 或全部方言支持。

文件 SQL 在配置确认期间现在保留文档内智能推荐：嵌套 CTE、显式 CAST 类型、限定成员和完整后缀替换使用独立的当前文档 RPC；真实已显示的 Monaco 列表自动恢复为局部候选，确认后恢复物理文件列。补齐 SQL Server TABLE 变量的列绑定、类型/批次隔离，以及 ClickHouse CAST 局部类型；大列表先匹配排序再限量，避免末尾字段丢失。新增 **32 前端、12 Rust 库、3 协议、1 Host 测试**；全量 **3069 前端 / 452 文件、1108 vendor / 24 目标、1085 Host / 12 ignored**，实捆绑 **102 协议**、真实文件 **6 场景 / 142 断言**与共享 LSP **88 场景 / 2405 断言**通过。DBX 固定 53 项复测通过；全部 G01–G13 / E01–E07 继续。

| 内容 | 已验证行为与限制 |
| --- | --- |
| 独立局部补全 RPC | `oxide/documentCompletions` 只接收当前 URI、文档版本、明确登记的方言、光标及当前调用方偏好。不读全局配置、SchemaManager 或项目目录；持有配置写锁时仍完成局部请求。版本/适配器变化和已关闭文档拒绝；未知方言、伪造授权字段与非法偏好拒绝。 |
| 候选内容与传输 | 复用已有方言、局部关系、内置函数、大小写和编辑范围模块；局部候选清除 data、command、additionalTextEdits，客户端禁止目录 resolve。新增 Tauri 精确方法白名单和取消 token，取消及旧进程响应不能重新发布列表。普通 provider 的元数据授权和逐来源同步契约保持原样。 |
| 文件推荐状态 | 文件 provider 在 syntaxAllowed 时可用，实际已确认 lspAllowed 时继续标准补全；等待确认时走当前版本/明确方言的局部 RPC。schema/偏好切换保留同一列表持有者并同步撤回旧响应；只在焦点、光标、文本和上下文仍有效时恢复，普通编辑器不自动获得该局部恢复授权。不增加轮询。 |
| SQL Server TABLE 变量 | 复用现有 DECLARE/批次/模块收集器，从原始 TABLE 定义读取列，保留 NVARCHAR(42)、DECIMAL(19,4)、Unicode 引号列及真正约束。关系位置保留 @变量名称，不改变标量占位符读取。验证 GO、前向引用、重名声明、过程边界、注释伪声明、JOIN 别名和非 T-SQL 隔离。没有声称全部表类型参数或厂商语法均已完成。 |
| 大输入与性能边界 | 最多 512 KiB 源文档、512 返回候选、2 MiB 候选序列化预算；截断显式标记 incomplete。1,024 列测试先暴露末尾匹配字段被截断的问题，修复后精确前缀字段可达。列来源行号按顺序累计，避免逐列重扫整个前缀。预算是工作量上限，不当作安装版端到端性能基线。 |
| 多方言复杂语义 | 8 种明确方言/别名配置 postgres、mysql、sqlserver、hive、clickhouse、duckdb、mariadb、mssql 验证 Unicode、嵌套通配 CTE、CAST INTEGER、光标后 FROM 和成员后缀替换；暖目录物理字段/私有函数不进入局部候选。ClickHouse CAST 原本推断 unknown，现进入已有显式转换推断；未运行新的 ClickHouse 引擎测试。 |
| 单元与协议 | 前端 **3069 / 452**，生产构建 **2913 文件**；vendor **885 库 + 102 stdio 协议**，24 目标合计 **1108 / 0 ignored**；Host **1085 / 12 ignored**。严格 vendor/Root all-targets Clippy 通过。新 release 字节再次运行 **102/102 协议**，调试二进制已恢复。 |
| 实际文件控件 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-p1f2E4；**6 场景 / 142 断言**。实际生产 Sidebar、Open Dialog、FileQueryEditor、只读 Grid → Tauri → 临时签名 DuckDB Host。先显示真实标准候选列表，仅延迟已在服务端提交的配置确认，原列表自动恢复为局部 CTE 列；待确认期间无物理 completion RPC，实际接受替换完整 Suffix，确认后恢复源 label 列并实际接受。暖物理目录仍在服务端，局部响应不带 id/label。 |
| 共享 LSP 复验 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-HhaB5U；**88 场景 / 2405 断言**，使用当前 release 新跑。文件专用路径没有替代共享 core/hover/diagnostic 的完整现有 Native 验收。 |
| DBX 比较 | 参考仍为干净的 `sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a`，本批没有 fetch，不声称截至今日远端最新。53 项源码/无头编辑器状态比较：Oxide 53，DBX 19；此结果不证明可见 DBX 控件、数据库执行或完整产品体验等价。 |
| 构建产物 | 当前 release SHA-256：`3e3e39d574acb8f555404175dd986b86d0d53b54535a019eaa52383e7719372e`，运行输入 **276 文件**。源码包 **302 文件 / 262 Rust 源文件逐字节匹配**，SHA-256：`c94df9b6aed924ead621a95cfb25e485f8add7f1d22d073db1575a83e6075b16`。cargo package 使用 --no-verify，未独立编译打包源码；本地/打包锁文件摘要不同但与此前已审计的一对相同。 |
| 恢复与清理 | 临时签名公私钥删除；正常 Desktop lib 与 oxide-studio 应用使用默认信任重新构建，最后以禁止 protoc 的路径重建 headless oxide-agent，版本 0.1.18；本批拥有的 Native/LSP/DuckDB 进程残留 0。保留测试证据与浏览器 profile；没有删除缓存或更改 DBX 引用。未提交、推送、发布或安装产品包。 |

### 仍需继续

- 将局部补全契约核对到其余编辑器消费者和元数据变化场景，继续补全不同方言、嵌套表达式和复杂类型的一致性。文件路径本批通过，不代表主查询、Console 和 Where 输入等所有来源都已闭环。
- 完整 DuckDB 语法/诊断、真实数据库版本/权限/模块语义、可见 Workbench、实际系统文件选择、安装包和其他平台仍待验收。此前用户已同意许可并完成的 SQL Server 真引擎证据继续按原批次引用，本批未新启 SQL Server 容器，也未以此声称新的 TABLE 变量测试已在真实引擎运行。
- 保留原始 G01–G13 / E01–E07、文件侧栏与“打开文件”双入口目标。完整差距仍按专项与主清单推进，目标保持 active。

证据索引：`.impeccable/review/lsp-document-completion-evidence.json`；原始失败的大列表回归在 `lsp-document-completion-rust-focused.log`，最终成功在 `lsp-document-completion-vendor-final.log`。

## 第七十六批：主查询局部推荐与空列表恢复

日期：2026-10-25。此增量保留用户要求的完整对齐、复杂 SQL、智能推荐、性能及模块化范围。

主查询编辑器现复用文档补全 RPC：物理 available=false 但文档语法授权仍有效时，保留显式方言、嵌套 CTE、CAST 类型、完整后缀替换及表变量候选；独立服务端授权恢复后继续物理推荐。修复本地结果为空时丢失原列表恢复意图的问题，失焦、光标/文本/模型变化和 Escape 仍取消恢复。共享列定义模块修复 unique_count 误判 UNIQUE、引号保留字列丢失，以及 CHECK/CASE/字符串/注释导致的约束误判。新增 **25 前端、2 Rust 库、1 协议测试**；全量 **3094 前端 / 453 文件、1111 vendor / 24 目标**，真实 LSP **90 场景 / 2418 断言**、签名文件 **6 场景 / 142 断言**通过。Host 1085/12 ignored 按 642 个未变输入沿用第七十五批；本轮重跑严格 Clippy、构建及 Native。全部 G01–G13 / E01–E07 继续。

| 内容 | 实现、测试与实际边界 |
| --- | --- |
| 主查询生产路径 | createQueryCompletionProvider 使用当前文档的语法授权，先同步持有者文本；未获物理 LSP 授权时调用 oxide/documentCompletions，传入已同步版本、明确 capability 方言和当前补全偏好。请求前后检查上下文、取消、模型和 shadow。离线/空返回仍保留既有保守缓存/语法降级，不借用未授权物理字段。 |
| 服务端与 renderer 独立授权 | lspAllowed=true 且来源仍有效时继续标准补全，metadataAllowed=false 不隐藏已经由服务端证明的来源。syntaxAllowed=false 拒绝局部请求；项目、连接、路由和生成变化仍使旧结果失效。8 种明确 profile（postgres/mysql/sqlite/hive/clickhouse/duckdb/sqlserver/argo）有调用/偏好、编辑、无目录读取及无 resolve 的单测。 |
| 列表恢复缺陷 | 新增主查询场景先通过，但原有真实 SQLite 驱动事件回归失败：旧物理字段撤回后，本地结果为空，恢复器提前清掉原交互，新物理字段到达后不再打开列表。新增失败单测复现；本地恢复保留原交互，renderer 元数据完整后再消费恢复意图；服务端的独立授权仍可先展示物理候选。对渐进服务端空结果继续保留意图，并在重试前重置 Monaco 逻辑上仍活跃的空建议会话；新增失焦、光标、文本、模型和 Escape 反例，普通 provider 默认授权保持不变。 |
| 共享列定义 | 新增 local_relations/column_constraints.rs，按真实顶层 token 判断 NOT NULL、PRIMARY KEY、UNIQUE，跳过括号表达式、CASE、约束名称和同字节词法噪声。临时表与 T-SQL TABLE 变量共享解析；TABLE 变量复用整文档 mask，避免逐列重复扫描。带引号的 UNIQUE/PRIMARY/CHECK/CONSTRAINT/FOREIGN 是列名，不再作为表级约束丢弃。 |
| 方言可空性 | T-SQL TABLE 变量的 PRIMARY KEY 依该方言标为非空；通用临时列解析保持原先未显式 NOT NULL 的可空性，不把同一推断强加到 SQLite 的历史 PRIMARY KEY 行为。更广的复杂类型和表级约束传播仍待继续。 |
| 测试与构建 | **3094 前端 / 453 文件**，生产 build **2915 文件**；vendor **887 库 + 103 stdio 协议**，24 目标合计 **1111 / 0 ignored**，严格 all-targets Clippy 通过。捆绑 release 字节 **103/103 协议**；暖目录协议用例补齐 functions:[] 并真实读取物理符号作为正向对照。 |
| 主查询控件证据 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-vMGm81；**90 场景 / 2418 断言**。新增两场景使用生产 provider/coordinator/refresh 和真实 Monaco/Host LSP；受控 capability/授权/目录夹具，mysql URI 明确选择 sqlserver profile。旧列表在 available=false 时自动恢复为局部 CTE，保留暖目录，实际接受替换整个 Suffix；带引号 UNIQUE 表变量列实际接受后保留安全引号；只恢复服务端授权、renderer 元数据仍未完成时，真实恢复物理候选。未执行新的 SQL Server 引擎。 |
| 真实驱动完整回归 | 原有 productionQueryCompletionHook、生产事件观察/同步、真实 SQLite ALTER、事务、hover、inlay、inline、诊断和实际列表恢复场景全部重跑；没有以新 provider 的受控夹具代替真实 React hook 链路。 |
| 签名文件链路 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-9UsOgC；**6 场景 / 142 断言**。生产文件侧栏/对话框/编辑器/只读 Grid → Tauri → 实际签名 DuckDB Host，四格式、真实列表/hover、配置确认、错误恢复和重开复验通过。系统 picker 实际选取与完整安装包仍未验收。 |
| DBX 对比 | 干净固定参考 b160d130560f71c5c429be15cec6147f677a4b3a，新 release 重跑 53 项：Oxide 53、DBX 无头状态 19。本轮未 fetch，不声称今日远端最新、可见 DBX 控件或完整产品等价。 |
| 构建产物与恢复 | release SHA-256：`4071cb9e58ea468c904e8f28504c4e68867cca56aba7fb5426076b1accd541aa`，277 个运行输入。源码包 **303 文件 / 263 Rust 源文件逐字节匹配**，SHA-256：`dc52558272fa955895e9a2e321c7fb7189c8f43a0f2489ba5592af7930f5080f`，--no-verify，未独立构建源码包。本地与打包锁文件仍为此前已审计的同一对摘要。正常 Desktop lib/应用、headless oxide-agent 0.1.18 均恢复，临时密钥删除，本批 Native/LSP/DuckDB 进程残留 0；未删除浏览器缓存，未提交/推送/发布。 |

### 失败证据与后续重点

- 约束反例先失败 2 项，原有 12 项通过；物理 available=false 的局部恢复反例先失败 1 项；空本地列表丢恢复意图的新增单测先失败 1 项。失败日志保留，最终全量成功日志单独记录。
- Native 初次夹具未引用用于大纲检查的物理表，并漏了必填 functions 数组，目录正向检查失败；补齐后新增主查询场景通过，随后完整真实驱动回归暴露并修复上述列表恢复缺陷。所有失败根目录保留，不能把中间新场景通过当作整轮成功。
- **接下来修复配置确认语义**：排查确认 apply_configuration 先登记 token，再尝试解析 schemas；无效 schema 载荷仍可能获得 applied=true 并保留旧目录。当前生产构建器发送完整 schemas，但配置回执需要增加拒绝无效载荷/不授予新来源授权的单元、协议与实际链路证明；本批未声称已修复。
- 继续核对 Where/其他剩余消费者、更多厂商表达式/类型、带嵌套词法的声明约束、真实产品/权限/版本、可见 Workbench、系统文件选择、安装包和其他平台。完整 DuckDB 语法与全部 DBX G01–G13 / E01–E07 保持进行中。

证据索引：`.impeccable/review/lsp-query-local-evidence.json`；约束原失败 `lsp-query-local-red.log`，恢复原失败 `lsp-query-local-focus.log` / `lsp-query-local-empty-widget-red.log`；最终 `lsp-query-local-vitest-final.log`、`lsp-query-local-vendor-final.log` 和两份 Native 归档。

## 第七十七批：配置校验与失败后的推荐授权撤销

日期：2026-10-25。本轮完成上一批已列出的配置确认缺陷，保留完整 DBX 对齐范围。

修复无效配置仍获确认、保留旧推荐授权的问题：服务端先完整解析与校验，再一次提交配置，最后登记 token；拒绝时保留最近有效设置并撤销旧、新 token。前端同一上下文同步失败后清除来源授权，重新确认前仅保留文档内推荐。新增 **7 前端、9 Rust 库、2 协议测试**；全量 **3101 前端 / 454 文件、1122 vendor / 24 目标**，真实 LSP **92 场景 / 2433 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

| 内容 | 实现、验证与边界 |
| --- | --- |
| 原问题与失败证明 | 配置原先先登记 token，之后才尝试反序列化 schemas；缺必填 functions 的目录可能保留旧字段但返回 applied=true，非对象载荷也未撤销旧回执。新增反例在修复前 3 failed / 9 passed，失败日志独立保留。 |
| 原子校验与提交 | 独立 configuration_patch 模块消费传入 JSON Value，避免提交时再次克隆完整 schema 数组。已知字段类型、显式 null、枚举、登记方言、schema UUID 重复均先校验；缺省字段保留旧值，合法空目录可清空。通过后在已有独占配置锁内提交目录、路由、偏好，再发布 token。 |
| 拒绝语义 | 每次尝试先撤销旧 provenance；无效对象或非对象都不能确认旧、新 token，也不部分更新方言、偏好或映射。最近有效目录保留以便恢复；原始标准协议仍可显式读取该目录，不能称所有旧目录已经删除。带来源的元数据快照与生产消费者通过撤销授权拒绝使用。 |
| 兼容与限制 | 合法部分更新、无 token 的兼容更新和未知扩展字段仍支持；登记别名转小写并保留别名身份。警告不回显载荷内容。未声称校验所有元数据语义、路由 URI 或引用完整性，也未测得性能提升百分比。 |
| 前端授权 | 从 useLspSchemaSync 抽出纯状态发布器。相同 identity 的 error 清除 token、来源和完整元数据引用；仅发送 full/cached/limited 状态不能复活授权，需新的已确认配置。独立服务端来源已确认而 renderer 元数据尚未完整时仍可使用，保持此前渐进同步行为。 |
| 新增单元与协议 | 9 库测试覆盖拒绝、无部分提交、null/类型/未知 profile、重复 UUID、合法修复和空目录、别名、无载荷回显、元数据快照及文档补全；2 stdio 测试验证暖目录、旧新 token 均失效、同 SQL 星号 CTE 在修复后换成新字段。7 前端测试覆盖同上下文失败、三种状态不能恢复授权、重新确认及独立来源。 |
| 实际控件与驱动 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-ei3Xux；**92 场景 / 2433 断言**。真实 SQLite 建立 35 张表触发渐进同步，先真实确认部分目录，再在同一 identity 注入无效 enrichment；实际生产 hook 撤销授权，真实 Monaco 局部 CTE 推荐可接受，期间不调用标准物理补全。随后真实 ALTER 与有效配置恢复字段推荐及后缀接受。 |
| 文件查询完整回归 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-cpnudB；**6 场景 / 142 断言**。实际签名 DuckDB Host、生产文件侧栏/打开入口/编辑器/Grid、四格式、错误恢复和重开通过；系统 picker 实际选取、安装包及完整可见 Workbench 仍未验收。 |
| 全量检查 | 前端 3101 / 454 文件；生产构建通过，模块大小检查 2918 文件，Vite 转换 4405 modules。vendor 896 库 + 105 协议，24 目标总计 1122 / 0 ignored；vendor 与 Root 严格 all-targets Clippy 通过。Host 库 1085 / 12 ignored 明确沿用第七十五批，642 个输入与第七十六批逐字节相同，本轮未重跑该库。 |
| 捆绑与源码包 | release 实字节 **105/105 协议**通过并恢复调试二进制；release SHA-256：`e6031d0b92d596a1232c08b2488b3bc2f310cef14d14d5ff041e1a15abb10617`，运行输入 278 个。源码包 **304 文件 / 264 Rust 源文件匹配**，SHA-256：`c9a5e298e249f6cde92677cd807d828fefcacd5def6356126c0c24fa6e25b75b`；--no-verify，未独立构建源码包，锁文件沿用此前审计的同一对摘要。 |
| DBX 与真实引擎 | 固定干净参考 b160d130560f71c5c429be15cec6147f677a4b3a 用新 release 重跑 53 项，Oxide 53、DBX 无头状态 19。未 fetch，不声称远端今日最新或可见 DBX 产品等价。本轮新增真实驱动为 SQLite；SQL Server 许可下的隔离真实引擎结果明确沿用第五十八批，没有启动新的 SQL Server 容器。 |
| 恢复与留证 | 正常签名信任的 Desktop lib/应用和无 Desktop 的 oxide-agent 0.1.18 均恢复。两份 Native 宿主、脚本、输入、日志与回执归档；测试密钥已删除，Native/LSP/DuckDB 进程残留 0。保留浏览器配置及失败证据；未提交、推送或发布。 |

### 后续差距

- 继续核对 Where 与其他编辑器消费者的文档补全降级和元数据授权；不能将主查询与文件编辑器的验收推广到所有入口。
- 扩充复杂嵌套声明约束、厂商表达式和类型、完整 DuckDB 语法，以及更多真实引擎/权限/版本组合。
- 完整可见 Workbench、系统文件选择、安装包与其他平台，以及全部 DBX G01–G13 / E01–E07 仍在进行中。

证据索引：`.impeccable/review/lsp-config-commit-evidence.json`；原失败 `lsp-config-commit-red.log`；全量 `lsp-config-commit-vitest.log`、`lsp-config-commit-vendor.log`、捆绑协议回执及两份 Native 归档。

## 第七十八批：Where 提示的文档隔离与复杂条件补全

日期：2026-10-25。此增量继续主查询、文件编辑器之外的实际消费者对齐。

表格 Where 提示现拥有独立 LSP 缓冲区，继承原查询明确配置的目录与方言，避免覆盖或关闭主编辑器文档。接入共享上下文授权、文档内补全、请求取消与接受前复核；配置失败时撤回旧字段，复杂子查询局部候选继续可用。修复多行 UTF-16 编辑范围及普通 SQL 插入中的美元参数。新增 **42 前端、2 Rust 库、1 协议测试**；全量 **3143 前端 / 456 文件、1125 vendor / 24 目标**，真实 LSP **96 场景 / 2458 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

| 内容 | 实现、验证与边界 |
| --- | --- |
| 原问题与先失败证明 | WhereCompletionInput 原先复用主查询 URI，直接 didOpen/didChange/didClose；异步结果只比较文本与光标，未比较连接、配置或元数据来源。新 React 输入框反例在原实现下 3 failed：URI 冲突、Escape 后迟到结果重开、元数据变化后旧字段回流。 |
| 独立缓冲与目录 | 每个输入实例使用独立 oxide://where/ URI，并用 source 参数引用既有 query URI。服务端只继承明确配置的 query 映射，不读取主文档内容、不继承推断缓存、不允许递归辅助 URI；有独立精确映射时优先使用。新库测试覆盖格式/长度/重复参数/来源边界、动态路由变更、独立正文及精确映射覆盖。 |
| 真实协议反例 | 两个目录拥有同名 app.users；父查询绑定第二目录与 sqlserver profile，但 URI 写 mysql。实际 stdio 协议证明 Where 只提示第二目录字段，关闭辅助文档后主查询 TABLE 变量的带引号 UNIQUE 字段仍可补全。此处是 LSP 目录夹具，不是新的 SQL Server 引擎执行。 |
| 共享授权 | useWhereCompletion 使用 createCompletionContextReader 与统一订阅，核对连接对象、运行代次、驱动操作状态、项目、tab 路由、metadataVersion、LSP 进程和确认回执。物理授权有效时使用标准补全；仅语法有效时调用文档 RPC，传入明确 capability 方言、已确认文档版本与当前偏好，不借用物理字段。 |
| 列快照与请求生命周期 | Grid 列快照绑定观察时的上下文；新回执不把未更新的同一列快照重新标记为新数据。进程切换重新取得文档 lease，失败 didOpen 可恢复；旧请求通过实际取消回调通知 Host。新输入、外部替换、失焦、光标变化、Escape 和卸载使原交互失效；上下文变化先撤回列表，同一仍有效交互可自动恢复。 |
| 原生回归发现并修复 | 首次原生接受生成 where_old =  > 0，暴露原局部字段候选无条件追加等号的缺陷。保留失败根目录；新增 8 个已有运算符/表达式反例及 4 个限定字段接受用例，修复已有条件不重复追加谓词、限定成员保留前缀、带点引号别名不误判已完成值。修复后完整原生链路重跑。第二次四个 Where 场景均过，原有重启用例随后发现配置确认不能充当文档已重开的证明；改为先观察当前进程实际自动 didOpen 回执，再保留原始补全/正文断言，不在测试中手动打开或同步文档。两次失败根目录均保留。 |
| 接受与复杂范围 | 实际接受候选前再次核对绑定的交互与来源，覆盖 store 变化和点击处于同一事件的情况。LSP 虚拟 SQL 的 TextEdit/InsertReplaceEdit 转为条件坐标，保留完整后缀替换、多行 UTF-16 与嵌套表达式；前缀越界或附加编辑不被半执行。普通 insertText 保留 $1，只有声明为 snippet 的项目才展开占位符。 |
| 模块与性能 | 新纯 Where 会话模块负责 lease、取消、授权和候选；React hook 只装配上下文与生命周期，组件保留交互。保留既有 55ms 输入 debounce，输入时立即取消上次请求；多行偏移索引每次合并计算一次。没有增加轮询，也未测得新的性能提升比例。 |
| 前端验证 | 新增 42 项：原 3 个回归、同事件旧候选接受、项目/重连/配置/元数据变化、失焦、外部文本替换、普通美元参数；会话测试覆盖恢复、版本/偏好/引号、取消、进程与失败重试，以及 postgres/mysql/sqlserver/sqlite/duckdb/clickhouse/hive/argo 的多行嵌套替换边界。原 Grid 选列、LIKE 光标和 IN 续写测试补齐真实焦点与已确认连接前置条件，全部保留。 |
| 原生生产输入框 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-qz08WE；**96 场景 / 2458 断言**。四个新增场景使用生产 WhereCompletionInput、生产 hook/registry、真实 Tauri LSP、实际 SQLite 建表/ALTER 与元数据命令；验证字段后缀接受、主查询正文存活、撤销物理来源后的嵌套派生表 CAST 列接受、重新确认后新字段恢复、真实响应延迟后 Escape 拒绝重开。Where 产品控件是 HTML 输入框，其余原场景继续使用真实 Monaco。 |
| 文件链路回归 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-vIwmgl；**6 场景 / 142 断言**，签名 DuckDB Host、四格式、生产文件双入口及编辑器/Grid 复验通过。系统 picker 实际选取、完整安装包与可见 Workbench 仍未验收。 |
| 全量与复用 | 3143 前端 / 456 文件；生产 build、模块大小检查 2923 文件、Vite 4407 modules 通过。vendor 898 库 + 106 协议，24 目标合计 1125 / 0 ignored，严格 Clippy 与 fmt 检查通过。Host 1085 / 12 ignored 按 642 个未变输入明确沿用第七十五批，本轮重跑 Root 严格 all-targets Clippy 和构建。 |
| 产物与固定 DBX 参考 | 新 release 实字节 106 协议通过，SHA-256：`edc0c870e5ed794ce5865775bc1f9a704a134a911dffff7f882569f976cb0274`，运行输入 279 个。源码包 305 文件 / 265 Rust 源文件匹配，SHA-256：`61d5486121482ff608622db987da7fa38c5db00875a6af3945fdfd505c7f0b10`；--no-verify，未独立构建源码包。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的 53 项重跑，Oxide 53、DBX 无头状态 19；本轮未 fetch，不声称远端最新或完整可见产品等价。 |
| 恢复与范围 | 正常信任 Desktop lib/应用、headless oxide-agent 0.1.18 已恢复；临时签名密钥删除，Native/LSP/DuckDB 进程残留 0。两份原生宿主及回执归档，保留浏览器配置和失败证据；未提交、推送或发布。SQL Server 真实引擎证据明确沿用第五十八批，本轮没有新容器。 |

### 仍需继续

- 继续其他剩余编辑器/元数据消费者、更多厂商表达式与复杂类型、嵌套声明约束及完整 DuckDB 语法；八种 profile 的编辑范围测试不能证明八种真实数据库的全部语法。
- Where 列快照当前按输入列数组引用绑定观察时的上下文；父级重新生成数组时，仍需核对真实数据代次，数组变更本身不能证明重新读取了元数据。
- Where 新原生场景的配置来源发布受控，真实 SQLite 元数据与 RPC 已执行；尚需覆盖完整可见 Workbench 中自动同步、真实权限与版本组合，以及安装版/跨平台链路。
- 全部 DBX G01–G13 / E01–E07、文件查询双入口的完整产品验收保持进行中。

证据索引：`.impeccable/review/lsp-where-context-evidence.json`；原失败 `lsp-where-context-red.log`；最终 `lsp-where-context-vitest-final-all.log`、`lsp-where-context-vendor.log`、捆绑协议与两份 Native 归档。

## 第七十九批：Where 字段来源与首次空列表恢复

日期：2026-10-25。继续上批列出的 Grid 字段来源代次与 Where 实际自动同步差距。

消除 Where 字段对 Grid 列数组引用的授权依赖：旧结果重新映射或改变显示布局不会重新授予字段权限。字段现从当前连接、操作代次和配置回执校验下的驱动元数据取得，稳定上下文合并重复读取并复用有界缓存；复用编辑器作用域绑定，避免把当前表字段注入其他子查询。同时修复主查询与文件编辑器首次空列表在目录就绪后不恢复的问题。新增 **46 前端测试**，全量 **3189 / 458 文件**及生产构建通过；原生 LSP **98 场景 / 2481 断言**、签名文件 **6 场景 / 142 断言**通过。真实 SQLite ALTER 通过生产同步器自动撤回并恢复 Where 字段，无手动发布配置或递增全局元数据版本。全部 G01–G13 / E01–E07 继续。

| 内容 | 实现、验证与边界 |
| --- | --- |
| 实际缺陷与原失败 | TableDataController 在渲染中把 result.columns 重新 map 成 Grid 数组。旧 Where 代码把新数组引用绑定到当时的配置回执，旧结果可因此恢复提示。新增真实 GridFilterRow 用例在原实现下 1 failed / 5 passed，证明配置更新后仅重映射旧结果仍能显示旧字段。 |
| 字段来源模块 | 新 whereColumnSource 只在当前 available 与 metadataAllowed 授权有效时读取 getColumns / getDatabaseColumns；队列执行前、驱动响应后复核完整上下文。缓存按连接、运行/LSP/操作代次、项目、路由、metadataVersion、配置 token 和来源 identity 校验，不使用 Grid 列数组或持久旧字段作为证明。 |
| 有界复用与错误 | 每个表来源最多保留一份当前快照，缓存估算上限 8 MiB；超过预算的有效结果仍可用于当前请求而不驻留缓存，不按前缀截断字段。同一上下文的并发读取合并；失败可重试。共享队列每个连接/数据库最多 2 个活动任务、64 个等待任务；不增加轮询。没有新的端到端性能提升百分比。 |
| 异步显示与取消边界 | 语法候选立即显示，驱动元数据与 LSP 独立推进；先到的有效结果可先展示，后到元数据保留已转换的 LSP 替换范围。元数据命令本身沿用现有非取消接口，代次失效后不发布或缓存旧响应；LSP 请求仍使用真实取消回调。 |
| 复杂作用域 | 新 wherePhysicalTarget 复用主编辑器 cachedSqlDocumentContext 和 scoped relation bindings。只有实际绑定到当前表及 schema 才合并该表字段；未知限定名、其他表/schema、歧义 join、CTE 遮蔽和派生表由正确的文档/LSP 语义继续处理。明确的相关外层表和匹配当前表的内层别名仍可使用字段来源。 |
| 原生失败与交互修复 | 首次原生回归在嵌套局部请求前失败，保留 GLFZfq 根目录。新增两项先失败的 React 用例复现接受候选后旧动画帧越过 Escape/外部文本替换而移动光标或重开列表；增加交互代次与文本校验，并在布局阶段提交受控文本引用。第二次原生自动回退/稳定读取场景通过，操作场景发现列表需要同步隐藏；增加先失败的立即隐藏/恢复用例，维护 aria 状态，并把原生断言挂到真实第一笔 local-operation 回调中，避免把异步拦截器前的 API 返回时刻当作操作已经开始。保留 EdfJNq 根目录，修复后全量与原生重新验证。 |
| 首次空列表自动恢复 | 第三次原生 Where 全过，主查询初次渐进补全为空后未恢复。原恢复器只记录已经可见的列表；现由生产主查询和文件 provider 在元数据未完整时登记已发起的实际交互，复用文档版本/位置/焦点及 Escape 取消。真实重启场景受控暂缓最后 enrichment，确认首次 provider 结果为空，再放行实际配置，要求不改 SQL、不再次触发就恢复两层星号 CTE 字段。保留 Sv6bFj 失败根目录。加强后的首次空列表原生恢复已过，随后重启的原始字段检查暴露 token 与 didOpen 仍不能代表目录 enrichment 已完整；重启用例分别等待当前进程的 metadataReady 和真实自动打开回执，再保留实际字段断言，保留 znWrKb 失败根目录。 |
| 同 ID 换表 | Where 上下文加入表目标，并同步读取 tab 当前 tableName。同一 tab ID 的表切换会在 React 提交前撤回旧列表，接受候选也重新检查，补齐通用 tab 路由未编码 tableName 的边界。 |
| 新增 46 项 | 字段来源 19 项覆盖并发合并、各代次/连接/路由/token 失效、队列前撤销、迟到结果、失败重试、10000 列末尾字段与缓存预算；作用域 10 项；异步先后顺序 2 项；接受后延迟回调取消 2 项；同步隐藏与新列表恢复 1 项；Grid 重映射回归 1 项；同 tab ID 换表立即拒绝旧接受 1 项；首次空列表恢复 9 项及生产 provider 连接验证 1 项。原 Where、Grid 选列/LIKE/IN 和复杂替换测试全部保留。 |
| 新鲜原生证据 | C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-VfOGTf；**98 场景 / 2481 断言**。保留既有 96 场景，新增两个使用实际 GridFilterRow + WhereCompletionInput + LspConnectionSyncer、真实 Tauri/SQLite 元数据/操作事件的场景。标准 LSP RPC 实际执行后受控返回空列表，验证真实驱动回退可显示字段；5 次重新映射旧 Grid 数组和重复请求只新增 1 次字段读取。 |
| 真实自动恢复 | 可见 Where 列表在真实 ALTER 开始时由本地操作屏障立即撤回；生产事件观察与同步器取得新配置回执后，驱动回退显示并实际接受 where_auto_final，旧 where_old/where_new 不回流。此新增自动链路不手动发布配置、不手动递增 metadataVersion；前四个既有 Where 场景仍保留其受控发布边界。 |
| 文件与构建 | 签名文件 C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-XRaJ94；**6 场景 / 142 断言**，实际签名 DuckDB Host、四格式和生产双入口链路重跑。前端 **3189 / 458 文件**；生产 build、模块大小检查 **2927 文件**、Vite **4409 modules**通过。Root 严格 Clippy、正常 Desktop lib/应用及 headless oxide-agent 0.1.18 已恢复，进程残留 0，临时签名密钥删除。 |
| 明确沿用的后端结果 | Rust LSP 与捆绑字节未改，全部 vendor 输入哈希与第七十八批一致。1125 vendor / 24 目标 / 0 ignored（898 库、106 协议）、严格 vendor Clippy/fmt、实捆绑 106 协议明确沿用第七十八批，本轮未重跑；Host 1085 / 12 ignored 按 642 个未变输入沿用第七十五批，本轮新跑 Root 严格 Clippy 和原生链路。 |
| 产物、DBX 与许可 | release SHA-256：`edc0c870e5ed794ce5865775bc1f9a704a134a911dffff7f882569f976cb0274`，279 个运行输入不变。305 文件 / 265 Rust 源文件源码包及其 `61d5486121482ff608622db987da7fa38c5db00875a6af3945fdfd505c7f0b10` 摘要沿用第七十八批，未独立构建源码包。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的 53 项结果（Oxide 53、DBX 无头 19）也明确沿用第七十八批；本轮未 fetch。SQL Server 真实引擎结果沿用第五十八批，没有新容器。 |

### 仍需继续

- 完整可见 Workbench 的 Grid 数据/结构面板刷新、更多真实数据库权限和版本组合、系统文件选择、安装版与其他平台继续核对；隐藏 WebView 里的生产组件链路不证明这些全部完成。
- 继续其余元数据消费者、复杂方言表达式与类型、嵌套声明约束和完整 DuckDB 语法，以及所有 DBX G01–G13 / E01–E07。

证据索引：`.impeccable/review/lsp-where-columns-evidence.json`；原失败 `lsp-where-columns-red.log`；本轮 `lsp-where-columns-vitest-final-all.log`、生产构建日志和两份 Native 归档。未提交、推送或发布。


## 第八十批：Where 拼音、注释搜索与词法边界

Where 本地字段提示复用主编辑器的拼音、标识符缩写和列注释搜索，名称命中优先，完整匹配后再限制结果。字段缓存保留有界注释；异步词典加载后仍检查当前交互与来源授权。补上七种方言的字符串和注释边界，保留带引号字段补全及原有 LSP 值候选。另修复中文字段完成后可触发的 UTF-8 前缀切片崩溃，并保留中文列名以推断谓词值。新增 **35 前端、3 Rust 库、1 协议测试**，全量 **3224 / 460 文件、1129 vendor / 24 目标**及生产构建通过；真实 LSP **100 场景 / 2494 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 继续。

| 核对项 | 实现、证据与边界 |
| --- | --- |
| DBX 参考 | 固定干净 sources/dbx@b160d130560f71c5c429be15cec6147f677a4b3a。静态核对 identifierSearch.ts 和 sqlCompletion.ts 的 matchesColumnSearch/computeColumnBoost，确认其拼音首字母与列注释路径。Where 原先只对列名做简单模糊匹配，且丢弃注释；本批复用 Oxide 现有匹配器，不声明排序与 DBX 完全相同。未 fetch，不声称远端今日最新。 |
| 字段搜索 | 主编辑器与 Where 共享 rankCachedColumns/searchCachedColumns；支持中文名称/注释拼音首字母、驼峰/下划线缩写、子串与有序子序列。按所有字段匹配排序后最多 256 个字段候选，输入列表仍最多 80。名称命中优先于纯注释命中，空查询跳过注释处理。 |
| 性能与边界 | 复用惰性拼音词典及既有有界首字母缓存，不为 Where 新增一份词典。列注释最多 2048 UTF-8 字节且不截断 Unicode，辅助搜索 query 上限 128 UTF-8 字节；列名不截断，缓存注释计入原有 8 MiB 预算。1 万字段拼音注释搜索本机 Node 中位 13.23 ms / p95 16.22 ms，21 次观测；只代表匹配计算，不是桌面端输入或全部 SQL 时延保证。 |
| 词法位置 | 独立可复用 completionRegion 模块按明确方言和有效标识符引号分类 SQL/标识符/字面量/注释。Where 本地候选避开字符串和注释；不拦截服务端可能提供的有效字符串值推荐。覆盖 PostgreSQL E 字符串和 dollar quote、MySQL 紧邻 # 与 -- 空白规则、T-SQL 嵌套注释/N 字符串、SQLite 无反斜杠转义、DuckDB dollar quote/嵌套注释、ClickHouse 转义和 Hive 双引号字符串。 |
| 异步与来源 | 元数据和 LSP 继续独立返回；加载拼音后复核当前交互/上下文，再发布并登记接受守卫。取消或换来源不能由晚到搜索重新打开列表；后续本地发布保留已映射的服务端 TextEdit。 |
| 红绿测试 | 搜索新用例先 3 失败；词法新矩阵先 13 失败 / 12 通过，再修复。新增 7 搜索、25 词法、1 来源注释、2 会话用例，共 35；实际原生失败保留于 QPoNVc（75 场景/2226 断言），定位中文字段之后前缀长度与 UTF-8 边界不一致的崩溃。3 个 Rust 红测先全部失败；修复后库 901、六方言 Unicode 光标与值模板协议通过，整个进程保持存活。最终全量 3224 / 460 文件。真实 SQLite 新增中文列后经生产同步器刷新，强制标准 LSP 空结果仍得到拼音候选；实际输入接受得到双引号中文字段并消费完整 Suffix。另一个原生场景覆盖字符串/块注释/行注释中本地列表消失。SQLite 无真实列注释，本批注释搜索用单元夹具验证。 |
| 新跑原生验收 | LSP：C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-HlBRBB，100 场景 / 2494 断言；文件：C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-0J62Ip，6 / 142。实际隐藏 WebView、生产组件/Monaco、Tauri 和真实 SQLite/签名 DuckDB；系统 picker、安装包、完整可见 Workbench、其他平台未验证。 |
| 沿用证据 | 642 个 Host 输入未变，Host 1085/12 ignored 沿用第七十五批。本批 vendor 1129/24 目标/0 ignored、107 捆绑实字节协议、新 release、305 文件/265 Rust 源码包与固定 DBX 53（Oxide 53 / DBX 无头 19）均为新跑；源码包未独立构建。严格 Root Clippy、正常 Desktop lib/应用和 headless CLI 0.1.18 为新跑恢复。SQL Server 许可下的真实引擎结果沿用第五十八批，容器已移除，本轮没有新容器。 |
| 证据与清理 | .impeccable/review/lsp-where-search-evidence.json、benchmark.json、红绿日志和两份原生归档。临时签名密钥移除，测试进程残留 0，浏览器配置及失败材料保留；未提交、推送或发布。 |

词法规则参照 [PostgreSQL](https://www.postgresql.org/docs/17/sql-syntax-lexical.html)、[MySQL](https://dev.mysql.com/doc/refman/8.0/en/comments.html)、[SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/slash-star-comment-transact-sql)、[SQLite](https://www.sqlite.org/lang_expr.html)、[DuckDB](https://duckdb.org/docs/preview/sql/data_types/literal_types) 和 [Hive](https://hive.apache.org/docs/latest/language/languagemanual-types/) 官方说明。

仍需推进：Where 完整表达式/子查询的本地阶段推断，与其他 SQL 扫描器统一，以及会话 NO_BACKSLASH_ESCAPES、非默认 QUOTED_IDENTIFIER 等显式模式；全部复杂语句和方言没有覆盖完成。其余编辑器消费方、完整 DuckDB 语法、真实数据库/安装包和 G01–G13 / E01–E07 差距继续按原清单执行。


## 第八十一批：Where 嵌套表达式与合并候选语义

Where 本地提示改为复用方言词法扫描和有界表达式栈，区分函数参数、分组、BETWEEN、IN、CASE 与子查询；已完成的标量表达式提示比较运算符，字符串和注释中的关键字不再改变语法位置。加入保守类型与来源限定，并按当前语法位置筛选合并的服务端候选。候选接受按实际插入动作校验，同一动作刷新后继续有效，被移除的动作立即失效。新增 **117 前端测试**，全量 **3341 / 463 文件**及生产构建通过；真实 LSP **102 场景 / 2513 断言**、签名文件 **6 场景 / 142 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。

| 核对项 | 结果、证据与边界 |
| --- | --- |
| 结构性差距 | 旧正则把 COALESCE/CAST/分组的右括号误当成条件结束，把字面量 IN ( 或 BETWEEN 当成语法，嵌套 IN/范围内无法正确续写；新矩阵先 19 失败 / 9 通过。另查出前一个算术谓词污染新括号、PostgreSQL 未完成类型名与候选对象刷新问题，第二轮红测 5 失败 / 69 通过。 |
| 模块组织与预算 | completionRegion 的同一次方言扫描同时产生光标区域和不透明词法单元；predicateContext 用栈折叠函数、分组、IN 和 CASE 后判断当前语法位置。最多 524288 UTF-16 单元、16384 token、128 frame，越界交回既有 LSP 路径。3000 项平铺算术采用迭代分段，避免线性表达式造成递归栈增长。当前模块检查 2935 文件；生产 bundle 1 个启动模块且无静态循环。 |
| 复杂条件与实际编辑 | 函数、CAST、闭合 CASE/标量子查询后恢复运算符；BETWEEN 下界函数/分组后只续写范围 AND，IN 的嵌套函数/CASE 项后续写逗号或右括号，CASE 分支续写 WHEN/THEN/ELSE/END。继续文本和结束符采用显式 UTF-16 替换范围，保留已有数字/字面量，不重复已有结束符。普通谓词开头保留字段 = 快捷插入，函数、比较值和算术内部不自动追加比较。 |
| 类型与来源 | 识别 INTEGER/BIGINT/UInt64、部分 Nullable/LowCardinality、字符和时间别名及 JSON/UUID。对已知字段、CAST、常用内置函数、同族 COALESCE/CASE 分支提供保守值提示；未知函数、限定命名的函数、外国别名和子查询结果不借用当前表类型。数组/Map/Tuple 保留未知标量族。复用当前物理关系绑定的真实别名，而不是按同名列猜来源；新增 6 个子查询/CTE/相关引用定位用例。精确类型与全部函数签名仍由服务端负责。 |
| 合并列表与接受校验 | whereRemoteCompletion 按可确认的语法位置移除不合适的服务端字段、函数或逻辑关键字；未知返回类型保留可能有效的逻辑续写，文档内操作数位置继续接受局部字段。Where 的 T-SQL 本地 BIT 值使用 0/1/NULL，IS 分支只保留相应 NULL 形式，合并时排除错误的真值关键字，带引号同名字段继续保留。这里没有宣称全局服务端和主编辑器的 BIT 模板已对齐。 |
| 原生发现与修复 | ROWWgL 的首轮原生在 75 场景 / 2231 断言后发现点击未生效；保留失败根目录、回执与日志。相同内容的新对象不再使候选失效：用插入文本、snippet、光标动作及规范化替换范围建立接受键，并继续绑定原请求来源。新增测试同时证明：元数据收窄后旧 AND 不可接受；完全相同动作跨刷新仍可接受。最终 mQ402Y 通过全部 102 场景。 |
| 实际运行覆盖 | LSP：C:/Users/housh/AppData/Local/Temp/oxide-desktop-lsp-ipc-mQ402Y，102 / 2513；文件：C:/Users/housh/AppData/Local/Temp/oxide-desktop-file-query-2rDZjB，6 / 142。新增原生场景调用真实 LSP 并受控追加错误候选，验证完整合并策略；另在真实请求后控制标准返回为空，验证嵌套范围/列表/CASE 的本地实际接受。接受的 COALESCE 谓词在真实 SQLite 上执行；独立 SQL 同时验证嵌套范围、列表、CASE 和关键字字面量结果。复杂字段 Suffix 还由多方言单元矩阵与已有原生嵌套局部候选场景分别验证。受控返回与真实引擎边界分别记录。 |
| 性能观测 | 本机 Node、每项 21 次：256 组复杂谓词中位 12.01 ms，3000 项算术 4.24 ms。1 万字段空查询 0.06 ms，拼音注释搜索 7.81 ms。只是本地匹配/语法计算，不作为发布版桌面输入时延或所有 SQL 的保证。 |
| 沿用与恢复 | 340 个 vendor 输入、642 个 Host 输入和捆绑字节未变。1129 vendor / 24 目标、107 捆绑协议、305 文件 / 265 Rust 源码包、固定 DBX 53（Oxide 53 / DBX 无头 19）明确沿用第八十批；源码包未独立构建，Host 1085 / 12 ignored 沿用第七十五批。本轮重新运行严格 Root Clippy，恢复正常 Desktop lib/应用与 headless CLI 0.1.18。SQL Server 真实引擎沿用第五十八批已获许可并清理的隔离测试，本轮没有新容器。 |
| 参考与证据 | DBX 仍固定干净 b160d130560f71c5c429be15cec6147f677a4b3a，未 fetch；未声明可见 DBX 产品效果等价。当前依据同一复杂语义矩阵和源码结构继续修复输入列表差距。证据 .impeccable/review/lsp-where-expressions-evidence.json，包括红绿日志、两个基准、两份原生宿主/回执归档和冻结输入。临时签名密钥已移除、测试进程残留 0，浏览器配置及失败证据保留；未提交、推送或发布。 |

标准表达式形态及类型口径参考 [PostgreSQL 条件表达式](https://www.postgresql.org/docs/17/functions-conditional.html)、[比较谓词](https://www.postgresql.org/docs/17/functions-comparison.html)、[IN/数组比较](https://www.postgresql.org/docs/17/functions-comparisons.html) 和 [SQL Server BIT](https://learn.microsoft.com/en-us/sql/t-sql/data-types/bit-transact-sql)。本地类型用途是候选提示，没有替代数据库类型检查。

剩余范围：全局服务端/主编辑器的方言真值和 BIT 值模板；专有函数、窗口/FILTER、复杂查询块、行值/数组/JSON 运算与精确返回类型；会话词法模式和其他消费者的扫描统一；安装包、系统 picker、完整可见 Workbench、跨平台与完整 G01–G13 / E01–E07。所有复杂语句和方言的完成仍未证明。


## 第八十二批：全局方言值候选与主编辑器验证

全局服务端、文档内补全与 Where 本地回退按实际方言区分 Boolean 和 BIT：SQL Server/SQLite 使用 0/1，PostgreSQL/MySQL 使用对应宽度的位串，现有 DuckDB 使用显式 BIT 转换。已知数组不再继承标量真值候选；补上 IN 后续项、BETWEEN/CASE 类型来源和完整关键字后的插入范围。新增 **17 前端、4 Rust 库、11 集成、2 协议测试**；全量 **3358 / 464 前端文件、1146 vendor / 24 目标**通过。原生 LSP **104 场景 / 2527 断言**，签名文件 **6 场景 / 143 断言**通过。全部 G01–G13 / E01–E07 保留，完整对齐继续。

| 核对项 | 修复与验证边界 |
| --- | --- |
| 方言值候选差距 | 原全局模板将 bit/bool/boolean 都视为 TRUE/FALSE。红测复现 SQL Server、PostgreSQL 固定位串/变长位串、MySQL、DuckDB、SQLite 及 PostgreSQL Boolean 数组错误。改为按注册方言选择模板；SQL Server 使用实际 Postgres 兼容解析器，但值语义保留 sqlserver 身份，DuckDB 的兼容路径同样保留 duckdb 身份。未把兼容解析器名当作业务方言。 |
| 字面量 | SQL Server/SQLite BIT 推荐 0/1/NULL；PostgreSQL bit(3) 为 B'000'/B'001'，变长为 B'0'/B'1'；MySQL BIT(3) 为相同三位字面量，最大 64 位。较大的 PostgreSQL 固定位宽使用短字面量显式转换，避免按位宽分配长字符串。DuckDB 采用现有驱动兼容的 '0'::BIT / '1'::BIT，两个值已在真实签名驱动上执行验证。 |
| 合并与身份 | 类型策略在通用关键字追加后执行，排除与已知数值/文本/位串/数组不符的真值和日期候选。仅筛选关键字，同名字段、枚举成员保留。Where 远端列表采用同一前端类型规则，数值及位串的本地插入动作不再被服务端无空格文本覆盖；Boolean 仍接受既有大小写偏好。领域值先按前缀筛选，再限制 64 个结果，新增第 100 个成员搜索验证。 |
| 复杂来源与范围 | 共享有界扫描只读取当前未完成的值位置；前一个已完成比较不再将字段类型带入下一操作数。嵌套括号/IN/CASE 保留外层 BETWEEN 来源，限定别名在字段引用处解析，两个同名不同类型列、未知别名、相关外层别名、转义标识符及注释均有测试。预算 524288 源码字节、128 frame；这不等价于所有复杂表达式的精确类型推断。 |
| 模块组织 | Rust 值模板与上下文提取从通用候选构建中独立到 common/value_items.rs，测试单独归属；common 维持 9 个明确模块和无环依赖。前端值模板归属 query-languages/sql/valueTemplates.ts，供 Where 回退与远端过滤共用。解析器增加一次扫描同时提供值上下文遮罩及注释范围的入口。生产构建、模块边界 2939 文件和静态无环检查通过。 |
| 协议与原生界面 | 109 项调试及捆绑 release 字节协议测试通过。新增标准协议矩阵覆盖显式方言优先于 URI 后缀、大小写偏好；文档端点覆盖本地表变量/CTE 的 BIT 类型且无目录解析数据。原生主查询使用生产 provider 和真实建议控件，分别接受标准/文档内 RPC 的 SQL Server BIT 数值项；这里使用真实 LSP 和本地声明，未运行新的 SQL Server 引擎。Where 原生实际接受 BETWEEN/IS NOT 后的值而不覆盖关键字。 |
| 回归与恢复 | vendor 1146（905 库、109 协议，共 24 目标，0 ignored）及严格 Clippy新跑；源码包 307 文件 / 267 Rust 匹配，cargo package --no-verify，未独立构建包。Host 1085 / 12 ignored 按 642 个未变输入沿用第七十五批，本轮重新严格 Root Clippy，恢复正常 Desktop lib/应用、签名信任和 headless CLI 0.1.18。SQL Server 真实引擎仍沿用第五十八批已获许可且完成清理的隔离测试，本轮没有新容器。 |
| DBX 与证据 | DBX 仍固定干净 b160d130560f71c5c429be15cec6147f677a4b3a，本轮未 fetch。相同 53 样例本轮新跑，Oxide 53、DBX 无头 EditorState 19，不能据此宣布完整可见产品等价。捆绑 SHA bfead222440caa5482ab3d20ef5966cadd8ac4ccfbb6917a32b9c1996fd7d358；完整证据 .impeccable/review/lsp-dialect-values-evidence.json，包含两份原生宿主/回执归档及冻结输入。测试残留进程 0，临时密钥已移除；未提交、推送或发布。 |

方言口径参考 [SQL Server BIT](https://learn.microsoft.com/en-us/sql/t-sql/data-types/bit-transact-sql)、[PostgreSQL 位串类型](https://www.postgresql.org/docs/current/datatype-bit.html)、[MySQL BIT](https://dev.mysql.com/doc/refman/8.4/en/bit-type.html?ff=nopfpls)、[DuckDB BITSTRING](https://duckdb.org/docs/2.0/sql/data_types/bitstring)。DuckDB 2.0 的新位串字面量没有直接替代当前驱动的兼容转换形式。

剩余：全局 IS 槽位的完整语法筛选、任意表达式精确返回类型、专有函数/窗口/FILTER、行值/数组/JSON 高级运算、会话词法模式、长注释段性能及其他消费者扫描统一；安装包、系统 picker、完整可见 Workbench、跨平台与 G01–G13 / E01–E07 的未完成项仍保留。当前结果不代表全部复杂语句和所有数据库方言均已支持。


## 第八十三批：IS 复杂谓词推荐与长注释性能

标准与文档内补全共用 IS 关键字槽位；已知 PostgreSQL 非布尔字段不再推荐真值测试，SQL Server/ClickHouse 的现代空值安全比较按已知版本提供。Where 增加 IS [NOT] DISTINCT FROM、必填 FROM 及字段 RHS，保留 SQLite 任意表达式操作数。长注释剥离改为单次逆向消费。新增 **35 前端、8 Rust 库、5 协议测试**；全量 **3393 / 465 前端文件、1159 vendor / 24 目标**通过；原生 LSP **106 场景 / 2543 断言**，签名文件 **6 场景 / 144 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

| 核对项 | 结果、证据和限制 |
| --- | --- |
| 协议差距 | 红测 2 失败 / 1 通过：SQL Server IS 后缺少 NOT NULL，混入日期与函数；完整 IS 紧接光标时可能返回空列表。原有 IS NOT DISTINCT FROM 后局部字段作用域已通过，修复保留这一能力。新增标准/文档端点共同的 server/is_predicate_completion.rs，仅在已识别的关键字槽位生成列表，普通操作数委托原有语义服务。 |
| 方言与版本 | PostgreSQL 支持 NULL、真值与空值安全比较，已解析字段类型可证明为数值/文本/位串/数组时排除真值项。MySQL 保留自身真值测试；Hive 不制造 UNKNOWN；SQL Server/ClickHouse 不推荐 IS TRUE/FALSE。SQL Server 已知版本 >=16.0 提供 DISTINCT 比较，ClickHouse >=25.10 提供 NOT DISTINCT 比较，未知版本不主动制造现代语法候选。显式输入的 DISTINCT 仍可续写必需 FROM。对未列入的新产品 profile 保留既有服务，不套用兼容解析器的产品假设。 |
| 文档来源与隔离 | 标准端点只在识别 IS 位置后读取既有作用域；文档端点使用请求声明的 profile 和当前文档局部 schema，不读取目录、项目或服务端配置偏好。测试将 URI/配置故意设为 SQL Server，而文档请求为 PostgreSQL，验证 CTE INTEGER 输出不借用物理 Boolean 字段，偏好小写、无 resolve 数据、完整后缀替换均保留。纯 FROM 过渡及字符串/注释不加载元数据，另有回调拒绝测试。 |
| Where 复杂语义 | 新增 DISTINCT 后必填 FROM 阶段，IS [NOT] DISTINCT FROM 的 FROM 不再误判关系入口。右侧允许局部字段、后缀替换和嵌套标量，不追加多余等号；完整关键字后插入保留已有文本。远端严格 IS 槽位排除函数/字段，保留服务端按版本提供的比较形式。SQLite IS/IS NOT 的任意表达式候选继续委托服务端并保留本地字段，排除错误 UNKNOWN 关键字。未知函数等任意表达式精确返回类型仍未全部解决。 |
| 原生发现与共享缓存修复 | 首轮 me6Qws 在 80 场景 / 2267 断言后发现 Where RHS 无字段。共享查询缓存误把比较 FROM 记为新关系输入，导致正确撤回物理授权。新增 isSqlComparisonFrom 供作用域、顶层词及投影边界共用，8 个关联/隔离场景先 4 失败 / 20 通过；修复后保留来源校验，另加 2 个 CTE 比较输出测试，表达式不借用操作数字段元数据。失败回执和根目录保留。 |
| 实际界面与引擎 | 生产主编辑器建议控件分别通过标准和文档内 RPC 接受 IS NULL，断言完整列表只含合法 SQL Server 形式，并保留 emoji 前的 UTF-16 编辑范围。生产 Where 在真实 RPC 后控制标准候选为空，选择 NOT DISTINCT FROM、字段 RHS 和必填 FROM，实际 SQLite 执行接受后的谓词。签名 DuckDB Host 实际执行 TRUE IS TRUE、NULL IS UNKNOWN、NULL IS NOT DISTINCT FROM NULL，均返回真。没有新启动 SQL Server/ClickHouse 引擎，版本变化由真实协议配置重放验证。 |
| 长注释性能 | 旧实现每剥离一段注释重新逆向搜索整个范围列表，形成二次增长；新实现逆序迭代器只消费一次范围。旧单次观测 500/2000/8000 段约 2.3/14.7/174.1 ms；最终调试单测宿主 5 次复测，8000 段、184041 字节中位 20.24 ms。这是本机算法观测，不证明发布桌面输入延迟。回归同时核对 Unicode 字段、注释噪声、524288 字节及 128 frame 降级，以及超大 PostgreSQL 位宽仅生成短转换文本，避免按声明宽度分配。 |
| 模块与预算 | IS 槽位独立于常规候选构建，只检查最多 524288 字节、末尾 8 个词法项和 1024 字节单词；引用共享方言词法遮罩。前端值类型规范化供值候选、真值谓词及远端过滤共用。2942 文件模块检查、生产 bundle 无静态循环、vendor 与 Root 严格 Clippy 通过。 |
| 制品、恢复与沿用 | 新跑 vendor 1159（913 库、114 协议，24 目标，0 ignored）、捆绑 release 字节 114 协议、源码包 309 文件 / 269 Rust 匹配，cargo package --no-verify，未独立构建源码包。Host 1085 / 12 ignored 按 642 个未变输入沿用第七十五批，本轮重跑严格 Root Clippy、正常 Desktop lib/应用和 headless CLI 0.1.18；临时密钥已移除，测试进程残留 0。SQL Server 真实引擎仍沿用第五十八批授权隔离测试，本轮未新建容器。 |
| DBX 和证据 | 固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a，无 fetch。同一 53 样例本轮新跑，Oxide 53、DBX 无头 EditorState 19；不是完整可见产品效果对齐证明。捆绑 SHA 3ec4a22daf8591738bb27ff8012e9df43aee78f27602b2381512d230412ac30b；完整证据 .impeccable/review/lsp-predicate-slots-evidence.json，含两份原生宿主/回执、基准和冻结输入。未提交、推送或发布。 |

方言依据：[PostgreSQL 比较谓词](https://www.postgresql.org/docs/current/functions-comparison.html)、[MySQL 比较运算](https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html)、[SQLite 表达式](https://www.sqlite.org/lang_expr.html)、[Hive 操作符](https://hive.apache.org/docs/latest/language/hive-operators/)、[SQL Server IS DISTINCT FROM](https://learn.microsoft.com/en-us/sql/t-sql/queries/is-distinct-from-transact-sql?view=sql-server-ver17)、[ClickHouse 25.10 语法新增](https://clickhouse.com/videos/25.10-sql-features)。

剩余：任意函数/CAST/CASE 等表达式的完整精确真值类型、超长完整文档下的类型探测预算、更多厂商 IS 变体；专有函数、窗口/FILTER、行/数组/JSON 运算；会话词法模式及其他消费者统一；实际安装包、系统 picker、完整可见 Workbench、跨平台、桌面性能基线，以及完整 G01–G13 / E01–E07 未完成项。当前没有宣称所有复杂 SQL、所有版本和所有方言均已支持。


## 第八十四批：表达式类型探测复用与光标前缀性能

IS 推荐复用现有 AST 表达式类型推断，覆盖 PostgreSQL CAST、CASE、COALESCE、部分标量函数和布尔聚合，保留原始字符串常量的上下文转换。类型探测限制完整文档预算，光标转换在目标位置停止。新增 **8 前端、10 Rust 库、3 协议测试**；全量 **3401 / 465 前端文件、1172 vendor / 24 目标**通过；原生 LSP **108 场景 / 2592 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

| 核对项 | 结果、证据和限制 |
| --- | --- |
| 差距与红测 | 初始类型/预算单测 3 失败 / 5 通过；原始字符串前端 2 失败 / 30 通过；内部类型标记展示 1 失败 / 32 通过；分号前未完成 IS 的 CAST 类型另有失败回归。现已修复，并完成全量重跑。 |
| 共享语义模块 | 新比较左操作数探测复用 routine argument 的解析来源、作用域、变量与投影表达式推断，保留原有参数接口和行为。只返回短类型字符串，不再为判断真值类型生成并丢弃值候选。原始解析树可用时直接复用；未完成 IS 的内部恢复以同字节长度 =0 及空格替代关键字，保留所有源码和 UTF-16 坐标，原文及诊断内容不改写。 |
| PostgreSQL 语义 | CAST/postfix cast、CASE、COALESCE、NULLIF、算术、标量子查询沿用共享推断；补充 LOWER/UPPER、长度、REPLACE、STRPOS 及 BOOL_AND/BOOL_OR/EVERY 的已知返回类型。实时函数元数据优先，未知、引用或异源函数不猜测；原始字符串常量保留上下文转换，组合表达式解析为 text 后不提供真值测试。内部未定字符串标记不出现在用户详情中。标准与文档端点分别断言，文档端点不借用物理目录类型。 |
| 预算与性能 | 完整文档超过 524288 字节时跳过类型和目录探测，保留有限关键字回退。固定语法 profile 不为真值筛选加载元数据；前后缀总替换词超过 1024 字节时委托既有服务。坐标转换只扫描到目标 UTF-16 位置或换行，避免前部光标反复扫描同一行巨大后缀。旧调试宿主 100 次转换、600000 字节后缀单次样本共 114103 微秒；新调试宿主 5 次复测中位共 53 微秒。两组运行方法与样本量不同，只是本机算法观测，不证明桌面输入延迟。 |
| 原生接受与执行 | 生产主编辑器标准与文档内两条 RPC 路径均检查六种表达式的实际建议控件，并接受 NULL 或 TRUE，保留 emoji 与完整 SQL。真实客户端 profile 切换到 PostgreSQL，未启动 PostgreSQL 引擎。签名 DuckDB Host 实际执行 CAST、CASE、COALESCE 的三个谓词，断言都为真。既有 SQL Server、SQLite、BIT、IS 比较接受流程仍通过。 |
| 检查与制品 | 前端生产构建和 2943 文件模块检查通过；vendor 1172（923 库、117 协议，24 目标，0 ignored）及严格 Clippy 通过。捆绑 release 字节另跑 117 协议；源码包 310 文件 / 270 Rust 匹配，cargo package --no-verify，未独立构建源码包。Host 1085 / 12 ignored 按 642 个未变输入沿用第七十五批；本轮重跑 Root 严格 Clippy、正常签名信任下 Desktop lib/应用与 headless CLI 0.1.18。临时密钥移除，测试进程残留 0。 |
| DBX 与证据 | 固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a，无 fetch；同一 53 样例本轮新跑，Oxide 53、DBX 无头 EditorState 19。没有宣称已追平完整可见产品。捆绑 SHA 3ecc2c2a86173d3ccbe474f1e32cb7fe7ea550c965ff4400a5da0e631afafa4b；完整证据 .impeccable/review/lsp-expression-probes-evidence.json，包含两份原生宿主/回执、基准与冻结输入。未提交、推送或发布。 |

语义依据：[PostgreSQL 17 Boolean 常量](https://www.postgresql.org/docs/17/datatype-boolean.html)、[字符串函数](https://www.postgresql.org/docs/17/functions-string.html)、[聚合函数](https://www.postgresql.org/docs/17/functions-aggregate.html)。SQL Server 真实引擎验证沿用第五十八批授权隔离测试，本轮未新建容器。

剩余：限定/引用类型名、自定义类型、domain、行及复合类型；完整厂商函数、窗口/FILTER、数组/JSON 运算；后端已解析类型到所有 Where 消费者的桥接；SQLite 主编辑器保留任意操作数的 DISTINCT 主动推荐；会话词法模式；实际安装包、系统 picker、完整可见 Workbench、跨平台及桌面性能基线。全部原始目标继续保留，尚未支持所有复杂语句和所有方言。


## 第八十五批：PostgreSQL 类型身份与复杂推荐一致性

前后端补齐 PostgreSQL 内部别名、pg_catalog 限定名、引用大小写和数组类型身份；值候选、IS、算术、CASE/COALESCE、聚合、比较及重载排序共用后端类型解析。前端保留 CAST/postfix cast 的类型参数。新增 **52 前端、7 Rust 库、2 协议测试**；全量 **3453 / 466 前端文件、1181 vendor / 24 目标**通过；原生 LSP **110 场景 / 2640 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 和双入口范围保留，完整对齐继续。

| 核对项 | 结果、证据和限制 |
| --- | --- |
| 可复现差距 | 初始 Rust 回归 int2 的数值分类得到 None，0 通过 / 1 失败；前端 8 个限定类型用例失败、17 旧用例通过。旧 CAST 类型拼接丢失参数，bit(3) 可错误产生一位字面量。修复后新增宽度与复杂组合回归。全量初次还有 3 个旧断言要求丢弃参数或人为插入数组空格，已改为核对保留源码中的 NUMERIC(20, 4)、DECIMAL(20,4)、INTEGER[]；这是类型文本契约的有意修正。 |
| 单一类型身份 | 新增 crate 私有 postgres_types.rs，解析已知内置标量与其数组身份；前端 typeNames.ts 供类型家族与值候选共用。int2/int4/int8 等别名、pg_catalog.int4、引用的 pg_catalog 与小写内部名可归一；SQL CHAR 与内部 pg_catalog.char 保持不同身份。其他 schema、引用的大写类型名及单个含点号的引用标识符不借用内置类型。自定义、domain、复合和会话 search_path 解析仍需真实目录支持。 |
| 数组与其他内置标量 | _bool/_int4 内部数组名、带尺寸的数组后缀及 ARRAY 声明保持数组身份，不生成标量布尔或数值模板。已知 inet、bytea、range 等非布尔标量不推荐真值测试，缺少专用字面量模板时保守提供 NULL。其他产品 profile 不解释 PostgreSQL 的限定名。这里没有宣称穷尽所有 PostgreSQL 类型或类型修饰语法。 |
| 复杂表达式与重载 | 值模板与 IS 分类、PostgreSQL 数值阶梯、SUM/AVG、MIN/MAX、CASE/COALESCE 公共类型、布尔和文本谓词及重载类型身份使用同一后端解析。新增 CAST 组合算术、不同别名分支、BOOL_OR、NOT/AND、LIKE、比较及实时函数参数排序测试；删除重载模块中重复的 PostgreSQL 归一分支。保留未知类型的保守行为。 |
| 前端语义与性能边界 | CAST 与 :: 类型使用原始源码范围，保留限定名、引号、bit 宽度、numeric 参数及数组拼写。类型解析限制为最多 1024 字节（Rust）/1024 UTF-16 代码单元（前端），普通无后缀类型提前返回，前端关键字识别不逐次编译正则。没有新增桌面延迟基准，上一批光标算法观测仅保留为历史证据。包含注释的类型修饰和其他厂商语法仍待补。 |
| 实际协议和编辑器 | 新协议用例逐一覆盖 12 种物理类型的 IS 与文档隔离、其中 10 种值上下文，以及 13 种显式表达式的标准/文档双路径。实际生产 React/Monaco 建议控件新增标准和文档内两个场景，接受限定 CAST、引号限定名、算术、COALESCE、数组及 Boolean 的 NULL/TRUE，完整 SQL 和 emoji UTF-16 范围均核对。使用真实 PostgreSQL profile 的 LSP RPC，没有新启动 PostgreSQL 引擎。 |
| 全量检查与制品 | 前端生产构建和 2946 文件模块检查通过；vendor 1181（930 库、119 协议，24 目标，0 ignored）及严格 Clippy 通过；捆绑 release 字节另跑 119 协议。源码包 311 文件 / 271 Rust 匹配，cargo package --no-verify，未独立构建源码包。Host 1085 / 12 ignored 按 642 个未变输入沿用第七十五批，本轮重跑严格 Root Clippy、正常信任 Desktop lib/应用与 headless CLI 0.1.18；测试进程残留 0，临时密钥移除。 |
| 文件查询、DBX 与证据 | 本轮签名 DuckDB 文件查询仍为 6 场景 / 145 断言，包含原有 CAST/CASE/COALESCE、BIT、IS 执行；这不等同于 PostgreSQL 引擎验证。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a，无 fetch；53 样例本轮新跑，Oxide 53、DBX 无头 EditorState 19，未证明完整可见产品对齐。捆绑 SHA 9fdb84420801ea584e8cf372a4ca3919f283cef8240e620dfe6a8515cdcda9ac；证据 .impeccable/review/lsp-catalog-types-evidence.json，含两份原生宿主、回执及冻结输入。未提交、推送或发布。 |

依据：[PostgreSQL 17 类型与别名](https://www.postgresql.org/docs/17/datatype.html)、[标识符引用与大小写](https://www.postgresql.org/docs/17/sql-syntax-lexical.html)、[pg_type 类型身份与数组/修饰关系](https://www.postgresql.org/docs/17/catalog-pg-type.html)、[schema 与 search_path](https://www.postgresql.org/docs/17/ddl-schemas.html)。SQL Server 实际引擎沿用第五十八批授权隔离测试，本轮未新建容器。

只读消费者复核另有两项明确缺口：Where 运算符过滤调用类型家族时未传 dialect，pg_catalog 数值类型仍可能保留 AND/OR；提供仅含 NULL/NOT NULL 的合成远端列表后，本地未知函数的 TRUE 候选仍保留。复核运行生产辅助函数，远端输入为合成 fixture，未宣称真实 RPC 已携带类型契约；证据 .impeccable/review/lsp-catalog-types-next-consumers.json。

剩余：完整 domain/enum/复合类型的目录解析、显式 search_path、内嵌注释的类型声明和更多厂商变体；后端已解析表达式类型到所有 Where 消费者的桥接；SQLite 主编辑器保留任意 IS 操作数的 DISTINCT 主动推荐；其余函数/窗口/FILTER/行/数组/JSON 推断、会话词法模式、安装包/picker/完整可见 Workbench/其他平台和桌面性能基线。原始 G01–G13 / E01–E07 与双入口要求全部保留。


## 第八十六批：Where 语义约束与目录补全快照

关闭上一批复现的两个 Where 缺口：运算符过滤传递显式方言，IS 本地/远端合并使用后端完整关键字约束。新增目录补全快照绑定文档版本、位置、产品 profile 与已提交配置标识；文档内约束不读取目录。新增 **40 前端、4 Rust 库、5 协议、1 Host 测试**；全量 **3493 / 467 前端文件、1190 vendor / 24 目标、1086 Host 库 / 12 ignored**通过；原生 LSP **114 场景 / 2674 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。

| 核对项 | 结果、证据和限制 |
| --- | --- |
| 差距与红测 | Where 的 pg_catalog 数值类型仍保留 AND/OR，新增 3 失败 / 7 通过的红测后修复显式 profile 参数。此前无约束的原始列表合并不具备类型知识，不能从缺少 TRUE 推断该类型不允许真值测试；本轮在会话层接入显式约束，保留旧接口、空列表和失败情况下的本地回退。 |
| 单一语义所有者 | IS 槽位所有者一次计算候选及未按前缀过滤的完整 allowedKeywords，覆盖 is、is-not、distinct-from。普通 textDocument/completion 仍返回标准候选形状；文档快照附加无目录权限的约束。新 oxide/completionSnapshot 是 Oxide 扩展，返回目录候选和明确约束，不将辅助状态塞进 CompletionItem.data。 |
| 来源与产品边界 | 目录快照在配置读锁内检查已提交 token、文档版本、精确 UTF-16 位置及显式产品身份，完成后检查文档 revision。新红测发现 Redshift 与 PostgreSQL 共用 Arc 适配器，单看适配器会错误通过；现进一步比较产品身份，仅合并明确的同产品别名。错误 token、版本、profile 和位置均拒绝。文档模式保留显式 profile，不借用实时函数返回类型。 |
| Where 合并和接受 | 收到匹配语法槽位的约束后，先过滤本地关键字，再按同一约束接收远端项，保留文本编辑范围和现有候选接受保护。约束可以撤下未知函数的本地 TRUE，也可让后端确认的 Boolean 类型覆盖本地内置函数文本假设。延迟目录列重新发布时仍使用当前约束，旧候选失效；元数据撤销、取消、进程更换和晚到回复不把旧约束带入新上下文。空或不完整候选列表不等于负面语义知识。 |
| 方言与协议 | 目录/文档双路径覆盖函数返回刷新、文档内自定义函数保持未知、STRPOS 固定返回类型、前缀过滤与小写候选。完整约束独立于当前候选数量和大小写。版本矩阵保持 SQL Server 15/16、ClickHouse 25.9/25.10 的运算符差异，另核对 PostgreSQL、MySQL、Hive、DuckDB；Hive 不生成 UNKNOWN。SQLite 普通 IS 继续允许任意操作数，新快照与原标准列表保持一致，不施加仅关键字限制。 |
| 实际 Where 控件 | 四个新增原生场景通过生产 WhereCompletionInput、Hook、独立缓冲区及真实 Tauri RPC：先显示未知函数的本地 TRUE，再用已确认 int4 目录约束撤下并接受 NULL；更新 Boolean 后接受 TRUE；文档内 STRPOS 排除真值而自定义函数保持未知；晚到目录约束不能限制已经恢复的文档模式。核对 emoji 和完整条件文本，关闭输入保留主查询。使用函数元数据 fixture 的 PostgreSQL profile，未启动 PostgreSQL 引擎；renderer 元数据权限保持关闭，实际 Driver 目录读取 0。 |
| 模块与预算 | 新约束解析、目录快照客户端和 Where 约束应用各有独立模块；2953 文件模块检查、生产 bundle 和 LSP client 无静态循环。Where 只在需要的非 SQLite IS 槽位改用目录快照，其他目录请求保留旧路径，没有额外的语义 RPC 或重复类型推断。目录快照最多 512 项、候选 JSON 2 MiB，超限明确 isIncomplete；3000 列及末尾精确字段回归通过。客户端约束最多 16 词且逐槽位验证。没有新跑桌面延迟基准。 |
| Host 与制品 | vendor 1190（934 库、124 协议，24 目标，0 ignored）、捆绑 release 字节 124 协议及严格 Clippy 通过。源码包 314 文件 / 274 Rust 匹配，cargo package --no-verify，未独立构建源码包。本轮修改 Tauri generic.rs 和其 tests.rs，已新跑 Host 库 1086 / 12 ignored；642 个原 Host 输入中另 640 个未变。Root all-targets 严格 Clippy、正常签名信任 Desktop lib/应用和禁止 protoc 的 headless CLI 0.1.18 恢复；临时密钥移除，测试进程残留 0。 |
| 文件查询和 DBX | 签名 DuckDB 文件查询本轮新跑 6 / 145，覆盖既有文件、CAST/CASE/COALESCE、BIT、IS 执行；不等同于 PostgreSQL 引擎验证。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a，无 fetch；53 样例本轮新跑，Oxide 53、DBX 无头 EditorState 19，未证明完整可见产品对齐。SQL Server 引擎结果沿用第五十八批授权隔离测试，本轮未新建容器。 |
| 证据 | 捆绑 SHA 1e3d5c43ac6420eca56652f87c14fb72290f2def62b0f52c26defabe2d7540d8；.impeccable/review/lsp-where-constraints-evidence.json 包含新跑 Host、协议、两份原生宿主/回执和冻结输入。上一批只读消费者复核保留为历史差距证据，本轮由定向测试及实际 Where 控件关闭这两项。未提交、推送或发布，完整目标尚未完成。 |

协议背景：[LSP 3.17 completion 的客户端筛选与不完整列表定义](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/completion.md)。本轮完整关键字约束和目录快照为项目自定义扩展，没有宣称它们属于标准 LSP。

另一次只读合成约束复核发现：完整 allowedKeywords 还需要区分后端“已确认 Boolean”与“类型未知”。当前宽泛集合可能覆盖本地已知文本类型，例如 TRIM；此项尚未修复，证据 .impeccable/review/lsp-where-constraints-truth-uncertainty.json。下一步必须明确类型知识强度后再允许覆盖本地判断。

剩余：IS 以外的值和普通运算符位置的后端表达式类型衔接；完整 domain/enum/复合类型、显式 search_path、带注释的类型声明及厂商变体；SQLite 主编辑器主动 IS DISTINCT 推荐；其他函数/窗口/FILTER/行/数组/JSON 推断、会话词法模式、实际安装包/picker/完整可见 Workbench/其他平台和桌面性能基线。G01–G13 / E01–E07 和文件双入口要求全部保留。


## 第八十七批：Where 真值类型知识与未知结果合并

修正显式关键字约束中的知识强度：truthTests=true 表示类型模型确认支持，false 表示确认不支持，省略表示未知。未知结果不再覆盖本地已知的文本/数值限制，已确认 Boolean 仍可覆盖本地内置函数假设。新增 **8 前端、1 Rust 库、1 协议测试**；全量 **3501 / 467 前端文件、1192 vendor / 24 目标**通过；原生 LSP **115 场景 / 2683 断言**，签名文件 **6 场景 / 145 断言**通过。全部 G01–G13 / E01–E07 与双入口范围保留。

| 核对项 | 结果、证据和限制 |
| --- | --- |
| 回归与纠正 | 上一批新合并规则对完整关键字集合过度信任：后端无法精确推断 TRIM 时，宽泛回退包含 TRUE，会覆盖前端已知 text 判断。只读辅助函数复现后，又在生产 Where 会话添加 1 失败 / 33 skipped 红测。现引入明确三态，不将“可能支持”当作已确认 Boolean；前端回归和真实 Where 控件均验证此项关闭。 |
| 后端知识契约 | IS 所有者保留类型分类的 Option<bool>，直接随同完整约束发送 truthTests，没有额外 AST 探测或语义 RPC。已识别 Boolean 为 true，已识别非 Boolean 为 false，无法解析、未知类型或预算降级时省略。普通候选列表仍可宽泛回退，不能用其中出现 TRUE 代替正面类型知识。原标准 LSP 候选形状保持，扩展信息仅在项目快照响应中。 |
| 前端合并 | Where 的统一约束所有者先应用服务端完整词集；只有 truthTests=true 才允许越过本地非布尔判断。unknown 继续结合本地已知类型，false 不折叠为 unknown。对旧的不带三态字段的约束保留本地类型限制；无约束、空响应、失败和未完成结果仍不构成负面类型知识。字段、替换范围、当前候选接受保护和来源撤销逻辑未绕过。 |
| 校验和真实协议 | 客户端拒绝字符串/null 三态值、false 与真值关键字并存、true 却没有 TRUE，以及给 distinct-from 附加真值类型知识等矛盾输入。新增协议分别检查显式 CAST Boolean、INTEGER 和未解析 TRIM；目录与文档快照的三态一致。已有实时函数元数据覆盖测试明确断言目录 Boolean=true、文档内 Text=false，且文档项不携带目录 resolve 数据。 |
| 实际 Where 控件 | 新增原生场景使用真实目录快照，确认 TRIM 的宽泛回退仍包含 TRUE 但没有正面类型知识；生产 Where 最终不显示 TRUE，并实际接受 NULL，保留 emoji 和完整条件。原有 Integer 撤下 TRUE、Boolean 刷新后接受 TRUE、文档内 STRPOS、自定义函数目录隔离、晚到旧约束和主文档保留流程继续通过；新断言核对真实 false 与 true 字段。函数目录由 fixture 提供，未启动 PostgreSQL 引擎，renderer Driver 目录读取仍为 0。 |
| 原生测试失败记录 | 首次完整运行在后续共享 MySQL 标记焦点检查失败（107 场景 / 2609 断言），新增 Where 三态场景当时已通过。保留失败回执、宿主 SHA 和原目录；测试增加实际焦点握手及有界诊断轨迹，独立真实 Monaco 检查 4 轮 / 8 场景 / 48 断言通过，随后完整流程复验通过。生产标记实现未改，首次失败根因尚未证实，不能据此宣称修复了生产焦点缺陷。独立检查不替代完整验收。 |
| 模块和性能边界 | 本地与远端都使用同一个有效关键字集合构建函数，知识强度判断没有分叉。2953 文件模块检查、生产 bundle、vendor 与 Root 严格 Clippy 通过。没有增加语义请求或后端类型推断次数，没有新增桌面延迟基准；原有 512 项/2 MiB 快照预算和明确 isIncomplete 保留。 |
| 制品与 Host | vendor 1192（935 库、125 协议，24 目标，0 ignored）及捆绑 release 字节 125 协议通过；源码包 314 文件 / 274 Rust 匹配，cargo package --no-verify，未独立构建源码包。Host 1086 / 12 ignored 是本轮前一阶段第八十六批新跑的库结果，642 个 Host 输入此阶段全部未变，未重复宣称新跑。当前阶段重跑 Root all-targets 严格 Clippy、正常签名信任 Desktop lib/应用及禁止 protoc 的 headless CLI 0.1.18；临时密钥移除，测试进程残留 0。 |
| 文件查询、DBX 与证据 | 本阶段签名 DuckDB 文件查询新跑 6 / 145。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a，无 fetch；同一 53 样例新跑，Oxide 53、DBX 无头 EditorState 19，不是完整可见产品对齐证明。SQL Server 引擎继续沿用第五十八批授权隔离测试，没有新建容器。捆绑 SHA af6df6c559694d276a3cda5b7f28002feac5828be996cd38b29bd6f92e300ad1；.impeccable/review/lsp-where-truth-knowledge-evidence.json 包含两份原生宿主/回执、红测及冻结输入。未提交、推送或发布。 |

本轮三态字段是项目自定义语义契约，不是标准 LSP 字段；上一批未知知识缺口证据保留在 .impeccable/review/lsp-where-constraints-truth-uncertainty.json，现由新红测和实际控件关闭。

剩余：IS 以外的值和普通运算符位置的后端表达式类型衔接；尚未建模的函数返回、完整 domain/enum/复合类型、显式 search_path、带注释的类型声明和更多厂商语法；SQLite 主编辑器主动 IS DISTINCT 推荐；窗口/FILTER/行/数组/JSON 推断、会话词法模式、安装包/picker/完整可见 Workbench/其他平台及桌面性能基线。完整 G01–G13 / E01–E07 与文件双入口要求保留，尚未宣称全部复杂 SQL 和所有方言已支持。


## 第八十八批：普通比较值的表达式类型贯通

普通比较值候选接入共享 AST 类型推断：标准补全与两类快照共用类型/模板策略，Where 使用绑定后的正面类型知识，且异步列刷新不能恢复旧的未知值。补齐 SQLite CAST 亲和性推断。新增 **24 前端、5 Rust 库、2 协议测试**；全量 **3525 / 467 前端文件、1199 vendor / 24 目标**通过；原生 LSP **119 场景 / 2718 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。

| 核对项 | 结果、证据与边界 |
| --- | --- |
| 实际缺口与红测 | 后端已知 semantic_result() 的数值返回时，普通比较位置仍只有前端未知值 TRUE/FALSE 等回退。新增生产会话回归先得到 2 failed / 34 skipped，现目录与文档两条路径通过。原始红测保留在 .impeccable/review/lsp-comparison-value-types-red.log。 |
| 后端语义所有者 | comparison_value_types 复用现有 projection/argument AST 类型推断；仅在明确普通比较操作符之后，并且返回类型存在已建模的值策略时产生 valueType。标准补全与两类快照均用同一函数过滤不兼容值关键字并生成类型模板；没有从候选缺失、空列表或截断推断负面类型知识。共享比较探测现在接受单字节操作符，原 IS 恢复逻辑保留。 |
| 编辑中的 SQL | 有界私有推断文本在当前比较后补上 NULL，所有来源和 AST 坐标都属于该私有文本；只返回类型字符串，不将私有位置或修改发送给编辑器。覆盖 CAST、CASE、COALESCE、STRPOS、LOWER、数组、BIT、大小写前缀与六种常用比较运算符。未支持或不确定的语法继续保留原回退。 |
| 快照契约和授权 | valueType 绑定原有 URI、版本、UTF-16 位置、显式 profile 和已提交配置 token；文档内快照绑定原文档和位置，无目录 token，不读取在线函数目录。客户端限制类型长度 256，拒绝空值、错误类型、控制字符、与 IS 约束并存及缺失位置的文档类型字段，保留合法 SQL 换行。缺失字段表示没有新增知识，保留旧版兼容行为。 |
| Where 消费者 | 当前交互的正面类型知识用于重新生成本地值模板，并统一筛选远端关键字。晚到列搜索若按旧类型开始，发布前按当前类型重建；元数据撤销、进程/交互更换和取消后，旧类型不能恢复。候选接受仍使用现有插入动作、替换范围和当前性守卫。普通操作符槽位尚未取得同类表达式契约，BETWEEN/IN/正则等更多位置仍不完整。 |
| 方言与产品 | 协议矩阵核对 PostgreSQL、MySQL、SQL Server、SQLite、DuckDB、Hive、ClickHouse 的标准/目录/文档结果；另核对函数返回由 integer 切换 Boolean 与暖目录隔离。矩阵属于 LSP 输出证据，不等于七种真实数据库引擎均完成执行验收。当前实际 PostgreSQL、SQL Server 引擎均未新启动。 |
| SQLite 语义 | CAST 按有序类型亲和性规则处理：INT 优先于文本/实数匹配，其次 TEXT、BLOB、REAL，其他为 NUMERIC；因此 BOOLEAN/DATE 是 NUMERIC，而 FLOATING POINT 命中 INTEGER。前后端按相同方言规则建模；原生 Tauri SQLite 查询核对七组 typeof(CAST(1 AS ...))。这里的亲和性不声称 NUMERIC 在所有输入下都是固定 integer 存储；SQLite 字面量可空性仍保守，BLOB 等值模板并未补全。 |
| 真实控件和文件 | 新增目录数值撤下 TRUE 并实际接受 0、Boolean 刷新、文档 STRPOS 接受 0、暖函数目录不泄漏，以及旧数值回复不能限制新文档范围的实际 Where 检查；保留 emoji 和完整条件。函数类型由已确认 fixture 提供，renderer Driver 目录读取仍为 0，未启动 PostgreSQL 引擎。原生 119/2718 与签名 DuckDB 文件 6/145 均新跑通过。 |
| 模块与性能 | 2955 文件模块检查及生产 bundle 通过；后端比较类型探测独立于 IS 关键字模块，前端类型字段解析独立于传输生命周期。完整 SQL 探测受 512 KiB、类型 256 字节、前缀 1024 字节限制；标准候选与返回类型共享这一次有界探测，没有额外语义 RPC。普通比较现在增加了有界语义推断成本；本轮没有新增打包桌面延迟基线，不宣称性能全面提升。 |
| Host、制品和参考 | vendor 1199=940 库+127 协议+其他集成，24 目标、0 ignored；严格 vendor/Root Clippy、同一捆绑 release 字节 127 协议、源码包 315 文件/275 Rust 匹配通过。源码包使用 --no-verify，未独立构建。Host 1086/12 ignored 继续沿用第八十六批库结果，本阶段 642 输入未变；正常签名信任 Desktop lib/应用及禁止 protoc 的 headless CLI 0.1.18 已恢复，测试进程残留 0。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 新跑同一 53 样例，Oxide 53、DBX 无头 EditorState 19，无 fetch，不是完整可见产品对齐。SQL Server 引擎沿用第五十八批授权结果。 |
| 追加只读复核 | 同一捆绑二进制的独立 stdio 探针已确认两个未关闭差距：无目录时，标准/目录补全没有数值模板，而文档模式能从 CAST 得到 INTEGER；文档端点仍接受半个 UTF-16 代理对和越界行/列，越界时还能按被截断到末尾的位置产生 valueType，目录端点则明确拒绝。客户端的响应位置一致校验不等于服务端位置合法性验证，后者必须继续修复。探针正常退出 0，证据为 .impeccable/review/lsp-comparison-value-types-next-consumers.json，本轮未宣称这两项完成。 |
| 证据和已知问题 | 捆绑 SHA 36e151b3539236f8ee0ecd0c3e428d18b8e74af39b586f0d0e8a5aa0e164a76f；.impeccable/review/lsp-comparison-value-types-evidence.json 归档两套原生宿主/回执与冻结输入。第八十七批共享焦点首次失败证据继续保留；本轮整套复验通过，未改生产标记实现，也未证明历史失败根因。未提交、推送或发布。 |

SQLite 规则依据：[类型亲和性的有序规则](https://www.sqlite.org/datatype3.html#determination_of_column_affinity)、[CAST 转换](https://www.sqlite.org/lang_expr.html#cast_expressions)。valueType 是本项目快照扩展；标准 LSP 返回形状保持，标准候选直接使用共享模板策略。

剩余包括普通操作符槽位、BETWEEN/IN/正则/窗口/FILTER 的完整表达式期望类型，以及更多函数、domain/enum/复合类型、search_path、会话词法与厂商变体；文件 picker/安装包/完整可见 Workbench/其他平台及桌面性能基线。全部原始 G01–G13 / E01–E07 保留，尚未达到所有复杂语句、全部方言和产品完整对齐。


## 第八十九批：无目录类型推断与快照位置校验

关闭上一批独立协议探针复现的两项缺口：没有目录时，标准/目录补全复用文档内类型环境；两类快照共用严格 UTF-16 位置校验，拒绝越界与半个代理对。新增 **4 Rust 库、2 协议测试**；全量 **1205 vendor / 24 目标、3525 / 467 前端文件**通过，原生 LSP **121 场景 / 2734 断言**、签名文件 **6 / 145**通过。完整 G01–G13 / E01–E07 与文件双入口范围保留。

| 核对项 | 结果、证据与边界 |
| --- | --- |
| 前后复现 | 上一批捆绑二进制的只读探针确认：无目录时标准/目录没有数值模板，文档端点却有；文档端点接受非法位置并可在截断到末尾后发送 INTEGER。新增两条真实失败回归分别为 1 failed，记录在 .impeccable/review/lsp-completion-fallback-position-red-position.log 和 -red-schema.log。当前同一探针新跑，三个路径都有数值模板、两类快照都拒绝三个非法位置，正常退出 0；与旧证据分别保留。 |
| 无目录回退 | comparison_value_types 的 schema 改为可选借用。先确认有界的普通比较值位置，再在没有提供 schema 时调用纯文档 local_schema；不复制已有的大目录，也不向同步目录注册临时形状。该回退没有 catalog/project manager，支持 CAST、固定内置函数及本地绑定，而暖私有函数保持未知。已有目录仍使用原 schema 和函数返回类型，不改变连接/元数据授权。 |
| 位置模块 | checked_position_to_byte_offset 与原有可截断转换共用行首扫描；检查只消费目标行前缀，按 UTF-16 计数，拒绝半个 emoji、超出行尾/文档的行列与 u32 最大位置。两类自定义快照共用该函数，非法请求在补全和语义推断前返回 -32602。原标准补全的截断行为保留，未把自定义快照策略冒称为标准 LSP 的要求。 |
| 换行与恢复 | 纯转换测试覆盖 Greek/汉字/emoji、CRLF、独立 CR、LF、行尾和最终空行。两个快照端点验证合法 CRLF 坐标；实际 Host 上连续拒绝非法请求后，合法 emoji/CRLF 文档仍得到 INTEGER 与 0，客户端会话持续可用。此项不是所有 provider 对独立 CR 的端到端覆盖证明。 |
| 多方言 | 无目录协议矩阵覆盖 postgres/mysql/sqlserver/sqlite/duckdb/hive/clickhouse，另有 postgresql/pgsql/psql、mssql/tsql、sqlite3、hql、ch 8 个同产品别名和 MariaDB，合计 16 个显式 profile。仅既有同产品别名在推断内部规范化，请求/响应产品身份、配置 token 和适配器校验保留；没有把 MariaDB 等兼容产品折叠成同一产品身份。目录/文档字段类型与标准数值模板一致。这里只证明 LSP 结果，不代表 16 个引擎均执行验收。 |
| 真实 Where 和暖目录隔离 | 当前配置保留私有函数元数据但撤下文件 schema 绑定，实际 Where 从 STRPOS 得到整数、撤下 TRUE 并接受 0；调用暖私有函数则仍是未知值，无正面 type 字段，也不出现数值模板。另通过生产 LspClient/Tauri/LSP 核对非法位置拒绝和合法恢复，标准补全也取得数值。renderer Driver 目录读取为 0；未启动 PostgreSQL 引擎。完整原生 121/2734 与签名 DuckDB 文件 6/145 新跑通过。 |
| 模块和性能 | 2955 文件模块检查与生产 bundle 通过；现有完整类型推断、模板策略及客户端传输继续复用，未增加 RPC、驱动权限或候选来源。没有目录时，只有已确认的普通比较值位置才构造本地类型环境；位置校验不扫描光标后的后缀。保留 512 KiB 探测及类型/候选预算；本轮没有新增桌面延迟或内存基准，仍需测量并优化大文档的实际推断成本。 |
| 制品、Host 和参考 | vendor 1205=944 库+129 协议+其他集成，24 个编译目标，另空 doc-test 组 0；全部 0 ignored。vendor/Root 严格 Clippy、同一捆绑 release 的 129 协议、源码包 315 文件/275 Rust 匹配通过，源码包 --no-verify、未独立构建。Host 1086/12 ignored 沿用第八十六批库结果，642 输入未变；正常签名信任 Desktop lib/应用及禁止 protoc 的 headless CLI 0.1.18 已恢复，测试进程残留 0。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 同一 53 样例新跑，Oxide 53、DBX 无头 EditorState 19，无 fetch，不是完整可见产品对齐；SQL Server 引擎仍沿用第五十八批授权证据。 |
| 证据和既有问题 | 捆绑 SHA 523dda91b10dd76b9539f3cfccac7adfcd00fdd90b081856df595246a82d1d1b；.impeccable/review/lsp-completion-fallback-position-evidence.json 归档新回执、二进制和冻结输入。上一批的 next-consumers.json 为历史红证据，本批同名证据的两项缺口已关闭。第八十七批共享焦点首次失败记录仍保留，本轮整套复验通过，未改生产标记实现，也未证明历史根因。未提交、推送或发布。 |

剩余仍包括普通操作符槽位、BETWEEN/IN/正则/窗口/FILTER 的完整期望类型；domain/enum/复合类型、更多函数、search_path、会话词法及厂商变体；文件 picker/安装包/完整可见 Workbench/其他平台与打包桌面性能基线。原始 G01–G13 / E01–E07 全范围继续，尚未达到所有复杂语句和全部方言/产品的完整对齐。


## 第九十批：普通逻辑运算符与方言标量语义

新增显式 AND/OR 逻辑操作数知识，区分 true、false 与未知；目录返回类型刷新、文档隔离、延迟回包和完整关键词后缀替换贯穿实际 Where 控件。补齐 ClickHouse Decimal64(2) 等自定义数值类型参数语法。全量前端 **3576 / 467 文件**、vendor **1214 / 24 目标**通过；本轮原生 LSP **125 场景 / 2762 断言**、签名文件 **6 / 152**通过。G01–G13 / E01–E07 全范围保留。

| 核对项 | 结果与边界 |
| --- | --- |
| 多方言逻辑策略 | PostgreSQL/Hive 已知 Boolean 可以接 AND/OR，PostgreSQL 文本/数值与 SQL Server 裸 BIT 不被当作谓词。SQLite 采用数值真假转换；MySQL/MariaDB 已知标量允许相应转换；ClickHouse 只确认布尔及整数/浮点；DuckDB 数值、文本和 BIT 允许逻辑转换。未知自定义、JSON 和未建模枚举保留未知，不从缺少候选推断 false。这里确认的是类型可转换性，不能保证每个具体字符串的转换成功。协议矩阵覆盖 7 个家族及既有同产品别名；不是所有引擎执行证明。 |
| 独立知识与模块 | logicalContinuation 可选布尔字段与 IS constraints、比较 RHS valueType 分开，并在两种客户端快照解析中拒绝错误类型/矛盾字段；false 保留，未携带字段为未知。共用 profile 归一化与类型策略；有界逻辑模块复用现有 AST 左操作数推断、本地类型环境、目录授权和可取消 RPC，不新增驱动目录权限或传输端点。Where 只在 operator 槽使用该知识，AND/OR 的参数列表等其他语法职责不被替代。 |
| 编辑与并发 | 实际 React Where 输入验证整数返回撤下 AND/OR、刷新为 Boolean 后恢复 AND，并在 emoji 后接受 AND 时替换 ASuffix 的完整后缀。文档内置 LOWER 返回文本限制成立，未知函数不借暖目录类型；已发出的旧目录 false 响应不能剪掉已恢复文档上下文的候选。异步列检索同时绑定值类型与逻辑知识；位置、版本、profile、配置 token 和 generation 校验保留。 |
| 语法缺口 | 真正失败的 ClickHouse Decimal64(2) 协议样例定位到 custom_type 不拥有数值参数。grammar.js 现保留一/两个数字参数、限定名与数组维度，回归检查 CAST、PostgreSQL postfix、真实函数调用和错误参数。固定 tree-sitter-cli 0.26.3 / ABI 14 重新生成，12 项指纹与从发布基线重建补丁验证通过；不是对所有 ClickHouse 嵌套类型语法的覆盖声明。 |
| 真实引擎与界面 | SQLite 实际 Where 选择数值表达式后的 AND，生成条件通过 Tauri SQLite 执行；独立执行验证数值/字符串/NULL 的逻辑组合。签名 DuckDB 文件会话实际执行 INTEGER、VARCHAR、BIT 三个正向转换，并由独立文档 LSP 返回 logicalContinuation=true 与 AND，保留真实编辑器 SQL。额外本地只读 DuckDB 探针验证 6 表达式，包括非法字符串及 DATE 拒绝；该探针没有 Tauri/安装包权限证明，不能等同签名端到端的负例。 |
| 测试与制品 | 先有前端 8 failed 和后端 1 failed 红回归，现新加 51 前端、6 Rust 库、3 协议测试。vendor 1214=950 库+132 协议+其余集成，24 编译目标及空 doc-test，0 ignored；同一捆绑 release 132 协议通过。源码包 316 文件/276 Rust 与当前源字节匹配，--no-verify 未独立构建。Host 1086/12 ignored 沿用第八十六批，642 输入未变；Root/vendor 严格 Clippy 本轮新跑，正常 Desktop lib/应用信任及禁止 protoc 的 headless CLI 0.1.18 已恢复。 |
| DBX、性能与未闭项 | 固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的同一 53 样例新跑，Oxide 53，DBX 无头 EditorState 19；没有 fetch，不证明线上最新。逻辑补全增加一次至多 512 KiB 的 AST 探测，保持后缀预算和现有 RPC，未声称桌面延迟改善。第八十七批历史焦点失败证据保留，本轮全套通过但未证明其原始根因。普通操作符的 LIKE/ILIKE、正则、BETWEEN/IN、窗口/FILTER、domain/复合类型、search_path、更多厂商与实际桌面性能基线仍待补齐；未达到全部复杂语句/所有方言对齐。 |

语义依据：[SQLite Boolean Expressions](https://www.sqlite.org/lang_expr.html#boolean_expressions)、[MySQL Logical Operators](https://dev.mysql.com/doc/refman/8.4/en/logical-operators.html)、[SQL Server Search Condition](https://learn.microsoft.com/en-us/sql/t-sql/queries/search-condition-transact-sql?view=sql-server-ver17)、[ClickHouse Logical Functions](https://clickhouse.com/docs/reference/functions/regular-functions/logical-functions)。DuckDB 转换边界另由本轮本地及签名引擎实测保存。

证据为 .impeccable/review/lsp-logical-continuations-evidence.json、final-verification.json 及其冻结输入/原生宿主归档；捆绑 SHA d5b9cb2fa457bde53bd033ada2551ccbdce62ac07af1e8f60cb3f4ebcd34f107。不包含系统 picker/安装包/完整可见 Workbench/其他平台验收；沿用第五十八批已授权 SQL Server 隔离引擎证据，无新容器。未提交、推送或发布。

本轮新增的下一消费点探针：7 个家族共 35 个完整比较、IS、BETWEEN、IN、EXISTS 文档请求，未返回新的 false 限制；其中 DuckDB/ClickHouse 的 EXISTS (SELECT 1) 后没有 AND，单列为未闭项，未声称完整谓词补全覆盖。首次桌面夹具在 81 场景处等待旧标准请求计数而失败；操作符现走语义快照，夹具已同时跟踪并注入快照候选，保留原候选过滤断言。修复仅在测试夹具，本轮整套 125 场景重新通过；原失败宿主、回执和输入仍归档。

生成表成本（本轮实测）：parser.c 从 38493138 到 38870314 字节，状态数 28965 到 29277，约增加 1%。这只是生成表大小，不代表进程常驻内存或补全延迟；后续性能优化须以真实桌面测量为准。


## 第九十一批：多方言谓词与条件结果推断

补齐 DuckDB/Hive/ClickHouse 的固定谓词结果模型，并让谓词在 NOT、逻辑组合、CASE 与本地 CTE 中保留类型；SQLite 也支持这些已知相同类型的条件分支。前端 **3576 / 467 文件**、vendor **1220 / 24 目标**通过；实际桌面 LSP **134 场景 / 2815 断言**、签名文件 **6 / 158**通过。原 G01–G13 / E01–E07 与文件双入口范围继续。

| 核对项 | 结果、证据与边界 |
| --- | --- |
| 缺口复现与修复 | 第九十批捆绑协议探针发现 DuckDB/ClickHouse 的 EXISTS 后没有 AND。新增 3 条库回归先红，扩展协议又复现 SQLite 的 CASE 结果缺口（2 failed）。固定谓词共享 owner 原只建模 PostgreSQL/MySQL/SQLite，现补充 DuckDB/Hive Boolean、ClickHouse UInt8；继续复用原 AST、目录授权和本地绑定，没有给 WHERE 字符串追加特例，也没有用 EXISTS 子查询选出列的类型作为其返回类型。35 个完整谓词请求在当前捆绑版本重新执行，缺少 AND 的清单为零；这只关闭该探针的范围。 |
| 条件与复合语义 | NOT、AND/OR 复用既有逻辑操作数策略，拒绝已知不兼容的 DATE/Decimal/Hive 数值操作数。CASE 支持新增产品与 SQLite；仅保留相同已建模逻辑标量类型及 NULL 分支，不猜测完整隐式转换格。相同 Boolean/UInt8/integer 谓词结果经 CASE 与 CTE 传播到比较 RHS，继而产生 TRUE 或 0 模板；不是所有日期、字符串、复合类型混合分支的完整覆盖。SQL Server 裸谓词仍不变成可 SELECT 的虚构 Boolean 标量。 |
| NULL 与方言边界 | DuckDB/Hive 比较、IN 与 BETWEEN 保留三值逻辑的保守可空性；ClickHouse IN/NOT IN 的结果按 0/1 建模，NULL 处理不套用 PostgreSQL 的 nullable IN 规则。Hive 支持既有语法中的 <=>，但不推断 IS UNKNOWN；ClickHouse 不推断 IS TRUE。普通未知字段/函数仍需真实绑定，不宣称检查了引擎会话全部设置、相关子查询版本门槛或所有运算符合法性。 |
| 单元与协议矩阵 | 新增 3 库、3 协议测试；实际协议矩阵覆盖 postgres/mysql/mariadb/sqlite/sqlite3/duckdb/hive/hql/clickhouse/ch 10 个显式 profile 的多层 EXISTS、NOT、逻辑与 CASE，以及 6 家族本地 CTE 值类型传播、3 家族 CRLF/UTF-16/关键词大小写和完整后缀替换。全量 vendor 1220=953 库+135 协议+其余集成，24 编译目标及空 doc-test，0 ignored；同一 release 135 协议通过。前端 3576/467 新跑通过。 |
| 实际 Monaco 与 SQLite | 真实生产 Query provider、Monaco widget、Tauri 和 LSP 下，duckdb/hive/clickhouse/sqlite 各走标准与文档模式，8 场景中实际选择 OR 并替换 OSuffix，保留多行 Unicode SQL；不是只检查返回数组。另经实际 Tauri SQLite 执行 CASE 谓词，核对存储类型 integer、值 1 与 NULL 分支。完整 134/2815 通过；没有运行 Hive/ClickHouse 数据库引擎。 |
| 签名文件与独立引擎 | 签名 DuckDB 文件会话实际执行 EXISTS、NOT EXISTS、CASE，核对 BOOLEAN/true，独立文档 LSP 同时给出 logicalContinuation=true 和 AND；保持真实文件编辑器 SQL 不变。文件 6/158 通过。额外本地只读 DuckDB sidecar 16 条查询核对布尔值、NULL、短路组合和非法 DATE AND TRUE；保存实际引擎 version() 回应，不把文档网站版本当作本地版本，也不将该独立探针称为签名/Tauri/安装包证明。 |
| 模块、性能与制品 | 复用 predicates、literal、set_types 与既有投影/比较 AST owner；模块检查 2956 文件通过。相对此前逻辑补全没有新增 AST、RPC 或目录读取，EXISTS 体继续由既有 scalar_queries 收集规则跳过；本轮没有新增桌面延迟/内存基准。解析器语法与生成表未变。源码包 316 文件/276 Rust 与当前源匹配，--no-verify 未独立构建；Root/vendor 严格 Clippy、正常 Desktop lib/应用及禁止 protoc 的 headless CLI 0.1.18 恢复通过，测试进程残留 0。 |
| 参考、历史问题与剩余 | 固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的同一 53 样例新跑，Oxide 53、DBX 无头 EditorState 19；没有 fetch，不能据此证明线上最新或全部可见产品对齐。Host 1086/12 ignored 沿用第八十六批，642 源输入不变。第八十七批焦点历史失败及第九十批已修复的请求计数夹具证据保留，当前整套重新通过。剩余包括 BETWEEN/IN 的完整期望操作数类型、正则/窗口/FILTER、混合类型转换、domain/复合类型、search_path、会话设置、更多厂商及性能基准；安装包、系统 picker、完整可见 Workbench 与其他平台仍待验收。 |

语义依据：[DuckDB Subqueries](https://duckdb.org/docs/2.0/sql/expressions/subqueries)、[Apache Hive Operators](https://cwiki.apache.org/confluence/spaces/Hive/pages/27362046/LanguageManual+UDF)、[ClickHouse EXISTS](https://clickhouse.com/docs/reference/statements/exists)、[ClickHouse IN NULL Processing](https://clickhouse.com/docs/reference/statements/in#null-processing)。ClickHouse 官方文档的 EXISTS 页面合并了独立语句与子查询形式；本轮引用子查询及其 IN 转写示例，未据此声称所有相关子查询版本/设置已验证。

捆绑 SHA d8b72ecc8fe43f98caf73994c598e2565a24bd108143700eebe16d11b06a6a7f；证据 .impeccable/review/lsp-predicate-result-types-evidence.json 与 final-verification.json 保存新回执、宿主、协议与冻结输入。已授权 SQL Server 隔离引擎结果继续沿用第五十八批，无新容器；本轮未提交、推送或发布，整体目标仍未完成。

下一消费点：高级匹配表达式。当前捆绑版本的独立文档探针在 5 个家族共 8 条 ILIKE/SIMILAR/regexp_matches/match/RLIKE/REGEXP/GLOB 本地 CTE 表达式后仍没有 valueType，保留的是未知类型通用 TRUE/FALSE 候选。此为当前 RPC 行为证据；下一轮需先确认各产品语法、返回类型与引擎行为，再补回归，不把本批 EXISTS 的通过扩大成高级搜索全部支持。详见 .impeccable/review/lsp-predicate-result-types-advanced-probe.json。

本轮构建空间处理：自动审批审查拒绝临时恢复备份删除，理由为 blocked by policy，动作未执行。后续采用 NTFS 透明压缩保留文件；单份探测与 39 份旧测试宿主归档逐一验证内容 SHA-256 不变，删除文件数为 0。三份资源处理记录已冻结在本轮证据中。

## 第九十二批：高级匹配运算与模式类型提示

高级匹配的结果类型、右侧模式字符串和 NOT 候选统一按方言处理；覆盖 ILIKE、SIMILAR TO、REGEXP/RLIKE、GLOB 与已建模正则函数。新增 38 前端、8 Rust 库、4 协议测试；全量前端 **3614 / 468 文件**、vendor **1232 / 24 目标**通过。实际桌面 LSP **147 场景 / 2950 断言**，签名文件 **6 / 174**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。

| 核对项 | 当前结果与边界 |
| --- | --- |
| 原始缺口 | 第九十一批独立文档探针的 8 条本地 CTE 表达式在 5 家族中均缺少 valueType。本轮先保留 2 个失败库测试，再核对产品文档、引擎差异并修复；新捆绑二进制重跑 8 条全部具有具体类型，不将通用 TRUE/FALSE 当作语义推断成功。 |
| 解析与类型模块 | 语法补真实 REGEXP/RLIKE/GLOB 二元节点及 NOT 形式，并支持 Nullable(String)、LowCardinality(Nullable(String)) 等嵌套类型参数。新增 patterns owner 统一结果与期望模式类型，复用既有 literal、predicate、routine identity 和比较 AST；移除旧 predicate/search 中重复的匹配规则。固定正则函数只覆盖 DuckDB regexp_matches/regexp_full_match 与 ClickHouse match；实时函数返回元数据继续优先，命名空间、参数数量、已知非法参数与大小预算有负例。 |
| 方言结果 | 本轮 LSP 类型模型中 PostgreSQL/DuckDB/Hive 匹配结果为 Boolean；MySQL bigint、SQLite integer、ClickHouse UInt8，保留已建模 NULL 传播。LIKE/ILIKE/SIMILAR/正则等支持范围按产品区分；SQLite 默认 REGEXP 扩展没有被虚构，DuckDB 当前引擎不接受中缀 NOT GLOB。类型模型不执行正则，也不保证未知函数、任意模式或会话扩展一定可运行。 |
| 推荐列表与编辑 | 模式 RHS 使用 text/varchar/string/String/nvarchar，避免把数值左值直接当成模式值。Where 增加必填 SIMILAR → TO；NOT 后仅提供当前方言允许的字母运算符，远端候选使用相同规则。关键字同名字段自动引用，完整后缀、emoji 与多行 SQL 有单元和实际控件验收。 |
| 版本边界 | DuckDB ~*/!~* 仅在已知版本至少 2.0 时建模；ClickHouse !~、~*/!~* 要求至少 26.8，ILIKE 的后端类型推断在已知旧版本受限。没有版本证据时不发明现代别名。实际本地 DuckDB 为 v1.5.5，独立探针记录了 ~* 的拒绝。新版别名只有版本规则/协议测试，未运行对应新版数据库。 |
| 测试与真实编辑器 | 全量前端 3614/468、vendor 1232/24（961 库、139 协议、132 其他集成）通过，捆绑 release 字节另跑 139 协议。生产 Query provider + Monaco + Tauri 在 5 方言各走标准/文档模式，10 个新场景实际接受 CTE 匹配结果 TRUE 或 0，替换 Suffix；Where 两模式实际接受 TO 与字符串，SQLite 实际输入后执行 GLOB/NOT GLOB。全部 147/2950 通过。这不是实际 Hive/ClickHouse/MySQL 数据库执行。 |
| 签名文件与引擎 | 签名 DuckDB 文件会话新增 8 条真实查询，核对 ILIKE/SIMILAR/regexp_matches/regexp_full_match/选项/NULL/GLOB 的 BOOLEAN 与值；独立文档 LSP 经 CTE 返回 Boolean 提示，保持文件编辑器内容。完整 6/174。另有本地只读 sidecar 14 条观测：11 条成功结果断言，3 条非法或版本变体被拒绝；该独立探针不代替签名流程。SQL Server 第五十八批已授权隔离实测证据沿用，没有新容器。 |
| 性能与制品 | 未增加解析/RPC 路径，比较 RHS 复用既有共享 AST；不编译或运行正则。类型文字最多 1024 字节、正则调用最多 64 KiB、literal 解包最多 32 层。生成 C 表源码从 38870314 增至 41455344 字节，状态 29277 → 29517，large state 4766 → 5729；这是语法表体积成本，不是运行内存/时延改善证明。模块检查 2960 文件通过；源码包 318 文件/278 Rust 匹配，--no-verify 未独立构建。 |
| 参考与恢复 | 固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的相同 53 样例重跑，Oxide 53、DBX 无头 EditorState 19；没有 fetch，不能证明线上最新或完整可见产品对齐。Root/vendor 严格 Clippy、正常 Desktop lib/应用及禁止 protoc 的 headless CLI 0.1.18 恢复通过，进程残留 0；Host 1086/12 ignored 沿用第八十六批，642 源输入未变。 |

语义依据：[DuckDB pattern matching](https://duckdb.org/docs/2.0/sql/functions/pattern_matching)、[DuckDB regular expressions](https://duckdb.org/docs/2.0/sql/functions/regular_expressions)、[SQLite expressions](https://www.sqlite.org/lang_expr.html)、[MySQL regular expressions](https://dev.mysql.com/doc/refman/8.4/en/regexp.html)、[Hive UDF/operators](https://cwiki.apache.org/confluence/spaces/Hive/pages/27362046/LanguageManual+UDF)、[ClickHouse string search functions](https://clickhouse.com/docs/reference/functions/regular-functions/string-search-functions)。本地实际版本以保存的 version() 为准。

剩余重点：本地 Where fallback 的完整版本感知候选目录；LIKE/ILIKE ESCAPE 的表达式语法与期望类型；其他模式函数与扩展；版本/会话设置及重载；BETWEEN/IN 的完整期望操作数；普通运算符、window/FILTER、混合 CASE 转换、domain/复合类型与 search_path；更多真实数据库矩阵与端到端性能基准。安装包、系统文件 picker、完整可见 Workbench 和其他平台仍待验收，整体目标未完成。

实际 Monaco 初次接受 DuckDB CTE 的 TRUE 时留下 TRUESuffix；该真实失败和当时宿主已归档。追加 959 通过/2 失败的库回归后，修复了类型值模板的完整 UTF-16 TextEdit，并优先移除重复通用字面量候选；同名字段、函数和带引号的 domain 值保留独立身份。全套实际控件重新通过。ClickHouse !~ 也补齐 26.8 下限，NOT REGEXP 在缺少产品语法证明时保守不推荐。

生产构建首次在新补全测试的可选 replacementRange 类型检查处停止，尚未运行 Native；已为补全函数显式声明统一返回类型，并重新通过完整前端、生产构建和 Native，失败日志保留。第八十七批焦点和第九十批夹具计数的历史证据仍保留，不声称修改生产 marker 修复了前者。

签名宿主构建曾因磁盘空间不足（os error 112）在执行 Native 前停止，失败日志保留；内容保留的 NTFS 压缩释放空间后重新完成。签名 NULL 夹具的严格空值类型检查问题也在启动 Native 前修复并留存。

本轮仅对旧证明归档/恢复备份及闲置构建缓存做 NTFS 透明压缩，操作前后内容 SHA 相同，删除 0 文件；此前删除备份被自动审批审查以 blocked by policy 拒绝的记录沿用，本轮没有重试删除。旧证明归档在最终冻结时再验哈希，后续会被正常编译改写的缓存只记录操作时的内容一致性。

捆绑 SHA 685f68bc6eecb0d9e10215e594dee8bf5bb0911dcdd16e177deebbe5ab44f1d9；当前证据 .impeccable/review/lsp-pattern-semantics-evidence.json 与 final-verification.json。未提交、推送或发布。

## 第九十三批：ESCAPE 语义与单字符提示契约

补齐 LIKE/ILIKE 及已支持方言 SIMILAR TO 的 ESCAPE 结果类型与单字符提示，主编辑器、WHERE 和文件查询共用绑定后的语义角色。新增 26 前端、6 Rust 库、3 协议测试；全量前端 **3640 / 469 文件**、vendor **1241 / 24 目标**通过。实际桌面 LSP **160 场景 / 3019 断言**、签名文件 **6 / 191**通过。原 G01–G13 / E01–E07 与文件双入口范围保留。

| 核对项 | 当前结果与边界 |
| --- | --- |
| 缺口与回归 | 旧发布二进制的 11 条文档模式探针均未提供 ESCAPE 结果/RHS 类型；通用 TRUE/FALSE 不视为推断成功。实现前 Rust 1 通过/3 失败，前端 65 通过/16 失败。新发布字节重跑 11 条，支持的产品提供具体类型和 pattern-escape；不支持的形式保持未知。 |
| 语法与模块 | ESCAPE 复用 binary_in 优先级，模式右值包含独立二元 ESCAPE，保留原始范围；没有额外三元语法节点。patterns owner 统一结果、操作数及 NULL；comparison/value owner 从已有 AST 取得真实外层 LIKE/ILIKE/SIMILAR。语法是超集，解析成功不代表某家数据库支持。 |
| 类型与边界 | PostgreSQL、DuckDB、MySQL、SQLite 和 SQL Server 的相应 LIKE/ILIKE 支持按产品限制；SIMILAR TO ESCAPE 支持 PG，DuckDB 不发明支持。ClickHouse LIKE/ILIKE ESCAPE 要求已知版本至少 26.6，SIMILAR TO 至少 26.10；未知版本不借用热目录。SQL Server 不把投影谓词伪装成可查询 Boolean。 |
| 推荐契约 | 两类快照增加可省略 valueRole=pattern-escape，必须同时有文本类型且匹配文档、版本、方言、配置和 UTF-16 光标。标准补全也使用同一字符候选 owner。提供 '#'/ '!'/NULL，移除通用 TRUE/FALSE/0/空字符串模板，保留字段和函数身份；类型本身不能开启不支持产品的字符语义。 |
| 编辑与异步 | 完整 Suffix、emoji、CRLF、关键字后无空格均有回归。Where 支持完成模式后提示 ESCAPE，以及 ESuffix 接受后的完整替换；远端字符字面量与 snippet 过滤受同一语义约束。晚到列元数据不能恢复旧角色，目录失权后文档模式不能借用旧版本知识。 |
| 实际引擎 | 只读 DuckDB v1.5.5 sidecar 11 条断言，加 Node SQLite 3.50.4 与 DuckDB 的 7 对差异断言。SQLite 接受 Unicode 单字符和 ESCAPE 1，拒绝空字符；DuckDB 当前版本拒绝非 ASCII 与数值，接受空字符；两者 NULL 传播均实测。多字符被拒绝。MySQL SQL mode/常量表达式和其他版本没有被等同验证。 |
| 实际主编辑器与 WHERE | 5 个 profile 各走标准/文档模式，10 个新真实 Monaco 场景接受 '#', 消耗完整 Suffix；PG Where 两模式核对角色和可选关键字，SQLite Where 实际接受并执行查询，同时执行 Unicode/数值/NULL。总计 160/3019。这些 profile 补全测试不代表运行了相应 PG/MySQL/SQL Server 数据库。 |
| 签名文件流程 | 生产 FileQueryEditor + Tauri + 隔离签名 DuckDB 新增 8 条真实 LIKE/ILIKE/否定/空字符/动态 SUBSTR/NULL 查询，核对 BOOLEAN 和值，再验证 LSP 的 CTE 比较类型；另核对字符角色，文件编辑器 SQL 保持。完整 6/191。用户此前授权的 SQL Server 隔离引擎测试已在第五十八批执行和清理，本轮沿用其证据，无新容器或重复许可请求。 |
| 全量与发布 | 前端 3640/469，vendor 1241（967 库 +142 协议 +132 其他集成）/24 目标、0 ignored；发布精确字节另跑142协议。Root/vendor 严格 Clippy、正常 Desktop 库/应用和禁用 protoc 的 headless CLI 0.1.18 恢复。Host 1086/12 ignored 沿用第八十六批，642 源输入逐一匹配；未伪装成本批复跑。 |
| 制品与参考 | 源码包 319 文件/279 Rust 字节核对，--no-verify 没有独立包构建。固定干净 DBX b160d130560f71c5c429be15cec6147f677a4b3a 的原53样例重跑，Oxide53，DBX无头EditorState19；不是完整可见产品对齐或远端最新证明。本轮未fetch/合并/提交/推送/发布。 |
| 性能成本 | 模式识别先快速拒绝普通运算符，之后才扫描噪声；复用已有 AST、范围和配置，不增加解析/RPC/常驻候选缓存，不执行正则。生成 C 从 41455344 到 42348106 字节（约+2.15%），状态29517→29645，large5729→5948。ABI14和12摘要校验通过；这不是实际时延或内存改善证明。 |

语义依据：[PostgreSQL pattern matching](https://www.postgresql.org/docs/current/functions-matching.html)、[DuckDB pattern matching](https://duckdb.org/docs/2.0/sql/functions/pattern_matching)、[SQLite expressions](https://www.sqlite.org/lang_expr.html)、[MySQL LIKE](https://dev.mysql.com/doc/refman/8.4/en/string-comparison-functions.html)、[SQL Server LIKE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/like-transact-sql?view=sql-server-ver17)、[ClickHouse string search](https://clickhouse.com/docs/reference/functions/regular-functions/string-search-functions)、[ClickHouse ESCAPE 合并记录](https://github.com/ClickHouse/ClickHouse/pull/99774)。ClickHouse PR 的 Version Info 给出26.6.1.123，未把26.9发布介绍误当首次支持；Synapse 不支持 ESCAPE，未纳入普通 SQL Server 支持声明。

仍需继续：主编辑器的可选 ESCAPE 发现、完成匹配后的显式 logicalContinuation（本轮独立6条探针均未知，AND候选仍存在）；复杂动态/常量限制、MySQL SQL modes、扩展/版本；普通表达式、BETWEEN/IN、混合 CASE、窗口/FILTER、domain/复合类型和 search_path；更多真实厂商矩阵、规模化时延/内存、完整可见产品与安装包验收。所有 G01–G13/E01–E07 保留，目标尚未完成。

构建期间观察到 PDB 写入和单个测试 exe 链接失败；保留内容的 NTFS 压缩后，单目标重试和完整24目标均成功。未删除归档、备份或浏览器 profile，缓存及归档压缩前后核对 SHA；缓存随后可以被正常编译更新，只有冻结证明继续核对当前字节。动态 SUBSTR 的可空性保持保守；原先要求非空的夹具已更正，并补当前 DuckDB 数值/Unicode 非法负例。文件验收 TypeScript 在启动 Native 前发现可能 undefined 的分行索引，改为原文本偏移计算。之前第八十七批焦点、第九十批计数、第九十二批 TRUE 后缀问题的历史证据保留，不声称本轮又修复。

真实桌面首轮在 SQLite 夹具停止（115场景/2576断言）：数字1作为 ESCAPE 时，原模式 oxide1_1 末尾的1也是转义符，不能期待匹配成功。原查询保留为返回0的负例，新增 oxide_ 对 oxide1_ 的返回1正例；最终实际 Tauri 同时断言 Unicode、原负例、数值正例和 NULL。原失败 receipt、JS 与精确宿主已冻结归档，未改生产逻辑来迁就错误预期。

另一次闲置元数据缓存压缩与文件验收的前端构建重叠；验收进入 Cargo 时，维护脚本检测到 rustc 后停止，没有继续处理其他缓存。已完成文件在操作中检查 SHA，但退出前未写出逐文件汇总，保留中止说明与 compact 日志，不将其作为完整冻结清单；后续构建和验收独立核验。以后维护与整个构建流水线串行。

捆绑 SHA 54f38c7d989b368d7a657604e94f669ae87a5c50cd120a59c2b894c81b099b5b；本轮证据 .impeccable/review/lsp-pattern-escape-evidence.json 与 final-verification.json。实际宿主和前端证明独立归档，恢复后进程残留0。

## 第九十四批：匹配谓词续写与 ESCAPE 发现

主编辑器在完整匹配后主动发现可选 ESCAPE，完成匹配/转义后提供明确的 AND/OR 类型知识与完整 UTF-16 编辑；标准、目录和文档路径共用已有 AST 与类型策略。新增 4 Rust 库、4 协议测试；前端 **3640 / 469 文件**、vendor **1249 / 24 目标**通过。实际桌面 LSP **174 场景 / 3101 断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07 与文件双入口范围保持。

| 核对项 | 当前结果与边界 |
| --- | --- |
| 已复现缺口 | 第九十三批发布探针的6条 PG/DuckDB/SQLite 匹配语句均只有通用 AND 候选，logicalContinuation 未知，且未发现可选 ESCAPE。实现前新增用例执行结果6通过/2失败，保留行为红测；本轮发布精确字节重跑6条全部有明确 true/AND，未转义形式有 ESCAPE，已转义形式不再提示第二次 ESCAPE。另外6条三profile的行/块注释和跨行光标探针也全部通过，原先按单行位置发请求的探针已修正为真实多行UTF-16位置，未视作服务端缺陷。 |
| 逻辑探针 | 原先追加等号会因优先级进入 LIKE 等模式右值。现在追加低于匹配的 AND NULL，从同一原树取得完整左操作数。词法预检查只把真实末尾关键字当作不完整槽位，闭合字符串不会让前一个 LIKE/ILIKE 被误判成缺少 RHS。原有标量真/假/未知、未知函数和预算回归继续通过。 |
| 模块与类型 | argument_types 增加续写知识入口，projection 共用 argument_node 范围定位；patterns owner 统一结果、可空性、有效操作数和续写检查。最多32层定位末尾匹配，识别逻辑链与 NOT；整体括号、非匹配运算符、未知/不支持版本和已转义表达式不误加 ESCAPE。SQL Server 谓词续写可明确支持，未把其投影结果伪装成 SQL Boolean。 |
| 候选与身份 | 普通 AND/OR 和可选 ESCAPE 同一位置/前缀策略，完整替换 ESuffix/A suffix 与多行 emoji 后的 UTF-16 范围。移除重复通用关键字以保留明确编辑，字段/函数身份保留。字符 RHS 继续使用第九十三批 valueRole，不提前把可选关键字当成字符值。 |
| 三路与刷新 | 新协议测试覆盖 PG/DuckDB/MySQL/MariaDB/SQLite/SQL Server 的标准、目录、文档三路；ClickHouse LIKE 26.6、SIMILAR TO 26.10 版本边界、同 SQL 配置刷新及文档模式不能借用热目录版本；实时函数 text→integer→text 反复撤销/恢复，文档模式不借用目录函数。 |
| 实际主编辑器 | 7 profile各走标准/文档两模式，14新场景实际接受可选 ESCAPE 和完成匹配后的 AND，消耗完整后缀。ClickHouse 已知26.6目录可提供 ESCAPE，文档模式保留未知版本边界；Hive 只验证匹配后的逻辑续写。完整174/3101。这些是实际生产 provider/Monaco/Tauri 与 profile 模型，未运行7家数据库。 |
| 签名文件与引擎 | 8条原有转义表达式实际追加 AND TRUE，通过签名 DuckDB 文件会话核对 BOOLEAN 与真值/NULL，再要求独立文档 LSP 明确逻辑知识且不重复 ESCAPE。保留其他文件生产流程，完整6/207。SQL Server 第五十八批授权隔离引擎证据沿用，没有新容器或许可请求。 |
| 全量与制品 | 前端3640/469重新运行，生产构建和严格TS通过；vendor1249（971库+146协议+132其他）/24目标，0ignored；捆绑release精确字节再跑146协议。源码包319文件/279 Rust逐一匹配，tests目录按既有清单不打包，--no-verify并非独立包构建。Root/vendor严格Clippy及普通Desktop库/应用、禁止protoc的headless CLI0.1.18恢复。Host1086/12ignored沿用第八十六批，642源输入未变。 |
| DBX与真实性 | 固定干净DBX b160d130560f71c5c429be15cec6147f677a4b3a 原53样例重跑，Oxide53，DBX无头EditorState19。另外独立6组（2正向物理字段对照+4组PG/DuckDB/MySQL/SQLite的CASE+ESCAPE+CTE）对比，双方均能推荐4组matched字段，Oxide还提供预期Boolean/bigint/integer类型，DBX当前参考只给字段名；整体带类型判据为6对2。使用相同预置元数据，真实EditorState/字符串两模式，0网络读取；这些追加样例不改变原53输入，既不是完整关键词provider/可见产品对齐，也不代表实际执行了四家数据库。未fetch，不能称远端最新。 |
| 性能与语法成本 | 仍使用已有请求内AST、绑定和预算；没有增加解析/RPC/常驻候选缓存，生成C、状态数、ABI14和12摘要均未因本轮改变。新增的是有界模式检查，不能当作整体p95或内存改善证据；复杂文档和端到端性能仍待基准。 |

发布协议首次出现144通过/1失败：旧schema刷新夹具只按文档版本1匹配诊断，没有区分配置标识。保留原日志和精确测试宿主；增强为每次独立配置token，并按uri/version/token匹配通知，随后核对配置提交、实际inlay列名和拉取诊断，不根据期望语义计数选择通知。初期夹具调整在已被 open() 消费的通知上再次等待，或先调用会丢弃未匹配通知的 request()，导致超时；这些日志也保留。最终按实际适配器消费顺序修正，不声称修改生产诊断代码解决了该失败。

签名文件首轮在实际执行动态SUBSTR转义之后停止（1场景/128断言）：库内直接类型探针已能识别完整谓词，但逻辑推荐的前置过滤没有接纳解析器已有的 PredicateContinuationClause，导致动态/NULL转义没有明确逻辑知识。新增0通过/1失败的库回归后，复用该已有上下文；9项定向库测试与新增跨三路协议负/正向覆盖通过。8条实际文件表达式的独立发布探针最终均明确 true/AND 且不重复ESCAPE。原失败receipt、JS、精确签名宿主、前后探针均冻结；最终所有实际桌面与签名流程按新发布字节重新验收，未缩减失败输入或改变SUBSTR的保守可空性。

仍需继续：Where 本地版本感知、更多SQL modes/动态与常量验证、BETWEEN/IN/普通运算/混合CASE/窗口/FILTER、完整domain与复合类型/search_path、更多真实数据库矩阵及冷/热/p95/内存/取消性能；安装版、系统picker、完整可见Workbench和跨平台仍保留。目标未完成。

另一次最终签名宿主在启动Native之前因创建rlib遇到os error112停止，单独保存构建失败证据。129个闲置缓存文件经过前后SHA核对做透明压缩，并仅为 src-tauri/target/debug 与其 deps 两个固定目录启用新文件的NTFS压缩，以控制后续重建占用；没有改变源码或系统压缩策略。已有归档另做4个文件的内容保留压缩，最终冻结时复核原字节。缓存可被后续编译正常改写，不把其当前内容哈希当冻结源码；后续签名验收及普通构建重新验证。

捆绑SHA 5ca02179a428979481cc5d93cbbe833e14419e5a521a7f7d26caec587c8d839d；本轮证据 .impeccable/review/lsp-pattern-continuations-evidence.json 与 final-verification.json。源码与两个实际宿主、前端证据冻结核验；构建缓存维护与整条编译流水线串行，删除0文件，保留以前拒绝删除的记录。未提交、推送或发布。

## 第九十五批：WHERE 版本能力与语义快照

WHERE 的 LIKE/ILIKE/SIMILAR TO 可选 ESCAPE 现在使用绑定的版本能力，明确区分支持、不支持和未知；配置改变、文档恢复与晚到回包不会沿用旧授权。两条快照共用原子语义解析。新增29前端、1 Rust库、1协议测试；全量前端 **3669 / 470文件**、vendor **1251 / 24目标**通过。实际桌面 LSP **179场景 / 3155断言**、签名文件 **6 / 207**通过。G01–G13 / E01–E07及文件双入口范围继续。

| 核对项 | 结果与验证边界 |
| --- | --- |
| 行为红测 | 修改前前端3文件17失败/120通过，协议新增测试0通过/1失败：服务端已能提供版本感知候选，但没有显式patternEscape契约；WHERE续写还走旧items-only请求，并按未知版本本地canEscape过滤。保留两份失败日志，修复后重点及全量重新通过。 |
| 契约 | optional patternEscape=true表示已知支持、false明确否定、缺失表示未知；仅与logicalContinuation=true同时有效，绑定相同文档、版本、方言、配置和UTF-16位置。它不是已接受ESCAPE后字符RHS的valueRole=pattern-escape。目录和文档路径共用同一个pattern类型owner，文档模式不借用热目录版本。 |
| 方言版本 | 模型中ClickHouse LIKE/ILIKE ESCAPE要求26.6，SIMILAR TO要求26.10；26.5明确否定LIKE转义，未知版本不伪造支持。SIMILAR TO本身未知/未支持时不制造逻辑或转义类型。PG、DuckDB、Hive、SQLite、SQL Server的支持/否定、正则/GLOB和已转义边界均有库/协议回归。这里是LSP版本模型，未启动ClickHouse引擎。 |
| 客户端模块 | completionValueType集中解析整个语义契约，两条客户端路由共同拒绝错误类型、缺少位置和互相冲突的字段；减少重复分支。WHERE续写使用已有绑定快照，替换旧items-only RPC；本地只在可直接附加的LIKE/ILIKE/SIMILAR TO槽位使用显式能力，false可撤销静态假设，未类型化ESCAPE候选不能充当授权。 |
| 编辑态与异步 | 原条件不修改即跟随版本未知→26.5→26.6→26.5改变列表；完整替换emoji后的ESuffix尾，接着实际接受单字符转义值。文档恢复立即移除版本授权，独立正向请求证明热目录仍存在；持有旧正向回包并在恢复后释放也不能重新发布。异步列搜索同时绑定当前能力，晚到元数据不能覆盖新类型。 |
| 实际桌面 | 新增5个真实WHERE生产输入/Tauri/LSP场景，179/3155全量通过。使用mysql连接描述加显式clickhouse能力，验证配置优先于URI；未运行真实ClickHouse。禁止get_columns/get_database_columns授权，计数为0。保留实际Monaco主查询、SQLite执行和其他174个原场景。 |
| 文件与授权SQL Server | 签名DuckDB文件流程6/207重新执行，包含复杂转义、NULL/动态字符与逻辑续写。用户此前批准的SQL Server隔离Developer测试沿用第五十八批实际四引擎证据，本轮无需再次接受许可或新建容器。没有把ClickHouse模型夹具计为真实数据库。 |
| 全量与制品 | 前端3669/470及严格TS；vendor1251=972库+147协议+132其他，24目标、0ignored。捆绑release精确字节另跑147协议。源码包319文件，279个src Rust逐一匹配；既有tests目录不在包内，--no-verify不表示独立构建过包。Root/vendor严格Clippy通过，恢复正常Desktop库/应用及禁止protoc的headless CLI0.1.18。Host1086/12ignored沿用第八十六批，642源码输入逐一未变。 |
| DBX对比 | 干净固定参考b160d130560f71c5c429be15cec6147f677a4b3a的原53样例重新运行，Oxide53、DBX EditorState/字符串各19；所有原输入保留。这是相同预置元数据下无头补全比较，不是完整关键词provider、真实引擎或可见产品对齐。上批6个追加CASE+ESCAPE+CTE/物理对照及独立逻辑探针沿用第九十四批并明确fresh=false，不能称本轮重跑或远端最新。 |
| 性能 | 两路共用已有请求内AST和能力owner，WHERE一次绑定快照替代旧请求，无新增解析、元数据RPC、常驻候选缓存或生成语法变化。当前仅能说明结构与额外调用成本受控，未新增耗时基准，不声称p95/内存或整体速度改善。 |

首轮实际Native在原有WHERE Boolean刷新夹具停止（134场景/2684断言）：等待条件只要求请求计数增加且列表包含本地TRUE，未要求新的真实快照已携带truthTests=true。取消请求也会增加计数，本地提示可提前满足该条件。保留失败receipt、场景bundle、输入与精确宿主；独立发布字节探针对同一SQL做integer→boolean→integer→boolean，4次完整契约均正确。夹具改为只持有非空真实快照，并等待真实Boolean契约与界面同时满足；全量179场景重新验证。没有修改生产代码来规避这一夹具失败。

第二次Native推进至135场景/2695断言后，旧夹具以“返回完成数”断言“没有发起目录请求”，把恢复前发起、恢复后取消完成的请求计成了新请求。现在另设调用入口计数来检查目录授权，语义计数则仅接受当前交互/配置下的非空快照；新版WHERE版本夹具也使用同样口径。第二次完整现场与原宿主哈希保留。这是对调用和完成两个时间点的区分，没有放宽禁止新目录请求的断言。

第三次推进至137场景/2708断言时，另一处旧等待仍把过期/取消观测当作当前宽泛IS契约。现在两套WHERE夹具都在触发输入与配置发布时更新观测revision，仅当前非空快照能完成语义等待；调用入口仍无条件统计，持有的旧非空回包仍原样交还生产session检验UI防护，不会被测试包装器截断。第三份现场也保留。

本轮发布SHA 5655cbee4e7bc0dbe481e2ad430ae2a149e04402cbf2a84c49c3e88c2aa8cd4f。证据为 .impeccable/review/lsp-pattern-capabilities-evidence.json 与 final-verification.json，包含源码/输入、发布协议、两个实际测试宿主及历史失败证据哈希。没有缓存删除或压缩维护；保留已有归档与浏览器profile。未提交、推送或发布。原范围全部保留，仍有上表差距，目标未完成。
