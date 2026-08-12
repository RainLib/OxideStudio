# Enterprise identity and managed data access

OxideStudio keeps one global personal identity model. “Enterprise user” is a
membership of that personal identity in one or more organizations, not a
separate account type.

## Runtime modes

| Mode | Local projects | Managed projects | Database credentials |
| --- | --- | --- | --- |
| Anonymous | Full support | Hidden | Local credentials stay on device |
| Signed-in personal | Full support | Invitation-capable | Not uploaded |
| Organization member | Full support | Assigned projects only | Never sent to client |

Signing in does not upload, convert, or transfer ownership of local projects.
Leaving one organization does not affect local projects or other memberships.
Local connection URLs, database passwords, SSH passwords and private-key
passphrases are removed from ordinary SQLite/JSON metadata and stored as
AES-256-GCM ciphertext with project/connection-bound AAD. The device key is a
user-private `0600` file, avoiding an interactive keychain prompt in anonymous
mode. Existing plaintext records and the legacy `config.json` are migrated in
the background.

## Trust boundary

```text
Desktop / oxide-agent
  ├─ local session ───────────────> existing local database driver
  └─ managed session
       ├─ OIDC + PKCE ────────────> identity provider
       ├─ descriptor/ticket ──────> control plane
       └─ mTLS gRPC + ticket ─────> customer-network Gateway
                                      └─ SecretProvider -> database
```

The control plane stores resource descriptors and policy, but not database
credentials. The Gateway is the only service that resolves a credential and
opens the database connection. It does not expose a generic TCP tunnel.

## Data-plane decision: local direct, managed Gateway

OxideStudio deliberately uses two connection paths rather than an enterprise
mode that can silently change its trust boundary:

| Connection origin | Data path | Credential owner | Enforcement |
| --- | --- | --- | --- |
| Personal/local | Desktop directly to the database | User device | Local connection policy and database account |
| Organization-managed | Desktop to customer-network Gateway over mTLS; Gateway to database | Gateway `SecretProvider` | Control-plane ticket issuance plus Gateway re-authorization |

Organization-managed sources never fall back to a desktop-direct database
connection. A Gateway outage therefore fails closed instead of causing the
client to request or cache a password. This is the production default because
it provides immediate revocation, consistent row/byte limits, centralized
audit identity, private-network reachability, and one location for dynamic
Vault or Kubernetes credentials.

A future direct mode is acceptable only for databases that issue short-lived,
individually scoped credentials and can enforce the same object/action policy
at the database itself. It must be a separately signed transport contract,
must use OS credential protection, and must never reuse a Gateway descriptor.
That mode is not implemented or advertised today; the client rejects every
managed transport other than the Gateway path.

## Desktop behavior

The account menu is optional. Account recovery runs during browser idle time,
after the workbench is interactive. Managed projects are grouped by
organization in the project selector. They use distinct secret-free
descriptors and are never persisted through the local `SavedConnection` API.

Opening a managed PostgreSQL/MySQL source installs a `ManagedGatewayDriver`
into the existing Rust `ConnectionManager`. Explorer metadata and read-only
queries therefore reuse the normal workbench commands, while every driver
operation obtains a fresh, scoped access ticket and opens an mTLS Gateway
channel. Certificate paths are optional desktop enrollment settings normally
installed by MDM; certificate material is loaded only when a managed source is
opened and is never sent to the WebView.

Before the Explorer becomes available, Desktop performs a Gateway capability
handshake over the same mTLS channel. It rejects an incompatible contract
version, a changed policy revision, or a Gateway whose advertised data-source
capabilities no longer cover the client assignment. The UI continues to use
the narrower descriptor-derived read-only capability set, so a Gateway cannot
activate a local mutation surface by advertising an extra capability.

The live driver reports a distinct `managed` distribution and derives its UI
capabilities from the assigned descriptor. The current Gateway RPC contract
implements discovery, metadata, and bounded read-only queries, so local
mutation, DDL, migration, export, transaction, and Explain controls remain
hidden even if a future policy grant already contains those action names.
Adding a permission does not activate a feature until the Gateway and Desktop
both implement and re-authorize its exact RPC.

Refresh tokens use the operating-system credential manager. Public endpoints,
issuer and client ID are stored in the application config directory with
private file permissions. Access tokens remain in memory.

Managed project snapshots are AES-256-GCM encrypted, retained for up to seven
days, and have their decryption key deleted on sign-out. Offline mode allows
local projects and the snapshot’s metadata; it does not permit managed
queries, refresh, edit, DDL, or export.

## Authorization

The shared contract enumerates:

- `resource.discover`
- `metadata.read`
- `query.read`
- `data.write`
- `schema.ddl`
- `data.export`
- `ai.use`
- `mcp.use`

The first vertical slice implements object/action policies and bounded
read-only PostgreSQL/MySQL execution. Discovery tickets contain effective
permit scopes and explicit exclusions, so a table-level `forbid` is applied to
Explorer results and every SQL relation, including JOINs. MongoDB, Redis,
Elasticsearch, mutation, DDL, export, approval leases and external managed MCP
remain separately gated capabilities: clients must not infer them from driver
names.

Every request is checked at ticket issuance and again at the Gateway. SQL that
cannot be parsed as read-only fails closed. The same permission manifest will
be consumed by Deep Agents and `oxide-agent`; model prompts and tool arguments
can only narrow the effective scope.

## Source map

- Shared model/policy/tickets: `enterprise/contracts`
- Identity, assignments, audit and sessions: `enterprise/control-plane`
- Secret and database boundary: `enterprise/gateway`
- Organization administration: `enterprise/admin-web`
- Desktop account integration: `src-tauri/src/enterprise` and
  `src/store/useEnterpriseAccountStore.ts`
- Reference deployment: `enterprise/deploy`

## Delivery boundary

This change completes the stage-one identity and relational read-only path:
anonymous/local use, OIDC/PKCE sign-in, multi-organization membership,
invitations, project assignment, secret-free descriptors, device-encrypted
cache, administrator provisioning, object/action grants, mTLS Gateway
metadata and PostgreSQL/MySQL read-only queries.

The following plan items deliberately remain fail-closed until their own
backend implementations exist:

- DPoP-bound access tokens and automated device-certificate enrollment;
- cloud-provider `SecretProvider` implementations (Vault dynamic
  credentials/KV and mounted Kubernetes Secrets are implemented);
- Gateway policy polling/heartbeat and high availability;
- MongoDB, Redis and Elasticsearch native Gateway operations;
- mutation, transaction, DDL, export and single-use approval leases;
- managed `oxide-agent` device login, MCP and CLI;
- Arrow IPC output (the protocol value is reserved; stage one returns bounded
  JSON chunks);
- SCIM, JIT access requests, SIEM export, column masking and row policy.

These are not advertised as capabilities in a managed descriptor, and all
attempts to use them fail rather than falling back to a local connection.
