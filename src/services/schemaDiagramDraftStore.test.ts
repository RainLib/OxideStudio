import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "@/services/tauri/types";
import {
  parsePersistedSchemaDiagramDraft,
  schemaDiagramDraftParentId,
} from "./schemaDiagramDraftStore";

const snapshot = {
  projectId: "project-a",
  connectionId: "connection-a",
  databaseName: "app",
  schemaName: "public",
} as SchemaSnapshot;

describe("schema diagram draft persistence", () => {
  it("scopes a draft to project, connection, database and schema", () => {
    const parentId = schemaDiagramDraftParentId(snapshot);
    expect(parentId).toContain("oxide:schema-diagram-drafts:v1:");
    expect(parentId).not.toBe(
      schemaDiagramDraftParentId({ ...snapshot, schemaName: "audit" }),
    );
    expect(parentId).not.toBe(
      schemaDiagramDraftParentId({ ...snapshot, projectId: "project-b" }),
    );
  });

  it("accepts a bounded, versioned draft payload", () => {
    const draft = parsePersistedSchemaDiagramDraft({
      version: 1,
      baseSnapshotId: "snapshot-1",
      baseFingerprint: "fingerprint-1",
      updatedAt: 42,
      relations: [
        { name: "users", columns: [], indexes: [], constraints: [] },
      ],
    });
    expect(draft?.relations[0]?.name).toBe("users");
    expect(draft?.updatedAt).toBe(42);
  });

  it("rejects corrupt or incompatible persisted payloads", () => {
    expect(parsePersistedSchemaDiagramDraft({ version: 2 })).toBeNull();
    expect(parsePersistedSchemaDiagramDraft({
      version: 1,
      baseSnapshotId: "snapshot-1",
      baseFingerprint: "fingerprint-1",
      updatedAt: Number.NaN,
      relations: [],
    })).toBeNull();
    expect(parsePersistedSchemaDiagramDraft({
      version: 1,
      baseSnapshotId: "snapshot-1",
      baseFingerprint: "fingerprint-1",
      updatedAt: 42,
      relations: [{ name: "users" }],
    })).toBeNull();
    expect(parsePersistedSchemaDiagramDraft({
      version: 1,
      baseSnapshotId: "snapshot-1",
      baseFingerprint: "fingerprint-1",
      updatedAt: 42,
      relations: [{
        name: "users",
        columns: [null],
        indexes: [],
        constraints: [],
      }],
    })).toBeNull();
  });
});
