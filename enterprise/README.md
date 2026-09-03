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

## Release distribution

Every desktop release tag (`v<desktop-version>`) also publishes the
Control Plane, Gateway, and Admin Web images to GitHub Container Registry.
Each image has two immutable references: the desktop version tag and the
commit-SHA tag. The release workflow emits a GitHub build-provenance
attestation and an SBOM for the resulting digest.

Production Kubernetes manifests must use the exact digest shown in that job's
summary, after verifying its attestation. Do not deploy the mutable version
tag directly and do not automatically rewrite a production overlay during a
desktop release; rollout approval remains an organization operation.

## Casdoor identity and local deployment

The control plane validates standard OIDC access tokens and uses Casdoor as the
reference identity provider. It never receives a Casdoor Client Secret: the
administration web application is a public client and uses Authorization Code
with PKCE (S256). Casdoor writes the application Client ID into the token `aud`
claim, so `CASDOOR_CLIENT_ID`, `VITE_OXIDE_OIDC_CLIENT_ID`, and
`OXIDE_OIDC_AUDIENCE` must resolve to the same value.

For the local reference environment:

1. Copy `deploy/.env.example` to `deploy/.env`. Generate the ticket signing
   seed with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
   and place the result in `OXIDE_TICKET_SIGNING_KEY_BASE64`.
2. Start only the database and Casdoor: `docker compose --env-file
   enterprise/deploy/.env -f enterprise/deploy/compose.yaml up -d postgres
   casdoor`.
3. Open `http://localhost:8000`, sign in to a fresh Casdoor installation with
   the documented bootstrap account (`built-in` / `admin` / `123`), and change
   that password immediately. Create a dedicated organization and an
   `app-oxide-enterprise-admin` application. Configure its redirect URL as
   `http://localhost:1430/`, keep only the authorization-code flow needed by
   the web application, disable public sign-up unless explicitly required, and
   choose the `JWT-Standard` token format.
4. Copy the application's Client ID into `CASDOOR_CLIENT_ID` in `deploy/.env`.
   Do not put its Client Secret in Oxide configuration.
5. Build and start the complete reference topology:

```bash
docker compose --env-file enterprise/deploy/.env \
  -f enterprise/deploy/compose.yaml up -d --build postgres casdoor control-plane admin-web
```

### Local demo data

After creating the local `hcloud` organization, load the repeatable demo data
set to exercise the administration UI with members, projects, Gateways, data
sources, resource catalog entries, managed devices, access grants, and audit
events. From the repository root on Bash:

```bash
docker compose --env-file enterprise/deploy/.env \
  -f enterprise/deploy/compose.yaml exec -T postgres \
  psql -U oxide -d oxide_enterprise < enterprise/deploy/development/seed-demo.sql
```

On PowerShell:

```powershell
Get-Content -Raw enterprise/deploy/development/seed-demo.sql |
  docker compose --env-file enterprise/deploy/.env `
    -f enterprise/deploy/compose.yaml exec -T postgres `
    psql -U oxide -d oxide_enterprise
```

The seed targets organization `386f9632-7ac7-4fd3-974c-58716b66e988` and can be
run repeatedly. Its Gateway endpoints and email addresses use the reserved
`.test` domain. Driver records cover PostgreSQL, MySQL, MongoDB,
Elasticsearch, and Redis. They contain capabilities and an opaque target
binding fingerprint, but intentionally contain no connection URL, username,
password, or Gateway secret reference.

The Compose Casdoor service is a development reference backed by the same
PostgreSQL server but a separate `casdoor` database. For production, deploy a
pinned Casdoor release independently (the official Helm chart is supported),
use HTTPS, an external production database, backups, and your normal secret
delivery mechanism. Set `OXIDE_OIDC_ISSUER` to the exact public Casdoor origin
without an application-specific suffix. The control plane uses OIDC discovery
by default; `OXIDE_OIDC_JWKS_URL` is only needed when an internal container URL
must be used for signing-key retrieval.

Run the deployment gate after the services are reachable:

```bash
npm run enterprise:deploy:verify
```

It checks Casdoor discovery, PKCE and JWKS, control-plane health, authentication
denial and CORS, plus the administration bundle, runtime endpoints, and browser
security headers. Set `OXIDE_VERIFY_ACCESS_TOKEN` to a short-lived Casdoor
access token to include the authenticated `/v1/me` check. Setting
`OXIDE_VERIFY_ORGANIZATION_ID` as well verifies that organization's admin
overview. The verifier never prints the token.

