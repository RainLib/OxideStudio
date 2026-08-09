import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "@/services/tauri/types";
import {
  normalizeSchemaDiagramCanvas,
  parsePersistedSchemaDiagramCanvas,
  schemaDiagramCanvasParentId,
} from "./schemaDiagramCanvasStore";

const snapshot = {
  version: 1,
  id: "snapshot-1",
  projectId: "project-a",
  connectionId: "connection-a",
  connectionName: "Local",
  driver: "postgres" as const,
  databaseName: "app",
  schemaName: "public",
  fingerprint: "fingerprint-2",
  capturedAt: 1,
  warnings: [],
  relations: [{ name: "users", columns: [], indexes: [], constraints: [] }],
} satisfies SchemaSnapshot;

const canvas = {
  version: 1 as const,
  baseFingerprint: "fingerprint-1",
  updatedAt: 42,
  areas: [{ id: "area-1", name: "Core", relationNames: ["users", "removed"] }],
  notes: [{
    id: "note-1",
    content: "Identity tables",
    x: 20,
    y: 40,
    width: 220,
    height: 120,
    color: "amber" as const,
  }],
};

describe("schema diagram canvas persistence", () => {
  it("scopes canvas state to the project database schema", () => {
    expect(schemaDiagramCanvasParentId(snapshot)).not.toBe(
      schemaDiagramCanvasParentId({ ...snapshot, schemaName: "audit" }),
    );
  });

  it("keeps notes and removes stale area members after a snapshot refresh", () => {
    const parsed = parsePersistedSchemaDiagramCanvas(canvas);
    expect(parsed).not.toBeNull();
    const normalized = normalizeSchemaDiagramCanvas(parsed!, snapshot);
    expect(normalized.areas[0]?.relationNames).toEqual(["users"]);
    expect(normalized.notes).toEqual(canvas.notes);
  });

  it("rejects malformed and duplicate canvas objects", () => {
    expect(parsePersistedSchemaDiagramCanvas({ ...canvas, version: 2 })).toBeNull();
    expect(parsePersistedSchemaDiagramCanvas({
      ...canvas,
      notes: [canvas.notes[0], canvas.notes[0]],
    })).toBeNull();
    expect(parsePersistedSchemaDiagramCanvas({
      ...canvas,
      notes: [{ ...canvas.notes[0], content: "x".repeat(4_001) }],
    })).toBeNull();
  });
});
