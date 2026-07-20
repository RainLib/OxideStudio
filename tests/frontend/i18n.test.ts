import { describe, expect, it } from "vitest";
import { resolveAppLocale, translate } from "@/i18n";

describe("application internationalization", () => {
  it("resolves supported system languages without depending on startup data", () => {
    expect(resolveAppLocale("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveAppLocale("system", "zh-TW")).toBe("zh-CN");
    expect(resolveAppLocale("system", "en-GB")).toBe("en-US");
    expect(resolveAppLocale("en-US", "zh-CN")).toBe("en-US");
  });

  it("translates stable UI keys and interpolates bounded values", () => {
    expect(translate("zh-CN", "common.settings")).toBe("设置");
    expect(
      translate("zh-CN", "assistant.process.more", { count: 3 }),
    ).toBe("另有 3 项");
    expect(
      translate("en-US", "assistant.process.more", { count: 3 }),
    ).toBe("3 more");
  });
});
