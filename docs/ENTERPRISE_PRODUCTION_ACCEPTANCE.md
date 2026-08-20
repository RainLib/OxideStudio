# Enterprise production acceptance

Run this checklist for each production rollout. It is deliberately separate
from unit and build checks because it needs real organization infrastructure.

- Verify each deployed image digest with its GitHub build-provenance attestation and SBOM.
- Confirm Gateway and Desktop mTLS rejects an untrusted, revoked, and rotated device certificate.
- Generate each source `targetBinding` from a private URL file; verify a ticket or resolved secret for another target is denied.
- Verify Vault/CSI secret mounts are read-only and no connection URL appears in Desktop, Control Plane, audit logs, or manifests.
- Exercise read-only PostgreSQL, MySQL, MongoDB, Elasticsearch, and Redis sources; verify mutation, DDL, export, transaction, and cross-resource requests fail closed.
- Verify NetworkPolicy permits only each registered database target and required control-plane/IdP/Vault/SIEM routes.
- Rotate a Gateway certificate and a source target binding; confirm old tickets fail and grants/data-source IDs remain intact.
