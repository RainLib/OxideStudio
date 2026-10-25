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

## Zeabur 配置

### 服务拆分和构建

Zeabur 当前不直接部署 Compose YAML，需分别创建服务。Git 服务的构建根目录保持仓库根目录，不能缩到 `enterprise/control-plane`，否则 Dockerfile 无法复制共享的 `src-tauri` 依赖。通过 `ZBPACK_DOCKERFILE_PATH` 指定下表完整路径。[官方 Dockerfile 文档](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)

| 服务 | 镜像或 Dockerfile | 容器端口 / 入口 |
| --- | --- | --- |
| PostgreSQL | Zeabur PostgreSQL 服务，创建企业和身份服务数据库 | 内网，配置持久存储 |
| Casdoor | 已有 OIDC 服务，或参考仓库固定的 `casbin/casdoor:4.1.0` | 8000 / HTTP 服务绑定 HTTPS 域名 |
| Control Plane | `enterprise/deploy/Dockerfile.control-plane` | 8787 / HTTP 服务绑定 HTTPS 域名 |
| Admin Web | `enterprise/deploy/Dockerfile.admin-web` | 8080 / HTTP 服务绑定 HTTPS 域名 |
| Gateway | `enterprise/deploy/Dockerfile.gateway` 构建的镜像 | 8790 / TCP 转发，TLS 在 Gateway 内终止 |

例如 Control Plane 服务设置 `ZBPACK_DOCKERFILE_PATH=enterprise/deploy/Dockerfile.control-plane`。这些 Dockerfile 已声明对应端口。Control Plane 仍须设置 `OXIDE_CONTROL_PLANE_BIND=0.0.0.0:8787`，Gateway 设置 `OXIDE_GATEWAY_BIND=0.0.0.0:8790`；两者不会仅凭 `PORT` 自动切换监听地址。

