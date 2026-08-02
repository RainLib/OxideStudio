/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDatabaseDialog } from "@/components/workspace/CreateDatabaseDialog";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";

const mocks = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  listInstallations: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getCapabilities,
    listDatabaseDriverInstallations: mocks.listInstallations,
    createDatabase: vi.fn(),
  },
}));

vi.mock("@/services/postgresDatabaseCatalogCache", () => ({
  refreshPostgresDatabaseCatalog: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const postgresCapabilities = {
  displayName: "PostgreSQL",
  namespaceLabel: "schema",
  supportsCreateDatabase: true,
  supportsCreateDatabaseOwner: true,
  supportsCreateDatabaseCharset: false,
  supportsCreateDatabaseCollation: false,
  supportsDatabaseCatalogs: false,
};

describe("CreateDatabaseDialog driver package boundary", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCapabilities.mockResolvedValue(postgresCapabilities);
    mocks.listInstallations.mockResolvedValue([]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
    });
    useProjectStore.setState({ activeProjectId: "project-1" });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll("[data-radix-focus-guard]").forEach((node) => node.remove());
  });

  it("uses a driver request instead of Host PostgreSQL SQL when an external package is active", async () => {
    mocks.listInstallations.mockResolvedValue([
      {
        driver: "postgres",
        displayName: "Vendor PostgreSQL",
        clientLibrary: "vendor-pg",
        clientVersion: "1.0.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared",
        implementation: "Verified sidecar",
        packageVersion: "1.0.0",
        active: true,
        status: "ready",
        runtimeReady: true,
      },
    ]);

    await act(async () => {
      root.render(
        <CreateDatabaseDialog
          isOpen
          activeConnectionId="postgres-1"
          onClose={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Driver request");
      expect(document.body.textContent).toContain("does not generate Host SQL");
    });
    expect(document.body.textContent).not.toContain("CREATE SCHEMA");
  });

  it("disables creation when the active capability contract cannot be read", async () => {
    mocks.getCapabilities.mockRejectedValue(new Error("contract unavailable"));
    await act(async () => {
      root.render(
        <CreateDatabaseDialog
          isOpen
          activeConnectionId="postgres-1"
          onClose={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("could not be verified");
    });
    const createButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create Schema"),
    );
    expect(createButton?.disabled).toBe(true);
  });
});
