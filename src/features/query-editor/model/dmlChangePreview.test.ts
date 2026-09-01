import { describe, expect, it } from "vitest";
import {
  dmlPreviewTabTitle,
  looksLikeDmlStatement,
} from "./dmlChangePreview";

describe("DML change preview presentation", () => {
  it("recognizes only leading update, insert, and delete statements", () => {
    expect(looksLikeDmlStatement(" UPDATE users SET enabled = true")).toBe(true);
    expect(looksLikeDmlStatement("\ninsert into users values (1)")).toBe(true);
    expect(looksLikeDmlStatement("DELETE FROM users")).toBe(true);
    expect(looksLikeDmlStatement("SELECT 'delete from users'")).toBe(false);
    expect(looksLikeDmlStatement("WITH source AS (SELECT 1) SELECT * FROM source")).toBe(false);
  });

  it("uses stable action-oriented preview titles", () => {
    expect(dmlPreviewTabTitle("update")).toBe("Preview update");
    expect(dmlPreviewTabTitle("INSERT")).toBe("Preview insert");
    expect(dmlPreviewTabTitle("unknown")).toBe("Preview changes");
  });
});
