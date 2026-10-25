# 后端部署与完整流程验证

OxideStudio 的 SQL 编辑、LSP 和个人数据库连接由桌面内的 Tauri/Rust 后端运行。验证这些能力只需运行桌面程序。以下部署用于企业流程：登录、组织和项目授权、设备登记、票据签发、Gateway 访问数据库及审计。

## 服务和配置

| 组件 | 本地端口 | 必须配置的内容 |
| --- | --- | --- |
| PostgreSQL | Compose 内部 5432 | `POSTGRES_PASSWORD`；持久卷保存企业数据和独立的 Casdoor 数据库 |
| Casdoor | 8000 | `CASDOOR_PUBLIC_URL`、应用 `CASDOOR_CLIENT_ID`、Authorization Code + PKCE S256、JWT-Standard、回调地址 |
| Control Plane | 8787 | 数据库地址、OIDC issuer/audience、票据 Ed25519 签名种子、允许的管理网页来源 |
| Admin Web | 1430 | `OXIDE_ADMIN_WEB_URL`、`OXIDE_CONTROL_PLANE_PUBLIC_URL`、相同的 issuer 和 Client ID |
| Gateway | 8790 | Gateway ID、Control Plane 地址及验签公钥、服务端证书/私钥/客户端 CA、登记身份、数据源配置和凭据提供器 |
| 桌面客户端 | 本机 | Control Plane URL、OIDC issuer/Client ID、Gateway CA、设备客户端证书/私钥和已登记的设备 ID |

配置模板是 [enterprise/deploy/.env.example](../enterprise/deploy/.env.example)。Casdoor Client ID 必须与 Control Plane 的 `OXIDE_OIDC_AUDIENCE` 和 Admin Web 的 `VITE_OXIDE_OIDC_CLIENT_ID` 相同。网页采用 public client，不向网页或 Control Plane 配置 Casdoor Client Secret。

票据签名种子 `OXIDE_TICKET_SIGNING_KEY_BASE64` 是 32 字节随机值的 Base64；Gateway 的 `OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64` 是该 Ed25519 身份的原始 32 字节公钥的 Base64，不能使用另一份随机值，也不能使用 Gateway 的登记公钥代替。私钥和数据库凭据只存放在未提交的配置或挂载密钥文件中。

## 本机联调步骤

需要 Docker Engine/Compose、项目 Node.js 依赖和可用网络。证书初始化优先调用本机 OpenSSL；不可用时脚本使用 Docker OpenSSL 镜像。以下 PowerShell 命令在仓库根目录执行，统一使用与初始化脚本相同的 Compose 项目名。

1. 首次创建 `enterprise/deploy/.env`，从示例填入上述配置；已有文件时直接编辑，保留现有配置。先准备 PostgreSQL 密码和票据签名身份。

   可在自己的终端生成配对的票据身份，将输出分别填入 `.env`，不要把输出提交或粘贴到工单：

   ```powershell
   node -e "const c=require('node:crypto'); const k=c.generateKeyPairSync('ed25519'); const b=v=>Buffer.from(v,'base64url').toString('base64'); console.log('OXIDE_TICKET_SIGNING_KEY_BASE64='+b(k.privateKey.export({format:'jwk'}).d)); console.log('OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64='+b(k.publicKey.export({format:'jwk'}).x));"
   ```

2. 启动身份服务和数据库：

   ```powershell
   docker compose -p oxide-enterprise-local --env-file enterprise/deploy/.env -f enterprise/deploy/compose.yaml up -d postgres casdoor
   ```

3. 打开 `http://localhost:8000`，完成 Casdoor 管理员初始化并修改初始密码，创建专用组织和应用。管理网页回调配置为 `http://localhost:1430/`。桌面还使用 `http://127.0.0.1:<运行时端口>/callback`，应确认身份服务允许该桌面 loopback 回调；只配置网页回调不能覆盖桌面登录。将应用 Client ID 填回 `.env`。
4. 构建并启动应用服务：

   ```powershell
   docker compose -p oxide-enterprise-local --env-file enterprise/deploy/.env -f enterprise/deploy/compose.yaml up -d --build postgres casdoor control-plane admin-web
   ```

