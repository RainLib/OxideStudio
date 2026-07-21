import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeRawCommand: vi.fn(),
}));

vi.mock("@/services/tauri/client", () => ({
  invokeRawCommand: mocks.invokeRawCommand,
}));

import { enterpriseService } from "@/services/tauri/enterprise.service";

describe("enterprise service boundary", () => {
  beforeEach(() => {
    mocks.invokeRawCommand.mockReset();
    mocks.invokeRawCommand.mockResolvedValue({});
  });

  it("keeps public account configuration separate from credentials", async () => {
    const config = {
      controlPlaneUrl: "https://oxide.example.com",
      oidcIssuer: "https://identity.example.com/realms/acme",
      oidcClientId: "oxide-studio-desktop",
    };
    await enterpriseService.configure(config);
    expect(mocks.invokeRawCommand).toHaveBeenCalledWith(
      "enterprise_configure_account",
      { config },
    );
    expect(JSON.stringify(mocks.invokeRawCommand.mock.calls)).not.toMatch(
      /password|secret|refreshToken|accessToken/i,
    );
  });

  it("only sends a secret-free descriptor when connecting a managed source", async () => {
    const descriptor = {
      organizationId: "organization-id",
      projectId: "project-id",
      dataSourceId: "source-id",
      gatewayId: "gateway-id",
      driver: "postgres" as const,
      displayName: "Analytics",
      capabilities: ["resource.discover", "metadata.read", "query.read"],
      allowedResourceSummary: ["warehouse/public/orders"],
      policyRevision: "policy-7",
    };
    await enterpriseService.connectManagedSource("source-id", descriptor);
    expect(mocks.invokeRawCommand).toHaveBeenCalledWith(
      "enterprise_connect_managed_source",
      { connectionId: "source-id", descriptor },
    );
    expect(JSON.stringify(mocks.invokeRawCommand.mock.calls)).not.toMatch(
      /password|secretRef|connectionUrl|privateKey/i,
    );
  });
});