Gateway 可使用自建镜像服务配置 TCP 端口；如果当前 Git 服务入口无法选择 TCP 协议，应改用镜像服务或将 Gateway 放在数据库所在的受控网络。平台的 TCP 转发可作为保持 mTLS 的部署候选路径，但本文未完成 Zeabur 实机验证。不要把 HTTP 域名绑定等同于 TLS passthrough。[官方公网与端口文档](https://zeabur.com/docs/en-US/deploy/networking/public-networking)

### Control Plane 和网页变量

以下域名都是占位符，替换为实际 Zeabur HTTPS 地址或自有域名：

```dotenv
# Control Plane 服务
OXIDE_CONTROL_PLANE_BIND=0.0.0.0:8787
OXIDE_OIDC_ISSUER=https://auth.example.com
OXIDE_OIDC_AUDIENCE=<Casdoor应用ClientID>
OXIDE_ALLOWED_ORIGINS=https://admin.example.com
DATABASE_URL_FILE=/run/secrets/oxide/database-url
OXIDE_TICKET_SIGNING_KEY_BASE64_FILE=/run/secrets/oxide/ticket-signing-key

# Admin Web 服务：Docker 构建参数，修改后重新构建
VITE_OXIDE_CONTROL_PLANE_URL=https://api.example.com
VITE_OXIDE_OIDC_ISSUER=https://auth.example.com
VITE_OXIDE_OIDC_CLIENT_ID=<同一个ClientID>
```

`database-url` 文件写入企业数据库的完整连接 URI，`ticket-signing-key` 文件写入前文生成的签名种子。文件变量和对应的 inline 变量不能同时设置。服务间可使用同项目内网主机名，但浏览器和桌面使用公网 HTTPS 地址；OIDC issuer 始终保持浏览器可见的精确身份地址。[官方内网文档](https://zeabur.com/docs/en-US/deploy/networking/private-networking)

如另行部署 Casdoor，按本仓库 Compose 的 `driverName=postgres`、独立的 `dbName=casdoor` 和 `dataSourceName` 配置数据库；使用实际数据库用户名、密码和内网地址，不能照搬 Compose 的 `postgres` 主机名。设置 `origin`、`originFrontend` 为公网身份地址，登记管理网页和桌面回调，使用 JWT-Standard 和 PKCE。

### Gateway 私有文件和身份

Gateway 除绑定地址外需要以下配置：

```dotenv
OXIDE_GATEWAY_ID=<管理端注册的UUID>
OXIDE_GATEWAY_BIND=0.0.0.0:8790
OXIDE_GATEWAY_PUBLIC_ENDPOINT=https://<TCP转发主机名>:<外部端口>
OXIDE_CONTROL_PLANE_URL=https://api.example.com
OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64=<配对票据公钥>
OXIDE_GATEWAY_SOURCES_FILE=/run/oxide/sources.json
OXIDE_GATEWAY_TLS_CERTIFICATE=/run/oxide/tls/gateway.crt
OXIDE_GATEWAY_TLS_PRIVATE_KEY=/run/oxide/tls/gateway.key
OXIDE_GATEWAY_CLIENT_CA_CERTIFICATE=/run/oxide/tls/client-ca.crt
OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE=/run/oxide/secrets/enrollment-signing-key
OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/oxide/secrets/enrollment-token
```

证书 SAN 必须覆盖实际 TCP 入口的主机名，私有 CA 要在桌面配置中受信任；公网转发端口通常不同于容器 8790。若转发地址发生变化，需同步证书、管理端路由和 `OXIDE_GATEWAY_PUBLIC_ENDPOINT`，不能假定平台分配地址永久固定。首次登记 token 有效期 15 分钟且仅显示一次；成功后可移除 token 文件，登记签名身份继续保留。

另外配置 Vault 的 `OXIDE_SECRET_PROVIDER=vault`、`OXIDE_VAULT_ADDRESS`、`OXIDE_VAULT_TOKEN_FILE`，或按现有目录文件提供器使用 `OXIDE_SECRET_PROVIDER=kubernetes` 和 `OXIDE_KUBERNETES_SECRET_DIRECTORY`，让 Gateway 读取挂载的数据库连接文件。后者不需要 Kubernetes API 凭据，文件引用为 `k8s:<文件名>`。真实数据源仍须满足证书校验、只读授权和 `targetBinding` 一致性。

Zeabur 支持配置文件挂载；模板 `configs.permission` 使用十进制，`256` 对应 `0400`。程序会拒绝组/其他用户可读的私密文件和 `sources.json`。还需验证挂载文件所有者允许镜像的 UID `65532` 读取；不能只把默认 `0644` 文件挂进去。私密内容通过平台受控配置输入，不提交到 Git 或公开模板。若当前部署方式不能满足权限和所有者要求，需调整挂载交付方式后才能启动 Gateway。[官方配置文件说明](https://zeabur.com/docs/en-US/operations/data/config-file-management) · [权限格式说明](https://zeabur.com/docs/en-US/template/template-format)

### 验证顺序

先部署 PostgreSQL 和身份服务，再部署 Control Plane（健康检查 `/healthz`）及 Admin Web。随后通过管理端完成组织、成员、项目、设备、Gateway 和数据源登记，启动 Gateway，最后在桌面填写公网 API/issuer/Client ID 和三份 mTLS 文件路径，刷新项目并查询真实数据源。不要对 Zeabur 环境运行仅用于本机的 `enterprise:local:bootstrap`。

在本机 PowerShell 中让部署验证脚本指向 Zeabur 地址：

```powershell
$env:CASDOOR_PUBLIC_URL='https://auth.example.com'
$env:OXIDE_CONTROL_PLANE_PUBLIC_URL='https://api.example.com'
$env:OXIDE_ADMIN_WEB_URL='https://admin.example.com'
$env:CASDOOR_CLIENT_ID='<实际ClientID>'
npm run enterprise:deploy:verify
```

部署门禁通过后，继续验证实际桌面登录、项目同步、查询成功、越权拒绝、撤销设备和审计。PostgreSQL 需要持久卷与备份；Zeabur 服务重启不能依赖容器临时文件保留数据。[官方持久卷文档](https://zeabur.com/docs/en-US/data-management/volumes)
