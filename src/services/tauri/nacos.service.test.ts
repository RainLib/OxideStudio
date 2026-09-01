import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import { nacosService } from "./nacos.service";

describe("Nacos reviewed configuration transfer service", () => {
  const request = {
    sourceConnectionId: "source",
    targetConnectionId: "target",
    items: [
      {
        source: { dataId: "app.yaml", group: "DEFAULT_GROUP", tenant: "dev" },
        target: { dataId: "app.yaml", group: "DEFAULT_GROUP", tenant: "staging" },
      },
    ],
    conflictPolicy: "overwrite" as const,
  };

  beforeEach(() => invokeWithInterceptors.mockReset());

  it("sends a complete immutable review request before any migration", async () => {
    invokeWithInterceptors.mockResolvedValue({ confirmationToken: "review-1" });
    await nacosService.previewConfigTransfer(request);
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "preview_nacos_config_transfer",
      { request },
    );
  });

  it("keeps the overwrite confirmation phrase separate from the reviewed token", async () => {
    invokeWithInterceptors.mockResolvedValue({ overwritten: 1 });
    await nacosService.executeConfigTransfer({
      ...request,
      confirmationToken: "review-1",
      confirmationPhrase: "OVERWRITE 1 CONFIGURATION",
    });
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "execute_nacos_config_transfer",
      {
        request: {
          ...request,
          confirmationToken: "review-1",
          confirmationPhrase: "OVERWRITE 1 CONFIGURATION",
        },
      },
    );
  });
});
