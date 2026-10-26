# 托管 PostgreSQL 表定义与逐表权限

DDL 查看使用 `metadata.read`，数据编辑使用 `data.write`，列结构修改使用 `schema.ddl`。三个动作独立授权。管理端 Access policies 的路径按数据库、Schema、表逐段填写，例如 `oxide_studio_validation/validation/adapter_notes`。默认拒绝；显式 forbid 优先于 permit。

## 服务配置

Gateway 的 PostgreSQL 数据源需要在 `capabilities` 中显式启用相应动作：

```json
"capabilities": ["resource.discover", "metadata.read", "query.read", "data.write", "schema.ddl"]
```

这表示服务实现了相应能力，不等于给所有用户授权。Control Plane 中仍需要逐用户或用户组配置 grant；数据库角色还需要对应的原生权限。数据库 URL、密码和证书私钥仅保存在服务端私有文件中。

原有只读数据源可以继续使用前三项能力。客户端同时检查服务端协商的 `sql.mutation.postgres.v1` 和具体表的实时授权；未加载、请求失败或切换表时，编辑入口默认关闭。每次实际写入仍重新申请绑定具体表的票据，并由 Gateway 再次核对。

## hs_test 验证矩阵

隔离测试库为 `oxide_studio_validation`，Schema 为 `validation`。权限测试使用独立数据源和 `oxide_studio_gateway_editor` 角色，原有只读数据源与生产 PostgreSQL 实例配置保持独立。

| 表 | 查询与 DDL 查看 | 数据编辑 | 列结构修改 |
| --- | --- | --- | --- |
| adapter、products 等普通样例表 | 允许 | 拒绝 | 拒绝 |
| adapter_notes | 允许 | 允许 | 拒绝 |
| schema_sandbox | 允许 | 拒绝 | 允许 |
| restricted_records | 显式禁止 | 禁止 | 禁止 |

数据库角色只在 `adapter_notes` 获得 INSERT、UPDATE、DELETE 和对应 identity 序列权限；只拥有 `schema_sandbox`，用于测试列结构变更。它没有创建数据库、创建角色、超级用户、绕过 RLS 或 Schema CREATE 权限。

客户端打开表后，可在 DDL 标签查看表定义。元数据权限必须覆盖完整表；只允许部分列或显式排除某列时，不返回完整 DDL。表定义保留列类型、默认值、identity/generated 语义、约束、索引和注释；分区、继承和外部表等不在此接口的普通表定义范围内。

在权限测试数据源中，`adapter_notes` 的网格可编辑，`schema_sandbox` 的 Edit Columns 可修改列。无对应权限时，列信息仍可查看，修改按钮关闭。

## 当前写入边界

- 支持 PostgreSQL 单表 INSERT、UPDATE、DELETE；SQL 编辑器写语句不包含 RETURNING。
- 网格使用类型化参数，最多 100 条语句组成同一张表的原子批次；桌面票据默认最多影响 500 行，超过后回滚。
- 支持审核过的 ALTER TABLE 列与约束操作；GUI 开放新增、删除、重命名、修改列。整表创建、删除、重命名，以及 CASCADE、权限变更、存储过程和任意函数不在此范围内。
- 继承表、分区表、视图和跨表写入不进入此写入通道；每次执行在事务内锁定并核对具体普通表。
- 事务使用 15 秒语句超时和 2 秒锁等待限制，提交前再次检查票据有效期及设备、票据撤销状态。调用方断开后仍由服务端任务负责事务结束；客户端不自动重试结果未知的写入。

## 回归验证

单元测试覆盖：SQL 动作分类、跨表引用、表级和列内外键、动态目标、危险函数、大小写与带引号标识符、完整 DDL 授权、禁止项优先，以及切换表和权限请求失败时的界面状态。

真实环境验收还应执行：查看 identity/JSON/索引/视图 DDL、允许表的增删改、未授权表的数据和结构修改拒绝、超限回滚、类型化参数与分页筛选、临时列新增/重命名/删除，以及测试后样例行数恢复。最终验收结果记录在本次部署交付记录中。
