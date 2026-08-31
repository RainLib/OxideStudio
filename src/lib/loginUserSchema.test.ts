import { describe, expect, it } from "vitest";
import { isLoginUserSchema } from "./loginUserSchema";

describe("isLoginUserSchema", () => {
  it("matches Oracle-family login schemas case-insensitively", () => {
    expect(isLoginUserSchema({ driver: "oracle", user: "test01" }, "TEST01")).toBe(true);
    expect(isLoginUserSchema({ driver: "dameng", user: "APP" }, "app")).toBe(true);
    expect(
      isLoginUserSchema(
        { driver: "oceanbase-oracle", user: "tenant_admin" },
        "TENANT_ADMIN",
      ),
    ).toBe(true);
  });

  it("does not infer user schemas for other database families", () => {
    expect(isLoginUserSchema({ driver: "postgres", user: "public" }, "public")).toBe(false);
    expect(isLoginUserSchema({ driver: "mysql", user: "app" }, "app")).toBe(false);
    expect(isLoginUserSchema({ driver: "oracle", user: "" }, "SYSTEM")).toBe(false);
  });
});
