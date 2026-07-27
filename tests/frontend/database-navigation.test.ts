import { afterEach, describe, expect, it } from "vitest";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  requestDatabaseObjectReveal,
  requestDatabaseSchemaReveal,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";

describe("database navigation targets", () => {
  afterEach(() => {
    useDatabaseNavigationStore.setState({ revealRequest: null });
  });

  it("preserves an exact schema target without inventing an object", () => {
    const id = requestDatabaseSchemaReveal({
      projectId: "project-a",
      connectionId: "postgres-a",
      databaseName: "analytics",
      schemaName: "sales ops",
    });

    expect(useDatabaseNavigationStore.getState().revealRequest).toEqual({
      id,
      target: {
        projectId: "project-a",
        connectionId: "postgres-a",
        databaseName: "analytics",
        schemaName: "sales ops",
      },
    });
    expect(
      databaseSchemaNavigationKey({
        connectionId: "postgres-a",
        databaseName: "analytics",
        schemaName: "sales ops",
      }),
    ).toBe("postgres-a:analytics:sales%20ops");
  });

  it("keeps object navigation distinct from its parent schema", () => {
    requestDatabaseObjectReveal({
      projectId: "project-a",
      connectionId: "postgres-a",
      databaseName: "analytics",
      schemaName: "public",
      objectType: "table",
      objectName: "daily revenue",
    });

    expect(useDatabaseNavigationStore.getState().revealRequest?.target).toEqual(
      expect.objectContaining({
        schemaName: "public",
        objectName: "daily revenue",
      }),
    );
    expect(
      databaseObjectNavigationKey({
        connectionId: "postgres-a",
        databaseName: "analytics",
        schemaName: "public",
        objectName: "daily revenue",
      }),
    ).toBe("postgres-a:analytics:public:daily%20revenue");
  });
});
