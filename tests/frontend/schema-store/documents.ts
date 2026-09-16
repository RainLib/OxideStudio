import { describe, expect, it } from "vitest";
import {
  getSchemaObjectMetadataSnapshotKey,
  mocksForTests as mocks,
  useConnectionStore,
  useSchemaStore,
} from "./harness";

describe("schema store: document and search metadata", () => {
  it("revalidates an empty cached MongoDB collection snapshot", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost:27017/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
      connectedConnectionIds: ["mongo-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "app",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: "sqls:mongo-1:mongodb:app:collections",
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "mongo-1:mongodb:app:COLLECTION_CACHE",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "mongodb" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockResolvedValueOnce([
      {
        name: "messages",
        namespace: "app",
        type: "collection",
        documentCount: 12,
      },
    ]);

    await useSchemaStore
      .getState()
      .loadCollections("mongo-1", "app", false, "", true);

    expect(mocks.getCollections).toHaveBeenCalledWith("mongo-1", "app");
    expect(useSchemaStore.getState()).toMatchObject({
      collections: [expect.objectContaining({ name: "messages" })],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
  });

  it("loads a collapsed schema for search without replacing the active schema", async () => {
    mocks.getTables.mockResolvedValueOnce([
      {
        name: "audit_log",
        schema: "audit",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getFunctions.mockResolvedValueOnce([
      {
        name: "audit_entry",
        schema: "audit",
        type: "FUNCTION",
        returnType: "void",
        parameters: [],
      },
    ]);

    const loaded = await useSchemaStore
      .getState()
      .loadSchemaObjectsForSearch("conn-1", "audit");

    expect(loaded).toBe(true);
    expect(useSchemaStore.getState().currentSchema).toBe("public");
    expect(useSchemaStore.getState().tables.map((table) => table.name)).toEqual(
      ["users"],
    );
    const snapshot =
      useSchemaStore.getState().objectSnapshots[
        getSchemaObjectMetadataSnapshotKey("conn-1", "postgres", "audit")
      ];
    expect(snapshot?.tables.map((table) => table.name)).toEqual(["audit_log"]);
    expect(snapshot?.functions.map((routine) => routine.name)).toEqual([
      "audit_entry",
    ]);
  });

  it("keeps usable collapsed search metadata when an optional catalog fails", async () => {
    mocks.getTables.mockResolvedValueOnce([
      {
        name: "audit_log",
        schema: "audit",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getFunctions.mockRejectedValueOnce(new Error("not supported"));

    expect(
      await useSchemaStore
        .getState()
        .loadSchemaObjectsForSearch("conn-1", "audit"),
    ).toBe(true);
    const snapshot =
      useSchemaStore.getState().objectSnapshots[
        getSchemaObjectMetadataSnapshotKey("conn-1", "postgres", "audit")
      ];
    expect(snapshot?.tables.map((table) => table.name)).toEqual(["audit_log"]);
    expect(snapshot?.functions).toEqual([]);
  });

  it("keeps cached MongoDB collections when background revalidation fails", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost:27017/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
      connectedConnectionIds: ["mongo-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "app",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: null,
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "mongo-1:mongodb:app:events",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION",
        name: "events",
        metadata: {
          driver: "mongodb",
          namespace: "app",
          type: "collection",
        },
        last_updated: Date.now(),
      },
      {
        id: "mongo-1:mongodb:app:COLLECTION_CACHE",
        connection_id: "mongo-1",
        parent_id: "mongo-1:mongodb:app",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "mongodb" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockRejectedValueOnce(new Error("offline"));

    await useSchemaStore
      .getState()
      .loadCollections("mongo-1", "app", false, "", true);

    expect(useSchemaStore.getState()).toMatchObject({
      collections: [expect.objectContaining({ name: "events" })],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
    });
  });

  it("revalidates cached Elasticsearch indices in the background", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "elastic-1",
          name: "Elasticsearch",
          driver: "elasticsearch",
          url: "http://localhost:9200",
          database: "default",
        },
      ],
      activeConnectionId: "elastic-1",
      connectedConnectionIds: ["elastic-1"],
      isConnected: true,
    });
    useSchemaStore.setState({
      currentSchema: "default",
      collections: [],
      collectionLoadingKey: null,
      isCollectionsLoading: false,
      lastLoadedObjectKey: "sqls:elastic-1:elasticsearch:default:collections",
    });
    mocks.getResources.mockResolvedValueOnce([
      {
        id: "elastic-1:elasticsearch:default:COLLECTION_CACHE",
        connection_id: "elastic-1",
        parent_id: "elastic-1:elasticsearch:default",
        kind: "COLLECTION_CACHE",
        name: "COLLECTION_CACHE",
        metadata: { driver: "elasticsearch" },
        last_updated: Date.now(),
      },
    ]);
    mocks.getCollections.mockResolvedValueOnce([
      {
        name: "events-2026",
        namespace: "default",
        type: "index",
        documentCount: 42,
      },
    ]);

    await useSchemaStore
      .getState()
      .loadCollections("elastic-1", "default", false, "", true);

    expect(useSchemaStore.getState().collections).toEqual([
      expect.objectContaining({ name: "events-2026", type: "index" }),
    ]);
    expect(mocks.replaceResources).toHaveBeenCalledWith(
      "elastic-1",
      "elastic-1:elasticsearch:default",
      "COLLECTION",
      expect.any(Array),
      "sqls",
    );
  });
});
