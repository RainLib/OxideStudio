# Production Kubernetes baseline

These manifests are a production **baseline**, not a one-command replacement
for the local `compose.yaml` topology. Apply them only after replacing image
digests, DNS names, namespace selectors, database service selectors, and the
Gateway exposure model for the target cluster.

## Secret boundary

No database URL, signing seed, SIEM token, device private key, Gateway
enrollment token, or database credential belongs in a ConfigMap or a manifest
committed to source control.

- Mount control-plane secrets through a Kubernetes Secret, CSI provider, or
  Vault Agent at `/var/run/secrets/oxide`.
- Mount Gateway mTLS/enrollment material and its source configuration through
  read-only CSI/Secret volumes at the paths referenced by the Deployment.
- Keep `automountServiceAccountToken: false`. A Gateway using Vault must get a
  dedicated, minimal identity through the Vault integration; do not give it
  broad Kubernetes Secret read permissions.

## Required production changes

1. Pin every image by immutable digest and verify the GitHub build-provenance
   attestation emitted by the matching `v<desktop-version>` release before
   updating `kustomization.yaml`. The image workflow publishes both a version
   tag and a commit-SHA tag for discovery only; neither mutable tag is a
   deployment reference.
2. Replace all `example.invalid` values and the NetworkPolicy selectors with
   the real control-plane, database, Vault, Casdoor, SIEM, and ingress identities.
   Replace `REPLACE_WITH_CASDOOR_CLIENT_ID` in both `control-plane.yaml` and
   `admin-web.yaml` with the same dedicated Casdoor application Client ID. The
   browser configuration is public and belongs in the admin-web ConfigMap; a
   Casdoor Client Secret does not belong there and is not used by the PKCE
   client.
   The reference Gateway egress rule lists the standard managed-driver ports
   (PostgreSQL, MySQL, Redis, Elasticsearch, MongoDB) so every supported
   source can function; narrow it to each approved database CIDR/FQDN and port
   before production rollout.
3. Use an mTLS-capable L4 load balancer or TLS-passthrough ingress for the
   Gateway. TLS termination in front of the Gateway must preserve the original
   client certificate, otherwise ticket/device binding correctly fails closed.
   Publish the control plane through a separately managed HTTPS ingress or
   service mesh; its in-cluster Service deliberately remains HTTP-only and
   must not be exposed directly. Publish the admin-web Service through HTTPS
   and register that exact URL (including its callback path) in the Casdoor
   application's redirect URLs.
4. The control plane applies its embedded migrations on startup. For an
   operationally controlled rollout, start one maintenance replica with the
   same private database URL mount, wait for it to become ready, then scale the
   regular Deployment. Do not add an init container that lets every replica
   race a schema change.
5. Use a CNI with FQDN egress policy for external IdP/SIEM/Vault hosts. The
   portable policy permits TCP/443 only; it cannot enforce host names.

Before promotion, run `npm run enterprise:deploy:verify` with
`CASDOOR_PUBLIC_URL`, `OXIDE_CONTROL_PLANE_PUBLIC_URL`, and
`OXIDE_ADMIN_WEB_URL` pointed at the deployed HTTPS endpoints. Provide a
short-lived `OXIDE_VERIFY_ACCESS_TOKEN` and `OXIDE_VERIFY_ORGANIZATION_ID` for
the authenticated checks.

Validate with a non-production Casdoor tenant, a real private CA, a revoked device
certificate, a failed SIEM endpoint, and PostgreSQL/MySQL read-only sources
before promotion. These database/network checks remain intentionally separate
from the local logic tests.
