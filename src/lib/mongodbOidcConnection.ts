/** MongoDB OIDC URL handling shared by the connection form and tests. */

function queryValue(url: URL, key: string) {
  const expected = key.toLocaleLowerCase();
  for (const [candidate, value] of url.searchParams) {
    if (candidate.toLocaleLowerCase() === expected) return value;
  }
  return "";
}

function removeQueryKeys(url: URL, keys: readonly string[]) {
  const expected = new Set(keys.map((key) => key.toLocaleLowerCase()));
  for (const key of [...url.searchParams.keys()]) {
    if (expected.has(key.toLocaleLowerCase())) url.searchParams.delete(key);
  }
}

export function mongoConnectionUsesOidc(value: string) {
  try {
    return queryValue(new URL(value), "authMechanism").toLocaleUpperCase() === "MONGODB-OIDC";
  } catch {
    return false;
  }
}

/**
 * Enables the only interactive MongoDB OIDC configuration accepted by the
 * native driver.  Credentials are removed from the URL rather than silently
 * retained alongside a token-based authentication mechanism.
 */
export function setMongoConnectionOidc(value: string, enabled: boolean) {
  try {
    const url = new URL(value);
    removeQueryKeys(url, ["authMechanism"]);
    if (enabled) {
      url.username = "";
      url.password = "";
      removeQueryKeys(url, ["authSource"]);
      url.searchParams.set("authMechanism", "MONGODB-OIDC");
      url.searchParams.set("authSource", "$external");
    } else if (queryValue(url, "authSource") === "$external") {
      removeQueryKeys(url, ["authSource"]);
    }
    return url.toString();
  } catch {
    return value;
  }
}
