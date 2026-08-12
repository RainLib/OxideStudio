import { describe, expect, it } from "vitest";
import { isUpdateVersionIgnored } from "@/store/useUpdateStore";

describe("ignored application update versions", () => {
  it("ignores the selected version and older releases", () => {
    expect(isUpdateVersionIgnored("v1.4.2", "1.4.2")).toBe(true);
    expect(isUpdateVersionIgnored("1.4.1", "v1.4.2")).toBe(true);
    expect(isUpdateVersionIgnored("1.4.3", "1.4.2")).toBe(false);
    expect(isUpdateVersionIgnored("2.0.0", "1.99.99")).toBe(false);
  });

  it("falls back to normalized equality for non-semver versions", () => {
    expect(isUpdateVersionIgnored("vnext", "next")).toBe(true);
    expect(isUpdateVersionIgnored("nightly-2", "nightly-1")).toBe(false);
  });
});