5. 打开 `http://localhost:1430` 登录，创建企业组织并记录其 UUID；在桌面账户设置填写相同身份服务/API/Client ID 并登录。
6. 为该组织初始化本地 Gateway、设备证书、只读授权和真实 PostgreSQL 数据源：

   ```powershell
   npm run enterprise:local:bootstrap -- --organization-id <实际组织UUID>
   npm run enterprise:deploy:verify
   ```

   若省略组织参数，脚本使用固定演示组织 `386f9632-7ac7-4fd3-974c-58716b66e988`，该组织必须事先存在且有有效 owner。脚本修改本机企业账户配置，并把开发证书和 Gateway 私有配置写入忽略目录 `enterprise/deploy/.local-runtime`。它仅用于本机 Compose 联调。
7. 在桌面刷新项目，打开 `Local Enterprise PostgreSQL`，验证资源发现、元数据、复杂只读查询、授权拒绝和审计。演示 seed 中的 `.test` Gateway 地址不可用于查询链路。

`enterprise:deploy:verify` 检查身份发现、PKCE/JWKS、API 健康、匿名拒绝、CORS 和管理网页安全配置。设置短期 `OXIDE_VERIFY_ACCESS_TOKEN` 可增加 `/v1/me` 检查，同时设置 `OXIDE_VERIFY_ORGANIZATION_ID` 可增加组织管理检查；它不能替代第 7 步的实际桌面查询验证。

## 远程验证环境

远程主机需要分别可达的身份服务、API、管理网页 HTTPS 地址，以及桌面能够访问的 Gateway gRPC/mTLS 地址。`localhost` 始终指向正在运行浏览器或桌面的那台机器，不能直接复制本机配置到远程服务器。Admin Web 的地址配置由 Docker 构建参数生成，使用 Compose 更改这些地址后需要重新构建 Admin Web。

- 配置真实域名、HTTPS 证书、OIDC 精确 issuer、回调 URL 和 `OXIDE_ALLOWED_ORIGINS`。
- Gateway 必须保留原始客户端证书，使用 L4 负载均衡或 TLS passthrough；普通 HTTPS 终止反向代理不能直接替代这一链路。
- 准备 Gateway 服务端身份、设备客户端身份、CA 信任，以及管理员登记的证书指纹、Gateway 公钥和首次登记 token 私有文件。
- Gateway 的 `sources.json` 配置数据源 UUID、driver、`targetBinding` 和 `secretRef`；与管理端的数据源和票据绑定一致。真实数据库的只读账号和网络连通性也必须就绪。
- 生产凭据提供器使用 Vault 或挂载 Kubernetes Secret。PostgreSQL 要求 `sslmode=verify-full`，MySQL 要求 `ssl-mode=VERIFY_IDENTITY`。
- Control Plane 使用 `DATABASE_URL_FILE` 和 `OXIDE_TICKET_SIGNING_KEY_BASE64_FILE` 挂载私密文件；规划 PostgreSQL 持久化、备份和升级。服务启动时执行内嵌迁移，多副本升级先由一个维护副本完成迁移。

本机 Compose 包含 HTTP、环境凭据和开发数据库传输开关，不应原样公开到远程环境。生产部署基线、镜像 digest 和网络策略见 [Kubernetes 部署说明](../enterprise/deploy/kubernetes/README.md)；完整变量和登记流程见 [Enterprise README](../enterprise/README.md)。可选 SIEM 使用 `OXIDE_AUDIT_WEBHOOK_URL` 和私有 `OXIDE_AUDIT_WEBHOOK_TOKEN_FILE`。

本文仅说明仓库现有部署路径；发布前单元测试和 CI 通过并不等于某个远程环境已完成部署或网络验收。
