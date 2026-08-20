# 企业管理、分发与数据库连接安全基线

本文以当前仓库的 enterprise control plane、customer-network Gateway、桌面端 managed driver 和发布工作流为基线。它区分已经由代码强制执行的边界、待实施的控制，以及需要在真实企业环境验证的项目；不能把文档或管理界面存在视为生产保证。

## 已实施的信任边界

| 链路 | 当前强制措施 | 结论 |
| --- | --- | --- |
| 桌面端 → 控制面 | OIDC Authorization Code + PKCE、HTTPS-only 配置、加密本地缓存与系统密钥环 refresh token | 桌面端不保存 managed datasource 的数据库凭据。 |
| 控制面 → 桌面端 | secret-free project descriptor；拒绝 URL、password、secret、private key 等凭据特征 | 项目同步不能把数据库连接串带回客户端。 |
| 桌面端 → Gateway | mTLS 证书/私钥/CA 三件套同时配置；短时 Ed25519 签名 access ticket | Gateway 在客户网络内，控制面不保存数据库 secret。 |
| Gateway → 数据库 | Gateway-local secret provider、按 source 连接池、只读 SQL 解析、路径授权、行数/字节数上限 | 用户票据和 policy scope 会在数据面再次校验。 |
| 本地连接与 managed 连接 | local driver 与 managed Gateway driver 分离；managed driver 不提供 mutation、DDL、export、transaction 等桌面能力 | 禁止 managed project 静默回落为本地直连。 |
| 桌面/驱动分发 | Tauri updater 签名、GitHub Release、可选 Aliyun OSS immutable release index；独立 driver 包使用 Minisign | 应用和独立驱动的更新完整性有独立验证链。 |

## 已落地的阶段一能力收敛

当前 Gateway RPC 只实现资源发现、元数据读取和只读 SQL 查询。为防止控制面管理界面、grant 或 descriptor 比数据面承诺得更多，当前版本统一实施以下限制：

1. `AccessAction::is_stage_one_managed_action` 只允许 `resource.discover`、`metadata.read`、`query.read`。
2. 控制面拒绝为 `data.write`、`schema.ddl`、`data.export`、`ai.use` 或 `mcp.use` 注册 managed source、创建 grant 或签发 access ticket。
3. project descriptor 只会下发当前 Gateway 实际可执⾏的三种能力，即使旧数据库中遗留了更宽的 grant。
4. Gateway source 配置拒绝重复 source ID、非 PostgreSQL/MySQL driver、空/控制字符 secret reference、缺少动态凭据占位符的 connection template，以及任何非只读能力。
5. Gateway 的 source 配置和 TLS 私钥必须是普通文件；敏感文件大小受限。在 Unix 上它们还必须禁止 group/other 读取。

这条能力收敛是安全边界，不是永久功能限制。实现 managed write/DDL/export 前，必须先新增专用 Gateway RPC、单次审批/回执、事务边界、审计和故障恢复模型；不能只开放一个 `AccessAction`。

## 未闭环风险与实施顺序

### P0：上线前必须闭环

| 缺口 | 当前状态 | 风险 | 下一步 |
| --- | --- | --- | --- |
| 设备身份绑定 | 管理员登记 organization/user/device UUID 与 mTLS 叶证书 SHA-256 指纹；控制面只为 active 记录签发 ticket，ticket 带指纹，Gateway 每个 RPC 都从 TLS peer certificate 计算并比较。管理员可从设备清单撤销活动设备，控制面立即拒绝它后续的 ticket。 | 被窃取的短期 ticket 不能在另一张客户证书上重放；撤销后的已签发 ticket 最多还能存活其 60 秒 TTL。 | 增加证书轮换 enrollment 和 control-plane 到 Gateway 的低延迟撤销 deny cache。 |
| Gateway 注册与激活证明 | 控制面登记证书 SHA-256 指纹和 Gateway 专用 Ed25519 公钥，签发 15 分钟的一次性 token（仅在创建响应中返回其明文）；Gateway 在开始监听前必须通过 HTTPS 回连，提交端点、指纹、token 的 Ed25519 签名。控制面只保存 token 摘要，成功后立刻销毁摘要并写入 Gateway 系统审计事件；后续重启只需同一私钥的空-token身份签名，并刷新 last-seen。旧的手工 Activate API 已移除，旧 Gateway 会被迁回 pending。 | token 只可用一次，且单独持有 token 或复述证书指纹均不能激活；Gateway 不会在未注册身份下开放数据平面，也可以安全重启。仍需加入持续 health/证书轮换流程。 | 加入 Gateway heartbeat、证书轮换 enrollment 与 last-seen health gate。 |
| 票据撤销 | 设备撤销已经阻止新的 ticket；数据库有 `revoked_access_nonces`，但 control plane/Gateway 尚未分发 nonce、用户或 Gateway 级撤销。 | 紧急撤销无法缩短已签发 ticket 的 60 秒上限。 | 实现按 nonce、设备、用户、gateway 的撤销分发；数据面要有低延迟 deny cache。 |
| 管理操作审计 | 组织、项目、Gateway、数据源、grant、成员邀请和项目分配已与 `audit_events` 同一数据库事务落库；尚未有 outbox/SIEM 投递或数据库级 append-only 权限 | 本地可追责，但无法证明外部留存与不可篡改 | 增加 append-only DB role、transactional outbox、SIEM 投递与失败重试。 |
| 生产部署保护 | compose 明确为开发配置；没有生产 Helm/secret policy/NetworkPolicy | 运维人员可能把环境变量 secret 或 HTTP compose 用于生产 | 提供生产 deployment 模板、admission checks、secret provider allowlist、egress/ingress NetworkPolicy。 |

