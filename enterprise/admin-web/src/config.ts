interface AdminRuntimeConfig {
  controlPlaneUrl?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
}

declare global {
  interface Window {
    __OXIDE_ENTERPRISE_CONFIG__?: AdminRuntimeConfig;
  }
}

const runtime =
  typeof window === "undefined" ? undefined : window.__OXIDE_ENTERPRISE_CONFIG__;

export const adminConfig = {
  controlPlaneUrl: (
    runtime?.controlPlaneUrl || import.meta.env.VITE_OXIDE_CONTROL_PLANE_URL || ""
  ).replace(/\/$/, ""),
  oidcIssuer: (
    runtime?.oidcIssuer || import.meta.env.VITE_OXIDE_OIDC_ISSUER || ""
  ).replace(/\/$/, ""),
  oidcClientId:
    runtime?.oidcClientId ||
    import.meta.env.VITE_OXIDE_OIDC_CLIENT_ID ||
    "oxide-enterprise-admin",
};
