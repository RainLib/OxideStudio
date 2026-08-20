# OxideStudio Enterprise

This workspace contains the enterprise identity and data-access boundary. It
does not replace anonymous/local mode in the desktop application.

## Components

- `contracts`: secret-free DTOs, Cedar authorization adapter, and signed
  60-second access tickets.
- `control-plane`: OIDC-authenticated Axum API for identities, memberships,
  managed projects, grants, audit records, and ticket issuance.
- `gateway`: customer-network gRPC data plane. It validates every ticket,
  resolves credentials through a Gateway-local `SecretProvider`, re-validates
  read-only SQL, and bounds every response.
- `admin-web`: browser OIDC/PKCE administration UI.
- `deploy`: reference containers and local integration topology.

The desktop receives neither database credentials nor Gateway secret
references. `data_sources` intentionally has no credential column.

Managed data access always uses the Gateway data plane. Desktop-direct access
is reserved for personal/local connections and is never used as a fallback for
an organization descriptor. See `docs/ENTERPRISE_IDENTITY_AND_ACCESS.md` for
the transport decision and the requirements for any future short-lived direct
credential mode.

## Development

```bash
cargo test --manifest-path enterprise/Cargo.toml --workspace
npm run enterprise:admin:build
```

Copy `deploy/.env.example` to `deploy/.env`, configure a Keycloak realm and
clients, then start the control-plane reference environment:

```bash
docker compose --env-file enterprise/deploy/.env \
  -f enterprise/deploy/compose.yaml up postgres keycloak control-plane admin-web
```

The Gateway requires an Ed25519 verification key and mutual-TLS certificate,
private key, and client CA. The environment secret provider is disabled unless
`OXIDE_ALLOW_ENVIRONMENT_SECRETS=true`; it exists only for local integration.
Production deployments must provide a Vault/cloud/Kubernetes
`SecretProvider`.

The control plane also accepts `DATABASE_URL_FILE` and
`OXIDE_TICKET_SIGNING_KEY_BASE64_FILE`. Each points to one private, regular
mounted file (Unix permissions must exclude group/other reads); it is an error
to set either file variable and its inline secret variable together. This is
the production path for Kubernetes Secret, Vault Agent, or equivalent mounted
secret delivery. The inline variables remain available only for the local
reference topology.

Vault is implemented as the first production provider. It reads its token from
a private mounted file rather than an environment variable:

```text
OXIDE_SECRET_PROVIDER=vault
OXIDE_VAULT_ADDRESS=https://vault.internal
OXIDE_VAULT_TOKEN_FILE=/run/secrets/oxide-vault-token
OXIDE_VAULT_NAMESPACE=optional-enterprise-namespace
```

Use `secretRef: "vault:database/creds/oxide-readonly"` for Vault database
dynamic credentials and place a Gateway-local template such as
`postgres://{username}:{password}@database.internal/app` in
`connectionTemplate`. The token file must be a regular file and, on Unix,
must not be group/world readable. Lease duration is honored: cached drivers
are closed and recreated before the dynamic credential expires. Vault KV
payloads may instead supply a complete `connection_url`.

Mounted Kubernetes Secrets are also supported without granting the Gateway
Kubernetes API credentials:

```text
OXIDE_SECRET_PROVIDER=kubernetes
OXIDE_KUBERNETES_SECRET_DIRECTORY=/var/run/secrets/oxide-data-sources
```

Each Gateway-local `secretRef` uses `k8s:<file-name>`, and the mounted file
contains one complete connection URL. Names cannot contain path separators or
traversal segments, and files are size/type checked before use.

The desktop’s enterprise account settings accept three optional,
organization-installed paths: Gateway CA certificate, device client
certificate, and device private key. All three are required together before a
managed data source can be opened. This is the stage-one enrollment mechanism;
automatic short-lived device certificate enrollment remains a follow-up and
must not be emulated by returning private keys from the control plane.

The administration UI can create managed projects, register credential-free
Gateway routes and data-source descriptors, invite members, assign projects,
and create permit/forbid policies. Database credentials and even
Gateway-local secret references are intentionally absent from those APIs.

## Security invariants

- Unknown or stale policy defaults to deny.
- Cedar `forbid` overrides `permit`.
- Gateway RPCs determine the action; callers cannot promote it in input.
- Tickets are scoped to user, device, organization, project, source, action,
  resource path, policy revision, audience, nonce, expiry, row limit, and byte
  limit.
- Managed descriptors are validated before serialization and reject
  credential-like fields.
- Enterprise synchronization and account recovery are deferred and cannot
  block the local workbench.

The Gateway trusts only current, signed 60-second tickets. It does not accept a
client-supplied policy revision or keep a manually synchronized policy number
in `sources.json`; revocation stops new ticket issuance immediately and any
already issued ticket expires within the acceptance window.