设备撤销现已使用签名 Gateway 拉取 feed：Gateway 每五秒获取本组织已撤销的设备证书指纹，启动前必须取得成功快照，连续二十秒未成功刷新便拒绝数据面请求。剩余票据撤销工作是 nonce、用户、Gateway 级失效，以及大组织的增量 feed。

### P1：规模化与可运维性

| 缺口 | 下一步 |
| --- | --- |
| OIDC JWKS rotation | 已对未知 key id 实现单飞 JWKS 刷新，避免轮换后必须重启 control plane；后续补充周期性 refresh telemetry/告警。 |
| 身份生命周期 | 增加 SCIM/JIT、group sync、停用传播及审计；目前 principal kind 已预留 user/group，但没有企业目录同步。 |
| 数据面 HA | 控制面 policy revision heartbeat、Gateway health、负载均衡和故障域策略。 |
| 数据治理 | 行/列级 policy、字段掩码、分类标签、查询指纹与 SIEM 事件。 |
| managed engine 覆盖 | MongoDB、Elasticsearch、Redis 的受限 Gateway adapter 需分别实现协议级范围校验；不可复用 SQL parser 假装支持。 |
| 分发运营 | 企业私有 channel、设备/版本合规报告、强制最低版本、回滚策略和更新签名 key rotation drill。 |

## 生产运行约束

1. control plane、OIDC issuer 和 Gateway endpoint 必须为 HTTPS，Gateway endpoint 不得含凭据。
2. 数据库 secret 只能在客户网络 Gateway 的 Vault/Kubernetes provider 内解析；`OXIDE_ALLOW_ENVIRONMENT_SECRETS=true` 仅可用于受控开发环境。
3. control plane 的数据库 URL 与 ticket signing seed 在生产环境应通过私有挂载文件的 `*_FILE` 变量提供；同名内联环境变量与文件变量同时存在会拒绝启动。
4. 管理员注册 Gateway 时必须提供实际 TLS 叶证书的 SHA-256 DER 指纹及专用 Ed25519 公钥。返回的一次性 enrollment token 和匹配的 Ed25519 私钥只能写入 Gateway 的私有挂载文件；Gateway 回连签名证明成功后才会变为 active。激活后可移除 token 文件，但必须保留 Ed25519 私钥以完成重启身份证明。管理员没有手工激活入口。
5. 未分类/生产数据库上的 AI mutation 保持禁用；企业 managed Gateway 当前更严格，仅支持只读能力。
6. 发布不可覆盖既有 version 目录；应用更新和 driver release 均应使用专用、最小权限的签名与 OSS 凭据。

## 验收与延后验证

当前可本地验证：contracts/Gateway 单元测试、control plane API 输入拒绝、release manifest/签名检查、desktop managed driver 不暴露写入能力。

必须在企业环境后置验证：真实 OIDC/JWKS rotation、Vault/Kubernetes secret provider、mTLS 证书轮换与设备撤销、NetworkPolicy、SIEM/outbox、PostgreSQL/MySQL 受限查询以及未来 MongoDB/Elasticsearch Gateway adapter。真实数据库验证不会在控制逻辑完成前提前执行。
