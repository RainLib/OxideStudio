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
| 设备身份绑定 | ticket 只有客户端提交的 `device_id`；Gateway mTLS 未把客户端证书指纹绑定到 ticket | 被窃取的短期 ticket 在有效期内缺乏设备证明 | 增加设备注册/撤销记录，在 ticket 中写入证书指纹，Gateway 从 TLS peer certificate 计算并比较。 |
| Gateway 注册与激活证明 | 管理员可将 pending Gateway 标为 active；没有 registration token 或 Gateway proof | 端点/证书配置错误可能被激活 | 加入一次性注册 token、Gateway challenge/proof、证书 serial/fingerprint 校验和 last-seen health gate。 |
| 票据撤销 | 数据库有 `revoked_access_nonces`，但 control plane/Gateway 未使用 | 60 秒 TTL 内无法紧急撤销已签发票据 | 实现按 nonce、设备、用户、gateway 的撤销分发；数据面要有低延迟 deny cache。 |
| 管理操作审计 | 组织、项目、Gateway、数据源、grant、成员邀请和项目分配已与 `audit_events` 同一数据库事务落库；尚未有 outbox/SIEM 投递或数据库级 append-only 权限 | 本地可追责，但无法证明外部留存与不可篡改 | 增加 append-only DB role、transactional outbox、SIEM 投递与失败重试。 |
| 生产部署保护 | compose 明确为开发配置；没有生产 Helm/secret policy/NetworkPolicy | 运维人员可能把环境变量 secret 或 HTTP compose 用于生产 | 提供生产 deployment 模板、admission checks、secret provider allowlist、egress/ingress NetworkPolicy。 |

### P1：规模化与可运维性

| 缺口 | 下一步 |
| --- | --- |
| OIDC JWKS rotation | 对未知 key id 实现单飞刷新、TTL 缓存和审计；当前启动时只拉取一次 JWKS。 |
| 身份生命周期 | 增加 SCIM/JIT、group sync、停用传播及审计；目前 principal kind 已预留 user/group，但没有企业目录同步。 |
| 数据面 HA | 控制面 policy revision heartbeat、Gateway health、负载均衡和故障域策略。 |
| 数据治理 | 行/列级 policy、字段掩码、分类标签、查询指纹与 SIEM 事件。 |
| managed engine 覆盖 | MongoDB、Elasticsearch、Redis 的受限 Gateway adapter 需分别实现协议级范围校验；不可复用 SQL parser 假装支持。 |
| 分发运营 | 企业私有 channel、设备/版本合规报告、强制最低版本、回滚策略和更新签名 key rotation drill。 |

## 生产运行约束

1. control plane、OIDC issuer 和 Gateway endpoint 必须为 HTTPS，Gateway endpoint 不得含凭据。
2. 数据库 secret 只能在客户网络 Gateway 的 Vault/Kubernetes provider 内解析；`OXIDE_ALLOW_ENVIRONMENT_SECRETS=true` 仅可用于受控开发环境。
3. 管理员创建 source 后应先通过 Gateway registration proof 再激活；在该机制完成前，生产变更必须走人工双人复核。
4. 未分类/生产数据库上的 AI mutation 保持禁用；企业 managed Gateway 当前更严格，仅支持只读能力。
5. 发布不可覆盖既有 version 目录；应用更新和 driver release 均应使用专用、最小权限的签名与 OSS 凭据。

## 验收与延后验证

当前可本地验证：contracts/Gateway 单元测试、control plane API 输入拒绝、release manifest/签名检查、desktop managed driver 不暴露写入能力。

必须在企业环境后置验证：真实 OIDC/JWKS rotation、Vault/Kubernetes secret provider、mTLS 证书轮换与设备撤销、NetworkPolicy、SIEM/outbox、PostgreSQL/MySQL 受限查询以及未来 MongoDB/Elasticsearch Gateway adapter。真实数据库验证不会在控制逻辑完成前提前执行。