The Gateway requires an Ed25519 verification key and mutual-TLS certificate,
private key, and client CA. Registration is a proof step, not a status switch:
the administrator registers the exact SHA-256 DER fingerprint of the Gateway
leaf certificate, receives a 15-minute enrollment token exactly once, and
writes it to a private mounted file. Before opening the data-plane listener,
the Gateway sends that token, its public endpoint, and its computed certificate
fingerprint back to the control plane over HTTPS. The control plane stores only
the token digest and consumes it on success.

Generate the per-Gateway enrollment signing identity before registration, then
paste only `public_key_base64` into the administration UI. Store
`private_key_base64` in the private signing-key file shown below:

```bash
cargo run --manifest-path enterprise/Cargo.toml -p oxide-enterprise-gateway --bin enrollment-keygen
```

```text
OXIDE_GATEWAY_ID=<registered gateway UUID>
OXIDE_GATEWAY_PUBLIC_ENDPOINT=https://gateway.example.com:8790
OXIDE_CONTROL_PLANE_URL=https://control-plane.example.com
OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/secrets/oxide-gateway-enrollment
# Optional when the control plane uses a private CA:
OXIDE_CONTROL_PLANE_CA_CERTIFICATE=/run/secrets/oxide-control-plane-ca.pem
```

`OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE` must be a private regular file (mode 0600
on Unix) for the first enrollment and may be removed after a successful
activation. `OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE` remains required for
later signed identity checks and must also be private. Do not put either value
in an environment variable, deployment manifest, shell history, or source
control. A pending or expired enrollment prevents the Gateway from listening.
The environment secret provider is disabled unless
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

Every `audit_events` insert is append-only and atomically enqueued in
`audit_outbox` by the database. To deliver that durable stream to a SIEM, set a
credential-free HTTPS `OXIDE_AUDIT_WEBHOOK_URL` and put its bearer credential
only in `OXIDE_AUDIT_WEBHOOK_TOKEN_FILE`. The control plane retries failed
deliveries with bounded exponential backoff; a disabled or unavailable sink
never blocks access-policy decisions, and the undelivered events remain queued.

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
`postgres://{username}:{password}@database.internal/app?sslmode=verify-full` in
`connectionTemplate`. The token file must be a regular file and, on Unix,
must not be group/world readable. Lease duration is honored: cached drivers
are closed and recreated before the dynamic credential expires. Vault KV
payloads may instead supply a complete `connection_url`.

Gateway database URLs are independently validated after secret resolution. In
production, PostgreSQL requires `sslmode=verify-full`; MySQL requires
`ssl-mode=VERIFY_IDENTITY`. This applies both
to `connectionTemplate` and a complete URL returned by Vault or Kubernetes.
Plaintext or certificate-unverified transport is rejected by default. Local
development may opt in only when **both** the source has
`"allowInsecureTransport": true` and the Gateway process has
`OXIDE_ALLOW_INSECURE_DATABASE_TRANSPORT=true`; this is not a production
deployment option.

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
managed data source can be opened. The administrator must enroll the desktop's
reported device UUID and SHA-256 client-certificate fingerprint before access
tickets can be issued; the Gateway compares that ticket binding against the
actual peer certificate on every RPC. Certificate private keys are never sent
through the control plane. Automatic short-lived device certificate enrollment
remains a follow-up and must not be emulated by returning private keys from the
control plane.

The administration UI can create managed projects, register credential-free
Gateway routes and data-source descriptors, invite members, assign projects,
and create permit/forbid policies. Database credentials and even
Gateway-local secret references are intentionally absent from those APIs.

When registering a data source, an administrator also pastes its **target
binding**: the SHA-256 digest of the Gateway's credential-free canonical
locator (`driver|scheme|host|port|path`). Generate it on the Gateway host from
the same connection template or private secret file that the Gateway will
resolve; the command prints only the digest, never the URL:

```bash
npm run enterprise:target-binding -- \
  --driver postgres \
  --connection-url-file /run/secrets/oxide/database-url
```

Store that digest in the local `sources.json` as `targetBinding`.
The control plane signs the digest into every ticket; the Gateway checks both
its local source entry and the resolved connection URL before opening a driver.
The digest never includes a username, password, or URL query parameter.

## Security invariants

For a Kubernetes production baseline, see
[`deploy/kubernetes`](deploy/kubernetes/README.md). It is intentionally
separate from the HTTP/local-development Compose topology and requires
immutable image digests, CSI-mounted secrets, mTLS passthrough, and
cluster-specific NetworkPolicy selectors.

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
in `sources.json`. In addition to blocking new ticket issuance, the Gateway
fetches the organization's revoked device-certificate fingerprints with its
enrolled Ed25519 identity every five seconds. It will not start without that
snapshot and fails closed if it cannot refresh one for twenty seconds.
