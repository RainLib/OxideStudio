import { describe, expect, it } from "vitest";
import { mongoConnectionUsesOidc, setMongoConnectionOidc } from "./mongodbOidcConnection";

describe("MongoDB OIDC connection options", () => {
  it("enables native OIDC with the required external authentication source", () => {
    const value = setMongoConnectionOidc(
      "mongodb://alice:secret@localhost:27017/app?replicaSet=rs0",
      true,
    );
    const url = new URL(value);
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.searchParams.get("authMechanism")).toBe("MONGODB-OIDC");
    expect(url.searchParams.get("authSource")).toBe("$external");
    expect(mongoConnectionUsesOidc(value)).toBe(true);
  });

  it("removes only OIDC-owned parameters when disabled", () => {
    const value = setMongoConnectionOidc(
      "mongodb://localhost/app?authMechanism=MONGODB-OIDC&authSource=%24external&replicaSet=rs0",
      false,
    );
    const url = new URL(value);
    expect(url.searchParams.get("authMechanism")).toBeNull();
    expect(url.searchParams.get("authSource")).toBeNull();
    expect(url.searchParams.get("replicaSet")).toBe("rs0");
  });
});
