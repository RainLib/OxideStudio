import { adminConfig } from "./config";

const issuer = adminConfig.oidcIssuer;
const clientId = adminConfig.oidcClientId;
const accessTokenKey = "oxide.enterprise.admin.access-token";
const verifierKey = "oxide.enterprise.admin.pkce-verifier";
const stateKey = "oxide.enterprise.admin.oauth-state";
const organizationKey = "oxide.enterprise.admin.organization";

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function discovery(): Promise<Discovery> {
  if (!issuer) throw new Error("The admin OIDC issuer is not configured.");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("The identity provider is unavailable.");
  return response.json() as Promise<Discovery>;
}

function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

export const adminAuth = {
  accessToken: () => sessionStorage.getItem(accessTokenKey),
  organizationId: () =>
    new URLSearchParams(window.location.search).get("organization") ||
    sessionStorage.getItem(organizationKey) ||
    "",

  signIn: async () => {
    const metadata = await discovery();
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = base64Url(verifierBytes);
    const challenge = base64Url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      ),
    );
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem(verifierKey, verifier);
    sessionStorage.setItem(stateKey, state);
    sessionStorage.setItem(organizationKey, organizationFromUrl());
    const target = new URL(metadata.authorization_endpoint);
    target.searchParams.set("client_id", clientId);
    target.searchParams.set("redirect_uri", redirectUri());
    target.searchParams.set("response_type", "code");
    target.searchParams.set("scope", "openid profile email");
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "S256");
    window.location.assign(target);
  },

  completeCallback: async () => {
    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    if (!code) return false;
    const returnedState = parameters.get("state");
    const expectedState = sessionStorage.getItem(stateKey);
    const verifier = sessionStorage.getItem(verifierKey);
    if (!returnedState || returnedState !== expectedState || !verifier) {
      throw new Error("The sign-in callback could not be verified.");
    }
    const metadata = await discovery();
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri(),
        code,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error("The identity provider rejected sign-in.");
    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new Error("The identity provider did not return an access token.");
    }
    sessionStorage.setItem(accessTokenKey, token.access_token);
    sessionStorage.removeItem(verifierKey);
    sessionStorage.removeItem(stateKey);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?organization=${encodeURIComponent(organizationFromUrl())}`,
    );
    return true;
  },

  signOut: () => {
    sessionStorage.removeItem(accessTokenKey);
    window.location.reload();
  },
};

function organizationFromUrl() {
  return (
    new URLSearchParams(window.location.search).get("organization") ||
    sessionStorage.getItem(organizationKey) ||
    ""
  );
}
