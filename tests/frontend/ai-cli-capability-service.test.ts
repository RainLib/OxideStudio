import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/services/tauri/client", () => ({
  invokeWithInterceptors: mocks.invoke,
}));

import { aiService, type AiCliProviderConfig } from "@/services/tauri/ai.service";

const CONFIG: AiCliProviderConfig = {
  kind: "codebuddy-cli",
  profileId: "codebuddy-cli:default",
  executablePath: "/opt/codebuddy",
  model: "hy-3",
  environmentKeys: ["HTTPS_PROXY"],
};

describe("AI CLI capability service cache options", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue([]);
  });

  it("forwards version and forced refresh to all capability commands", async () => {
    const options = {
      runtimeVersion: "codebuddy 2.0.0",
      forceRefresh: true,
    };

    await aiService.listCliModels(CONFIG, options);
    await aiService.listCliCommands(CONFIG, options);
    await aiService.listCliEfforts(CONFIG, options);

    expect(mocks.invoke.mock.calls).toEqual([
      [
        "ai_cli_list_models",
        { config: CONFIG, runtimeVersion: options.runtimeVersion, forceRefresh: true },
      ],
      [
        "ai_cli_list_commands",
        { config: CONFIG, runtimeVersion: options.runtimeVersion, forceRefresh: true },
      ],
      [
        "ai_cli_list_efforts",
        { config: CONFIG, runtimeVersion: options.runtimeVersion, forceRefresh: true },
      ],
    ]);
  });
});
