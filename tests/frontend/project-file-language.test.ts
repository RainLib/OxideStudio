import { describe, expect, it } from "vitest";
import {
  projectFileLanguage,
  projectFileModelUri,
} from "@/lib/projectFileLanguage";

describe("project file editor language", () => {
  it("enables SQL LSP only for SQL-capable connections", () => {
    expect(projectFileLanguage("queries/report.sql", "postgres")).toMatchObject({
      editorLanguageId: "sql",
      usesDatabaseLsp: true,
      executable: true,
    });
    expect(projectFileLanguage("queries/report.sql", "mongodb")).toMatchObject({
      editorLanguageId: "sql",
      usesDatabaseLsp: false,
      executable: false,
    });
  });

  it("uses JSON query support for document databases and plain editing otherwise", () => {
    expect(projectFileLanguage("queries/find.json", "mongodb")).toMatchObject({
      editorLanguageId: "json",
      usesDatabaseLsp: true,
      executable: true,
    });
    const markdown = projectFileLanguage("notes/readme.md", "postgres");
    expect(markdown).toMatchObject({
      editorLanguageId: "markdown",
      usesDatabaseLsp: false,
      executable: false,
    });
    expect(projectFileModelUri("tab 1", markdown)).toBe(
      "oxide://project-file/tab%201.markdown"
    );
  });
});
